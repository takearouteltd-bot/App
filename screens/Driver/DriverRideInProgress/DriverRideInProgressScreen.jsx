import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, useNavigation } from '@react-navigation/native';
import polyline from '@mapbox/polyline';

export default function DriverRideInProgressScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { origin, destination, fare, distance, duration, rider } = route.params || {};

  const mapRef = useRef(null);
  const [driverLocation, setDriverLocation] = useState(null);
  const [routeCoords, setRouteCoords] = useState([]);
  const [loadingRoute, setLoadingRoute] = useState(true);
  const [arrived, setArrived] = useState(false);
  const [eta, setEta] = useState('');
  const [pickupDistance, setPickupDistance] = useState('');
  const [zoomLevel, setZoomLevel] = useState(16);

  const GOOGLE_MAPS_API_KEY = 'AIzaSyBtmcvJE-m_v44Z2lLDm8wDgI6GGYLXimQ';
  const ARRIVAL_DISTANCE = 40; // meters

  // Get driver location once
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const loc = await Location.getCurrentPositionAsync({});
      const start = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };

      setDriverLocation(start);
      fetchRoute(start);
    })();
  }, []);

  // Fetch route from driver to pickup
  const fetchRoute = async (startLocation) => {
    try {
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${startLocation.latitude},${startLocation.longitude}&destination=${origin.latitude},${origin.longitude}&key=${GOOGLE_MAPS_API_KEY}`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.routes.length) {
        const points = polyline.decode(data.routes[0].overview_polyline.points);
        const coords = points.map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
        setRouteCoords(coords);

        const leg = data.routes[0].legs[0];
        setEta(leg.duration.text);
        setPickupDistance(leg.distance.text);

        mapRef.current?.fitToCoordinates([startLocation, ...coords, origin], {
          edgePadding: { top: 150, right: 60, bottom: 300, left: 60 },
          animated: true,
        });
      }
    } catch (e) {
      console.log(e);
    } finally {
      setLoadingRoute(false);
    }
  };

  // Simulate driving along route
  useEffect(() => {
    if (!routeCoords.length) return;

    let i = 0;
    const interval = setInterval(() => {
      if (i < routeCoords.length - 1) {
        i++;
        const nextPoint = routeCoords[i];
        setDriverLocation(nextPoint);

        mapRef.current?.animateCamera({
          center: nextPoint,
          zoom: zoomLevel,
        });

        const distanceToPickup = getDistance(
          nextPoint.latitude,
          nextPoint.longitude,
          origin.latitude,
          origin.longitude
        );

        if (distanceToPickup < ARRIVAL_DISTANCE) {
          setArrived(true);
          clearInterval(interval);
        }
      }
    }, 700);

    return () => clearInterval(interval);
  }, [routeCoords, zoomLevel]);

  const getDistance = (lat1, lon1, lat2, lon2) => {
    const toRad = (x) => (x * Math.PI) / 180;
    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

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
  

  if (loadingRoute || !driverLocation) {
    return (
      <SafeAreaView style={styles.loader}>
        <ActivityIndicator size="large" color="#79B531" />
        <Text style={{ color: '#000', marginTop: 10 }}>Driver heading to pickup...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        customMapStyle={mapStyle}
        initialRegion={{
          latitude: driverLocation.latitude,
          longitude: driverLocation.longitude,
          latitudeDelta: 0.01,  // more zoomed in
          longitudeDelta: 0.01, // more zoomed in
        }}
      >
        <Marker coordinate={driverLocation}>
          <View style={styles.driverMarker}>
            <Ionicons name="car-sport" size={18} color="#fff" />
          </View>
        </Marker>

        <Marker coordinate={origin} pinColor="#79B531" />

        {routeCoords.length > 0 && (
          <Polyline coordinates={routeCoords} strokeColor="#79B531" strokeWidth={5} />
        )}
      </MapView>

      {/* GPS & Zoom Buttons */}
      <View style={styles.controls}>
  {/* Zoom In */}
  <TouchableOpacity style={[styles.controlBtn, styles.zoomInBtn]} onPress={handleZoomIn}>
    <Ionicons name="add-outline" size={24} color="#000" />
  </TouchableOpacity>

  {/* Zoom Out */}
  <TouchableOpacity style={[styles.controlBtn, styles.zoomOutBtn]} onPress={handleZoomOut}>
    <Ionicons name="remove-outline" size={24} color="#000" />
  </TouchableOpacity>

  {/* GPS */}
  <TouchableOpacity style={[styles.controlBtn, styles.gpsBtn]} onPress={handleGps}>
    <Ionicons name="locate-outline" size={24} color="#79B531" />
  </TouchableOpacity>
</View>

      {/* Bottom Card */}
      <View style={styles.bottomCard}>
        <View style={styles.infoRow}>
          <Text style={styles.etaText}>{eta}</Text>
          <Text style={styles.distanceText}>{pickupDistance}</Text>
        </View>

        <View style={styles.riderRow}>
          <View style={styles.riderInfo}>
            
            <View>
              <Text style={styles.riderName}>Hassan</Text>
              <Text style={styles.riderRating}>⭐ 4.5</Text>
            </View>
          </View>

          <View style={styles.contactIcons}>
            <TouchableOpacity style={styles.iconBtn}>
              <Ionicons name="chatbubble-ellipses-outline" size={22} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn}>
              <Ionicons name="call-outline" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.arrivalBtn, { backgroundColor: arrived ? '#79B531' : '#9ca3af' }]}
          disabled={!arrived}
          onPress={() =>
            navigation.navigate('RideToDropoff', { origin, destination, fare, distance, duration })
          }
        >
          <Text style={styles.arrivalText}>Arrive at Pickup</Text>
        </TouchableOpacity>
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
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },

  driverMarker: {
    backgroundColor: '#1e293b',
    padding: 8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#79B531',
  },

  controls: {
    position: 'absolute',
    right: 20,
    bottom: 240,
    alignItems: 'center',

    justifyContent: 'center',
  },
  
  controlBtn: {
    width: 50,
    height: 50,
    backgroundColor: 'rgba(255,255,255,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  
  zoomInBtn: {
    borderTopLeftRadius: 25,
    borderTopRightRadius: 25,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  
  zoomOutBtn: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 25,
    borderBottomRightRadius: 25,
  },
  
  gpsBtn: {
    borderRadius: 25,
    marginTop: 8,
  },
  

  bottomCard: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  infoRow: { marginBottom: 16 },
  etaText: { color: '#79B531', fontSize: 32, fontWeight: 'bold' },
  distanceText: { color: '#6b7280', fontSize: 16 },

  riderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  riderInfo: { flexDirection: 'row', alignItems: 'center' },
  riderPhoto: { width: 50, height: 50, borderRadius: 25, marginRight: 10 },
  riderName: { color: '#000', fontSize: 16, fontWeight: 'bold' },
  riderRating: { color: '#6b7280', fontSize: 14 },

  contactIcons: { flexDirection: 'row' },
  iconBtn: {
    backgroundColor: '#235594',
    padding: 10,
    borderRadius: 12,
    marginLeft: 10,
  },

  arrivalBtn: { paddingVertical: 14, borderRadius: 15, alignItems: 'center' },
  arrivalText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
