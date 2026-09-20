import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Animated,
  Dimensions,
  StatusBar,
  Platform,
  Alert,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRoute, useNavigation } from '@react-navigation/native';
import polyline from '@mapbox/polyline';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { currencySymbol } from '../../../utils/appConfig';
import SafetyButton from '../../../components/SafetyButton';

const { width, height } = Dimensions.get('window');
const PRIMARY = '#79B531';
const SECONDARY = '#235594';
const DANGER = '#DC2626';
const DARK = '#1A1A1A';
const BG = '#F8F9FA';

const GOOGLE_MAPS_API_KEY = 'AIzaSyBtmcvJE-m_v44Z2lLDm8wDgI6GGYLXimQ';
const ARRIVAL_DISTANCE = 40;

export default function DriverRideToDropoffScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { rideId } = route.params;
  const ENABLE_SIMULATION = true; // 🔁 turn false in production

  const mapRef = useRef(null);
  const slideAnim = useRef(new Animated.Value(400)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const [ride, setRide] = useState(null);
  const [riderData, setRiderData] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);
  const [routeCoords, setRouteCoords] = useState([]);
  const [loadingRoute, setLoadingRoute] = useState(true);
  const [arrived, setArrived] = useState(false);
  const [eta, setEta] = useState('');
  const [dropoffDistance, setDropoffDistance] = useState('');
  const [zoomLevel, setZoomLevel] = useState(16);
  const [completing, setCompleting] = useState(false);

  /* ================= ANIMATIONS ================= */
  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 600,
      delay: 300,
      useNativeDriver: true,
    }).start();
  }, []);

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  /* ================= RIDE LISTENER ================= */
  useEffect(() => {
    if (!rideId) return;

    const rideRef = doc(db, 'rides', rideId);
    const unsubscribe = onSnapshot(rideRef, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      setRide(data);

      if (data.pickupLocation) {
        setDriverLocation({
          latitude: data.pickupLocation.latitude,
          longitude: data.pickupLocation.longitude,
        });
        fetchRoute(data.pickupLocation, data.dropoffLocation);
      }
    });

    return () => unsubscribe();
  }, [rideId]);

  /* ================= DRIVER LIVE LOCATION ================= */
  useEffect(() => {
    if (!ride?.driverId || ENABLE_SIMULATION) return;

    const driverRef = doc(db, 'drivers', ride.driverId);
    const unsubscribe = onSnapshot(driverRef, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();

      if (data.location) {
        const loc = {
          latitude: data.location.latitude,
          longitude: data.location.longitude,
        };
        setDriverLocation(loc);
        mapRef.current?.animateCamera({ center: loc });
      }
    });

    return () => unsubscribe();
  }, [ride?.driverId]);

  /* ================= RIDER DATA ================= */
  useEffect(() => {
    if (!ride?.riderId) return;

    const riderRef = doc(db, 'riders', ride.riderId);
    const unsubscribe = onSnapshot(riderRef, (snap) => {
      if (!snap.exists()) return;
      setRiderData(snap.data());
    });

    return () => unsubscribe();
  }, [ride?.riderId]);

  /* ================= ROUTE FETCH ================= */
  const fetchRoute = useCallback(async (start, destination) => {
    try {
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${start.latitude},${start.longitude}&destination=${destination.latitude},${destination.longitude}&key=${GOOGLE_MAPS_API_KEY}`;

      const res = await fetch(url);
      const data = await res.json();

      if (data.routes.length) {
        const points = polyline.decode(data.routes[0].overview_polyline.points);
        const coords = points.map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
        setRouteCoords(coords);

        const leg = data.routes[0].legs[0];
        setEta(leg.duration.text);
        setDropoffDistance(leg.distance.text);

        mapRef.current?.fitToCoordinates([start, ...coords, destination], {
          edgePadding: { top: 150, right: 60, bottom: 320, left: 60 },
          animated: true,
        });
      }
    } catch (e) {
      console.log('Route fetch error:', e);
    } finally {
      setLoadingRoute(false);
    }
  }, []);

  /* ================= SIMULATION ================= */
  useEffect(() => {
    if (!ENABLE_SIMULATION || !ride?.pickupLocation || !ride?.dropoffLocation) return;

    let current = {
      latitude: ride.pickupLocation.latitude,
      longitude: ride.pickupLocation.longitude,
    };

    setDriverLocation(current);

    const interval = setInterval(() => {
      const nextLat = current.latitude + (ride.dropoffLocation.latitude - ride.pickupLocation.latitude) * 0.01;
      const nextLng = current.longitude + (ride.dropoffLocation.longitude - ride.pickupLocation.longitude) * 0.01;
      current = { latitude: nextLat, longitude: nextLng };

      setDriverLocation(current);
      mapRef.current?.animateCamera({ center: current });

      const distance = getDistance(nextLat, nextLng, ride.dropoffLocation.latitude, ride.dropoffLocation.longitude);
      if (distance < ARRIVAL_DISTANCE) {
        setArrived(true);
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [ride]);

  /* ================= ARRIVAL CHECK ================= */
  useEffect(() => {
    if (!driverLocation || !ride?.dropoffLocation) return;

    const distance = getDistance(
      driverLocation.latitude,
      driverLocation.longitude,
      ride.dropoffLocation.latitude,
      ride.dropoffLocation.longitude
    );

    if (distance < ARRIVAL_DISTANCE) {
      setArrived(true);
    }
  }, [driverLocation, ride]);

  const getDistance = (lat1, lon1, lat2, lon2) => {
    const toRad = (x) => (x * Math.PI) / 180;
    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  /* ================= CONTROLS ================= */
  const handleZoomIn = () => {
    const newZoom = Math.min(zoomLevel + 0.5, 20);
    setZoomLevel(newZoom);
    mapRef.current?.animateCamera({ zoom: newZoom });
  };

  const handleZoomOut = () => {
    const newZoom = Math.max(zoomLevel - 0.5, 1);
    setZoomLevel(newZoom);
    mapRef.current?.animateCamera({ zoom: newZoom });
  };

  const handleGps = () => {
    if (driverLocation) {
      mapRef.current?.animateCamera({ center: driverLocation, zoom: zoomLevel });
    }
  };

// Straight-line distance in km between two { latitude, longitude } points.
const distanceKm = (a, b) => {
  if (!a || !b) return null;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// How close to the drop-off the driver should be before completing.
const COMPLETE_RADIUS_KM = 0.5;

// Checks the driver is near the drop-off first. Ending early is allowed (the
// passenger may ask to get out) but needs a confirmation and is flagged on
// the ride so support can see it if the fare is disputed.
const handleCompleteRide = () => {
  if (completing) return;
  const away = distanceKm(driverLocation, ride?.dropoffLocation);

  if (away !== null && away > COMPLETE_RADIUS_KM) {
    const shown = away < 1 ? `${Math.round(away * 1000)} m` : `${away.toFixed(1)} km`;
    Alert.alert(
      'You are not at the drop-off yet',
      `You are ${shown} from the drop-off. Only complete the trip here if the passenger has asked to get out.`,
      [
        { text: 'Keep driving', style: 'cancel' },
        {
          text: 'Passenger got out here',
          style: 'destructive',
          onPress: () => completeRide({ completedAwayFromDropoff: true, completeDistanceKm: Number(away.toFixed(2)) }),
        },
      ]
    );
    return;
  }
  completeRide({ completedAwayFromDropoff: false, completeDistanceKm: away !== null ? Number(away.toFixed(2)) : null });
};

const completeRide = async (extra) => {
  if (completing) return;
  setCompleting(true);

  try {
    const rideRef = doc(db, 'rides', rideId);

    // Also need the driverId here — make sure it's available in scope
    const driverRef = doc(db, 'drivers', ride.driverId);

    // Batch both updates so they succeed/fail together
    await Promise.all([
      updateDoc(rideRef, {
        status: 'completed',
        expiresAt: serverTimestamp(),
        completedAt: serverTimestamp(),
        ...extra,
      }),
      updateDoc(driverRef, {
        isOnRide: false,
        currentRideId: null,
        status: 'online',
      }),
    ]);

    navigation.navigate('RideCompleted', { rideId });
  } catch (error) {
    console.log('Error completing ride:', error);
    setCompleting(false);
  }
};

  const handleChat = () => {
    navigation.navigate('ChatScreen', {
      rideId,
      currentUser: { uid: ride.driverId },
      userType: 'driver',
      otherUserName: riderData?.fullName || 'Rider',
      otherUserPhoto: riderData?.photoURL || riderData?.profileImage,
    });
  };

  /* ================= LOADING ================= */
  if (!ride || !driverLocation || !ride.dropoffLocation) {
    return (
      <SafeAreaView style={styles.loader}>
        <StatusBar barStyle="light-content" backgroundColor={SECONDARY} />
        <ActivityIndicator size="large" color={PRIMARY} />
        <Text style={styles.loaderText}>Loading ride details...</Text>
      </SafeAreaView>
    );
  }

  const destination = ride.dropoffLocation;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      {/* ================= MAP ================= */}
      <MapView
        ref={mapRef}
        style={styles.map}
        customMapStyle={customMapStyle}
        initialRegion={{
          latitude: driverLocation.latitude,
          longitude: driverLocation.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
      >
        {/* Driver Marker with Pulse */}
        <Marker coordinate={driverLocation} anchor={{ x: 0.5, y: 0.5 }}>
          <View style={styles.markerContainer}>
            <Animated.View style={[styles.pulseRing, { transform: [{ scale: pulseAnim }] }]} />
            <View style={styles.driverMarker}>
              <Ionicons name="car-sport" size={16} color="#fff" />
            </View>
          </View>
        </Marker>

        {/* Dropoff Marker */}
        <Marker coordinate={destination} anchor={{ x: 0.5, y: 1 }}>
          <View style={styles.destinationMarker}>
            <View style={styles.destinationPin}>
              <Ionicons name="flag" size={14} color="#fff" />
            </View>
            <View style={styles.destinationArrow} />
          </View>
        </Marker>

        {/* Route Polyline */}
        {routeCoords.length > 0 && (
          <Polyline coordinates={routeCoords} strokeColor={PRIMARY} strokeWidth={5} />
        )}
      </MapView>

      {/* ================= TOP BAR ================= */}
      <SafeAreaView style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.etaBadge}>
          <Ionicons name="navigate" size={14} color="#fff" />
          <Text style={styles.etaText}>{eta || '...'}</Text>
        </TouchableOpacity>
        

        {/* Safety: 999, 101 and the driver's emergency contact. Replaces an
            unused menu button. */}
        <SafetyButton role="driver" rideId={rideId} />
      </SafeAreaView>

      {/* ================= FLOATING STATS ================= */}
      <View style={styles.floatingStats}>
        <View style={styles.statPill}>
          <MaterialCommunityIcons name="map-marker-distance" size={14} color={PRIMARY} />
          <Text style={styles.statPillText}>{dropoffDistance || '...'}</Text>
        </View>
        <View style={styles.statPill}>
          <Ionicons name="cash-outline" size={14} color={PRIMARY} />
          <Text style={styles.statPillText}>{currencySymbol()}{ride.fare?.total?.toFixed(2) || '0.00'}</Text>
        </View>
      </View>

      {/* ================= MAP CONTROLS ================= */}
      <View style={styles.mapControls}>
        <TouchableOpacity style={styles.controlBtn} onPress={handleZoomIn} activeOpacity={0.8}>
          <Ionicons name="add" size={20} color={DARK} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlBtn} onPress={handleZoomOut} activeOpacity={0.8}>
          <Ionicons name="remove" size={20} color={DARK} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.controlBtn, styles.gpsBtn]} onPress={handleGps} activeOpacity={0.8}>
          <Ionicons name="locate" size={20} color={PRIMARY} />
        </TouchableOpacity>
      </View>

      {/* ================= BOTTOM SHEET ================= */}
      <Animated.View style={[styles.bottomSheet, { transform: [{ translateY: slideAnim }] }]}>
        <View style={styles.handle} />

        {/* Status Header */}
        <View style={styles.statusHeader}>
          <View style={[styles.statusDot, { backgroundColor: arrived ? PRIMARY : SECONDARY }]} />
          <View style={styles.statusTextContainer}>
            <Text style={styles.statusTitle}>
              {arrived ? 'Arrived at Destination' : 'Driving to Dropoff'}
            </Text>
            <Text style={styles.statusSubtitle}>
              {arrived ? 'Confirm arrival to complete the ride' : 'Follow the route to reach your destination'}
            </Text>
          </View>
        </View>

        {/* Progress Steps */}
        <View style={styles.progressContainer}>
          <View style={styles.progressStep}>
            <View style={[styles.stepCircle, styles.stepActive]}>
              <Ionicons name="checkmark" size={12} color="#fff" />
            </View>
            <Text style={styles.stepLabel}>Pickup</Text>
          </View>
          <View style={[styles.progressLine, styles.progressLineActive]} />
          <View style={styles.progressStep}>
            <View style={[styles.stepCircle, styles.stepActive]}>
              <Ionicons name="checkmark" size={12} color="#fff" />
            </View>
            <Text style={styles.stepLabel}>Started</Text>
          </View>
          <View style={[styles.progressLine, arrived && styles.progressLineActive]} />
          <View style={styles.progressStep}>
            <View style={[styles.stepCircle, arrived ? styles.stepActive : styles.stepInactive]}>
              {arrived ? (
                <Ionicons name="checkmark" size={12} color="#fff" />
              ) : (
                <View style={styles.stepDot} />
              )}
            </View>
            <Text style={[styles.stepLabel, !arrived && styles.stepLabelInactive]}>Complete</Text>
          </View>
        </View>

        {/* Location Card */}
        <View style={styles.locationCard}>
          <View style={styles.locationIconContainer}>
            <View style={[styles.locationIcon, { backgroundColor: PRIMARY + '15' }]}>
              <Ionicons name="location" size={18} color={PRIMARY} />
            </View>
            <View style={styles.locationLine} />
          </View>
          <View style={styles.locationDetails}>
           

            <View style={styles.locationDivider} />
            <View style={styles.locationRow}>
              <Text style={styles.locationLabel}>Dropoff</Text>
              <Text style={styles.locationValue} numberOfLines={2}>
                {destination?.address || 'Unknown destination'}
              </Text>
            </View>
          </View>
        </View>

        {/* Rider Card */}


        {/* Action Button */}
        <TouchableOpacity
          style={[
            styles.primaryBtn,
            !arrived && styles.primaryBtnDisabled,
            completing && styles.primaryBtnLoading,
          ]}
          onPress={handleCompleteRide}
          disabled={!arrived || completing}
          activeOpacity={0.9}
        >
          {completing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name={arrived ? "checkmark-circle" : "car"} size={20} color="#fff" />
              <Text style={styles.btnText}>
                {arrived ? 'Complete Ride' : 'Driving to Dropoff...'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

/* ================= CUSTOM MAP STYLE - LIGHT & VISIBLE ================= */
const customMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#f8fafc" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#475569" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f8fafc" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#1e293b" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#64748b" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#dcfce7" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#166534" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#e2e8f0" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#475569" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#f1f5f9" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#cbd5e1" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#f1f5f9" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#dbeafe" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#1e40af" }] },
];

/* ================= STYLES ================= */
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },

  /* Loader */
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: SECONDARY,
  },
  loaderText: {
    marginTop: 16,
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },

  /* Top Bar */
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 40,
    paddingBottom: 12,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(35, 85, 148, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  moreBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(35, 85, 148, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  etaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(35, 85, 148, 0.9)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  etaText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
  },

  /* Floating Stats */
  floatingStats: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 110 : 100,
    right: 16,
    gap: 8,
  },
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statPillText: {
    fontSize: 13,
    fontWeight: '700',
    color: DARK,
  },

  /* Map Controls */
  mapControls: {
    position: 'absolute',
    right: 16,
    bottom: 340,
    gap: 8,
  },
  controlBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  gpsBtn: {
    marginTop: 4,
  },

  /* Markers */
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: PRIMARY + '30',
  },
  driverMarker: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: PRIMARY,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  destinationMarker: {
    alignItems: 'center',
  },
  destinationPin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: DANGER,
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
  destinationArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: DANGER,
    marginTop: -4,
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
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 20,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#E5E5EA',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },

  /* Status Header */
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: PRIMARY,
  },
  statusTextContainer: {
    flex: 1,
  },
  statusTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: DARK,
    letterSpacing: -0.3,
  },
  statusSubtitle: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
    fontWeight: '500',
  },

  /* Progress Steps */
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    paddingHorizontal: 20,
  },
  progressStep: {
    alignItems: 'center',
    gap: 6,
  },
  stepCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepActive: {
    backgroundColor: PRIMARY,
  },
  stepInactive: {
    backgroundColor: '#E5E5EA',
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#999',
  },
  stepLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: DARK,
  },
  stepLabelInactive: {
    color: '#999',
  },
  progressLine: {
    flex: 1,
    height: 2,
    backgroundColor: '#E5E5EA',
    marginHorizontal: 8,
    marginBottom: 20,
  },
  progressLineActive: {
    backgroundColor: PRIMARY,
  },

  /* Location Card */
  locationCard: {
    flexDirection: 'row',
    backgroundColor: BG,
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
  },
  locationIconContainer: {
    alignItems: 'center',
    marginRight: 12,
  },
  locationIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  locationLine: {
    width: 2,
    flex: 1,
    backgroundColor: '#E5E5EA',
    marginVertical: 4,
  },
  locationDetails: {
    flex: 1,
    justifyContent: 'space-between',
  },
  locationRow: {
    paddingVertical: 4,
  },
  locationLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  locationValue: {
    fontSize: 14,
    fontWeight: '600',
    color: DARK,
    lineHeight: 20,
  },
  locationDivider: {
    height: 1,
    backgroundColor: '#E5E5EA',
    marginVertical: 8,
  },

  /* Rider Card */
  riderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#F2F2F7',
  },
  riderAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: '#F2F2F7',
  },
  riderInfo: {
    flex: 1,
    marginLeft: 14,
  },
  riderName: {
    fontSize: 16,
    fontWeight: '700',
    color: DARK,
  },
  riderMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 6,
  },
  riderRating: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F5B300',
    marginLeft: 2,
  },
  riderDivider: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ccc',
  },
  riderLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#888',
  },
  riderActions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBtnPrimary: {
    backgroundColor: SECONDARY,
    shadowColor: SECONDARY,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  actionBtnSecondary: {
    backgroundColor: '#F8F9FA',
    borderWidth: 1.5,
    borderColor: '#E5E5EA',
  },

  /* Primary Button */
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PRIMARY,
    paddingVertical: 16,
    borderRadius: 16,
    gap: 8,
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryBtnDisabled: {
    backgroundColor: '#9CA3AF',
    shadowColor: '#9CA3AF',
  },
  primaryBtnLoading: {
    opacity: 0.7,
  },
  btnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 0.3,
  },
});