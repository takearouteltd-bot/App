import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Dimensions,
  StatusBar,
  Linking,
  ScrollView,
} from 'react-native';
import { Alert } from '../../../components/ui/alert';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import MapViewDirections from 'react-native-maps-directions';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, useNavigation } from '@react-navigation/native';
import { doc, onSnapshot, updateDoc, serverTimestamp, arrayUnion } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { currencySymbol } from '../../../utils/appConfig';
import SafetyButton from '../../../components/SafetyButton';
import { confirmMaskedCall } from '../../../utils/calling';
import { useWaitingClock } from '../../../utils/useWaitingClock';
import { COLORS, TYPE, SPACE, RADIUS, SHADOW, Avatar, IconButton, RouteLine, isCoord, validCoords } from '../../../components/ui/kit';

const { height } = Dimensions.get('window');
const GOOGLE_MAPS_API_KEY = 'AIzaSyBtmcvJE-m_v44Z2lLDm8wDgI6GGYLXimQ';

const SHEET_OPEN = Math.min(height * 0.62, 560);
const SHEET_SHUT = 190;

export default function DriverRideInProgressScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { rideId } = route.params;

  const mapRef = useRef(null);
  const sheetHeight = useRef(new Animated.Value(SHEET_OPEN)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const [ride, setRide] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);
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
        setDriverLocation({
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
  const handleArrived = useCallback(async () => {
    setLoadingAction(true);
    try {
      await updateDoc(doc(db, 'rides', rideId), {
        status: 'arrived',
        arrivedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error updating status:', error);
      Alert.alert('Could not update', 'Please try again.');
    } finally {
      setLoadingAction(false);
    }
  }, [rideId]);

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
      <SafeAreaView style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={[TYPE.small, { marginTop: SPACE[4] }]}>Loading the job…</Text>
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
              <Ionicons name="car-sport" size={16} color={COLORS.white} />
            </View>
          </View>
        </Marker>

        {isCoord(pickupLocation) ? (
          <Marker coordinate={pickupLocation} anchor={{ x: 0.5, y: 1 }}>
            <Ionicons name="location" size={32} color={COLORS.primary} />
          </Marker>
        ) : null}

        {isCoord(pickupLocation) ? (
        <MapViewDirections
          origin={driverLocation}
          destination={pickupLocation}
          apikey={GOOGLE_MAPS_API_KEY}
          strokeWidth={4}
          strokeColor={COLORS.primary}
          onReady={(result) => {
            setEta(Math.ceil(result.duration));
            setDistance(result.distance.toFixed(1));
          }}
        />
        ) : null}
      </MapView>

      <SafeAreaView style={styles.topBar} pointerEvents="box-none">
        <IconButton icon="chevron-back" onPress={goHome} accessibilityLabel="Back to home" />
        {eta ? (
          <View style={styles.etaPill}>
            <Text style={styles.etaText}>{eta} min</Text>
            {distance ? (
              <>
                <View style={styles.pillDivider} />
                <Text style={styles.etaText}>{distance} km</Text>
              </>
            ) : null}
          </View>
        ) : (
          <View />
        )}
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
                style={[styles.waiting, { color: waiting.inFreeTime ? COLORS.blue : COLORS.amber }]}
              >
                {waiting.label}
              </Text>
            ) : (
              <Text style={TYPE.small}>
                {arrived ? 'Waiting for your passenger.' : 'Follow the route to your passenger.'}
              </Text>
            )}
          </View>
          <Text style={styles.fare}>
            {currencySymbol()}
            {Number(fare?.total || 0).toFixed(2)}
          </Text>
        </View>

        {/* Stays reachable even with the sheet collapsed. */}
        <TouchableOpacity
          style={[styles.action, loadingAction && { opacity: 0.6 }]}
          onPress={action.onPress}
          disabled={loadingAction}
          activeOpacity={0.9}
          accessibilityRole="button"
        >
          {loadingAction ? (
            <ActivityIndicator color={COLORS.onPrimary} />
          ) : (
            <Text style={styles.actionText}>{action.label}</Text>
          )}
        </TouchableOpacity>

        {!isMinimized ? (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: SPACE[5] }}
            showsVerticalScrollIndicator={false}
          >
            {riderData ? (
              <View style={styles.riderCard}>
                <Avatar
                  uri={riderData.profileImage || riderData.photoURL}
                  name={riderData.fullName || riderData.name}
                  size={48}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.riderName} numberOfLines={1}>
                    {riderData.fullName || riderData.name || 'Passenger'}
                  </Text>
                  <Text style={TYPE.small}>
                    {riderRating ? `★ ${riderRating}` : 'No rating yet'}
                  </Text>
                </View>
                <View style={styles.contact}>
                  <IconButton
                    icon="chatbubble-ellipses"
                    size={42}
                    accessibilityLabel="Message your passenger"
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
                  <IconButton
                    icon="call"
                    size={42}
                    tone="dark"
                    accessibilityLabel="Call your passenger"
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
              <TouchableOpacity style={styles.secondary} onPress={handleNavigate} activeOpacity={0.8}>
                <Ionicons name="navigate" size={18} color={COLORS.navy} />
                <Text style={styles.secondaryText}>Open in Maps</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={styles.giveBack}
              onPress={arrived ? handleNoShow : handleCancel}
              activeOpacity={0.7}
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
  { elementType: 'geometry', stylers: [{ color: '#F5F7FA' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: COLORS.muted }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: COLORS.white }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: COLORS.line }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#DCE6F2' }] },
];

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface },
  centered: { alignItems: 'center', justifyContent: 'center' },

  markerWrap: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  markerPulse: {
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
    position: 'absolute', top: 0, left: SPACE[5], right: SPACE[5],
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: SPACE[3],
  },
  etaPill: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[3],
    backgroundColor: COLORS.white, height: 40,
    paddingHorizontal: SPACE[4], borderRadius: RADIUS.pill,
    ...SHADOW.float,
  },
  etaText: { fontSize: 13, fontWeight: '700', color: COLORS.navy },
  pillDivider: { width: StyleSheet.hairlineWidth, height: 16, backgroundColor: COLORS.line },

  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: COLORS.white,
    borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SPACE[5], paddingBottom: SPACE[6],
    ...SHADOW.sheet,
  },
  handle: { alignItems: 'center', paddingVertical: SPACE[3] },
  handleBar: { width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.line },

  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE[4], marginBottom: SPACE[4] },
  waiting: { fontSize: 13, fontWeight: '700', marginTop: 2 },
  fare: { fontSize: 24, fontWeight: '800', color: COLORS.navy, letterSpacing: -0.6 },

  action: {
    minHeight: 54, borderRadius: 999,
    backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  actionText: { fontSize: 16, fontWeight: '800', color: COLORS.onPrimary, letterSpacing: -0.2 },

  riderCard: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[3],
    marginTop: SPACE[5], paddingTop: SPACE[5],
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
  },
  riderName: { fontSize: 16, fontWeight: '700', color: COLORS.navy },
  contact: { flexDirection: 'row', gap: SPACE[2] },

  journey: {
    marginTop: SPACE[5], paddingTop: SPACE[5],
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
  },

  secondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE[2],
    minHeight: 50, marginTop: SPACE[5],
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.lineStrong,
  },
  secondaryText: { fontSize: 15, fontWeight: '700', color: COLORS.navy },

  giveBack: { alignItems: 'center', paddingVertical: SPACE[5] },
  giveBackText: { fontSize: 14, fontWeight: '700', color: COLORS.red },
});
