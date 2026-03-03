import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Dimensions,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

const PRIMARY = '#79B431';
const SECONDARY = '#235594';

export default function HomeScreen() {
  const [location, setLocation] = useState(null);
  const [region, setRegion] = useState(null);
  const [address, setAddress] = useState('');
  const navigation = useNavigation();
  const mapRef = useRef(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
      });

      const coords = loc.coords;

      const initialRegion = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };

      setLocation(coords);
      setRegion(initialRegion);

      await getFullAddress(coords.latitude, coords.longitude);
    })();
  }, []);

const GOOGLE_API_KEY = 'AIzaSyBtmcvJE-m_v44Z2lLDm8wDgI6GGYLXimQ';

const getFullAddress = async (lat, lng) => {
  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_API_KEY}`
    );

    const data = await response.json();

    if (data.results.length > 0) {
      const fullAddress = data.results[0].formatted_address;
      setAddress(fullAddress);
    }
  } catch (error) {
    console.log(error);
  }
};


  const recenterMap = () => {
    if (location && mapRef.current) {
      mapRef.current.animateToRegion(
        {
          ...region,
          latitude: location.latitude,
          longitude: location.longitude,
        },
        500
      );
    }
  };

  const zoomMap = delta => {
    if (region && mapRef.current) {
      const newRegion = {
        ...region,
        latitudeDelta: Math.max(0.001, region.latitudeDelta * delta),
        longitudeDelta: Math.max(0.001, region.longitudeDelta * delta),
      };
      setRegion(newRegion);
      mapRef.current.animateToRegion(newRegion, 300);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {region && (
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={region}
          showsUserLocation={false}
          showsMyLocationButton={false}
        >
          {location && (
            <Marker coordinate={location} anchor={{ x: 0.5, y: 1 }}>
              <View style={styles.markerContainer}>
                <View style={styles.markerShadow} />

                <View style={styles.markerOuterPulse} />

                <View style={styles.markerPin}>
                  <View style={styles.markerInnerCircle} />
                </View>

                <View style={styles.markerTriangle} />
              </View>
            </Marker>
          )}
        </MapView>
      )}

      {/* SEARCH BAR */}
      <TouchableOpacity
        style={styles.floatingSearch}
        onPress={() =>
          navigation.navigate('DestinationSearch', { origin: location })
        }
      >
        <Ionicons name="search" size={18} color="#777" />
        <Text style={styles.searchPlaceholder}>Where to?</Text>
        <Ionicons name="arrow-forward" size={20} color={SECONDARY} />
      </TouchableOpacity>

      {/* CONTROLS */}
      <View style={styles.controlsContainer}>
        <TouchableOpacity style={styles.gpsButton} onPress={recenterMap}>
          <Ionicons name="locate" size={22} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.zoomButton}
          onPress={() => zoomMap(0.5)}
        >
          <Text style={styles.zoomText}>+</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.zoomButton}
          onPress={() => zoomMap(2)}
        >
          <Text style={styles.zoomText}>-</Text>
        </TouchableOpacity>
      </View>

      {/* BOTTOM CARD */}
      <View style={styles.bottomCard}>
        <View style={styles.tag}>
          <Text style={styles.tagText}>
            SAVE UP TO 25% VS TRADITIONAL RIDE APPS
          </Text>
        </View>

        <View style={styles.pickupContainer}>
          <Ionicons name="location" size={18} color={PRIMARY} />
          <View style={{ marginLeft: 10 }}>
            <Text style={styles.pickupLabel}>Pickup Location</Text>
            <Text style={styles.pickupText}>
              {address || 'Fetching precise location...'}
            </Text>
          </View>
        </View>

        <View style={styles.savedRow}>
          <TouchableOpacity style={styles.savedBox}>
            <Ionicons name="home" size={18} color={SECONDARY} />
            <Text style={styles.savedText}>Home</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.savedBox}>
            <Ionicons name="briefcase" size={18} color={SECONDARY} />
            <Text style={styles.savedText}>Work</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  map: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },

  /* ===== CUSTOM MARKER ===== */

  markerContainer: {
    alignItems: 'center',
  },

  markerShadow: {
    position: 'absolute',
    bottom: -4,
    width: 20,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },

  markerOuterPulse: {
    position: 'absolute',
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: PRIMARY,
    opacity: 0.15,
    top: -25,
  },

  markerPin: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: PRIMARY,
    justifyContent: 'center',
    alignItems: 'center',
  },

  markerInnerCircle: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#fff',
  },

  markerTriangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 12,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: PRIMARY,
    marginTop: -2,
  },

  /* SEARCH */
  floatingSearch: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    width: width * 0.9,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 14,
    borderRadius: 14,
    elevation: 6,
  },
  searchPlaceholder: {
    marginLeft: 10,
    flex: 1,
    color: '#777',
    fontSize: 16,
  },

  /* CONTROLS */
  controlsContainer: {
    position: 'absolute',
    right: 15,
    bottom: 260,
    alignItems: 'center',
  },
  gpsButton: {
    backgroundColor: PRIMARY,
    padding: 12,
    borderRadius: 30,
    marginBottom: 12,
    elevation: 5,
  },
  zoomButton: {
    backgroundColor: PRIMARY,
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  zoomText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },

  /* BOTTOM CARD */
  bottomCard: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
  },
  tag: {
    backgroundColor: PRIMARY,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    alignSelf: 'flex-start',
    marginBottom: 15,
  },
  tagText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  pickupContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  pickupLabel: {
    fontSize: 12,
    color: '#999',
  },
  pickupText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#222',
    maxWidth: width * 0.8,
  },
  savedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  savedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f4f6f8',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 14,
    width: '48%',
    justifyContent: 'center',
  },
  savedText: {
    marginLeft: 8,
    fontWeight: '600',
    color: SECONDARY,
  },
});
