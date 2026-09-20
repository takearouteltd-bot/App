import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useRoute, useNavigation } from '@react-navigation/native';
import polyline from '@mapbox/polyline'; // decode Google polyline
import { currencySymbol } from '../../../utils/appConfig';

export default function IncomingRideScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { ride } = route.params;

  const mapRef = useRef(null);
  const [timeLeft, setTimeLeft] = useState(15);
  const [routeCoords, setRouteCoords] = useState([]);
  const [loadingRoute, setLoadingRoute] = useState(true);

  const GOOGLE_MAPS_API_KEY = 'AIzaSyBtmcvJE-m_v44Z2lLDm8wDgI6GGYLXimQ'; // replace with your key

  // Countdown timer
  useEffect(() => {
    if (timeLeft <= 0) return;
    const interval = setInterval(() => setTimeLeft(prev => prev - 1), 1000);
    return () => clearInterval(interval);
  }, [timeLeft]);

  useEffect(() => {
    if (timeLeft === 0) navigation.goBack();
  }, [timeLeft]);

  // Fetch route from Google Directions API
  useEffect(() => {
    const fetchRoute = async () => {
      try {
        const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${ride.pickup.latitude},${ride.pickup.longitude}&destination=${ride.dropoff.latitude},${ride.dropoff.longitude}&key=${GOOGLE_MAPS_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.routes.length) {
          const points = polyline.decode(data.routes[0].overview_polyline.points);
          const coords = points.map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
          setRouteCoords(coords);

          // Fit map to route
          setTimeout(() => {
            if (mapRef.current) {
              mapRef.current.fitToCoordinates(coords, {
                edgePadding: { top: 100, right: 50, bottom: 250, left: 50 },
                animated: true,
              });
            }
          }, 500);
        }
      } catch (error) {
        console.log('Error fetching route:', error);
      } finally {
        setLoadingRoute(false);
      }
    };

    fetchRoute();
  }, [ride]);

  if (loadingRoute) {
    return (
      <SafeAreaView style={styles.loader}>
        <ActivityIndicator size="large" color="#7FD957" />
        <Text style={{ color: '#fff', marginTop: 10 }}>Calculating route...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* MAP */}
      <MapView
        ref={mapRef}
        style={styles.map}
        customMapStyle={mapStyle}
        showsCompass={false}
        initialRegion={{
          latitude: ride.pickup.latitude,
          longitude: ride.pickup.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
      >
        {/* Pickup */}
        <Marker coordinate={ride.pickup} pinColor="#7FD957" />
        {/* Dropoff */}
        <Marker coordinate={ride.dropoff} pinColor="#FF4D6D" />
        {/* Route line */}
        {routeCoords.length > 0 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor="#7FD957"
            strokeWidth={5}
          />
        )}
      </MapView>

      {/* TIMER */}
      <View style={styles.timerContainer}>
        <Text style={styles.timerText}>Accept in {timeLeft}s</Text>
      </View>

      {/* INFO CARD */}
      <View style={styles.card}>
        <View style={styles.riderRow}>
          <Image source={{ uri: 'https://i.pravatar.cc/100' }} style={styles.riderImage} />
          <View style={{ marginLeft: 12 }}>
            <Text style={styles.riderName}>{ride.riderName}</Text>
            <View style={styles.ratingRow}>
              <MaterialIcons name="star" size={16} color="#FFD700" />
              <Text style={styles.ratingText}>{ride.rating}</Text>
            </View>
          </View>
        </View>

        <View style={styles.addressContainer}>
          <View style={styles.addressRow}>
            <Ionicons name="location-sharp" size={20} color="#7FD957" />
            <Text style={styles.addressText}>{ride.pickup.address}</Text>
          </View>
          <View style={styles.addressRow}>
            <Ionicons name="flag" size={20} color="#FF4D6D" />
            <Text style={styles.addressText}>{ride.dropoff.address}</Text>
          </View>
        </View>

        <View style={styles.fareRow}>
          <Text style={styles.fareText}>{currencySymbol()}{ride.fare}</Text>
          <Text style={styles.distanceText}>{ride.distance} km</Text>
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: '#FF4D6D' }]}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.actionText}>Decline</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: '#7FD957' }]}
            onPress={() =>
              navigation.navigate('DriverRideInProgress', {
                origin: ride.pickup,
                destination: ride.dropoff,
                fare: ride.fare,
                distance: ride.distance,
                duration: ride.etaToPickup,
              })
            }
          >
            <Text style={styles.actionText}>Accept</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const mapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#1d2c4d' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#304a7d' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
];

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  map: { flex: 1 },

  loader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a' },

  timerContainer: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    backgroundColor: 'rgba(30,58,95,0.9)',
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 20,
  },
  timerText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },

  card: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    backgroundColor: '#1e293b',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
  },

  riderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  riderImage: { width: 55, height: 55, borderRadius: 28 },
  riderName: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  ratingText: { color: '#FFD700', marginLeft: 4 },

  addressContainer: { marginBottom: 16 },
  addressRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 4 },
  addressText: { color: '#fff', fontSize: 14, marginLeft: 8 },

  fareRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  fareText: { color: '#7FD957', fontSize: 18, fontWeight: 'bold' },
  distanceText: { color: '#fff', fontSize: 16 },

  actionRow: { flexDirection: 'row', justifyContent: 'space-between' },
  actionBtn: { flex: 0.48, paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  actionText: { color: '#000', fontWeight: 'bold', fontSize: 16 },
});
