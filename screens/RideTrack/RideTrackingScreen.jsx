import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
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
  SHADOW,
  Avatar,
  IconButton,
  RouteLine,
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
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const [rideData, setRideData] = useState(null);
  const [driverData, setDriverData] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);
  const waiting = useWaitingClock(rideData);

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

      // Driver gave the job back: return to the searching screen.
      if (data.status === 'searching') {
        hasNavigatedToProgress.current = true;
        Alert.alert(
          'Finding you another driver',
          'Your driver had to cancel. We are looking for a new one now.'
        );
        navigation.replace('RideRequest', { rideId });
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

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.4, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  /* The map used to have no starting region, and this bailed out until the
     driver's location arrived, leaving it at 0,0 — the sea off West Africa.
     It now starts on the pickup and fits without the driver if needed. */
  const recenterMap = () => {
    if (!rideData) return;
    const coords = validCoords(rideData.pickupLocation, rideData.dropoffLocation, driverLocation);
    if (!coords.length) return;
    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 120, right: 60, bottom: 380, left: 60 },
      animated: true,
    });
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
      <SafeAreaView style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={[TYPE.small, { marginTop: SPACE[4] }]}>Loading your ride…</Text>
      </SafeAreaView>
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
            <Ionicons name="location" size={30} color={COLORS.navy} />
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
            strokeWidth={4}
            strokeColor={COLORS.primary}
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

      <View style={styles.sheet}>
        <View style={styles.grabber} />

        <Text style={TYPE.title}>{state.title}</Text>
        <Text style={[TYPE.small, { marginTop: SPACE[1] }]}>{state.detail}</Text>

        {waiting ? (
          <View
            style={[
              styles.waiting,
              waiting.inFreeTime ? styles.waitingFree : styles.waitingCharged,
            ]}
          >
            <Ionicons
              name="time-outline"
              size={18}
              color={waiting.inFreeTime ? COLORS.blue : COLORS.amber}
            />
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.waitingLabel,
                  { color: waiting.inFreeTime ? COLORS.blue : COLORS.amber },
                ]}
              >
                {waiting.label}
              </Text>
              <Text style={TYPE.small}>{waiting.detail}</Text>
            </View>
          </View>
        ) : null}

        {driverData ? (
          <View style={styles.driverCard}>
            <Avatar uri={driverData.selfieUrl} name={driverData.fullName} size={52} />

            <View style={{ flex: 1 }}>
              <Text style={styles.driverName} numberOfLines={1}>
                {driverData.fullName || 'Your driver'}
              </Text>
              <Text style={TYPE.small} numberOfLines={1}>
                {[driverData.vehicleColor, driverData.makeModel].filter(Boolean).join(' ') ||
                  'Vehicle'}
                {rating ? ` · ★ ${rating}` : ''}
              </Text>
              {driverData.registrationNumber ? (
                <View style={styles.plate}>
                  <Text style={styles.plateText}>
                    {driverData.registrationNumber.toUpperCase()}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={styles.contact}>
              <IconButton icon="chatbubble-ellipses" onPress={handleChat} size={42} accessibilityLabel="Message your driver" />
              <IconButton icon="call" onPress={handleCall} size={42} tone="dark" accessibilityLabel="Call your driver" />
            </View>
          </View>
        ) : null}

        <View style={styles.journey}>
          <RouteLine compact pickup={pickupLocation.address} dropoff={dropoffLocation.address} />
        </View>

        {/* The trip screen opens by itself when the driver starts the ride. */}
        {beforePickup ? (
          <TouchableOpacity style={styles.cancel} onPress={handleCancelRide} activeOpacity={0.8}>
            <Text style={styles.cancelText}>Cancel ride</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.white },
  centered: { alignItems: 'center', justifyContent: 'center' },

  pickupMarker: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: COLORS.lime, borderWidth: 3, borderColor: COLORS.midnight,
  },
  driverMarkerWrap: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  driverPulse: {
    position: 'absolute', width: 46, height: 46, borderRadius: 23,
    backgroundColor: COLORS.navy, opacity: 0.18,
  },
  driverMarker: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: COLORS.navy,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: COLORS.white,
  },

  topBar: {
    position: 'absolute', top: SPACE[3], left: SPACE[5], right: SPACE[5],
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  topRight: { flexDirection: 'row', gap: SPACE[2] },

  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: COLORS.white,
    borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SPACE[5], paddingTop: SPACE[3], paddingBottom: SPACE[8],
    ...SHADOW.sheet,
  },
  grabber: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.line,
    alignSelf: 'center', marginBottom: SPACE[5],
  },

  waiting: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[3],
    borderRadius: RADIUS.md, borderWidth: StyleSheet.hairlineWidth,
    padding: SPACE[3], marginTop: SPACE[4],
  },
  waitingFree: { backgroundColor: COLORS.blueSoft, borderColor: '#E6E8EC' },
  waitingCharged: { backgroundColor: COLORS.amberSoft, borderColor: '#FCD34D' },
  waitingLabel: { fontSize: 14, fontWeight: '700' },

  driverCard: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[3],
    marginTop: SPACE[5], paddingTop: SPACE[5],
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
  },
  driverName: { fontSize: 17, fontWeight: '700', color: COLORS.navy, letterSpacing: -0.3 },
  plate: {
    alignSelf: 'flex-start', marginTop: SPACE[2],
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.line,
    paddingHorizontal: SPACE[2], paddingVertical: 3,
  },
  plateText: { fontSize: 13, fontWeight: '800', color: COLORS.ink, letterSpacing: 1 },
  contact: { flexDirection: 'row', gap: SPACE[2] },

  journey: {
    marginTop: SPACE[5], paddingTop: SPACE[5],
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
  },

  cancel: {
    minHeight: 50, marginTop: SPACE[5],
    alignItems: 'center', justifyContent: 'center',
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.lineStrong,
  },
  cancelText: { fontSize: 15, fontWeight: '700', color: COLORS.red },
});
