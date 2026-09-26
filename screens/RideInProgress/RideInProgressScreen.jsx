import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  Animated,
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
import SafetyButton from '../../components/SafetyButton';
import { confirmMaskedCall } from '../../utils/calling';
import { currencySymbol } from '../../utils/appConfig';
import {
  COLORS,
  TYPE,
  SPACE,
  RADIUS,
  Screen,
  Sheet,
  Card,
  Button,
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


export default function RideInProgressScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { rideId } = route.params;

  const mapRef = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const [ride, setRide] = useState(null);
  const [driverData, setDriverData] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    if (!rideId) return undefined;

    let hasFinished = false;
    let finishTimer = null;

    const unsubscribe = onSnapshot(doc(db, 'rides', rideId), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      setRide(data);

      // The driver can abandon a trip that cannot be finished.
      if ((data.status === 'cancelled' || data.status === 'canceled') && !hasFinished) {
        hasFinished = true;
        if (data.cancelledBy === 'driver') {
          Alert.alert(
            'Trip ended',
            'Your driver could not finish this trip. You have not been charged.'
          );
        }
        navigation.popToTop();
        return;
      }

      if (data.status === 'completed' && !hasFinished) {
        hasFinished = true;
        // A short beat so the sheet does not vanish mid-sentence.
        finishTimer = setTimeout(() => {
          navigation.reset({
            index: 0,
            routes: [{ name: 'RiderRideCompleted', params: { rideId } }],
          });
        }, 600);
      }
    });

    return () => {
      unsubscribe();
      if (finishTimer) clearTimeout(finishTimer);
    };
  }, [rideId, navigation]);

  useEffect(() => {
    if (!ride?.driverId) return undefined;

    return onSnapshot(doc(db, 'drivers', ride.driverId), (snap) => {
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
  }, [ride?.driverId]);

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

  /* Same fix as the tracking screen: no more fitting only once the driver's
     location exists, which left the map at 0,0 off West Africa. */
  const recenterMap = () => {
    if (!ride) return;
    const coords = validCoords(ride.pickupLocation, ride.dropoffLocation, driverLocation);
    if (!coords.length) return;
    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 120, right: 60, bottom: 360, left: 60 },
      animated: true,
    });
  };

  const hasFitDriver = useRef(false);
  useEffect(() => {
    if (!ride || !driverLocation || hasFitDriver.current) return;
    hasFitDriver.current = true;
    recenterMap();
  }, [ride, driverLocation]);

  const handleChat = () => {
    navigation.navigate('ChatScreen', {
      rideId,
      currentUser: { uid: ride.riderId },
      userType: 'rider',
      otherUserName: driverData?.fullName || 'Driver',
      otherUserPhoto: driverData?.selfieUrl,
    });
  };

  // Masked call through Twilio. Neither side sees a real number.
  const handleCall = () => confirmMaskedCall(rideId, 'your driver');

  /* Ending a trip that is already under way. There was previously no way out
     of this screen at all — once the driver started the ride, neither side
     could stop it. The trip is marked cancelled rather than completed, so
     chargeOnRideCompletion does not fire and cancelRidePayment releases the
     hold on the card. */
  const handleEndEarly = () => {
    if (ending) return;
    Alert.alert(
      'End this trip early?',
      'Your driver will be told to pull over when it is safe. You will not be charged for the journey.',
      [
        { text: 'Stay in the trip', style: 'cancel' },
        {
          text: 'End trip',
          style: 'destructive',
          onPress: async () => {
            setEnding(true);
            try {
              await updateDoc(doc(db, 'rides', rideId), {
                status: 'cancelled',
                cancelledBy: 'rider',
                cancelReason: 'rider_ended_early',
                endedEarly: true,
                cancelledAt: serverTimestamp(),
              });
              const uid = getAuth().currentUser?.uid;
              if (uid) {
                updateDoc(doc(db, 'riders', uid), { currentRideId: null }).catch(() => null);
              }
              navigation.popToTop();
            } catch (error) {
              console.log('Error ending trip:', error);
              Alert.alert('Could not end the trip', 'Please try again, or speak to your driver.');
              setEnding(false);
            }
          },
        },
      ]
    );
  };

  if (!ride) {
    return (
      <Screen scroll={false}>
        <Loading label="Loading your ride…" />
      </Screen>
    );
  }

  const { pickupLocation, dropoffLocation } = ride;
  const fare = ride.fare?.finalTotal ?? ride.fare?.total ?? ride.fareEstimate;
  const rating = driverData?.rating ? Number(driverData.rating).toFixed(1) : null;

  // The useful line now is the driver's remaining route to the dropoff.
  const routeFrom = driverLocation || pickupLocation;
  const initialRegion = regionCovering([dropoffLocation, pickupLocation], 0.05);

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

        {isCoord(routeFrom) && isCoord(dropoffLocation) ? (
          <RouteDirections
            origin={routeFrom}
            destination={dropoffLocation}
            waypoints={remainingStops(ride)}
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

      <Sheet style={styles.sheet}>
        <View style={styles.headRow}>
          <View style={{ flex: 1 }}>
            <Text style={TYPE.label}>Your ride</Text>
            <Text style={TYPE.title}>On your way</Text>
            <Text style={[TYPE.small, { marginTop: SPACE[1] }]}>
              Your driver is taking you to the dropoff.
            </Text>
          </View>
          {fare ? (
            <View style={styles.fareBox}>
              <Text style={TYPE.label}>Fare</Text>
              <Text style={styles.fareValue}>
                {currencySymbol()}
                {Number(fare).toFixed(2)}
              </Text>
            </View>
          ) : null}
        </View>

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
                  {[driverData.vehicleColor, driverData.makeModel].filter(Boolean).join(' ') || 'Vehicle'}
                </Text>
                {rating ? (
                  <View style={styles.rating}>
                    <Ionicons name="star" size={13} color={COLORS.star} />
                    <Text style={styles.ratingText}>{rating}</Text>
                  </View>
                ) : null}
              </View>
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
          <RouteLine
            compact
            pickup={pickupLocation?.address}
            dropoff={dropoffLocation?.address}
          />
        </View>

        <TouchableOpacity
          style={[styles.endEarly, ending && { opacity: 0.5 }]}
          onPress={handleEndEarly}
          disabled={ending}
          activeOpacity={0.8}
          accessibilityRole="button"
        >
          <Text style={styles.endEarlyText}>
            {ending ? 'Ending…' : 'End trip early'}
          </Text>
        </TouchableOpacity>
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface },

  pickupMarker: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: COLORS.lime, borderWidth: 3, borderColor: COLORS.midnight,
  },

  topBar: {
    position: 'absolute', top: SPACE[3], left: SPACE[5], right: SPACE[5],
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  topRight: { flexDirection: 'row', gap: SPACE[2] },

  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0 },

  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE[4] },
  fareBox: { alignItems: 'flex-end' },
  fareValue: { ...TYPE.figure, marginTop: 2 },

  driverCard: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[3],
    marginTop: SPACE[4], padding: SPACE[4],
  },
  driverName: { ...TYPE.subhead, fontSize: 17, color: COLORS.midnight },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE[2], marginTop: 2 },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  ratingText: { ...TYPE.caption, color: COLORS.inkSoft, fontWeight: '700' },
  contact: { flexDirection: 'row', gap: SPACE[2], marginTop: SPACE[3] },

  journey: {
    marginTop: SPACE[4], paddingTop: SPACE[4],
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
  },

  // A quiet red pill: destructive, but not the screen's main action.
  endEarly: {
    minHeight: 52, marginTop: SPACE[4],
    alignItems: 'center', justifyContent: 'center',
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.redSoft,
  },
  endEarlyText: { fontSize: 16, fontWeight: '800', color: COLORS.red, letterSpacing: -0.2 },
});
