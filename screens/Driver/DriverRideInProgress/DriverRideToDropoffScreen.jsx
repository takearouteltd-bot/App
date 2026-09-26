import React, { useEffect, useState, useRef, useCallback } from 'react';
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
} from 'react-native';
import { Alert } from '../../../components/ui/alert';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, useNavigation } from '@react-navigation/native';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { currencySymbol, money, waitingCharge } from '../../../utils/appConfig';
import { navigationUrl, remainingStops, stopsOf } from '../../../utils/stops';
import { fetchRoute as fetchDrivingRoute, durationText, distanceText } from '../../../utils/routes';
import SafetyButton from '../../../components/SafetyButton';
import { confirmMaskedCall } from '../../../utils/calling';
import {
  COLORS, TYPE, SPACE, RADIUS, SHADOW,
  Avatar, Button, Chip, IconButton, Loading, StatRow, isCoord,
} from '../../../components/ui/kit';

const { height } = Dimensions.get('window');

// Within this many metres of the drop-off the trip counts as arrived.
const ARRIVAL_DISTANCE_M = 60;
// Completing further away than this asks the driver to confirm first.
const COMPLETE_RADIUS_KM = 0.5;
// The route is redrawn at most this often, to keep Directions calls sane.
const ROUTE_REFRESH_MS = 25000;

export default function DriverRideToDropoffScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { rideId } = route.params;

  const mapRef = useRef(null);
  const slideAnim = useRef(new Animated.Value(400)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const lastRouteAt = useRef(0);

  const [ride, setRide] = useState(null);
  const [riderData, setRiderData] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);
  const [routeCoords, setRouteCoords] = useState([]);
  const [arrived, setArrived] = useState(false);
  const [eta, setEta] = useState('');
  const [dropoffDistance, setDropoffDistance] = useState('');
  const [completing, setCompleting] = useState(false);
  const [followDriver, setFollowDriver] = useState(true);

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 600,
      delay: 250,
      useNativeDriver: true,
    }).start();
  }, [slideAnim]);

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

  /* ================= RIDE ================= */
  const leftScreen = useRef(false);

  useEffect(() => {
    if (!rideId) return undefined;
    return onSnapshot(doc(db, 'rides', rideId), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      setRide(data);

      // The passenger can end a trip early. Without this the driver's screen
      // sat on a journey that had already been called off.
      if ((data.status === 'cancelled' || data.status === 'canceled') && !leftScreen.current) {
        leftScreen.current = true;
        if (data.cancelledBy === 'rider') {
          Alert.alert('Trip ended', 'Your passenger ended this trip. You are free for the next job.');
        }
        if (data.driverId) {
          updateDoc(doc(db, 'drivers', data.driverId), {
            isOnRide: false,
            currentRideId: null,
            status: 'online',
          }).catch(() => null);
        }
        navigation.reset({ index: 0, routes: [{ name: 'DriverHome' }] });
      }
    });
  }, [rideId, navigation]);

  /* ================= WHERE THE DRIVER ACTUALLY IS =================
     The driver's own GPS, written to drivers/{id}.location by the home
     screen's watcher. This is the same position the passenger sees, so both
     sides of the trip agree. */
  useEffect(() => {
    if (!ride?.driverId) return undefined;

    return onSnapshot(doc(db, 'drivers', ride.driverId), (snap) => {
      if (!snap.exists()) return;
      const loc = snap.data().location;
      if (!loc || typeof loc.latitude !== 'number') return;

      const next = { latitude: loc.latitude, longitude: loc.longitude };
      setDriverLocation(next);
      if (followDriver) mapRef.current?.animateCamera({ center: next });
    });
  }, [ride?.driverId, followDriver]);

  useEffect(() => {
    if (!ride?.riderId) return undefined;
    return onSnapshot(doc(db, 'riders', ride.riderId), (snap) => {
      if (snap.exists()) setRiderData(snap.data());
    });
  }, [ride?.riderId]);

  /* ================= ROUTE ================= */
  // Through any stops not reached yet; the ETA shown is to the next point.
  const fetchRoute = useCallback(async (start, destination, stops = []) => {
    try {
      const route = await fetchDrivingRoute({ origin: start, destination, waypoints: stops });
      if (!route) return;

      setRouteCoords(route.coordinates);

      const leg = route.legs[0] || route;
      setEta(durationText(leg.duration));
      setDropoffDistance(distanceText(leg.distance));
    } catch (error) {
      console.log('Route fetch error:', error);
    }
  }, []);

  // Redrawn from where the driver is now, but not on every GPS tick.
  useEffect(() => {
    if (!isCoord(driverLocation) || !isCoord(ride?.dropoffLocation)) return;
    const now = Date.now();
    if (now - lastRouteAt.current < ROUTE_REFRESH_MS) return;
    lastRouteAt.current = now;
    fetchRoute(driverLocation, ride.dropoffLocation, remainingStops(ride));
  }, [driverLocation, ride?.dropoffLocation, ride?.stopsCompleted, fetchRoute]);

  /* ================= DISTANCE ================= */
  const metresBetween = (a, b) => {
    if (!a || !b) return null;
    const toRad = (x) => (x * Math.PI) / 180;
    const R = 6371000;
    const dLat = toRad(b.latitude - a.latitude);
    const dLon = toRad(b.longitude - a.longitude);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  };

  // Arrival is judged on the driver's real position, never a simulated one.
  useEffect(() => {
    const away = metresBetween(driverLocation, ride?.dropoffLocation);
    if (away === null) return;
    setArrived(away < ARRIVAL_DISTANCE_M);
  }, [driverLocation, ride?.dropoffLocation]);

  /* ================= COMPLETE =================
     Ending early is allowed (the passenger may ask to get out) but needs a
     confirmation and is flagged on the ride so support can see it if the fare
     is disputed. The button stays enabled so that path is reachable. */
  // What the passenger owes: the booked fare plus any waiting at pickup,
  // worked out the same way the payment function does.
  const amountDue = () => {
    const base = Number(ride?.fare?.total || 0);
    const arrivedMs = ride?.arrivedAt?.toMillis?.();
    const startedMs = ride?.startedAt?.toMillis?.();
    const waiting =
      arrivedMs && startedMs ? waitingCharge(startedMs - arrivedMs, ride?.waitingPolicy) : 0;
    return Math.round((base + waiting) * 100) / 100;
  };

  // Cash rides: the driver confirms they have been paid before the trip closes.
  const finish = (extra) => {
    if (ride?.paymentMethod !== 'cash') return completeRide(extra);
    Alert.alert(
      `Collect ${money(amountDue(), ride?.currency)} in cash`,
      'This is a cash ride. Take payment from the passenger, then confirm.',
      [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Cash received', onPress: () => completeRide({ ...extra, cashCollected: true }) },
      ]
    );
  };

  const handleCompleteRide = () => {
    if (completing) return;
    const awayM = metresBetween(driverLocation, ride?.dropoffLocation);
    const awayKm = awayM === null ? null : awayM / 1000;

    if (awayKm !== null && awayKm > COMPLETE_RADIUS_KM) {
      const shown = awayM < 1000 ? `${Math.round(awayM)} m` : `${awayKm.toFixed(1)} km`;
      Alert.alert(
        'You are not at the drop-off yet',
        `You are ${shown} away. Only complete the trip here if the passenger has asked to get out.`,
        [
          { text: 'Keep driving', style: 'cancel' },
          {
            text: 'Passenger got out here',
            style: 'destructive',
            onPress: () =>
              finish({
                completedAwayFromDropoff: true,
                completeDistanceKm: Number(awayKm.toFixed(2)),
              }),
          },
        ]
      );
      return;
    }

    finish({
      completedAwayFromDropoff: false,
      completeDistanceKm: awayKm === null ? null : Number(awayKm.toFixed(2)),
    });
  };

  const completeRide = async (extra) => {
    if (completing) return;
    setCompleting(true);

    try {
      await Promise.all([
        updateDoc(doc(db, 'rides', rideId), {
          status: 'completed',
          expiresAt: serverTimestamp(),
          completedAt: serverTimestamp(),
          ...extra,
        }),
        updateDoc(doc(db, 'drivers', ride.driverId), {
          isOnRide: false,
          currentRideId: null,
          status: 'online',
        }),
      ]);

      navigation.navigate('RideCompleted', { rideId });
    } catch (error) {
      console.log('Error completing ride:', error);
      Alert.alert('Could not complete', 'Please try again.');
      setCompleting(false);
    }
  };

  /* Abandoning a trip that has already started — a breakdown, a safety
     problem, a passenger who has to be put out. Distinct from "End trip here",
     which completes the journey and charges for it. This marks the ride
     cancelled, so the hold on the passenger's card is released. */
  const handleCancelTrip = () => {
    if (completing) return;
    Alert.alert(
      'Cancel this trip?',
      'Use this only if the journey cannot be finished. The passenger will not be charged, and you will not be paid for it.',
      [
        { text: 'Keep driving', style: 'cancel' },
        {
          text: 'Cancel trip',
          style: 'destructive',
          onPress: async () => {
            setCompleting(true);
            try {
              await Promise.all([
                updateDoc(doc(db, 'rides', rideId), {
                  status: 'cancelled',
                  cancelledBy: 'driver',
                  cancelReason: 'driver_ended_mid_trip',
                  endedEarly: true,
                  cancelledAt: serverTimestamp(),
                }),
                updateDoc(doc(db, 'drivers', ride.driverId), {
                  isOnRide: false,
                  currentRideId: null,
                  status: 'online',
                }),
              ]);
              leftScreen.current = true;
              navigation.reset({ index: 0, routes: [{ name: 'DriverHome' }] });
            } catch (error) {
              console.log('Error cancelling trip:', error);
              Alert.alert('Could not cancel', 'Please try again.');
              setCompleting(false);
            }
          },
        },
      ]
    );
  };

  const handleNavigate = () => {
    const point = ride?.dropoffLocation;
    if (!point?.latitude) return;
    Linking.openURL(navigationUrl(point, remainingStops(ride))).catch(() =>
      Alert.alert('Could not open maps', 'No maps app is available.')
    );
  };

  /* Stops: the driver ticks each one off as they reach it. */
  const [markingStop, setMarkingStop] = useState(false);
  const markStopReached = async () => {
    if (markingStop) return;
    setMarkingStop(true);
    try {
      await updateDoc(doc(db, 'rides', rideId), {
        stopsCompleted: (Number(ride?.stopsCompleted) || 0) + 1,
      });
    } catch (error) {
      Alert.alert('Could not update', 'Please try again.');
    } finally {
      setMarkingStop(false);
    }
  };

  if (!ride || !isCoord(driverLocation) || !isCoord(ride.dropoffLocation)) {
    return (
      <SafeAreaView style={styles.container}>
        <Loading label={ride ? 'Waiting for your location…' : 'Loading the trip…'} />
      </SafeAreaView>
    );
  }

  const destination = ride.dropoffLocation;
  const allStops = stopsOf(ride);
  const nextStop = remainingStops(ride)[0] || null;
  const stopNumber = (Number(ride.stopsCompleted) || 0) + 1;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

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
        onPanDrag={() => setFollowDriver(false)}
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

        {remainingStops(ride).map((s, i) => (
          <Marker key={`stop-${i}`} coordinate={s} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.stopMarker}>
              <Text style={styles.stopMarkerText}>{(Number(ride.stopsCompleted) || 0) + i + 1}</Text>
            </View>
          </Marker>
        ))}

        {isCoord(destination) ? (
          <Marker coordinate={destination} anchor={{ x: 0.5, y: 1 }}>
            <Ionicons name="location" size={32} color={COLORS.midnight} />
          </Marker>
        ) : null}

        {routeCoords.length ? (
          <Polyline coordinates={routeCoords} strokeColor={COLORS.midnight} strokeWidth={4} />
        ) : null}
      </MapView>

      <SafeAreaView style={styles.topBar} pointerEvents="box-none">
        <IconButton icon="chevron-back" onPress={() => navigation.goBack()} accessibilityLabel="Go back" />
        <View />
        <SafetyButton role="driver" rideId={rideId} />
      </SafeAreaView>

      <View style={styles.mapControls}>
        <IconButton
          icon={followDriver ? 'navigate' : 'locate'}
          onPress={() => {
            setFollowDriver(true);
            mapRef.current?.animateCamera({ center: driverLocation });
          }}
          accessibilityLabel="Follow my position"
        />
      </View>

      <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>
        <View style={styles.handle} />

        <View style={styles.headRow}>
          <View style={{ flex: 1 }}>
            <Text style={TYPE.heading}>
              {nextStop
                ? `Stop ${stopNumber} of ${allStops.length}`
                : arrived
                ? 'At the drop-off'
                : 'Driving to drop-off'}
            </Text>
            <Text style={[TYPE.small, { marginTop: 2 }]} numberOfLines={2}>
              {nextStop ? nextStop.address : destination?.address || 'Unknown destination'}
            </Text>
            {nextStop ? (
              <Button
                size="small"
                title={markingStop ? 'Saving…' : `Arrived at stop ${stopNumber}`}
                icon="flag"
                onPress={markStopReached}
                disabled={markingStop}
                style={styles.stopDone}
              />
            ) : null}
          </View>
          <View style={{ alignItems: 'flex-end', gap: SPACE[1] }}>
            <Text style={TYPE.figure}>
              {currencySymbol()}
              {Number(ride.fare?.total || 0).toFixed(2)}
            </Text>
            {ride.paymentMethod === 'cash' ? <Chip label="Cash" icon="cash-outline" /> : null}
          </View>
        </View>

        {eta ? (
          <StatRow
            style={styles.stats}
            items={[
              { value: eta, label: nextStop ? 'To next stop' : 'To drop-off' },
              dropoffDistance ? { value: dropoffDistance, label: 'Distance' } : null,
            ]}
          />
        ) : null}

        {riderData ? (
          <View style={styles.riderRow}>
            <Avatar
              uri={riderData.profileImage || riderData.photoURL}
              name={riderData.fullName}
              size={40}
            />
            <Text style={styles.riderName} numberOfLines={1}>
              {riderData.fullName || 'Passenger'}
            </Text>
            <View style={styles.contact}>
              <Button
                size="small"
                variant="secondary"
                icon="chatbubble-ellipses-outline"
                title="Message"
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
                onPress={() => confirmMaskedCall(rideId, 'your passenger')}
              />
            </View>
          </View>
        ) : null}

        <Button
          title={arrived ? 'Complete the trip' : 'End trip here'}
          variant={arrived ? 'primary' : 'secondary'}
          onPress={handleCompleteRide}
          disabled={completing}
          loading={completing}
        />

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
          style={styles.cancelTrip}
          onPress={handleCancelTrip}
          disabled={completing}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <Text style={styles.cancelTripText}>Cannot finish this trip?</Text>
        </TouchableOpacity>
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

  stopDone: { alignSelf: 'flex-start', marginTop: SPACE[3] },
  stopMarker: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.midnight,
    borderWidth: 2, borderColor: COLORS.white, alignItems: 'center', justifyContent: 'center',
  },
  stopMarkerText: { fontSize: 11, fontWeight: '800', color: COLORS.lime },

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

  mapControls: { position: 'absolute', right: SPACE[5], bottom: height * 0.42 },

  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: COLORS.white,
    borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SPACE[5], paddingTop: SPACE[3], paddingBottom: SPACE[8],
    ...SHADOW.sheet,
  },
  handle: {
    width: 44, height: 5, borderRadius: 3, backgroundColor: COLORS.lineStrong,
    alignSelf: 'center', marginBottom: SPACE[5],
  },

  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE[4] },

  stats: { marginTop: SPACE[5] },

  riderRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[3],
    marginTop: SPACE[5], paddingTop: SPACE[4], paddingBottom: SPACE[5],
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
  },
  riderName: { flex: 1, ...TYPE.subhead },
  contact: { flexDirection: 'row', gap: SPACE[2] },

  secondary: { marginTop: SPACE[3] },

  cancelTrip: { alignItems: 'center', paddingVertical: SPACE[4] },
  cancelTripText: { fontSize: 14, fontWeight: '700', color: COLORS.red },
});
