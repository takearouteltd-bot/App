import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Animated,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import MapViewDirections from 'react-native-maps-directions';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../config/firebase';

const PRIMARY = '#79B431';
const SECONDARY = '#235594';
const DARK = '#1a1a1a';
const BG = '#F8F9FA';

export default function RideTrackingScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { rideId } = route.params;

  const mapRef = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const [rideData, setRideData] = useState(null);
  const [driverData, setDriverData] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);

  const GOOGLE_MAPS_API_KEY = 'AIzaSyBtmcvJE-m_v44Z2lLDm8wDgI6GGYLXimQ';

  const handleChat = () => {
    navigation.navigate('ChatScreen', {
      rideId,
      currentUser: { uid: rideData.riderId },
      userType: 'rider',
      otherUserName: driverData?.fullName || 'Driver',
      otherUserPhoto: driverData?.photoURL,
    });
  };

  /* ================= RIDE LISTENER ================= */
 const hasNavigatedToProgress = useRef(false);

useEffect(() => {
  const rideRef = doc(db, 'rides', rideId);

  const unsubscribe = onSnapshot(rideRef, (snap) => {
    if (!snap.exists()) return;

    const data = snap.data();
    setRideData(data);

    // ✅ Auto-navigate when trip starts
    if (data.status === 'ongoing' && !hasNavigatedToProgress.current) {
      hasNavigatedToProgress.current = true;
      navigation.replace('RideInProgress', { rideId });
      return; // stop processing, unmounting anyway
    }

    if (data.driverId) {
      listenToDriver(data.driverId);
    }
  });

  return () => unsubscribe();
}, []);

  /* ================= DRIVER LISTENER ================= */
  const listenToDriver = (driverId) => {
    const driverRef = doc(db, 'drivers', driverId);

    return onSnapshot(driverRef, (snap) => {
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
  };

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

  /* ================= MAP FIT ================= */
  const recenterMap = () => {
    if (!rideData || !driverLocation) return;

    const { pickupLocation, dropoffLocation } = rideData;

    mapRef.current?.fitToCoordinates(
      [
        pickupLocation,
        dropoffLocation,
        driverLocation,
      ],
      {
        edgePadding: { top: 120, right: 60, bottom: 420, left: 60 },
        animated: true,
      }
    );
  };

  if (!rideData) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={PRIMARY} />
          <Text style={styles.loadingText}>Loading your ride…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const { pickupLocation, dropoffLocation, status } = rideData;

  const getStatusConfig = () => {
    switch (status) {
      case 'accepted':
        return { label: 'Driver is on the way', color: SECONDARY, icon: 'navigate' };
      case 'arrived':
        return { label: 'Driver has arrived', color: PRIMARY, icon: 'location' };
      case 'ongoing':
        return { label: 'Ride in progress', color: PRIMARY, icon: 'car-sport' };
      default:
        return { label: 'Tracking ride', color: SECONDARY, icon: 'navigate' };
    }
  };

  const statusConfig = getStatusConfig();

  return (
    <SafeAreaView style={styles.container}>
      {/* MAP */}
      <MapView ref={mapRef} style={styles.map} onMapReady={recenterMap}>
        <Marker coordinate={pickupLocation}>
          <View style={styles.originMarker}>
            <View style={styles.originDot} />
            <View style={styles.originRing} />
          </View>
        </Marker>

        <Marker coordinate={dropoffLocation}>
          <View style={styles.destMarker}>
            <Ionicons name="location" size={28} color={SECONDARY} />
          </View>
        </Marker>

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

        <MapViewDirections
          origin={pickupLocation}
          destination={dropoffLocation}
          apikey={GOOGLE_MAPS_API_KEY}
          strokeWidth={5}
          strokeColor={PRIMARY}
        />
      </MapView>

      {/* TOP BAR */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.iconButton} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={DARK} />
        </TouchableOpacity>

        <View style={styles.statusPill}>
          <View style={[styles.statusDot, { backgroundColor: statusConfig.color }]} />
          <Text style={styles.statusText}>{statusConfig.label}</Text>
        </View>

        <TouchableOpacity style={styles.iconButton} onPress={recenterMap}>
          <Ionicons name="locate" size={22} color={DARK} />
        </TouchableOpacity>
      </View>

      {/* BOTTOM SHEET */}
      <View style={styles.bottomSheet}>
        <View style={styles.sheetHandle} />

        {/* Status Header */}
        <View style={styles.statusHeader}>
          <View style={[styles.statusIconBox, { backgroundColor: `${statusConfig.color}15` }]}>
            <Ionicons name={statusConfig.icon} size={22} color={statusConfig.color} />
          </View>
          <View>
            <Text style={styles.statusTitle}>{statusConfig.label}</Text>
            <Text style={styles.statusSub}>
              {status === 'accepted' && 'Approaching pickup location'}
              {status === 'arrived' && 'Meet your driver at the pickup spot'}
              {status === 'ongoing' && 'Heading to your destination'}
            </Text>
          </View>
        </View>

        {/* Pickup Location */}
        <View style={styles.locationCard}>
          <View style={styles.locationRow}>
            <View style={styles.locationDotContainer}>
              <View style={[styles.routeDot, { backgroundColor: PRIMARY }]} />
            </View>
            <View style={styles.locationTextBox}>
              <Text style={styles.locationLabel}>Pickup</Text>
              <Text style={styles.locationText} numberOfLines={1}>
                {pickupLocation.address}
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
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => handleCall(driverData.phoneNumber)}
              >
                <Ionicons name="call" size={18} color={SECONDARY} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Track Progress Button */}
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => navigation.navigate('RideInProgress', { rideId })}
        >
          <Text style={styles.primaryText}>Track Ride Progress</Text>
          <Ionicons name="arrow-forward" size={18} color="#fff" />
        </TouchableOpacity>
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

  /* Status Header */
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  statusIconBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: DARK,
  },
  statusSub: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },

  /* Location Card */
  locationCard: {
    backgroundColor: BG,
    padding: 14,
    borderRadius: 16,
    marginBottom: 14,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationDotContainer: {
    width: 20,
    alignItems: 'center',
    marginRight: 10,
  },
  routeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  locationTextBox: {
    flex: 1,
  },
  locationLabel: {
    fontSize: 11,
    color: '#999',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  locationText: {
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
    marginBottom: 16,
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

  /* Primary Button */
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PRIMARY,
    paddingVertical: 16,
    borderRadius: 16,
    gap: 8,
  },
  primaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});