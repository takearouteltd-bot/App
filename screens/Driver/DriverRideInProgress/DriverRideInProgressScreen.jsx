import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Animated,
  Dimensions,
  StatusBar,
  Linking,
  ScrollView,
} from 'react-native';
import { Alert } from '../../../components/ui/alert';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import RouteDirections from '../../../components/RouteDirections';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, useNavigation } from '@react-navigation/native';
import { doc, onSnapshot, updateDoc, serverTimestamp, arrayUnion } from 'firebase/firestore';
import { auth, db } from '../../../config/firebase';
import { useDriverPosition, retryJobSharing } from '../../../utils/driverLocation';

import { currencySymbol, money } from '../../../utils/appConfig';
import { driverCancelPenalty, noShowFeeFor, noShowWaitMs } from '../../../utils/cancellation';
import { useAppConfig } from '../../../utils/appConfig';
import SafetyButton from '../../../components/SafetyButton';
import PaymentTypeBanner from '../../../components/PaymentTypeBanner';
import PhoneCustomerCard from '../../../components/PhoneCustomerCard';
import { confirmMaskedCall } from '../../../utils/calling';
import { useWaitingClock } from '../../../utils/useWaitingClock';
import {
  COLORS, TYPE, SPACE, RADIUS, SHADOW,
  Avatar, Banner, Button, RouteLine, Loading, StatRow, isCoord, validCoords,
} from '../../../components/ui/kit';
import { whenSaved } from '../../../utils/slowSave';
import { distanceText } from '../../../utils/routes';
import { DRIVER_MAP_STYLE } from '../../../utils/driverMapStyle';

const { height } = Dimensions.get('window');

const SHEET_OPEN = Math.min(height * 0.62, 560);
const SHEET_SHUT = 190;
// Marking "arrived" further than this from the pickup asks the driver first,
// because arriving starts the passenger's waiting meter.
const ARRIVE_RADIUS_M = 150;

const metresBetween = (a, b) => {
  if (!isCoord(a) || !isCoord(b)) return null;
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

export default function DriverRideInProgressScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { rideId } = route.params;

  const mapRef = useRef(null);
  const sheetHeight = useRef(new Animated.Value(SHEET_OPEN)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const [ride, setRide] = useState(null);
  // The phone's own GPS (session watcher) first; the Firestore mirror of it
  // as a fallback, e.g. on a cold resume before the first fix.
  const position = useDriverPosition();
  const appConfig = useAppConfig();
  const [mirroredLocation, setMirroredLocation] = useState(null);
  const liveLat = position.coords?.latitude;
  const liveLng = position.coords?.longitude;
  const driverLocation = useMemo(
    () =>
      Number.isFinite(liveLat) && Number.isFinite(liveLng)
        ? { latitude: liveLat, longitude: liveLng }
        : mirroredLocation,
    [liveLat, liveLng, mirroredLocation]
  );
  const [riderData, setRiderData] = useState(null);
  const [eta, setEta] = useState(null);
  const [distance, setDistance] = useState(null);
  const [loadingAction, setLoadingAction] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const waiting = useWaitingClock(ride);

  // Guards against leaving this screen twice (handler and listener both fire).
  const hasLeftScreen = useRef(false);
  const driverIdRef = useRef(null);

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.2, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  const goHome = useCallback(() => {
    navigation.reset({ index: 0, routes: [{ name: 'DriverHome' }] });
  }, [navigation]);

  // Clears the "on a job" flags and puts the driver back online.
  const releaseDriver = useCallback(async () => {
    const id = driverIdRef.current;
    if (!id) return;
    try {
      await updateDoc(doc(db, 'drivers', id), {
        isOnRide: false,
        currentRideId: null,
        status: 'online',
      });
    } catch (error) {
      console.log('Error releasing driver:', error);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'rides', rideId), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      setRide(data);
      if (data.driverId) driverIdRef.current = data.driverId;

      if (hasLeftScreen.current) return;

      // Decide only on what the server says. Straight after an accept the
      // cache still holds this job as "searching" from the job list (the
      // accept is a transaction, so it is not written locally first), and
      // acting on that told a driver who had just taken the job that it was
      // "no longer assigned" to them.
      if (snap.metadata.fromCache) return;

      if (data.status === 'ongoing') {
        hasLeftScreen.current = true;
        navigation.replace('RideToDropoff', { rideId });
        return;
      }

      // Passenger cancelled: tell the driver and free them for the next job.
      if (data.status === 'cancelled' || data.status === 'canceled') {
        hasLeftScreen.current = true;
        releaseDriver();
        Alert.alert(
          'Job cancelled',
          data.source === 'phone' ? 'The office cancelled this booking.' : 'The passenger cancelled this job.',
          [{ text: 'OK', onPress: goHome }]
        );
        return;
      }

      // The job is no longer this driver's: the server put it back to
      // "searching" (the passenger's card hold failed) or handed it to someone
      // else. Free the driver and say why.
      const me = auth.currentUser?.uid;
      const takenAway =
        data.status === 'searching' || data.status === 'dispatching' ||
        (me && data.driverId && data.driverId !== me);
      if (takenAway) {
        hasLeftScreen.current = true;
        releaseDriver();
        Alert.alert(
          'Job cancelled',
          data.paymentStatus === 'auth_failed'
            ? "This job was cancelled: the passenger's payment failed."
            : 'This job is no longer assigned to you.',
          [{ text: 'OK', onPress: goHome }]
        );
      }
    }, (error) => {
      // A phone job handed back to the office is no longer readable by
      // this driver (firestore.rules): the same as being taken away.
      if (error?.code !== 'permission-denied' || hasLeftScreen.current) return;
      hasLeftScreen.current = true;
      releaseDriver();
      Alert.alert('Job cancelled', 'This job is no longer assigned to you.', [{ text: 'OK', onPress: goHome }]);
    });
    return () => unsubscribe();
  }, [rideId, navigation, releaseDriver, goHome]);

  useEffect(() => {
    if (!ride?.driverId) return undefined;
    return onSnapshot(doc(db, 'drivers', ride.driverId), (snap) => {
      if (!snap.exists()) return;
      const driver = snap.data();
      if (driver.location) {
        setMirroredLocation({
          latitude: driver.location.latitude,
          longitude: driver.location.longitude,
        });
      }
    });
  }, [ride?.driverId]);

  useEffect(() => {
    if (!ride?.riderId) return undefined;
    return onSnapshot(doc(db, 'riderPublic', ride.riderId), (snap) => {
      if (snap.exists()) setRiderData(snap.data());
    });
  }, [ride?.riderId]);

  useEffect(() => {
    if (!ride || !driverLocation || !mapRef.current) return;
    const coords = validCoords(driverLocation, ride.pickupLocation);
    if (!coords.length) return;
    mapRef.current.fitToCoordinates(coords, {
      edgePadding: {
        top: 120,
        right: 60,
        bottom: (isMinimized ? SHEET_SHUT : SHEET_OPEN) + 40,
        left: 60,
      },
      animated: true,
    });
  }, [ride, driverLocation, isMinimized]);

  const toggleMinimize = useCallback(() => {
    const next = !isMinimized;
    setIsMinimized(next);
    Animated.timing(sheetHeight, {
      toValue: next ? SHEET_SHUT : SHEET_OPEN,
      duration: 260,
      useNativeDriver: false, // height cannot use the native driver
    }).start();
  }, [isMinimized, sheetHeight]);

  /* ================= ACTIONS ================= */
  const markArrived = useCallback(async (awayM) => {
    setLoadingAction(true);
    try {
      await whenSaved(updateDoc(doc(db, 'rides', rideId), {
        status: 'arrived',
        arrivedAt: serverTimestamp(),
        ...(awayM != null && awayM > ARRIVE_RADIUS_M
          ? { arrivedAwayFromPickupM: Math.round(awayM) }
          : {}),
      }), 'Arriving');
    } catch (error) {
      console.error('Error updating status:', error);
      Alert.alert('Could not update', 'Please try again.');
    } finally {
      setLoadingAction(false);
    }
  }, [rideId]);

  // Arriving starts the waiting meter, so it has to happen at the pickup.
  const handleArrived = useCallback(() => {
    const awayM = metresBetween(driverLocation, ride?.pickupLocation);
    if (awayM == null || awayM <= ARRIVE_RADIUS_M) return markArrived(awayM);
    const shown = distanceText(awayM / 1000);
    Alert.alert(
      "You're not at the pickup yet",
      `You're ${shown} from the pickup. Mark as arrived anyway?`,
      [
        { text: 'Keep driving', style: 'cancel' },
        { text: 'Mark as arrived', style: 'destructive', onPress: () => markArrived(awayM) },
      ]
    );
  }, [driverLocation, ride?.pickupLocation, markArrived]);

  const handleStartRide = useCallback(async () => {
    setLoadingAction(true);
    try {
      await whenSaved(updateDoc(doc(db, 'rides', rideId), {
        status: 'ongoing',
        startedAt: serverTimestamp(),
      }), 'Starting the trip');
      if (!hasLeftScreen.current) {
        hasLeftScreen.current = true;
        navigation.replace('RideToDropoff', { rideId });
      }
    } catch (error) {
      console.error('Error starting ride:', error);
      Alert.alert('Could not start', 'Please try again.');
      setLoadingAction(false);
    }
  }, [rideId, navigation]);

  /* The driver cancels the job. It returns to "searching" so the next
     available driver can take it (a fleet job goes back to the fleet), and
     this driver is not offered it again. The warning is an estimate; the
     server decides any penalty (functions/driverPenalty.js). */
  const handleCancel = useCallback(() => {
    const penalty = driverCancelPenalty(appConfig.cancellation, driverLocation, ride?.pickupLocation);
    let message = ride?.source === 'phone'
      ? 'It will go back to your fleet.'
      : 'It will be offered to another driver.';
    if (penalty?.type === 'money') {
      message += ` ${money(penalty.amount, ride?.currency)} will be taken from your balance as a penalty.`;
    } else if (penalty?.type === 'time') {
      message += ` As a penalty you won't be able to go online for ${penalty.minutes} minute${penalty.minutes === 1 ? '' : 's'}.`;
    }
    Alert.alert('Cancel this job?', message, [
      { text: 'Keep job', style: 'cancel' },
      {
        text: 'Cancel job',
        style: 'destructive',
        onPress: async () => {
          const id = driverIdRef.current;
          if (!id) return;
          setLoadingAction(true);
          try {
            hasLeftScreen.current = true;
            await updateDoc(doc(db, 'rides', rideId), {
              // A fleet's phone booking goes back to its office to resend.
              status: ride?.source === 'phone' ? 'dispatching' : 'searching',
              driverId: null,
              acceptedAt: null,
              declinedBy: arrayUnion(id),
              lastDriverCancelAt: serverTimestamp(),
            });
            await releaseDriver();
            goHome();
          } catch (error) {
            hasLeftScreen.current = false;
            console.error('Error cancelling job:', error);
            Alert.alert('Could not cancel', 'Please try again.');
            setLoadingAction(false);
          }
        },
      },
    ]);
  }, [rideId, releaseDriver, goHome, ride?.source, ride?.currency, ride?.pickupLocation, appConfig.cancellation, driverLocation]);

  /* After arriving, the driver can end the job if the passenger does not show.
     The ride is cancelled outright (not re-offered) and the passenger told.
     cancelRidePayment takes the no-show fee from the card hold if the driver
     waited long enough (utils/cancellation.js), and releases the rest. */
  const handleNoShow = useCallback(() => {
    const fee = noShowFeeFor(ride);
    const policyFee = Number(ride?.cancellationPolicy?.arrivedFee) || 0;
    const arrivedMs = ride?.arrivedAt?.toMillis?.();
    const leftMin = arrivedMs
      ? Math.ceil((arrivedMs + noShowWaitMs(ride) - Date.now()) / 60000)
      : 0;
    let message = 'The ride will be cancelled and the passenger told.';
    if (fee > 0) {
      message += ` The passenger is charged a ${money(fee, ride?.currency)} no-show fee.`;
    } else if (policyFee > 0 && ride?.paymentMethod !== 'cash' && leftMin > 0) {
      message += ` Wait ${leftMin} more minute${leftMin === 1 ? '' : 's'} and the passenger is charged a no-show fee; cancelling now is free for them.`;
    }
    Alert.alert(
      'Passenger has not turned up?',
      message,
      [
        { text: 'Keep waiting', style: 'cancel' },
        {
          text: 'Cancel ride',
          style: 'destructive',
          onPress: async () => {
            setLoadingAction(true);
            try {
              hasLeftScreen.current = true;
              await updateDoc(doc(db, 'rides', rideId), {
                status: 'cancelled',
                cancelledBy: 'driver',
                cancelReason: 'passenger_no_show',
                cancelledAt: serverTimestamp(),
              });
              await releaseDriver();
              goHome();
            } catch (error) {
              hasLeftScreen.current = false;
              console.error('Error cancelling ride:', error);
              Alert.alert('Could not cancel', 'Please try again.');
              setLoadingAction(false);
            }
          },
        },
      ]
    );
  }, [rideId, ride, releaseDriver, goHome]);

  // Turn-by-turn directions to the pickup in the phone's maps app.
  const handleNavigate = useCallback(() => {
    const point = ride?.pickupLocation;
    if (!point?.latitude || !point?.longitude) {
      Alert.alert('No pickup location', 'This job has no pickup coordinates.');
      return;
    }
    Linking.openURL(
      `https://www.google.com/maps/dir/?api=1&destination=${point.latitude},${point.longitude}&travelmode=driving`
    ).catch(() => Alert.alert('Could not open maps', 'No maps app is available.'));
  }, [ride]);

  if (!ride || !driverLocation) {
    return (
      <SafeAreaView style={styles.container}>
        <Loading label="Loading the job…" />
      </SafeAreaView>
    );
  }

  const { pickupLocation, dropoffLocation, status, fare } = ride;
  const arrived = status === 'arrived';
  const action = arrived
    ? { label: 'Start the ride', onPress: handleStartRide }
    : { label: "I've arrived", onPress: handleArrived };

  // Shown only when the passenger has actually been rated, never a stand-in.
  const riderRating =
    Number(riderData?.rating) > 0 ? Number(riderData.rating).toFixed(1) : null;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        customMapStyle={DRIVER_MAP_STYLE}
        initialRegion={{
          latitude: driverLocation.latitude,
          longitude: driverLocation.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
        showsCompass={false}
        toolbarEnabled={false}
      >
        <Marker coordinate={driverLocation} anchor={{ x: 0.5, y: 0.5 }} flat>
          <View style={styles.markerWrap}>
            <Animated.View style={[styles.markerPulse, { transform: [{ scale: pulseAnim }] }]} />
            <View style={styles.driverMarker}>
              <Ionicons name="car-sport" size={16} color={COLORS.lime} />
            </View>
          </View>
        </Marker>

        {isCoord(pickupLocation) ? (
          <Marker coordinate={pickupLocation} anchor={{ x: 0.5, y: 1 }}>
            <Ionicons name="location" size={32} color={COLORS.midnight} />
          </Marker>
        ) : null}

        {isCoord(pickupLocation) ? (
        <RouteDirections
          origin={driverLocation}
          destination={pickupLocation}
          strokeWidth={4}
          strokeColor={COLORS.midnight}
          onReady={(result) => {
            setEta(Math.ceil(result.duration));
            setDistance(result.distance.toFixed(1));
          }}
        />
        ) : null}
      </MapView>

      <SafeAreaView style={styles.topBar} pointerEvents="box-none">
        {/* No back button: the home screen resumes a live job, so it only
            brought the driver straight back here. */}
        <View />
        <View />
        <SafetyButton role="driver" rideId={rideId} />
      </SafeAreaView>

      {position.jobSharing === 'failed' ? (
        <View style={styles.shareWarning}>
          <Banner
            tone="warning"
            title="Your passenger can’t follow you"
            body="Your location only updates while TakeARoute is open. Allow location for the app and keep it on screen, or tap Try again."
            action={<Button size="small" title="Try again" onPress={() => retryJobSharing(ride.driverId)} />}
          />
        </View>
      ) : null}

      <Animated.View style={[styles.sheet, { height: sheetHeight }]}>
        <TouchableOpacity
          style={styles.handle}
          onPress={toggleMinimize}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={isMinimized ? 'Expand details' : 'Collapse details'}
        >
          <View style={styles.handleBar} />
        </TouchableOpacity>

        <View style={styles.headRow}>
          <View style={{ flex: 1 }}>
            <Text style={TYPE.heading}>{arrived ? 'At the pickup' : 'Heading to pickup'}</Text>
            {waiting ? (
              <Text
                style={[styles.waiting, { color: waiting.inFreeTime ? COLORS.limeInk : COLORS.amber }]}
              >
                {waiting.label}
              </Text>
            ) : (
              <Text style={TYPE.small}>
                {arrived ? 'Waiting for your passenger.' : 'Follow the route to your passenger.'}
              </Text>
            )}
          </View>
          <Text style={TYPE.figure}>
            {currencySymbol()}
            {Number(fare?.total || 0).toFixed(2)}
          </Text>
        </View>

        <PaymentTypeBanner method={ride.paymentMethod} collectBy={ride.collectBy} account={ride.account} style={{ marginBottom: SPACE[4] }} />

        {/* Stays reachable even with the sheet collapsed. */}
        <Button
          title={action.label}
          onPress={action.onPress}
          disabled={loadingAction}
          loading={loadingAction}
        />

        {!isMinimized ? (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: SPACE[5] }}
            showsVerticalScrollIndicator={false}
          >
            {eta ? (
              <StatRow
                style={styles.stats}
                items={[
                  { value: `${eta} min`, label: 'To pickup' },
                  distance ? { value: distanceText(Number(distance)), label: 'Distance' } : null,
                ]}
              />
            ) : null}

            {riderData ? (
              <View style={styles.riderCard}>
                <View style={styles.riderRow}>
                  <Avatar
                    uri={riderData.profileImage || riderData.photoURL}
                    name={riderData.fullName || riderData.name}
                    size={48}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={TYPE.subhead} numberOfLines={1}>
                      {riderData.fullName || riderData.name || 'Passenger'}
                    </Text>
                    <View style={styles.ratingRow}>
                      {riderRating ? <Ionicons name="star" size={13} color={COLORS.star} /> : null}
                      <Text style={TYPE.small}>{riderRating ? riderRating : 'No rating yet'}</Text>
                    </View>
                  </View>
                </View>
                <View style={styles.contact}>
                  <Button
                    size="small"
                    variant="secondary"
                    icon="chatbubble-ellipses-outline"
                    title="Message"
                    style={{ flex: 1 }}
                    onPress={() =>
                      navigation.navigate('ChatScreen', {
                        rideId,
                        currentUser: { uid: ride.driverId },
                        userType: 'driver',
                        otherUserName: riderData?.fullName || 'Passenger',
                        otherUserPhoto: riderData?.profileImage || riderData?.photoURL,
                      })
                    }
                  />
                  <Button
                    size="small"
                    variant="secondary"
                    icon="call-outline"
                    title="Call"
                    style={{ flex: 1 }}
                    onPress={() => confirmMaskedCall(rideId, 'your passenger')}
                  />
                </View>
              </View>
            ) : null}

            {ride?.source === 'phone' ? <PhoneCustomerCard ride={ride} /> : null}

            <View style={styles.journey}>
              <RouteLine
                compact
                pickup={pickupLocation?.address}
                dropoff={dropoffLocation?.address}
              />
            </View>

            {!arrived ? (
              <Button
                title="Open in Maps"
                icon="navigate"
                variant="dark"
                onPress={handleNavigate}
                style={styles.secondary}
              />
            ) : null}

            <TouchableOpacity
              style={styles.giveBack}
              onPress={arrived ? handleNoShow : handleCancel}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              <Text style={styles.giveBackText}>
                {arrived ? 'Passenger has not turned up' : 'Cancel job'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        ) : null}
      </Animated.View>
    </View>
  );
}


const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface },

  markerWrap: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  markerPulse: {
    position: 'absolute', width: 46, height: 46, borderRadius: 23,
    backgroundColor: COLORS.lime, opacity: 0.45,
  },
  driverMarker: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: COLORS.midnight,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: COLORS.white,
  },

  shareWarning: { position: 'absolute', top: 120, left: SPACE[5], right: SPACE[5] },
  topBar: {
    position: 'absolute', top: 0, left: SPACE[5], right: SPACE[5],
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: SPACE[3],
  },

  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: COLORS.white,
    borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SPACE[5], paddingBottom: SPACE[6],
    ...SHADOW.sheet,
  },
  handle: { alignItems: 'center', paddingVertical: SPACE[3] },
  handleBar: { width: 44, height: 5, borderRadius: 3, backgroundColor: COLORS.lineStrong },

  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE[4], marginBottom: SPACE[4] },
  waiting: { fontSize: 13, fontWeight: '700', marginTop: 2 },

  stats: { marginTop: SPACE[5] },

  riderCard: {
    marginTop: SPACE[5], paddingTop: SPACE[5],
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
    gap: SPACE[4],
  },
  riderRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE[3] },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  contact: { flexDirection: 'row', gap: SPACE[2] },

  journey: {
    marginTop: SPACE[5], paddingTop: SPACE[5],
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
  },

  secondary: { marginTop: SPACE[5] },

  giveBack: { alignItems: 'center', paddingVertical: SPACE[5] },
  giveBackText: { fontSize: 14, fontWeight: '700', color: COLORS.red },
});
