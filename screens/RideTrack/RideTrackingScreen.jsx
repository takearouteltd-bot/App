import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import MapViewDirections from 'react-native-maps-directions';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

const PRIMARY = '#79B431';
const SECONDARY = '#235594';
const DANGER = '#E53935';

export default function RideTrackingScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { origin, destination, fare, distance, duration } = route.params;

  const mapRef = useRef(null);
  const GOOGLE_MAPS_API_KEY = 'AIzaSyBtmcvJE-m_v44Z2lLDm8wDgI6GGYLXimQ';

  const [pickupAddress, setPickupAddress] = useState('');
  const [loadingAddress, setLoadingAddress] = useState(true);

  const driver = {
    name: 'James Wilson',
    rating: 4.8,
    car: 'Toyota Prius • White',
    plate: 'AB12 CDE',
    photo: 'https://i.pravatar.cc/100',
  };

  const [driverLocation, setDriverLocation] = useState({
    latitude: origin.latitude + 0.01,
    longitude: origin.longitude + 0.01,
  });

  const [status, setStatus] = useState('Driver is on the way');

  /* ---------------------------
     REVERSE GEOCODING FUNCTION
  ---------------------------- */
  const getAddressFromCoords = async (lat, lng) => {
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`
      );

      const data = await response.json();

      if (data.results && data.results.length > 0) {
        // Use first formatted address
        const fullAddress = data.results[0].formatted_address;

        // Optional: shorten address (cleaner UI)
        const shortAddress = fullAddress.split(',').slice(0, 3).join(',');

        setPickupAddress(shortAddress);
      } else {
        setPickupAddress('Pickup location');
      }
    } catch (error) {
      console.log('Geocoding error:', error);
      setPickupAddress('Pickup location');
    } finally {
      setLoadingAddress(false);
    }
  };

  /* Fetch pickup address */
  useEffect(() => {
    getAddressFromCoords(origin.latitude, origin.longitude);
  }, []);

  /* Simulate driver movement */
  useEffect(() => {
    const interval = setInterval(() => {
      setDriverLocation(prev => {
        const latDiff = origin.latitude - prev.latitude;
        const lngDiff = origin.longitude - prev.longitude;

        const newLat = prev.latitude + latDiff * 0.1;
        const newLng = prev.longitude + lngDiff * 0.1;

        if (Math.abs(latDiff) < 0.0005 && Math.abs(lngDiff) < 0.0005) {
          setStatus('Driver has arrived');
          clearInterval(interval);
        }

        return { latitude: newLat, longitude: newLng };
      });
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const recenterMap = () => {
    mapRef.current?.fitToCoordinates(
      [origin, destination, driverLocation],
      {
        edgePadding: { top: 120, right: 60, bottom: 420, left: 60 },
        animated: true,
      }
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <MapView ref={mapRef} style={styles.map} onMapReady={recenterMap}>
        <Marker coordinate={origin} pinColor={PRIMARY} />
        <Marker coordinate={destination} pinColor={SECONDARY} />
        <Marker coordinate={driverLocation} pinColor={PRIMARY} />

        <MapViewDirections
          origin={origin}
          destination={destination}
          apikey={GOOGLE_MAPS_API_KEY}
          strokeWidth={6}
          strokeColor={PRIMARY}
        />
      </MapView>

      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Ionicons name="arrow-back" size={22} color="#fff" />
      </TouchableOpacity>

      <TouchableOpacity style={styles.gpsButton} onPress={recenterMap}>
        <Ionicons name="locate" size={22} color="#fff" />
      </TouchableOpacity>

      <View style={styles.bottomSheet}>
        <View style={styles.sheetHandle} />

        <Text style={styles.status}>{status}</Text>

        {/* PICKUP LOCATION */}
        <View style={styles.locationCard}>
          <View style={styles.locationRow}>
            <View style={styles.pickupDot} />
            <View style={{ flex: 1 }}>
              <Text style={styles.locationLabel}>Pickup Point</Text>

              {loadingAddress ? (
                <ActivityIndicator size="small" color={PRIMARY} />
              ) : (
                <Text style={styles.locationText} numberOfLines={2}>
                  {pickupAddress}
                </Text>
              )}
            </View>
          </View>
        </View>

        {/* DRIVER CARD */}
        <View style={styles.driverCard}>
          <Image source={{ uri: driver.photo }} style={styles.driverImage} />

          <View style={{ flex: 1 }}>
            <Text style={styles.driverName}>{driver.name}</Text>
            <Text style={styles.driverSub}>{driver.car}</Text>
            <Text style={styles.plate}>{driver.plate}</Text>
          </View>

          <View style={styles.actionButtons}>
            <TouchableOpacity style={styles.iconBtn}>
              <Ionicons name="chatbubble-ellipses" size={18} color="#fff" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.iconBtn}>
              <Ionicons name="call" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity style={styles.primaryButton}>
          <Text style={styles.primaryText}>Track Ride Progress</Text>
        </TouchableOpacity>
        


      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  map: { flex: 1 },

  backButton: {
    position: 'absolute',
    top: 50,
    left: 20,
    backgroundColor: SECONDARY,
    padding: 10,
    borderRadius: 30,
    elevation: 5,
  },

  gpsButton: {
    position: 'absolute',
    bottom: 300,
    right: 20,
    backgroundColor: SECONDARY,
    padding: 12,
    borderRadius: 30,
    elevation: 5,
  },

  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 22,
    elevation: 25,
  },

  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ddd',
    alignSelf: 'center',
    marginBottom: 15,
  },

  status: {
    fontSize: 20,
    fontWeight: '700',
    color: SECONDARY,
    textAlign: 'center',
    marginBottom: 15,
  },

  locationCard: {
    backgroundColor: '#F7F9FC',
    padding: 14,
    borderRadius: 16,
    marginBottom: 15,
  },

  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  pickupDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: PRIMARY,
    marginRight: 10,
  },

  locationLabel: {
    fontSize: 12,
    color: '#888',
  },

  locationText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },

  driverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F9FC',
    padding: 15,
    borderRadius: 16,
    marginBottom: 18,
  },

  driverImage: {
    width: 55,
    height: 55,
    borderRadius: 30,
    marginRight: 12,
  },

  driverName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
  },

  driverSub: {
    fontSize: 13,
    color: '#666',
  },

  plate: {
    fontSize: 13,
    fontWeight: '700',
    color: PRIMARY,
  },

  actionButtons: {
    flexDirection: 'row',
    gap: 10,
  },

  iconBtn: {
    backgroundColor: SECONDARY,
    padding: 10,
    borderRadius: 25,
  },

  primaryButton: {
    backgroundColor: PRIMARY,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    marginBottom: 10,
  },

  primaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },

  sosButton: {
    backgroundColor: DANGER,
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
  },

  sosText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
});
