import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Dimensions,
  AppState,
  Alert,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  setDoc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../../config/firebase";
import { getAuth } from "firebase/auth";

const { width, height } = Dimensions.get('window');
const PRIMARY = '#79B531';
const SECONDARY = '#235594';
const DARK = '#1a1a1a';
const BG = '#F8F9FA';

export default function DriverHomeScreen() {
  const mapRef = useRef(null);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(width)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const navigation = useNavigation();

  const [location, setLocation] = useState(null);
  const [isOnline, setIsOnline] = useState(true);
  const [loading, setLoading] = useState(true);

  const [rideRequests, setRideRequests] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timer, setTimer] = useState(15);
  const [isAccepting, setIsAccepting] = useState(false);

  // Real data states
  const [earningsToday, setEarningsToday] = useState(0);
  const [walletBalance, setWalletBalance] = useState(0);
  const [tripsToday, setTripsToday] = useState(0);
  const [driverName, setDriverName] = useState('');

  const auth = getAuth();
  const driverId = auth.currentUser?.uid;

  const [checkingRide, setCheckingRide] = useState(true);



  const updateDriverLocation = async (driverId, coords) => {
    try {
      const driverRef = doc(db, "drivers", driverId);
      await setDoc(
        driverRef,
        {
          location: {
            latitude: coords.latitude,
            longitude: coords.longitude,
          },
          lastUpdated: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      console.log("Location update error:", error);
    }
  };

  /* ================= FETCH REAL DATA ================= */
  useEffect(() => {
    if (!driverId) return;

    // Fetch driver profile
    const driverRef = doc(db, "drivers", driverId);
    const unsubDriver = onSnapshot(driverRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setDriverName(data.firstName || data.fullName || 'Driver');
        setIsOnline(data.status === 'online');
      }
    });

    // Fetch wallet data
    const walletRef = doc(db, "driverWallets", driverId);
    const unsubWallet = onSnapshot(walletRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setWalletBalance(data.availableBalance || 0);
      } else {
        setWalletBalance(0);
      }
    });

    // Fetch today's earnings from rides
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const ridesQ = query(
      collection(db, "rides"),
      where("driverId", "==", driverId)
    );

    const unsubRides = onSnapshot(ridesQ, (snapshot) => {
      let todayTotal = 0;
      let todayTrips = 0;

      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const completedAt = data.completedAt;

        if (data.route?.status === "completed" || data.status === "completed") {
          // Check if completed today
          let completedDate = null;
          if (completedAt?.toDate) {
            completedDate = completedAt.toDate();
          } else if (completedAt) {
            completedDate = new Date(completedAt);
          }

          if (completedDate) {
            const rideDate = new Date(completedDate);
            rideDate.setHours(0, 0, 0, 0);
            if (rideDate.getTime() === today.getTime()) {
              todayTotal += data.earnings?.driverEarning || data.fare?.total || 0;
              todayTrips += 1;
            }
          }
        }
      });
      setEarningsToday(todayTotal);
      setTripsToday(todayTrips);
    });

    return () => {
      unsubDriver();
      unsubWallet();
      unsubRides();
    };
  }, [driverId]);

  /* ================= LOCATION TRACKING ================= */
  useEffect(() => {
    let subscription;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const loc = await Location.getCurrentPositionAsync({});
      setLocation(loc.coords);
      setLoading(false);

      if (driverId) {
        await updateDriverLocation(driverId, loc.coords);
      }

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 4000,
        },
        async (newLoc) => {
          const coords = newLoc.coords;
          setLocation(coords);

          if (driverId) {
            await updateDriverLocation(driverId, coords);
          }
        }
      );
    })();

    return () => {
      if (subscription) subscription.remove();
    };
  }, [driverId]);

  /* ================= TOGGLE ONLINE/OFFLINE ================= */
  const toggleOnlineStatus = async () => {
    if (!driverId) return;
    const newStatus = !isOnline ? 'online' : 'offline';

    try {
      const driverRef = doc(db, "drivers", driverId);
      await setDoc(driverRef, { status: newStatus }, { merge: true });
      setIsOnline(!isOnline);
    } catch (error) {
      console.log("Status update error:", error);
      Alert.alert("Error", "Failed to update status. Please try again.");
    }
  };

  /* ================= RIDE LISTENER ================= */
  useEffect(() => {
    if (!isOnline || !location) return;

    const q = query(
      collection(db, "rides"),
      where("status", "==", "searching")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const rides = [];

      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (!data.pickupLocation) return;

        const distance = getDistanceFromLatLonInKm(
          location.latitude,
          location.longitude,
          data.pickupLocation.latitude,
          data.pickupLocation.longitude
        );

        if (distance <= 50 && data.status === "searching") {
          rides.push({
            id: docSnap.id,
            ...data,
            driverToPickup: {
              distance: distance.toFixed(1),
              duration: Math.ceil(distance * 2),
            },
          });
        }
      });

      setRideRequests(rides);
      setCurrentIndex(0);

      if (rides.length) animateCard();
    });

    return () => unsubscribe();
  }, [isOnline, location]);

  /* ================= DISTANCE ================= */
  const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;

    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  };

  /* ================= ANIMATION ================= */
  const animateCard = () => {
    slideAnim.setValue(width);
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 400,
      useNativeDriver: true,
    }).start();
  };

  /* ================= PULSE ANIMATION FOR ONLINE ================= */
  useEffect(() => {
    if (isOnline) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.3, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [isOnline]);

  /* ================= TIMER ================= */
  useEffect(() => {
    if (!rideRequests.length) return;

    setTimer(15);

    const interval = setInterval(() => {
      setTimer((prev) => (prev > 1 ? prev - 1 : 1));
    }, 1000);

    return () => clearInterval(interval);
  }, [currentIndex, rideRequests]);

  /* ================= ACCEPT RIDE ================= */
  const handleAcceptRide = async (ride) => {
    if (isAccepting) return;

    setIsAccepting(true);

    try {
      const rideRef = doc(db, "rides", ride.id);
      const driverRef = doc(db, "drivers", driverId);

      await runTransaction(db, async (transaction) => {
        const rideDoc = await transaction.get(rideRef);

        if (!rideDoc.exists()) throw "Ride does not exist";

        if (rideDoc.data().status !== "searching") {
          throw "Ride already taken";
        }

        transaction.update(rideRef, {
          driverId: driverId,
          status: "accepted",
          walletProcessed: false,
          acceptedAt: serverTimestamp(),
        });

        transaction.set(
          driverRef,
          {
            isOnRide: true,
            currentRideId: ride.id,
            status: "on_ride",
          },
          { merge: true }
        );
      });

      const unsubscribe = onSnapshot(rideRef, (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();

        if (data.status === "accepted") {
          navigation.replace("DriverRideInProgress", {
            rideId: ride.id,
          });
          unsubscribe();
        }
      });

    } catch (err) {
      console.log(err);
      Alert.alert("Error", "Ride already taken or failed");
    } finally {
      setIsAccepting(false);
    }
  };


useEffect(() => {
  const checkOngoingRide = async () => {
    if (!driverId) {
      setCheckingRide(false);
      return;
    }

    try {
      const driverRef = doc(db, 'drivers', driverId);
      const driverSnap = await getDoc(driverRef);

      if (!driverSnap.exists()) {
        setCheckingRide(false);
        return;
      }

      const driverData = driverSnap.data();

      // If no ongoing ride, stop checking
      if (!driverData.isOnRide || !driverData.currentRideId) {
        setCheckingRide(false);
        return;
      }

      // Has ongoing ride — check the ride doc
      const rideRef = doc(db, 'rides', driverData.currentRideId);
      const rideSnap = await getDoc(rideRef);

      if (!rideSnap.exists()) {
        setCheckingRide(false);
        return;
      }

      const rideData = rideSnap.data();
      const status = rideData.status;
      let navigateTo = null;

      if (status === 'accepted' || status === 'arrived') {
        navigateTo = 'DriverRideInProgress';
      } else if (status === 'ongoing') {
        navigateTo = 'RideToDropoff';
      }

      if (navigateTo) {
        navigation.replace(navigateTo, { 
          rideId: driverData.currentRideId 
        });
        // Don't setCheckingRide(false) — we're leaving this screen
      } else {
        // Ride exists but not in a state we should navigate to
        setCheckingRide(false);
      }

    } catch (error) {
      console.error('Error checking ongoing ride:', error);
      setCheckingRide(false);
    }
  };

  checkOngoingRide();

  const subscription = AppState.addEventListener('change', (nextAppState) => {
    if (nextAppState === 'active') {
      checkOngoingRide();
    }
  });

  return () => subscription.remove();
}, [driverId, navigation]);

  if (checkingRide) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={PRIMARY} />
        <Text style={{ marginTop: 12, color: '#666', fontWeight: '600' }}>
          Checking for active ride...
        </Text>
      </SafeAreaView>
    );
  }
  /* ================= UI ================= */

  if (loading || !location) {
    return (
      <SafeAreaView style={styles.loader}>
        <ActivityIndicator size="large" color={PRIMARY} />
        <Text style={{ color: '#fff', marginTop: 10 }}>Getting location…</Text>
      </SafeAreaView>
    );
  }

  const currentRide = rideRequests[currentIndex];

  const handleDeclineRide = () => {
    if (currentIndex < rideRequests.length - 1) {
      setCurrentIndex(currentIndex + 1);
      animateCard();
    } else {
      setRideRequests([]);
    }
  };

  const handleMarkerPress = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 1.25, duration: 120, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 120, useNativeDriver: true }),
    ]).start();
  };

  const avgPerTrip = tripsToday > 0 ? (earningsToday / tripsToday) : 0;


  

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: location.latitude,
          longitude: location.longitude,
          latitudeDelta: 0.003,
          longitudeDelta: 0.003,
        }}
        customMapStyle={mapStyle}
      >
        <Marker coordinate={location} onPress={handleMarkerPress}>
          <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
            <View style={styles.carMarker}>
              <Ionicons name="car-sport" size={18} color="#fff" />
            </View>
          </Animated.View>
        </Marker>
      </MapView>

      {/* HEADER */}
      <SafeAreaView style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.onlineDotWrap}>
            <Animated.View style={[styles.onlinePulse, { transform: [{ scale: pulseAnim }] }]} />
            <View style={[styles.onlineDot, { backgroundColor: isOnline ? PRIMARY : '#ccc' }]} />
          </View>
          <View>
            <Text style={styles.statusText}>
              {isOnline ? 'You are online' : 'You are offline'}
            </Text>
            <Text style={styles.subText}>
              {isOnline ? 'Finding trips near you' : 'Go online to find trips'}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.goButton, { backgroundColor: isOnline ? '#DC2626' : PRIMARY }]}
          onPress={toggleOnlineStatus}
        >
          <Text style={styles.goButtonText}>
            {isOnline ? 'GO OFFLINE' : 'GO ONLINE'}
          </Text>
        </TouchableOpacity>
      </SafeAreaView>

      {/* EARNINGS CARD - Professional Design */}
      <View style={styles.earningsCard}>
        <View style={styles.earningsTopRow}>
          <View style={styles.earningsHeader}>
            <View style={styles.earningsIconBox}>
              <Ionicons name="trending-up" size={20} color={PRIMARY} />
            </View>
            <View>
              <Text style={styles.cardTitle}>Earnings Today</Text>
              <Text style={styles.amount}>£{earningsToday.toFixed(2)}</Text>
            </View>
          </View>

          <TouchableOpacity 
            style={styles.walletMiniCard}
            onPress={() => navigation.navigate('EarningsScreen')}
          >
            <Ionicons name="wallet-outline" size={16} color={SECONDARY} />
            <View style={{ marginLeft: 8 }}>
              <Text style={styles.walletMiniLabel}>Wallet</Text>
              <Text style={styles.walletMiniValue}>£{walletBalance.toFixed(2)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color="#C5C5C7" style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </View>

        <View style={styles.earningsDivider} />

        <View style={styles.earningsBottomRow}>
          <View style={styles.miniStat}>
            <Text style={styles.miniStatValue}>{tripsToday}</Text>
            <Text style={styles.miniStatLabel}>Trips Today</Text>
          </View>
          <View style={styles.miniStatDivider} />
          <View style={styles.miniStat}>
            <Text style={styles.miniStatValue}>£{avgPerTrip.toFixed(2)}</Text>
            <Text style={styles.miniStatLabel}>Avg / Trip</Text>
          </View>
          <View style={styles.miniStatDivider} />
          <View style={styles.miniStat}>
            <Text style={styles.miniStatValue}>{isOnline ? 'Active' : 'Off'}</Text>
            <Text style={styles.miniStatLabel}>Status</Text>
          </View>
        </View>
      </View>

      {/* RIDE CARD */}
      {currentRide && (
        <Animated.View
          style={[
            styles.rideRequestCard,
            { transform: [{ translateX: slideAnim }] },
          ]}
        >
          <View style={styles.cardHandle} />

          <View style={styles.badge}>
            <MaterialCommunityIcons name="lightning-bolt" size={16} color="#fff" />
            <Text style={styles.badgeText}>NEW REQUEST</Text>
          </View>

          <View style={styles.locationSection}>
            <View style={styles.locationRow}>
              <View style={styles.dotPickup} />
              <Text style={styles.pickup} numberOfLines={1}>
                {currentRide.pickupLocation.address}
              </Text>
            </View>

            <View style={styles.locationMeta}>
              <View style={styles.metaChip}>
                <Ionicons name="navigate-outline" size={12} color={SECONDARY} />
                <Text style={styles.metaText}>
                  {currentRide.driverToPickup.distance} km
                </Text>
              </View>
              <View style={styles.metaChip}>
                <Ionicons name="time-outline" size={12} color={SECONDARY} />
                <Text style={styles.metaText}>
                  {currentRide.driverToPickup.duration} mins
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.fareSection}>
            <Text style={styles.fareLabel}>Trip Fare</Text>
            <Text style={styles.fare}>
              £{currentRide.fareEstimate.toFixed(2)}
            </Text>
          </View>

          <View style={styles.tripDetails}>
            <View style={styles.tripItem}>
              <Ionicons name="location-outline" size={14} color="#888" />
              <Text style={styles.tripText}>
                {currentRide.route?.distanceKm || 0} km trip
              </Text>
            </View>
            <View style={styles.dotSeparator} />
            <View style={styles.tripItem}>
              <Ionicons name="time-outline" size={14} color="#888" />
              <Text style={styles.tripText}>
                {Math.ceil(currentRide.route?.durationMinutes || 0)} mins
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.acceptButton, isAccepting && styles.acceptButtonDisabled]}
            disabled={isAccepting}
            onPress={() => handleAcceptRide(currentRide)}
          >
            <Text style={styles.acceptText}>
              {isAccepting ? 'Accepting…' : `ACCEPT (${timer}s)`}
            </Text>
            {!isAccepting && <Ionicons name="checkmark" size={18} color="#fff" />}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.declineButton}
            onPress={handleDeclineRide}
          >
            <Text style={styles.declineText}>Decline</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* NO RIDES STATE */}
      {!currentRide && isOnline && (
        <View style={styles.noRidesCard}>
          <View style={styles.noRidesIcon}>
            <Ionicons name="search" size={32} color={PRIMARY} />
          </View>
          <Text style={styles.noRidesTitle}>Looking for rides</Text>
          <Text style={styles.noRidesSub}>We'll notify you when a trip is available nearby</Text>
        </View>
      )}
    </View>
  );
}

const mapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#f5f7fa' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#64748b' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#e2e8f0' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#dbeafe' }] },
];

const styles = StyleSheet.create({
  container: { flex: 1 },
  loader: {
    flex: 1,
    backgroundColor: SECONDARY,
    justifyContent: 'center',
    alignItems: 'center',
  },

  /* Car Marker */
  carMarker: {
    width: 44,
    height: 44,
    borderRadius: 22,
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

  /* Header */
  header: {
    position: 'absolute',
    top: 0,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    marginTop: 50,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  onlineDotWrap: {
    width: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  onlinePulse: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: PRIMARY,
    opacity: 0.4,
  },
  onlineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusText: {
    fontSize: 15,
    fontWeight: '800',
    color: DARK,
  },
  subText: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  goButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  goButtonText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.5,
  },

  /* Earnings Card - Professional */
  earningsCard: {
    position: 'absolute',
    top: 120,
    left: 16,
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 6,
  },
  earningsTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  earningsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  earningsIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: PRIMARY + '15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  amount: {
    fontSize: 28,
    fontWeight: '900',
    color: DARK,
    marginTop: 4,
  },
  walletMiniCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  walletMiniLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
  },
  walletMiniValue: {
    fontSize: 14,
    fontWeight: '800',
    color: SECONDARY,
    marginTop: 1,
  },
  earningsDivider: {
    height: 1,
    backgroundColor: '#F2F2F7',
    marginVertical: 14,
  },
  earningsBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  miniStat: {
    alignItems: 'center',
    flex: 1,
  },
  miniStatValue: {
    fontSize: 16,
    fontWeight: '800',
    color: DARK,
  },
  miniStatLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#888',
    marginTop: 3,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  miniStatDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#E5E5EA',
  },

  /* Ride Request Card */
  rideRequestCard: {
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
  cardHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ddd',
    marginBottom: 16,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: PRIMARY,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
    marginBottom: 16,
  },
  badgeText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.5,
  },

  /* Location Section */
  locationSection: {
    marginBottom: 16,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  dotPickup: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: PRIMARY,
  },
  pickup: {
    fontSize: 16,
    fontWeight: '700',
    color: DARK,
    flex: 1,
  },
  locationMeta: {
    flexDirection: 'row',
    gap: 10,
    paddingLeft: 20,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BG,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
  },

  /* Fare Section */
  fareSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: BG,
    padding: 14,
    borderRadius: 14,
    marginBottom: 12,
  },
  fareLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888',
  },
  fare: {
    fontSize: 24,
    fontWeight: '900',
    color: PRIMARY,
  },

  /* Trip Details */
  tripDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 16,
  },
  tripItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tripText: {
    fontSize: 12,
    color: '#888',
    fontWeight: '500',
  },
  dotSeparator: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ccc',
  },

  /* Buttons */
  acceptButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PRIMARY,
    paddingVertical: 16,
    borderRadius: 16,
    gap: 8,
    marginBottom: 10,
  },
  acceptButtonDisabled: {
    opacity: 0.6,
  },
  acceptText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 0.5,
  },
  declineButton: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  declineText: {
    color: '#888',
    fontWeight: '700',
    fontSize: 14,
  },

  /* No Rides */
  noRidesCard: {
    position: 'absolute',
    bottom: 40,
    left: 16,
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  noRidesIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(121,180,49,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  noRidesTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: DARK,
    marginBottom: 4,
  },
  noRidesSub: {
    fontSize: 13,
    color: '#888',
    textAlign: 'center',
  },
});