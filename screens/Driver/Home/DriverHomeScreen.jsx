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
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

const { width } = Dimensions.get('window');

export default function DriverHomeScreen() {
  const mapRef = useRef(null);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(width)).current;

  const navigation = useNavigation();

  const [location, setLocation] = useState(null);
  const [isOnline, setIsOnline] = useState(true);
  const [loading, setLoading] = useState(true);

  const [rideRequests, setRideRequests] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timer, setTimer] = useState(15);

  const earningsToday = 128.5;
  const walletBalance = 342.75;

  /* ================= LOCATION ================= */

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const loc = await Location.getCurrentPositionAsync({});
      setLocation(loc.coords);
      setLoading(false);

      Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 5 },
        (newLoc) => setLocation(newLoc.coords)
      );
    })();
  }, []);

  useEffect(() => {
    if (location && mapRef.current) {
      mapRef.current.animateCamera({ center: location, zoom: 17, pitch: 45 });
    }
  }, [location]);

  const handleMarkerPress = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 1.25, duration: 120, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 120, useNativeDriver: true }),
    ]).start();
  };

  /* ================= RIDE SIMULATION ================= */

  useEffect(() => {
    if (!isOnline || !location) {
      setRideRequests([]);
      return;
    }

    const sampleRide = {
      riderName: 'Ahmed',
      rating: 4.8,
      pickup: {
        latitude: 34.001963,
        longitude: 71.498867,
        address: 'Chief Grill',
      },
      dropoff: {
        latitude: 34.0076,
        longitude: 71.5241,
        address: 'KFC Peshawar',
      },
    };

    const createRide = () => {
      const driverToPickupDistance = 2.3;
      const driverToPickupDuration = 5;

      const tripDistance = 5.2;
      const tripDuration = 14;

      const totalDistance = driverToPickupDistance + tripDistance;
      const totalDuration = driverToPickupDuration + tripDuration;

      return {
        id: Date.now().toString(),
        ...sampleRide,

        driverToPickup: {
          distance: driverToPickupDistance.toFixed(1),
          duration: driverToPickupDuration,
        },

        trip: {
          distance: tripDistance.toFixed(1),
          duration: tripDuration,
        },

        total: {
          distance: totalDistance.toFixed(1),
          duration: totalDuration,
        },

        fare: 8.4,
      };
    };

    const addRideInterval = setInterval(() => {
      setRideRequests(prev => {
        if (prev.length < 3) {
          return [...prev, createRide()];
        }
        return prev;
      });
      animateCard();
    }, 6000);

    return () => clearInterval(addRideInterval);
  }, [isOnline, location]);

  /* ================= ANIMATION ================= */

  const animateCard = () => {
    slideAnim.setValue(width);
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 400,
      useNativeDriver: true,
    }).start();
  };

  /* ================= TIMER ================= */

  useEffect(() => {
    if (!rideRequests.length) return;

    setTimer(15);

    const interval = setInterval(() => {
      setTimer(prev => (prev > 1 ? prev - 1 : 1));
    }, 1000);

    return () => clearInterval(interval);
  }, [currentIndex, rideRequests]);

  /* ================= NAVIGATION ================= */

  const handleAcceptRide = (ride) => {
    setRideRequests([]);
    setCurrentIndex(0);
  
    navigation.navigate('DriverRideInProgress', {
      origin: ride.pickup,
      destination: ride.dropoff,
      fare: ride.fare,
      distance: ride.trip.distance,        // distance of the trip
      duration: ride.driverToPickup.duration, // ETA to pickup
    });
  };
  

  const handleDeclineRide = () => {
    if (currentIndex < rideRequests.length - 1) {
      setCurrentIndex(currentIndex + 1);
      animateCard();
    } else {
      setRideRequests([]);
    }
  };

  if (loading || !location) {
    return (
      <SafeAreaView style={styles.loader}>
        <ActivityIndicator size="large" color="#7FD957" />
        <Text style={{ color: '#fff', marginTop: 10 }}>Getting location…</Text>
      </SafeAreaView>
    );
  }

  const currentRide = rideRequests[currentIndex];

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
        <View>
          <Text style={styles.statusText}>
            {isOnline ? 'You are online' : 'You are offline'}
          </Text>
          <Text style={styles.subText}>
            {isOnline ? 'Finding trips near you' : 'Go online to find trips'}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.goButton, { backgroundColor: '#79B531' }]}
          onPress={() => setIsOnline(!isOnline)}
        >
          <Text style={styles.goButtonText}>
            {isOnline ? 'GO OFFLINE' : 'GO ONLINE'}
          </Text>
        </TouchableOpacity>
      </SafeAreaView>

      {/* EARNINGS */}
      <View style={styles.earningsCard}>
        <Text style={styles.cardTitle}>Earnings today</Text>
        <Text style={styles.amount}>£{earningsToday.toFixed(2)}</Text>
        <View style={styles.cardDivider} />
        <Text style={styles.walletText}>
          Wallet balance: £{walletBalance.toFixed(2)}
        </Text>
      </View>

      {/* RIDE CARD */}
      {currentRide && (
        <Animated.View
          style={[
            styles.rideRequestCard,
            { transform: [{ translateX: slideAnim }] },
          ]}
        >
          <View style={styles.badge}>
            <MaterialCommunityIcons name="flash" size={16} color="#fff" />
            <Text style={styles.badgeText}> NEW REQUEST</Text>
          </View>

          <Text style={styles.pickup}>
            📍 {currentRide.pickup.address}
          </Text>

          <Text style={styles.pickupMeta}>
            {currentRide.driverToPickup.distance} km •{' '}
            {currentRide.driverToPickup.duration} mins away
          </Text>

          <Text style={styles.fare}>
            £{currentRide.fare.toFixed(2)}
          </Text>

          <View style={styles.totalContainer}>
            <View style={styles.totalItem}>
              <Ionicons name="location-outline" size={16} color="#fff" />
              <Text style={styles.totalText}>
                {currentRide.trip.distance} km
              </Text>
            </View>

            <View style={styles.totalItem}>
              <Ionicons name="time-outline" size={16} color="#fff" />
              <Text style={styles.totalText}>
                {currentRide.trip.duration} mins
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.acceptButton}
            onPress={() => handleAcceptRide(currentRide)}
          >
            <Text style={styles.acceptText}>
              ACCEPT RIDE ({timer}s)
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.declineButton}
            onPress={handleDeclineRide}
          >
            <Text style={styles.declineText}>
              DECLINE REQUEST
            </Text>
          </TouchableOpacity>
        </Animated.View>
      )}
    </View>
  );
}


const mapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#1d2c4d' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#304a7d' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
];

const styles = StyleSheet.create({
  container: { flex: 1 },
  loader: { flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center' },

  carMarker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1e293b',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#7FD957',
  },

  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 120,
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    elevation: 6,
    marginBottom: 20,
  },
  statusText: { fontSize: 14, fontWeight: 'bold', color: '#0f172a' },
  subText: { fontSize: 20, color: '#64748b', marginTop: 2 },
  goButton: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
  goButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },

  earningsCard: {
    position: 'absolute',
    top: 140,
    left: 20,
    right: 20,
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    elevation: 6,
  },
  cardTitle: { color: '#235594', fontSize: 14, fontWeight: '600' },
  amount: { fontSize: 30, fontWeight: 'bold', color: '#235594', marginVertical: 6 },
  cardDivider: { height: 1, backgroundColor: '#e5e7eb', marginVertical: 10 },
  walletText: { color: '#0f172a', fontSize: 14, fontWeight: '500' },

  rideRequestCard: {
    position: 'absolute',
    top: '30%',
    left: 20,
    right: 20,
    height: 380,
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 20,
    elevation: 8,
    alignItems: 'center',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#79B531',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginBottom: 14,
  },
  badgeText: { color: '#fff', fontWeight: 'bold', marginLeft: 6, fontSize: 14 },
  pickup: { color: '#000', fontSize: 18, fontWeight: 'bold', marginBottom: 4, textAlign: 'center' },
  pickupMeta: { color: '#64748b', fontSize: 14, marginBottom: 12, textAlign: 'center' },
  fare: { color: '#235594', fontSize: 32, fontWeight: 'bold', marginBottom: 6, textAlign: 'center' },
  totalContainer: {
    flexDirection: 'row',
    backgroundColor: '#79B531',
    borderRadius: 30,
    paddingVertical: 8,
    paddingHorizontal: 20,
    marginBottom: 20,
    justifyContent: 'space-between',
    width: '80%',
    alignItems: 'center',
  },
  totalItem: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 8 },
  totalText: { color: '#fff', fontWeight: 'bold', marginLeft: 6, fontSize: 16 },
  acceptButton: { backgroundColor: '#79B531', paddingVertical: 14, borderRadius: 14, marginBottom: 10, width: '100%', alignItems: 'center' },
  acceptText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  declineButton: { paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: '#000', width: '100%', alignItems: 'center' },
  declineText: { color: '#000', fontWeight: 'bold', fontSize: 16 },
});
