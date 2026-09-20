import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  Animated,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import MapViewDirections from 'react-native-maps-directions';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../config/firebase';
import SafetyButton from '../../components/SafetyButton';
import { confirmMaskedCall } from '../../utils/calling';

const PRIMARY = '#79B431';
const SECONDARY = '#235594';
const DARK = '#1a1a1a';
const BG = '#F8F9FA';

export default function RideInProgressScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { rideId } = route.params;

  const mapRef = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const GOOGLE_MAPS_API_KEY = 'AIzaSyBtmcvJE-m_v44Z2lLDm8wDgI6GGYLXimQ';

  const [ride, setRide] = useState(null);
  const [driverData, setDriverData] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);

  /* ================= RIDE LISTENER ================= */
  useEffect(() => {
    if (!rideId) return;

    const rideRef = doc(db, 'rides', rideId);
    let hasFinished = false;
    let finishTimer = null;

    const unsubscribe = onSnapshot(rideRef, (snap) => {
      if (!snap.exists()) return;

      const data = snap.data();
      setRide(data);

      /* 🚀 NAVIGATE WHEN COMPLETED (once only) */
      if (data.status === 'completed' && !hasFinished) {
        hasFinished = true;
        finishTimer = setTimeout(() => {
          navigation.reset({
            index: 0,
            routes: [
              {
                name: 'RiderRideCompleted',
                params: { rideId },
              },
            ],
          });
        }, 600); // small delay = smoother UX
      }
    });

    return () => {
      unsubscribe();
      if (finishTimer) clearTimeout(finishTimer);
    };
  }, [rideId]);

  /* ================= DRIVER LISTENER ================= */
  useEffect(() => {
    if (!ride?.driverId) return;

    const driverRef = doc(db, 'drivers', ride.driverId);

    const unsubscribe = onSnapshot(driverRef, (snap) => {
      if (!snap.exists()) return;

      const driver = snap.data();
      setDriverData(driver);

      if (driver.location) {
        setDriverLocation({
          latitude: driver.location.latitude,
          longitude: driver.location.longitude,
        });
      }
    });

    return () => unsubscribe();
  }, [ride?.driverId]);

  /* ================= PULSE ANIMATION ================= */
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.4, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  /* ================= MAP RECENTER ================= */
  // Same fix as the tracking screen: no more fitting only once the driver's
  // location exists, which left the map at 0,0 off West Africa.
  const recenterMap = () => {
    if (!ride) return;
    const coords = [ride.pickupLocation, ride.dropoffLocation, driverLocation].filter(
      (c) => c && typeof c.latitude === 'number' && typeof c.longitude === 'number'
    );
    if (coords.length === 0) return;

    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 120, right: 60, bottom: 420, left: 60 },
      animated: true,
    });
  };

  const hasFitDriver = useRef(false);
  useEffect(() => {
    if (!ride || !driverLocation || hasFitDriver.current) return;
    hasFitDriver.current = true;
    recenterMap();
  }, [ride, driverLocation]);

  /* ================= ACTIONS ================= */
  const handleChat = () => {
    navigation.navigate('ChatScreen', {
      rideId,
      currentUser: { uid: ride.riderId },
      userType: 'rider',
      otherUserName: driverData?.fullName || 'Driver',
      otherUserPhoto: driverData?.photoURL,
    });
  };

  // Masked call through Twilio. Neither side sees a real number.
  const handleCall = () => confirmMaskedCall(rideId, 'your driver');

  /* ================= LOADING ================= */
  if (!ride) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={PRIMARY} />
          <Text style={styles.loadingText}>Loading your ride…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const { pickupLocation, dropoffLocation, status } = ride;

  return (
    <SafeAreaView style={styles.container}>
      {/* MAP */}
      <MapView
        ref={mapRef}
        style={styles.map}
        onMapReady={recenterMap}
        initialRegion={
          (dropoffLocation || pickupLocation)
            ? {
                latitude: (dropoffLocation || pickupLocation).latitude,
                longitude: (dropoffLocation || pickupLocation).longitude,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
              }
            : undefined
        }
      >
        {pickupLocation && (
          <Marker coordinate={pickupLocation}>
            <View style={styles.originMarker}>
              <View style={styles.originDot} />
              <View style={styles.originRing} />
            </View>
          </Marker>
        )}

        {dropoffLocation && (
          <Marker coordinate={dropoffLocation}>
            <View style={styles.destMarker}>
              <Ionicons name="location" size={28} color={SECONDARY} />
            </View>
          </Marker>
        )}

        {driverLocation && (
          <Marker coordinate={driverLocation}>
            <View style={styles.driverMarkerWrap}>
              <Animated.View style={[styles.driverPulse, { transform: [{ scale: pulseAnim }] }]} />
              <View style={styles.driverMarker}>
                <Ionicons name="car" size={16} color="#fff" />
              </View>
            </View>
          </Marker>
        )}

        {pickupLocation && dropoffLocation && (
          <MapViewDirections
            origin={pickupLocation}
            destination={dropoffLocation}
            apikey={GOOGLE_MAPS_API_KEY}
            strokeWidth={5}
            strokeColor={PRIMARY}
          />
        )}
      </MapView>

      {/* TOP BAR */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.iconButton} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={DARK} />
        </TouchableOpacity>

        <View style={styles.statusPill}>
          <View style={[styles.statusDot, { backgroundColor: PRIMARY }]} />
          <Text style={styles.statusText}>Ride in progress</Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <SafetyButton role="rider" rideId={rideId} />
          <TouchableOpacity style={styles.iconButton} onPress={recenterMap}>
            <Ionicons name="locate" size={22} color={DARK} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ================= BOTTOM SHEET ================= */}
      <View style={styles.bottomSheet}>
        <View style={styles.sheetHandle} />

        {/* Progress Header */}
        <View style={styles.progressHeader}>
          <View style={styles.progressIconBox}>
            <Ionicons name="navigate-circle" size={24} color={PRIMARY} />
          </View>
          <View style={styles.progressTextBox}>
            <Text style={styles.progressTitle}>Heading to destination</Text>
            <Text style={styles.progressSub}>Your driver is taking you to the dropoff</Text>
          </View>
        </View>

        {/* Route Card */}
        <View style={styles.routeCard}>
          <View style={styles.routeRow}>
            <View style={styles.routeDotContainer}>
              <View style={[styles.routeDot, { backgroundColor: PRIMARY }]} />
              <View style={styles.routeLine} />
            </View>
            <View style={styles.routeTextBox}>
              <Text style={styles.routeLabel}>Pickup</Text>
              <Text style={styles.routeText} numberOfLines={1}>
                {pickupLocation?.address || 'Pickup location'}
              </Text>
            </View>
          </View>

          <View style={styles.routeRow}>
            <View style={styles.routeDotContainer}>
              <View style={[styles.routeDot, { backgroundColor: SECONDARY }]} />
            </View>
            <View style={styles.routeTextBox}>
              <Text style={styles.routeLabel}>Dropoff</Text>
              <Text style={styles.routeText} numberOfLines={1}>
                {dropoffLocation?.address || 'Dropoff location'}
              </Text>
            </View>
          </View>
        </View>

        {/* Driver Card */}
        {driverData && (
          <View style={styles.driverCard}>
            <Image
              source={{ uri: driverData.selfieUrl }}
              style={styles.driverImage}
            />

            <View style={styles.driverInfo}>
              <Text style={styles.driverName}>{driverData.fullName}</Text>
              <Text style={styles.driverSub}>{driverData.makeModel}</Text>
              <View style={styles.plateBox}>
                <Text style={styles.plate}>{driverData.registrationNumber}</Text>
              </View>
            </View>

            <View style={styles.actionButtons}>
              <TouchableOpacity style={styles.actionBtn} onPress={handleChat}>
                <Ionicons name="chatbubble-ellipses" size={18} color={SECONDARY} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={handleCall}>
                <Ionicons name="call" size={18} color={SECONDARY} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Safety Note */}
        <View style={styles.safetyNote}>
          <Ionicons name="shield-checkmark-outline" size={16} color={SECONDARY} />
          <Text style={styles.safetyText}>Your ride is insured and tracked in real-time</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  map: { ...StyleSheet.absoluteFillObject },

  /* Loading */
  loadingOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: '#888',
    fontWeight: '500',
  },

  /* Top Bar */
  topBar: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '700',
    color: DARK,
  },

  /* Markers */
  originMarker: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  originDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: PRIMARY,
    borderWidth: 3,
    borderColor: '#fff',
  },
  originRing: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: PRIMARY,
    opacity: 0.3,
  },
  destMarker: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  driverMarkerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverPulse: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(121,180,49,0.3)',
  },
  driverMarker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: PRIMARY,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },

  /* Bottom Sheet */
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
    paddingHorizontal: 20,
    paddingBottom: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 20,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ddd',
    marginBottom: 16,
  },

  /* Progress Header */
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  progressIconBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(121,180,49,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressTextBox: {
    flex: 1,
  },
  progressTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: DARK,
  },
  progressSub: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },

  /* Route Card */
  routeCard: {
    backgroundColor: BG,
    padding: 16,
    borderRadius: 16,
    marginBottom: 14,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  routeDotContainer: {
    width: 20,
    alignItems: 'center',
    marginRight: 10,
  },
  routeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  routeLine: {
    width: 2,
    height: 20,
    backgroundColor: '#ddd',
    marginVertical: 2,
  },
  routeTextBox: {
    flex: 1,
    paddingBottom: 8,
  },
  routeLabel: {
    fontSize: 11,
    color: '#999',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  routeText: {
    fontSize: 14,
    fontWeight: '600',
    color: DARK,
  },

  /* Driver Card */
  driverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BG,
    padding: 14,
    borderRadius: 16,
    marginBottom: 14,
  },
  driverImage: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginRight: 14,
    borderWidth: 2,
    borderColor: '#fff',
  },
  driverInfo: {
    flex: 1,
  },
  driverName: {
    fontSize: 16,
    fontWeight: '800',
    color: DARK,
  },
  driverSub: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  plateBox: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  plate: {
    fontSize: 12,
    fontWeight: '800',
    color: DARK,
    letterSpacing: 1,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#eee',
  },

  /* Safety Note */
  safetyNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    backgroundColor: '#EBF2FA',
    borderRadius: 12,
    gap: 8,
  },
  safetyText: {
    fontSize: 12,
    color: SECONDARY,
    fontWeight: '500',
  },
});