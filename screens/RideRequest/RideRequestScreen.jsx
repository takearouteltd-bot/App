import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  TouchableOpacity,
  Dimensions,
  Animated,
  Alert,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import MapViewDirections from 'react-native-maps-directions';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { getAuth } from 'firebase/auth';
import { confirmPayment } from '@stripe/stripe-react-native';

const { width } = Dimensions.get('window');
const PRIMARY = '#79B431';
const SECONDARY = '#235594';
const DARK = '#1a1a1a';
const BG = '#F8F9FA';

export default function RideRequestScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { rideId } = route.params;

  const mapRef = useRef(null);
  const progress = useRef(new Animated.Value(0)).current;
  const paymentInProgress = useRef(false);
  const paymentCompleted = useRef(false);

  const [rideData, setRideData] = useState(null);
  const [rideStatus, setRideStatus] = useState("searching");
  const [cancelling, setCancelling] = useState(false);

  const GOOGLE_MAPS_API_KEY = 'AIzaSyBtmcvJE-m_v44Z2lLDm8wDgI6GGYLXimQ';

  /* ================= PROGRESS ANIMATION ================= */
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, { toValue: width * 0.3, duration: 700, useNativeDriver: false }),
        Animated.timing(progress, { toValue: width * 0.7, duration: 700, useNativeDriver: false }),
        Animated.timing(progress, { toValue: width * 0.95, duration: 700, useNativeDriver: false }),
        Animated.timing(progress, { toValue: 0, duration: 300, useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  /* ================= REAL-TIME LISTENER ================= */
const hasNavigatedToTracking = useRef(false);

useEffect(() => {
  if (!rideId) return;

  const rideDocRef = doc(db, 'rides', rideId);

  const unsubscribe = onSnapshot(rideDocRef, (docSnap) => {
    if (!docSnap.exists()) {
      Alert.alert('Error', 'Ride not found');
      navigation.goBack();
      return;
    }

    const data = docSnap.data();
    setRideData(data);
    setRideStatus(data.status);

    // ✅ Auto-navigate to tracking after driver accepted
    if (
      data.status === "accepted" &&
      data.driverId &&
      !hasNavigatedToTracking.current
    ) {
      hasNavigatedToTracking.current = true;
      
      // Show the assigned card for 3 seconds, then navigate
      setTimeout(() => {
        navigation.replace('RideTracking', { rideId });
      }, 3000);
    }

    if (
      data.status === "accepted" &&
      data.driverId &&
      data.payment?.status === "pending" &&
      data.payment?.clientSecret &&
      !paymentInProgress.current &&
      !paymentCompleted.current
    ) {
      handlePaymentConfirmation(data);
    }

    if (data.status === "cancelled") {
      Alert.alert("Ride Cancelled", "This ride has been cancelled.");
      navigation.goBack();
    }
  });

  return () => unsubscribe();
}, [rideId]);

  const handlePaymentConfirmation = async (ride) => {
    try {
      paymentInProgress.current = true;
      const clientSecret = ride.payment.clientSecret;
      console.log("🔐 Confirming payment...");

      const { error, paymentIntent } = await confirmPayment(clientSecret);

      if (error) {
        console.log("❌ Payment failed:", error);
        Alert.alert("Payment Failed", "Please update your payment method.");

        await updateDoc(doc(db, "rides", rideId), {
          status: "payment_failed",
          payment: {
            ...ride.payment,
            status: "failed",
            error: error.message,
          },
        });

        paymentInProgress.current = false;
        return;
      }

      console.log("✅ Payment authorized:", paymentIntent.id);
      paymentCompleted.current = true;

      await updateDoc(doc(db, "rides", rideId), {
        payment: {
          ...ride.payment,
          status: "authorized",
        },
      });
    } catch (err) {
      console.error("❌ Payment exception:", err);
    } finally {
      paymentInProgress.current = false;
    }
  };

  /* ================= MAP FIT ================= */
  const recenterMap = () => {
    if (mapRef.current && rideData) {
      const { pickupLocation, dropoffLocation } = rideData;
      mapRef.current.fitToCoordinates(
        [
          { latitude: pickupLocation.latitude, longitude: pickupLocation.longitude },
          { latitude: dropoffLocation.latitude, longitude: dropoffLocation.longitude },
        ],
        {
          edgePadding: { top: 120, right: 60, bottom: 420, left: 60 },
          animated: true,
        }
      );
    }
  };

  /* ================= CANCEL ================= */
  const handleCancelRequest = async () => {
    Alert.alert(
      'Cancel Ride',
      'Are you sure you want to cancel this ride request?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            try {
              setCancelling(true);
              const auth = getAuth();
              const currentUser = auth.currentUser;
              if (!currentUser) return;

              await updateDoc(doc(db, 'rides', rideId), { status: 'cancelled' });
              await updateDoc(doc(db, 'riders', currentUser.uid), { currentRideId: null });
              navigation.goBack();
            } catch (error) {
              console.error('Failed to cancel ride:', error);
              setCancelling(false);
            }
          },
        },
      ]
    );
  };

  /* ================= LOADING ================= */
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

  const {
    pickupLocation,
    dropoffLocation,
    fareEstimate,
    rideType,
    route: rideRoute,
  } = rideData;

  const distanceKm = rideRoute?.distanceKm || 0;
  const durationMinutes = rideRoute?.durationMinutes || 0;

  const isSearching = rideStatus === "searching";
  const isAccepted = rideStatus === "accepted" && rideData.driverId;

  return (
    <SafeAreaView style={styles.container}>
      {/* MAP */}
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: pickupLocation.latitude,
          longitude: pickupLocation.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
        onMapReady={recenterMap}
      >
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
          <View style={[styles.statusDot, { backgroundColor: isSearching ? '#FFC107' : PRIMARY }]} />
          <Text style={styles.statusText}>
            {isSearching ? 'Searching' : isAccepted ? 'Driver Found' : rideStatus}
          </Text>
        </View>

        <TouchableOpacity style={styles.iconButton}>
          <Ionicons name="share-outline" size={22} color={DARK} />
        </TouchableOpacity>
      </View>

      {/* BOTTOM SHEET */}
      <View style={styles.bottomSheet}>
        <View style={styles.sheetHandle} />

        {isSearching && (
          <View style={styles.searchingContainer}>
            <View style={styles.pulseRing}>
              <View style={styles.pulseInner}>
                <Ionicons name="search" size={28} color={PRIMARY} />
              </View>
            </View>

            <Text style={styles.loadingText}>Finding your driver</Text>
            <Text style={styles.etaText}>Estimated wait: 2–5 minutes</Text>

            <View style={styles.progressBarBackground}>
              <Animated.View style={[styles.progressBarFill, { width: progress }]} />
            </View>

            <View style={styles.searchingDetails}>
              <View style={styles.detailChip}>
                <Ionicons name="card-outline" size={14} color={SECONDARY} />
                <Text style={styles.chipText}>£{fareEstimate}</Text>
              </View>
              <View style={styles.detailChip}>
                <Ionicons name="navigate-outline" size={14} color={SECONDARY} />
                <Text style={styles.chipText}>{distanceKm} km</Text>
              </View>
              <View style={styles.detailChip}>
                <Ionicons name="time-outline" size={14} color={SECONDARY} />
                <Text style={styles.chipText}>{Math.ceil(durationMinutes)} min</Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.cancelButton, cancelling && styles.cancelButtonDisabled]}
              onPress={handleCancelRequest}
              disabled={cancelling}
            >
              <Text style={styles.cancelText}>
                {cancelling ? 'Cancelling…' : 'Cancel Request'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {isAccepted && (
          <View style={styles.acceptedContainer}>
            <View style={styles.successBadge}>
              <Ionicons name="checkmark-circle" size={20} color="#fff" />
              <Text style={styles.successText}>Driver Assigned</Text>
            </View>

            <View style={styles.rideTypeRow}>
              <View style={styles.rideTypeBadge}>
                <FontAwesome5 name="car-side" size={16} color={PRIMARY} />
                <Text style={styles.rideTypeText}>{rideType}</Text>
              </View>
            </View>

            <View style={styles.locationCard}>
              <View style={styles.locationRow}>
                <View style={styles.locationDotContainer}>
                  <View style={[styles.routeDot, { backgroundColor: PRIMARY }]} />
                  <View style={styles.routeLine} />
                </View>
                <Text style={styles.locationText} numberOfLines={1}>
                  {pickupLocation.address}
                </Text>
              </View>

              <View style={styles.locationRow}>
                <View style={styles.locationDotContainer}>
                  <View style={[styles.routeDot, { backgroundColor: SECONDARY }]} />
                </View>
                <Text style={styles.locationText} numberOfLines={1}>
                  {dropoffLocation.address}
                </Text>
              </View>
            </View>

            <View style={styles.fareCard}>
              <View style={styles.fareRow}>
                <View style={styles.fareIconBox}>
                  <Ionicons name="receipt-outline" size={18} color={SECONDARY} />
                </View>
                <View style={styles.fareTextBox}>
                  <Text style={styles.fareLabel}>Trip Fare</Text>
                  <Text style={styles.fareSub}>Includes VAT & fees</Text>
                </View>
                <Text style={styles.fareValue}>£{fareEstimate}</Text>
              </View>

              <View style={styles.fareDivider} />

              <View style={styles.fareRowCompact}>
                <View style={styles.fareCompactItem}>
                  <Ionicons name="navigate-outline" size={14} color="#888" />
                  <Text style={styles.fareCompactText}>{distanceKm} km</Text>
                </View>
                <View style={styles.fareCompactItem}>
                  <Ionicons name="time-outline" size={14} color="#888" />
                  <Text style={styles.fareCompactText}>{Math.ceil(durationMinutes)} min</Text>
                </View>
              </View>
            </View>

            <Text style={styles.etaText}>
              Redirecting to live tracking…
            </Text>

          </View>
        )}
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

  /* Searching State */
  searchingContainer: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  pulseRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(121,180,49,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  pulseInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(121,180,49,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 22,
    fontWeight: '800',
    color: DARK,
    textAlign: 'center',
  },
  etaText: {
    fontSize: 15,
    color: '#888',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 20,
  },
  progressBarBackground: {
    width: '100%',
    height: 6,
    backgroundColor: '#eee',
    borderRadius: 3,
    marginBottom: 20,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 6,
    backgroundColor: PRIMARY,
    borderRadius: 3,
  },
  searchingDetails: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  detailChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BG,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: DARK,
  },
  cancelButton: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  cancelButtonDisabled: {
    opacity: 0.6,
  },
  cancelText: {
    color: '#888',
    fontWeight: '700',
    fontSize: 15,
  },

  /* Accepted State */
  acceptedContainer: {
    paddingVertical: 4,
  },
  successBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: PRIMARY,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
    marginBottom: 16,
  },
  successText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  rideTypeRow: {
    alignItems: 'center',
    marginBottom: 16,
  },
  rideTypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(121,180,49,0.08)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    gap: 8,
  },
  rideTypeText: {
    fontSize: 16,
    fontWeight: '700',
    color: PRIMARY,
  },

  /* Location Card */
  locationCard: {
    backgroundColor: BG,
    padding: 16,
    borderRadius: 16,
    marginBottom: 16,
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
  routeLine: {
    width: 2,
    height: 20,
    backgroundColor: '#ddd',
    marginVertical: 2,
  },
  locationText: {
    fontSize: 14,
    fontWeight: '500',
    color: DARK,
    flex: 1,
    lineHeight: 20,
  },

  /* Fare Card */
  fareCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  fareRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fareIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#E3F2FD',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  fareTextBox: {
    flex: 1,
  },
  fareLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: DARK,
  },
  fareSub: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  fareValue: {
    fontSize: 20,
    fontWeight: '800',
    color: PRIMARY,
  },
  fareDivider: {
    height: 1,
    backgroundColor: '#f0f0f0',
    marginVertical: 12,
  },
  fareRowCompact: {
    flexDirection: 'row',
    gap: 20,
  },
  fareCompactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fareCompactText: {
    fontSize: 13,
    color: '#888',
    fontWeight: '500',
  },

  /* Track Button */
  trackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PRIMARY,
    paddingVertical: 16,
    borderRadius: 16,
    gap: 8,
  },
  trackText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});