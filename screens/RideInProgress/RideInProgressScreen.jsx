import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Image,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import MapViewDirections from 'react-native-maps-directions';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';

export default function RideInProgressScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { origin, destination, fare = 0, distance = 0, duration = 0 } = route.params || {};

  const mapRef = useRef(null);
  const intervalRef = useRef(null);
  const GOOGLE_MAPS_API_KEY = 'AIzaSyBtmcvJE-m_v44Z2lLDm8wDgI6GGYLXimQ';

  const driver = {
    name: 'James Wilson',
    rating: 4.8,
    car: 'Toyota Prius • White',
    plate: 'AB12 CDE',
    photo: 'https://i.pravatar.cc/100',
  };

  const [driverLocation, setDriverLocation] = useState({
    latitude: origin.latitude,
    longitude: origin.longitude,
  });
  const [status, setStatus] = useState('Ride in progress');
  const [eta, setEta] = useState(duration);              // real trip duration in minutes
  const [remainingDistance, setRemainingDistance] = useState(distance); // real trip distance in km

  // Helper: Calculate distance between two coordinates (km)
  const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Radius of the earth in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  /** 🚗 Simulate driver movement */
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setDriverLocation(prev => {
        const latDiff = destination.latitude - prev.latitude;
        const lngDiff = destination.longitude - prev.longitude;

        const newLat = prev.latitude + latDiff * 0.05;
        const newLng = prev.longitude + lngDiff * 0.05;

        // Calculate remaining distance
        const dist = getDistanceFromLatLonInKm(newLat, newLng, destination.latitude, destination.longitude);
        setRemainingDistance(dist);

        // Calculate ETA based on speed (distance/duration)
        const speed = distance / (duration || 1); // km per minute
        setEta(dist / speed);

        // Check if arrived (within 50 meters)
        if (dist < 0.05) {
          setStatus('Arrived at destination');
          setRemainingDistance(0);
          setEta(0);
          clearInterval(intervalRef.current);
        }

        return { latitude: newLat, longitude: newLng };
      });
    }, 2000);

    return () => clearInterval(intervalRef.current);
  }, [destination]);

  /** 📍 Auto-follow driver */
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.animateCamera({
        center: driverLocation,
        pitch: 45,
        heading: 0,
        altitude: 1000,
        zoom: 15,
      });
    }
  }, [driverLocation]);

  const recenterMap = () => {
    mapRef.current?.fitToCoordinates([origin, destination, driverLocation], {
      edgePadding: { top: 120, right: 60, bottom: 350, left: 60 },
      animated: true,
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <MapView ref={mapRef} style={styles.map}>
        <Marker coordinate={origin} title="Pickup" pinColor="#1e3a5f" />
        <Marker coordinate={destination} title="Drop-off" pinColor="#1e3a5f" />
        <Marker coordinate={driverLocation} title="Driver" pinColor="#7FD957" />

        <MapViewDirections
          origin={origin}
          destination={destination}
          apikey={GOOGLE_MAPS_API_KEY}
          strokeWidth={6}
          strokeColor="#7FD957"
        />
      </MapView>

      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Ionicons name="arrow-back" size={24} color="#fff" />
      </TouchableOpacity>

      <TouchableOpacity style={styles.gpsButton} onPress={recenterMap}>
        <Ionicons name="locate" size={24} color="#fff" />
      </TouchableOpacity>

      {/* INFO CARD */}
      <View style={styles.infoCard}>
        <Text style={styles.statusText}>{status}</Text>

        <View style={styles.tripInfoRow}>
          <Text style={styles.tripText}>ETA: {Math.ceil(eta)} min</Text>
          <Text style={styles.tripText}>Distance: {remainingDistance.toFixed(1)} km</Text>
          <Text style={styles.tripText}>Fare: £{Number(fare).toFixed(2)}</Text>
        </View>

        <View style={styles.driverRow}>
          <Image source={{ uri: driver.photo }} style={styles.driverImage} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.driverName}>{driver.name}</Text>
            <Text style={styles.driverRating}>⭐ {driver.rating}</Text>
            <Text style={styles.carText}>{driver.car}</Text>
            <Text style={styles.plateText}>{driver.plate}</Text>
          </View>

          <TouchableOpacity style={styles.callBtn}>
            <Ionicons name="call" size={18} color="#000" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.msgBtn}>
            <MaterialIcons name="message" size={18} color="#000" />
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}


const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a1a' },
  map: { flex: 1 },

  infoCard: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    backgroundColor: '#1e3a5f',
    padding: 20,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },

  statusText: {
    color: '#7FD957',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 15,
  },

  tripInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 15,
  },
  tripText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },

  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },

  driverImage: {
    width: 55,
    height: 55,
    borderRadius: 30,
  },
  driverName: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  driverRating: { color: '#FFD700', fontSize: 14 },
  carText: { color: '#ccc', fontSize: 13 },
  plateText: { color: '#7FD957', fontSize: 13, fontWeight: 'bold' },

  callBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#7FD957',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    marginLeft: 10,
  },

  msgBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFD700',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    marginLeft: 8,
  },

  backButton: {
    position: 'absolute',
    top: 75,
    left: 15,
    backgroundColor: 'rgba(30,58,95,0.8)',
    padding: 10,
    borderRadius: 30,
    elevation: 5,
  },

  gpsButton: {
    position: 'absolute',
    bottom: 240,
    right: 15,
    backgroundColor: 'rgba(30,58,95,0.8)',
    padding: 12,
    borderRadius: 30,
    elevation: 5,
  },
});
