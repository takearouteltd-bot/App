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
import { useDriverPosition } from '../../../utils/driverLocation';

import { currencySymbol } from '../../../utils/appConfig';
import SafetyButton from '../../../components/SafetyButton';
import { confirmMaskedCall } from '../../../utils/calling';
import { useWaitingClock } from '../../../utils/useWaitingClock';
import {
  COLORS, TYPE, SPACE, RADIUS, SHADOW,
  Avatar, Button, IconButton, RouteLine, Loading, StatRow, isCoord, validCoords,
} from '../../../components/ui/kit';

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

      if (data.status === 'ongoing') {
        hasLeftScreen.current = true;
        navigation.replace('RideToDropoff', { rideId });
        return;
      }

      // Passenger cancelled: tell the driver and free them for the next job.
      if (data.status === 'cancelled' || data.status === 'canceled') {
        hasLeftScreen.current = true;
        releaseDriver();
        Alert.alert('Job cancelled', 'The passenger cancelled this job.', [
          { text: 'OK', onPress: goHome },
        ]);
        return;
      }

      // The job is no longer this driver's: the server put it back to
      // "searching" (the passenger's card hold failed) or handed it to someone
      // else. Free the driver and say why.
      const me = auth.currentUser?.uid;
      const takenAway =
        data.status === 'searching' || (me && data.driverId && data.driverId !== me);
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
    return onSnapshot(doc(db, 'riders', ride.riderId), (snap) => {
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
      await updateDoc(doc(db, 'rides', rideId), {
        status: 'arrived',
        arrivedAt: serverTimestamp(),
        ...(awayM != null && awayM > ARRIVE_RADIUS_M
          ? { arrivedAwayFromPickupM: Math.round(awayM) }
          : {}),
      });
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
    const shown = awayM < 1000 ? `${Math.round(awayM)} m` : `${(awayM / 1000).toFixed(1)} km`;
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
      await updateDoc(doc(db, 'rides', rideId), {
        status: 'ongoing',
        startedAt: serverTimestamp(),
      });
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

  /* The driver gives the job back. It returns to "searching" so the next
     available driver can take it, and this driver is not offered it again. */
  const handleCancel = useCallback(() => {
    Alert.alert('Give this job back?', 'It will be offered to another driver.', [
      { text: 'Keep job', style: 'cancel' },
      {
        text: 'Give back',
        style: 'destructive',
        onPress: async () => {
          const id = driverIdRef.current;
          if (!id) return;
          setLoadingAction(true);
          try {
            hasLeftScreen.current = true;
            await updateDoc(doc(db, 'rides', rideId), {
              status: 'searching',
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
  }, [rideId, releaseDriver, goHome]);

  /* After arriving, the driver can end the job if the passenger does not show.
     The ride is cancelled outright (not re-offered), the card hold is released
     by the cancelRidePayment function, and the passenger is told. */
  const handleNoShow = useCallback(() => {
    Alert.alert(
      'Passenger has not turned up?',
      'The ride will be cancelled and the passenger told.',
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
  }, [rideId, releaseDriver, goHome]);

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
        customMapStyle={customMapStyle}
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
        <IconButton icon="chevron-back" onPress={goHome} accessibilityLabel="Back to home" />
        <View />
        <SafetyButton role="driver" rideId={rideId} />
      </SafeAreaView>

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
                  distance ? { value: `${distance} km`, label: 'Distance' } : null,
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
                {arrived ? 'Passenger has not turned up' : 'Give this job back'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        ) : null}
      </Animated.View>
    </View>
  );
}

const customMapStyle = [
  { elementType: 'geometry', stylers: [{ color: COLORS.surface }] },
  { elementType: 'labels.text.fill', stylers: [{ color: COLORS.muted }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: COLORS.white }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: COLORS.line }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: COLORS.fill }] },
];

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
