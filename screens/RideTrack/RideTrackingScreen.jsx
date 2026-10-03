import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
} from 'react-native';
import { Alert } from '../../components/ui/alert';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import CarMarker from '../../components/CarMarker';
import { remainingStops } from '../../utils/stops';
import RouteDirections from '../../components/RouteDirections';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '../../config/firebase';
import { useWaitingClock } from '../../utils/useWaitingClock';
import SafetyButton from '../../components/SafetyButton';
import { confirmMaskedCall } from '../../utils/calling';
import {
  COLORS,
  TYPE,
  SPACE,
  RADIUS,
  Screen,
  Sheet,
  Card,
  Button,
  Banner,
  Avatar,
  PresenceDot,
  IconButton,
  RouteLine,
  Loading,
  MapUnavailable,
  isCoord,
  validCoords,
  regionCovering,
} from '../../components/ui/kit';
import { cancellationFeeFor } from '../../utils/cancellation';
import { money } from '../../utils/appConfig';


const STATUS = {
  accepted: { title: 'Driver on the way', detail: 'Heading to your pickup point.' },
  arrived: { title: 'Your driver has arrived', detail: 'Meet them at the pickup point.' },
  ongoing: { title: 'On your way', detail: 'Heading to your destination.' },
};

export default function RideTrackingScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { rideId } = route.params;

  const mapRef = useRef(null);

  const [rideData, setRideData] = useState(null);
  const [driverData, setDriverData] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);
  const waiting = useWaitingClock(rideData);
  // "Track driver": the sheet shrinks to one line so the map shows the car
  // coming to the pickup, and the map follows it.
  const [tracking, setTracking] = useState(false);
  const [etaMinutes, setEtaMinutes] = useState(null);
  const [sheetHeight, setSheetHeight] = useState(380);

  const hasNavigatedToProgress = useRef(false);
  // One driver listener at a time. Previously a new one was opened on every
  // ride update and never closed.
  const driverUnsubRef = useRef(null);
  const listeningDriverId = useRef(null);

  const listenToDriver = (driverId) =>
    onSnapshot(doc(db, 'drivers', driverId), (snap) => {
      if (!snap.exists()) return;
      const driver = snap.data();
      setDriverData(driver);
      if (isCoord(driver.location)) {
        setDriverLocation({
          latitude: driver.location.latitude,
          longitude: driver.location.longitude,
          heading: typeof driver.heading === 'number' ? driver.heading : null,
        });
      }
    });

  useEffect(() => {
    const stopDriverListener = () => {
      if (driverUnsubRef.current) {
        driverUnsubRef.current();
        driverUnsubRef.current = null;
      }
      listeningDriverId.current = null;
    };

    const unsubscribe = onSnapshot(doc(db, 'rides', rideId), (snap) => {
      if (!snap.exists()) return;
      if (hasNavigatedToProgress.current) return;

      const data = snap.data();
      setRideData(data);

      if (data.status === 'ongoing') {
        hasNavigatedToProgress.current = true;
        navigation.replace('RideInProgress', { rideId });
        return;
      }

      // Back to searching: the driver gave the job back, or the card hold
      // failed (RideRequest explains that one itself).
      if (data.status === 'searching') {
        hasNavigatedToProgress.current = true;
        if (data.paymentStatus !== 'auth_failed') {
          Alert.alert(
            'Finding you another driver',
            'Your driver had to cancel. We are looking for a new one now.'
          );
        }
        navigation.replace('RideRequest', { rideId });
        return;
      }

      // Opened late (for example from a chat notification) after the trip
      // already ended: go to the summary instead of "driver on the way".
      if (data.status === 'completed') {
        hasNavigatedToProgress.current = true;
        navigation.reset({
          index: 0,
          routes: [{ name: 'RiderRideCompleted', params: { rideId } }],
        });
        return;
      }

      if (data.status === 'cancelled' || data.status === 'canceled') {
        hasNavigatedToProgress.current = true;
        if (data.cancelledBy === 'driver') {
          Alert.alert(
            'Ride cancelled',
            'Your driver cancelled this ride. You have not been charged.'
          );
        }
        navigation.popToTop();
        return;
      }

      if (data.driverId && listeningDriverId.current !== data.driverId) {
        stopDriverListener();
        listeningDriverId.current = data.driverId;
        driverUnsubRef.current = listenToDriver(data.driverId);
      }
    });

    return () => {
      unsubscribe();
      stopDriverListener();
    };
  }, [rideId, navigation]);

  /* The map used to have no starting region, and this bailed out until the
     driver's location arrived, leaving it at 0,0 — the sea off West Africa.
     It now starts on the pickup and fits without the driver if needed. */
  const recenterMap = () => {
    if (!rideData) return;
    const coming = rideData.status === 'accepted' || rideData.status === 'arrived';
    // Before pickup only the driver and the pickup matter; the destination
    // would zoom the map out until the car is a dot.
    const coords = coming && driverLocation
      ? validCoords(driverLocation, rideData.pickupLocation)
      : validCoords(rideData.pickupLocation, rideData.dropoffLocation, driverLocation);
    if (!coords.length) return;
    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 130, right: 70, bottom: sheetHeight + 50, left: 70 },
      animated: true,
    });
  };

  // While tracking, keep the car and the pickup in view as the car moves
  // (at most every 4 s, so the map isn't constantly animating).
  const lastFollow = useRef(0);
  useEffect(() => {
    if (!tracking || !driverLocation) return;
    const now = Date.now();
    if (now - lastFollow.current < 4000) return;
    lastFollow.current = now;
    recenterMap();
  }, [tracking, driverLocation, sheetHeight]);

  const startTracking = () => {
    lastFollow.current = 0;
    setTracking(true);
  };

  const hasFitDriver = useRef(false);
  useEffect(() => {
    if (!rideData || !driverLocation || hasFitDriver.current) return;
    hasFitDriver.current = true;
    recenterMap();
  }, [rideData, driverLocation]);

  const handleChat = () => {
    navigation.navigate('ChatScreen', {
      rideId,
      currentUser: { uid: rideData.riderId },
      userType: 'rider',
      otherUserName: driverData?.fullName || 'Driver',
      otherUserPhoto: driverData?.selfieUrl,
    });
  };

  // Masked call through Twilio. Neither side sees a real number.
  const handleCall = () => confirmMaskedCall(rideId, 'your driver');

  const handleCancelRide = () => {
    // Say what it costs before they confirm, from the ride's own terms.
    const fee = cancellationFeeFor(rideData);
    const message = fee > 0
      ? `Your driver has been on the way for a while, so a ${money(fee, rideData?.currency)} cancellation fee will be charged to your card.`
      : 'Your driver will be told straight away. There is no charge.';
    Alert.alert('Cancel this ride?', message, [
      { text: 'Keep ride', style: 'cancel' },
      {
        text: 'Cancel ride',
        style: 'destructive',
        onPress: async () => {
          try {
            await updateDoc(doc(db, 'rides', rideId), {
              status: 'cancelled',
              cancelledBy: 'rider',
              cancelledAt: serverTimestamp(),
            });
            const uid = getAuth().currentUser?.uid;
            if (uid) {
              updateDoc(doc(db, 'riders', uid), { currentRideId: null }).catch((e) =>
                console.log('Error clearing currentRideId:', e)
              );
            }
          } catch (error) {
            console.log('Error cancelling ride:', error);
            Alert.alert('Could not cancel', 'Please try again.');
          }
        },
      },
    ]);
  };

  if (!rideData) {
    return (
      <Screen scroll={false}>
        <Loading label="Loading your ride…" />
      </Screen>
    );
  }

  const { pickupLocation, dropoffLocation, status } = rideData;
  const state = STATUS[status] || STATUS.accepted;
  const beforePickup = status === 'accepted' || status === 'arrived';

  // While the driver is still coming to you, the line that matters is theirs
  // to the pickup — not yours to the destination.
  const routeFrom = beforePickup && driverLocation ? driverLocation : pickupLocation;
  const routeTo = beforePickup ? pickupLocation : dropoffLocation;
  const drawRoute =
    isCoord(routeFrom) &&
    isCoord(routeTo) &&
    !(routeFrom.latitude === routeTo.latitude && routeFrom.longitude === routeTo.longitude);

  // Without this the map falls back to 0,0 and opens on the Gulf of Guinea.
  const initialRegion = regionCovering([pickupLocation, dropoffLocation], 0.05);

  const rating = driverData?.rating ? Number(driverData.rating).toFixed(1) : null;

  return (
    <SafeAreaView style={styles.container}>
      {initialRegion ? (
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        onMapReady={recenterMap}
        initialRegion={initialRegion}
        showsCompass={false}
        toolbarEnabled={false}
      >
        {isCoord(pickupLocation) ? (
          <Marker coordinate={pickupLocation} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.pickupMarker} />
          </Marker>
        ) : null}

        {isCoord(dropoffLocation) ? (
          <Marker coordinate={dropoffLocation} anchor={{ x: 0.5, y: 1 }}>
            <Ionicons name="location" size={30} color={COLORS.midnight} />
          </Marker>
        ) : null}

        {driverLocation ? (
          <CarMarker
            coordinate={{ latitude: driverLocation.latitude, longitude: driverLocation.longitude }}
            heading={driverLocation.heading}
            tone="green"
            size={1.15}
          />
        ) : null}

        {drawRoute ? (
          <RouteDirections
            origin={routeFrom}
            destination={routeTo}
            waypoints={beforePickup ? [] : remainingStops(rideData)}
            strokeWidth={5}
            strokeColor={COLORS.midnight}
            onReady={(r) => setEtaMinutes(beforePickup ? Math.max(1, Math.round(r.duration)) : null)}
          />
        ) : null}
      </MapView>
      ) : (
        <View style={StyleSheet.absoluteFill}>
          <MapUnavailable note="We do not have map coordinates for this trip." />
        </View>
      )}

      <View style={styles.topBar}>
        <IconButton icon="chevron-back" onPress={() => navigation.goBack()} accessibilityLabel="Go back" />
        <View style={styles.topRight}>
          <SafetyButton role="rider" rideId={rideId} />
          <IconButton icon="locate" onPress={recenterMap} accessibilityLabel="Recentre the map" />
        </View>
      </View>

      {tracking ? (
        <View style={styles.sheet} onLayout={(e) => setSheetHeight(e.nativeEvent.layout.height)}>
          <Sheet>
            <View style={styles.trackRow}>
              <Avatar uri={driverData?.selfieUrl} name={driverData?.fullName} size={44} />
              <View style={{ flex: 1 }}>
                <Text style={styles.trackTitle} numberOfLines={1}>
                  {status === 'arrived'
                    ? 'Your driver has arrived'
                    : etaMinutes
                      ? `Arriving in ${etaMinutes} min`
                      : state.title}
                </Text>
                <Text style={TYPE.small} numberOfLines={1}>
                  {[driverData?.fullName, driverData?.registrationNumber?.toUpperCase()]
                    .filter(Boolean)
                    .join(' · ') || 'Your driver'}
                </Text>
              </View>
              <IconButton icon="call-outline" onPress={handleCall} accessibilityLabel="Call your driver" />
              <IconButton
                icon="chevron-up"
                tone="dark"
                onPress={() => setTracking(false)}
                accessibilityLabel="Show ride details"
              />
            </View>
          </Sheet>
        </View>
      ) : (
      <View style={styles.sheet} onLayout={(e) => setSheetHeight(e.nativeEvent.layout.height)}>
      <Sheet>
        <Text style={TYPE.label}>Your ride</Text>
        <Text style={TYPE.title}>{state.title}</Text>
        <Text style={[TYPE.small, { marginTop: SPACE[1] }]}>
          {beforePickup && etaMinutes && status === 'accepted'
            ? `About ${etaMinutes} min away. ${state.detail}`
            : state.detail}
        </Text>

        {beforePickup && driverLocation ? (
          <Button
            title="Track driver"
            icon="navigate"
            style={{ marginTop: SPACE[4] }}
            onPress={startTracking}
          />
        ) : null}

        {waiting ? (
          <View style={{ marginTop: SPACE[4] }}>
            <Banner
              tone={waiting.inFreeTime ? 'info' : 'warning'}
              icon="time-outline"
              title={waiting.label}
              body={waiting.detail}
            />
          </View>
        ) : null}

        {driverData ? (
          <Card style={styles.driverCard}>
            <Avatar
              uri={driverData.selfieUrl}
              name={driverData.fullName}
              size={52}
              badge={<PresenceDot online />}
            />

            <View style={{ flex: 1 }}>
              <Text style={styles.driverName} numberOfLines={1}>
                {driverData.fullName || 'Your driver'}
              </Text>
              <View style={styles.vehicleRow}>
                <Text style={[TYPE.small, { flexShrink: 1 }]} numberOfLines={1}>
                  {[driverData.vehicleColor, driverData.makeModel].filter(Boolean).join(' ') ||
                    'Vehicle'}
                </Text>
                {rating ? (
                  <View style={styles.rating}>
                    <Ionicons name="star" size={13} color={COLORS.star} />
                    <Text style={styles.ratingText}>{rating}</Text>
                  </View>
                ) : null}
              </View>
              {driverData.registrationNumber ? (
                <View style={styles.plate}>
                  <Text style={styles.plateText}>
                    {driverData.registrationNumber.toUpperCase()}
                  </Text>
                </View>
              ) : null}
            </View>
          </Card>
        ) : null}

        {driverData ? (
          <View style={styles.contact}>
            <Button
              title="Message"
              icon="chatbubble-ellipses-outline"
              variant="secondary"
              size="small"
              style={{ flex: 1 }}
              onPress={handleChat}
            />
            <Button
              title="Call"
              icon="call-outline"
              variant="secondary"
              size="small"
              style={{ flex: 1 }}
              onPress={handleCall}
            />
          </View>
        ) : null}

        <View style={styles.journey}>
          <RouteLine compact pickup={pickupLocation.address} dropoff={dropoffLocation.address} />
        </View>

        {/* The trip screen opens by itself when the driver starts the ride. */}
        {beforePickup ? (
          <TouchableOpacity
            style={styles.cancel}
            onPress={handleCancelRide}
            activeOpacity={0.8}
            accessibilityRole="button"
          >
            <Text style={styles.cancelText}>Cancel ride</Text>
          </TouchableOpacity>
        ) : null}
      </Sheet>
      </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface },

  pickupMarker: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: COLORS.lime, borderWidth: 3, borderColor: COLORS.midnight,
  },

  topBar: {
    position: 'absolute', top: SPACE[3], left: SPACE[5], right: SPACE[5],
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  topRight: { flexDirection: 'row', gap: SPACE[2] },

  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  trackRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE[3], paddingBottom: SPACE[2] },
  trackTitle: { ...TYPE.subhead, fontSize: 18, color: COLORS.midnight },

  driverCard: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[3],
    marginTop: SPACE[4], padding: SPACE[4],
  },
  driverName: { ...TYPE.subhead, fontSize: 17, color: COLORS.midnight },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE[2], marginTop: 2 },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  ratingText: { ...TYPE.caption, color: COLORS.inkSoft, fontWeight: '700' },
  plate: {
    alignSelf: 'flex-start', marginTop: SPACE[2],
    backgroundColor: COLORS.fill,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACE[3], paddingVertical: 4,
  },
  plateText: { fontSize: 13, fontWeight: '800', color: COLORS.midnight, letterSpacing: 1 },
  contact: { flexDirection: 'row', gap: SPACE[2], marginTop: SPACE[3] },

  journey: {
    marginTop: SPACE[4], paddingTop: SPACE[4],
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
  },

  // A quiet red pill: destructive, but not the screen's main action.
  cancel: {
    minHeight: 52, marginTop: SPACE[4],
    alignItems: 'center', justifyContent: 'center',
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.redSoft,
  },
  cancelText: { fontSize: 16, fontWeight: '800', color: COLORS.red, letterSpacing: -0.2 },
});
