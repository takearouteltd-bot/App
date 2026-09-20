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
  Linking,
  ScrollView,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import MapViewDirections from 'react-native-maps-directions';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRoute, useNavigation } from '@react-navigation/native';
import { doc, onSnapshot, updateDoc, serverTimestamp, getDoc, arrayUnion } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { currencySymbol } from '../../../utils/appConfig';
import SafetyButton from '../../../components/SafetyButton';
import { confirmMaskedCall } from '../../../utils/calling';
import { useWaitingClock } from '../../../utils/useWaitingClock';

const { width, height } = Dimensions.get('window');
const PRIMARY = '#79B531';
const SECONDARY = '#235594';
const DANGER = '#DC2626';
const DARK = '#1A1A1A';
const BG = '#F8F9FA';

const GOOGLE_MAPS_API_KEY = 'AIzaSyBtmcvJE-m_v44Z2lLDm8wDgI6GGYLXimQ';

export default function DriverRideInProgressScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { rideId } = route.params;

  const mapRef = useRef(null);
// Replace this:
const slideAnim = useRef(new Animated.Value(0)).current;

// With this:
const heightAnim = useRef(new Animated.Value(height * 0.7)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const [ride, setRide] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);
  const [riderData, setRiderData] = useState(null);
  const [eta, setEta] = useState(null);
  const [distance, setDistance] = useState(null);
  const [loadingAction, setLoadingAction] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const waiting = useWaitingClock(ride);
  // Guards against leaving this screen twice (handler + listener both fire).
  const hasLeftScreen = useRef(false);
  const driverIdRef = useRef(null);

  /* ================= ANIMATIONS ================= */
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
    const rideRef = doc(db, 'rides', rideId);
    const unsubscribe = onSnapshot(rideRef, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      setRide(data);
      if (data.driverId) driverIdRef.current = data.driverId;

      if (hasLeftScreen.current) return;

      // Auto-navigate if ride status changes
      if (data.status === 'ongoing') {
        hasLeftScreen.current = true;
        navigation.replace('RideToDropoff', { rideId });
        return;
      }

      // Passenger cancelled: tell the driver and free them up for the next job.
      if (data.status === 'cancelled' || data.status === 'canceled') {
        hasLeftScreen.current = true;
        releaseDriver();
        Alert.alert('Job cancelled', 'The passenger cancelled this job.', [
          { text: 'OK', onPress: goHome },
        ]);
      }
    });
    return () => unsubscribe();
  }, [rideId]);

  /* ================= LEAVING THE JOB ================= */
  const goHome = () => {
    navigation.reset({ index: 0, routes: [{ name: 'DriverHome' }] });
  };

  // Clears the "on a job" flags on the driver record and puts them back online.
  const releaseDriver = async () => {
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
  };

  /* ================= DRIVER LOCATION ================= */
  useEffect(() => {
    if (!ride?.driverId) return;
    const driverRef = doc(db, 'drivers', ride.driverId);
    const unsubscribe = onSnapshot(driverRef, (snap) => {
      if (!snap.exists()) return;
      const driver = snap.data();
      if (driver.location) {
        setDriverLocation({
          latitude: driver.location.latitude,
          longitude: driver.location.longitude,
        });
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

  /* ================= MAP FIT ================= */
  useEffect(() => {
    if (!ride || !driverLocation || !mapRef.current) return;

    const coords = [driverLocation];
    if (ride.status === 'accepted') {
      coords.push(ride.pickupLocation);
    } else if (ride.status === 'ongoing') {
      coords.push(ride.dropoffLocation);
    }

    // Adjust bottom padding based on minimized state
    const bottomPadding = isMinimized ? 150 : 350;

    mapRef.current.fitToCoordinates(coords, {
      edgePadding: { top: 120, right: 60, bottom: bottomPadding, left: 60 },
      animated: true,
    });
  }, [ride, driverLocation, isMinimized]);

  /* ================= TOGGLE MINIMIZE ================= */
const toggleMinimize = useCallback(() => {
  const expandedHeight = height * 0.7;
  const minimizedHeight = 120; // Show 120px when minimized
  
  const toValue = isMinimized ? expandedHeight : minimizedHeight;
  setIsMinimized(!isMinimized);
  Animated.timing(heightAnim, {
    toValue: toValue,
    duration: 300,
    useNativeDriver: false, // Height animation can't use native driver
  }).start();
}, [isMinimized]);

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
      setLoadingAction(false);
    }
  }, [rideId, navigation]);

  // Driver gives the job back. It returns to "searching" so the next
  // available driver can take it, and this driver will not be offered it again.
  const handleCancel = useCallback(() => {
    Alert.alert(
      'Cancel this job?',
      'The job will be offered to another driver.',
      [
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
              Alert.alert('Error', 'Could not cancel the job. Please try again.');
              setLoadingAction(false);
            }
          },
        },
      ]
    );
  }, [rideId]);

  // After arriving, the driver can end the job if the passenger doesn't show.
  // The ride is cancelled outright (not re-offered), the card hold is
  // released by the cancelRidePayment function, and the passenger is told.
  const handleNoShow = useCallback(() => {
    Alert.alert(
      'Cancel this ride?',
      'Only do this if the passenger has not turned up. The ride will be cancelled and the passenger told.',
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
              Alert.alert('Error', 'Could not cancel the ride. Please try again.');
              setLoadingAction(false);
            }
          },
        },
      ]
    );
  }, [rideId]);

  // Opens turn-by-turn directions to the pickup point in the phone's maps app.
  const handleNavigate = useCallback(() => {
    const point = ride?.pickupLocation;
    if (!point?.latitude || !point?.longitude) {
      Alert.alert('No pickup location', 'This job has no pickup coordinates.');
      return;
    }
    const url = `https://www.google.com/maps/dir/?api=1&destination=${point.latitude},${point.longitude}&travelmode=driving`;
    Linking.openURL(url).catch(() => Alert.alert('Error', 'Could not open maps.'));
  }, [ride]);

  /* ================= RENDER HELPERS ================= */
  const getStatusConfig = () => {
    switch (ride?.status) {
      case 'accepted':
        return {
          title: 'Heading to Pickup',
          subtitle: 'Follow the route to reach your rider',
          buttonText: "I've Arrived",
          buttonAction: handleArrived,
          destination: ride?.pickupLocation,
          markerColor: PRIMARY,
        };
      case 'arrived':
        return {
          title: 'Arrived at Pickup',
          subtitle: 'Wait for your rider to arrive',
          buttonText: 'Start Ride',
          buttonAction: handleStartRide,
          destination: ride?.pickupLocation,
          markerColor: SECONDARY,
        };
      default:
        return {
          title: 'Ride in Progress',
          subtitle: '',
          buttonText: '...',
          buttonAction: () => {},
          destination: ride?.pickupLocation,
          markerColor: PRIMARY,
        };
    }
  };

  const statusConfig = getStatusConfig();

  /* ================= LOADING ================= */
  if (!ride || !driverLocation) {
    return (
      <SafeAreaView style={styles.loader}>
        <StatusBar barStyle="light-content" backgroundColor={SECONDARY} />
        <ActivityIndicator size="large" color={PRIMARY} />
        <Text style={styles.loaderText}>Loading ride details...</Text>
      </SafeAreaView>
    );
  }

  const { pickupLocation, dropoffLocation, status, fare } = ride;
  const destination = status === 'accepted' ? pickupLocation : dropoffLocation;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

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

        {/* Destination Marker */}
        <Marker coordinate={destination} anchor={{ x: 0.5, y: 1 }}>
          <View style={styles.destinationMarker}>
            <View style={[styles.destinationPin, { backgroundColor: statusConfig.markerColor }]}>
              <Ionicons 
                name={status === 'accepted' ? "location" : "flag"} 
                size={14} 
                color="#fff" 
              />
            </View>
            <View style={styles.destinationArrow} />
          </View>
        </Marker>

        {/* Route Directions */}
        <MapViewDirections
          origin={driverLocation}
          destination={destination}
          apikey={GOOGLE_MAPS_API_KEY}
          strokeWidth={5}
          strokeColor={PRIMARY}
          onReady={(result) => {
            setEta(Math.ceil(result.duration));
            setDistance(result.distance.toFixed(1));
          }}
        />
      </MapView>

      {/* ================= TOP BAR ================= */}
      <SafeAreaView style={styles.topBar}>
        <TouchableOpacity 
          style={styles.backBtn} 
          onPress={() => navigation.goBack()}
          activeOpacity={0.8}
        >
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>

        <View style={styles.etaBadge}>
          <Ionicons name="time-outline" size={14} color="#fff" />
          <Text style={styles.etaText}>{eta ? `${eta} min` : '...'}</Text>
        </View>

        {/* Safety: 999, 101 and the driver's emergency contact. Replaces an
            unused menu button. */}
        <SafetyButton role="driver" rideId={rideId} />
      </SafeAreaView>

      {/* ================= FLOATING STATS ================= */}
      <View style={styles.floatingStats}>
        <View style={styles.statPill}>
          <MaterialCommunityIcons name="map-marker-distance" size={14} color={PRIMARY} />
          <Text style={styles.statPillText}>{distance ? `${distance} km` : '...'}</Text>
        </View>
        <View style={styles.statPill}>
          <Ionicons name="cash-outline" size={14} color={PRIMARY} />
          <Text style={styles.statPillText}>{currencySymbol()}{fare?.total?.toFixed(2) || '0.00'}</Text>
        </View>
      </View>

      {/* ================= BOTTOM SHEET ================= */}
     <Animated.View 
  style={[
    styles.bottomSheet,
    { height: heightAnim }  // Animate height instead of transform
  ]}
>
        {/* Handle - Click to toggle */}
        <TouchableOpacity 
          style={styles.handle} 
          onPress={toggleMinimize}
          activeOpacity={0.7}
        >
          <View style={styles.handleBar} />
          <Ionicons 
            name={isMinimized ? "chevron-up" : "chevron-down"} 
            size={18} 
            color="#999" 
            style={styles.handleIcon}
          />
        </TouchableOpacity>

        {/* Status Header - Always Visible */}
        <View style={styles.statusHeader}>
          <View style={[styles.statusDot, { backgroundColor: statusConfig.markerColor }]} />
          <View style={styles.statusTextContainer}>
            <Text style={styles.statusTitle}>{statusConfig.title}</Text>
            {!isMinimized && (
              <Text style={styles.statusSubtitle}>{statusConfig.subtitle}</Text>
            )}
            {waiting && (
              <Text style={[styles.statusSubtitle, { color: waiting.inFreeTime ? SECONDARY : '#D97706', fontWeight: '700' }]}>
                {waiting.label}
              </Text>
            )}
          </View>
        </View>

        {/* Minimized State - Show only essential info */}
        {isMinimized && (
          <View style={styles.minimizedInfo}>
            <Text style={styles.minimizedDistance}>
              {distance ? `${distance} km` : '...'} • {eta ? `${eta} min` : '...'}
            </Text>
          </View>
        )}

        {/* Expanded Content - Hidden when minimized */}
        {/* Scrollable so the Navigate and Cancel buttons at the bottom are
            never cut off by the fixed-height sheet on smaller phones. */}
        {!isMinimized && (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 16 }}
            showsVerticalScrollIndicator={false}
          >
            {/* Progress Steps */}
            <View style={styles.progressContainer}>
              <View style={styles.progressStep}>
                <View style={[styles.stepCircle, styles.stepActive]}>
                  <Ionicons name="checkmark" size={12} color="#fff" />
                </View>
                <Text style={styles.stepLabel}>Accepted</Text>
              </View>
              <View style={[styles.progressLine, status !== 'accepted' && styles.progressLineActive]} />
              <View style={styles.progressStep}>
                <View style={[styles.stepCircle, status !== 'accepted' ? styles.stepActive : styles.stepInactive]}>
                  {status !== 'accepted' ? (
                    <Ionicons name="checkmark" size={12} color="#fff" />
                  ) : (
                    <View style={styles.stepDot} />
                  )}
                </View>
                <Text style={[styles.stepLabel, status === 'accepted' && styles.stepLabelInactive]}>Arrived</Text>
              </View>
              <View style={[styles.progressLine, status === 'ongoing' && styles.progressLineActive]} />
              <View style={styles.progressStep}>
                <View style={[styles.stepCircle, status === 'ongoing' ? styles.stepActive : styles.stepInactive]}>
                  {status === 'ongoing' ? (
                    <Ionicons name="checkmark" size={12} color="#fff" />
                  ) : (
                    <View style={styles.stepDot} />
                  )}
                </View>
                <Text style={[styles.stepLabel, status !== 'ongoing' && styles.stepLabelInactive]}>Started</Text>
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
                <View style={styles.locationRow}>
                  <Text style={styles.locationLabel}>Pickup</Text>
                  <Text style={styles.locationValue} numberOfLines={2}>
                    {pickupLocation?.address || 'Loading address...'}
                  </Text>
                </View>
                <View style={styles.locationDivider} />
                <View style={styles.locationRow}>
                  <Text style={styles.locationLabel}>Dropoff</Text>
                  <Text style={styles.locationValue} numberOfLines={2}>
                    {dropoffLocation?.address || 'Loading address...'}
                  </Text>
                </View>
              </View>
            </View>

            {/* Rider Card */}
            {riderData && (
              <View style={styles.riderCard}>
                <Image
                  source={{ 
                    uri: riderData.profileImage || riderData.selfieUrl || riderData.photoURL || 'https://i.pravatar.cc/150?img=3'
                  }}
                  style={styles.riderAvatar}
                />
                <View style={styles.riderInfo}>
                  <Text style={styles.riderName}>
                    {riderData.fullName || riderData.name || 'Rider'}
                  </Text>
                  <View style={styles.riderMeta}>
                    <Ionicons name="star" size={12} color="#F5B300" />
                    <Text style={styles.riderRating}>{riderData.rating || '4.5'}</Text>
                    <View style={styles.riderDivider} />
                    <Text style={styles.riderLabel}>Passenger</Text>
                  </View>
                </View>
                <View style={styles.riderActions}>
                  <TouchableOpacity 
                    style={[styles.actionBtn, styles.actionBtnPrimary]}
                    onPress={() => navigation.navigate('ChatScreen', {
                      rideId,
                      currentUser: { uid: ride.driverId },
                      userType: 'driver',
                      otherUserName: riderData?.fullName || 'Rider',
                      otherUserPhoto: riderData?.profileImage || riderData?.photoURL,
                    })}
                  >
                    <Ionicons name="chatbubble-ellipses" size={18} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.actionBtn, styles.actionBtnSecondary]}
                    onPress={() => confirmMaskedCall(rideId, 'your passenger')}
                  >
                    <Ionicons name="call" size={18} color={SECONDARY} />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Action Button */}
            <TouchableOpacity 
              style={[
                styles.primaryBtn,
                loadingAction && styles.primaryBtnLoading
              ]} 
              onPress={statusConfig.buttonAction}
              disabled={loadingAction}
              activeOpacity={0.9}
            >
              {loadingAction ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Text style={styles.btnText}>{statusConfig.buttonText}</Text>
                  <Ionicons name="arrow-forward" size={18} color="#fff" />
                </>
              )}
            </TouchableOpacity>

            {/* Navigate to pickup */}
            {status === 'accepted' && (
              <TouchableOpacity style={styles.cancelBtn} onPress={handleNavigate}>
                <Text style={[styles.cancelText, { color: SECONDARY, fontWeight: '700' }]}>
                  Navigate to pickup
                </Text>
              </TouchableOpacity>
            )}

            {/* Cancel Option */}
            {status === 'accepted' && (
              <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
                <Text style={styles.cancelText}>Can't make it? Cancel ride</Text>
              </TouchableOpacity>
            )}
            {status === 'arrived' && (
              <TouchableOpacity style={styles.cancelBtn} onPress={handleNoShow}>
                <Text style={styles.cancelText}>Passenger not here? Cancel ride</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        )}
      </Animated.View>
    </View>
  );
}

/* ================= CUSTOM MAP STYLE ================= */
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
    borderTopColor: PRIMARY,
    marginTop: -4,
  },

  /* Bottom Sheet */
 // Replace the bottomSheet style with this:
bottomSheet: {
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  // Remove: transform: [{ translateY: slideAnim }]
  backgroundColor: '#fff',
  borderTopLeftRadius: 28,
  borderTopRightRadius: 28,
  paddingHorizontal: 20,
  paddingTop: 8,
  paddingBottom: Platform.OS === 'ios' ? 34 : 24,
  shadowColor: '#000',
  shadowOffset: { width: 0, height: -4 },
  shadowOpacity: 0.12,
  shadowRadius: 16,
  elevation: 20,
},
  handle: {
    alignSelf: 'center',
    marginBottom: 12,
    padding: 8,
    alignItems: 'center',
  },
  handleBar: {
    width: 40,
    height: 4,
    backgroundColor: '#E5E5EA',
    borderRadius: 2,
    marginBottom: 4,
  },
  handleIcon: {
    marginTop: 2,
  },

  /* Minimized Info */
  minimizedInfo: {
    marginBottom: 16,
    alignItems: 'center',
  },
  minimizedDistance: {
    fontSize: 13,
    color: '#888',
    fontWeight: '500',
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
  primaryBtnLoading: {
    opacity: 0.7,
  },
  btnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 0.3,
  },

  /* Cancel */
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 4,
  },
  cancelText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#999',
    textDecorationLine: 'underline',
  },
});