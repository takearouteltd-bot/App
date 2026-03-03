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

const { width } = Dimensions.get('window');
const PRIMARY = '#79B431';
const SECONDARY = '#235594';

export default function RideRequestScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { origin, destination, fare, distance, duration, rideType } = route.params;

  const mapRef = useRef(null);
  const [loading, setLoading] = useState(true);

  const [pickupAddress, setPickupAddress] = useState('');
  const [dropoffAddress, setDropoffAddress] = useState('');

  const progress = useRef(new Animated.Value(0)).current;

  const GOOGLE_MAPS_API_KEY = 'AIzaSyBtmcvJE-m_v44Z2lLDm8wDgI6GGYLXimQ';

  /* ------------------------------
     REVERSE GEOCODING FUNCTION
  -------------------------------*/
  const getAddressFromCoords = async (lat, lng, setAddress) => {
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`
      );
      const data = await response.json();

      if (data.results && data.results.length > 0) {
        setAddress(data.results[0].formatted_address);
      }
    } catch (error) {
      console.log('Geocoding error:', error);
    }
  };

  useEffect(() => {
    // Fetch exact addresses
    getAddressFromCoords(origin.latitude, origin.longitude, setPickupAddress);
    getAddressFromCoords(destination.latitude, destination.longitude, setDropoffAddress);

    // Animate loading
    Animated.timing(progress, {
      toValue: width * 0.9,
      duration: 5000,
      useNativeDriver: false,
    }).start();

    const timer = setTimeout(() => setLoading(false), 5000);
    return () => clearTimeout(timer);
  }, []);

  const recenterMap = () => {
    if (mapRef.current) {
      mapRef.current.fitToCoordinates([origin, destination], {
        edgePadding: { top: 120, right: 60, bottom: 400, left: 60 },
        animated: true,
      });
    }
  };

  const handleCancelRequest = () => {
    Alert.alert(
      'Cancel Ride',
      'Are you sure you want to cancel this ride request?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes',
          style: 'destructive',
          onPress: () => navigation.goBack(),
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* MAP */}
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: origin.latitude,
          longitude: origin.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
        onMapReady={recenterMap}
      >
        <Marker coordinate={origin} pinColor={PRIMARY} />
        <Marker coordinate={destination} pinColor={SECONDARY} />

        <MapViewDirections
          origin={origin}
          destination={destination}
          apikey={GOOGLE_MAPS_API_KEY}
          strokeWidth={6}
          strokeColor={PRIMARY}
        />
      </MapView>

      {/* BACK BUTTON */}
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Ionicons name="arrow-back" size={22} color="#fff" />
      </TouchableOpacity>

      {/* BOTTOM SHEET */}
      <View style={styles.bottomSheet}>
        <View style={styles.sheetHandle} />

        {loading ? (
          <>
            <ActivityIndicator size="large" color={PRIMARY} />
            <Text style={styles.loadingText}>Finding your Driver</Text>
            <Text style={styles.etaText}>Wait time 2–5 min</Text>

            <View style={styles.progressBarBackground}>
              <Animated.View style={[styles.progressBarFill, { width: progress }]} />
            </View>

            <TouchableOpacity style={styles.cancelButton} onPress={handleCancelRequest}>
              <Text style={styles.cancelText}>Cancel Request</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.sheetTitle}>Driver Assigned!</Text>

            {/* Ride Type */}
            <View style={styles.rideTypeRow}>
              <FontAwesome5 name="car-side" size={20} color={PRIMARY} />
              <Text style={styles.rideTypeText}>{rideType}</Text>
            </View>

            {/* LOCATION CARD */}
            <View style={styles.locationCard}>
              <View style={styles.locationRow}>
                <View style={styles.dotPickup} />
                <Text style={styles.locationText} numberOfLines={2}>
                  {pickupAddress}
                </Text>
              </View>

              <View style={styles.verticalLine} />

              <View style={styles.locationRow}>
                <View style={styles.dotDropoff} />
                <Text style={styles.locationText} numberOfLines={2}>
                  {dropoffAddress}
                </Text>
              </View>
            </View>

            {/* Ride Details */}
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Distance</Text>
              <Text style={styles.detailValue}>{distance.toFixed(2)} km</Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Duration</Text>
              <Text style={styles.detailValue}>{Math.ceil(duration)} min</Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Fare</Text>
              <Text style={styles.detailValue}>£{fare}</Text>
            </View>

            <TouchableOpacity
              style={styles.requestButton}
              onPress={() =>
                navigation.navigate('RideTracking', {
                  origin,
                  destination,
                  fare,
                  distance,
                  duration,
                  rideType,
                })
              }
            >
              <Text style={styles.requestText}>Track Ride</Text>
            </TouchableOpacity>
          </>
        )}
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

  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 22,
    elevation: 20,
  },

  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ddd',
    alignSelf: 'center',
    marginBottom: 15,
  },

  sheetTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: SECONDARY,
    marginBottom: 10,
    textAlign: 'center',
  },

  loadingText: {
    fontSize: 20,
    fontWeight: '700',
    color: SECONDARY,
    textAlign: 'center',
  },

  etaText: {
    fontSize: 16,
    color: '#777',
    textAlign: 'center',
    marginTop: 4,
  },

  progressBarBackground: {
    width: '100%',
    height: 8,
    backgroundColor: '#eee',
    borderRadius: 4,
    marginTop: 15,
  },

  progressBarFill: {
    height: 8,
    backgroundColor: PRIMARY,
    borderRadius: 4,
  },

  cancelButton: {
    marginTop: 15,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: SECONDARY,
    alignItems: 'center',
  },

  cancelText: {
    color: SECONDARY,
    fontWeight: '700',
    fontSize: 16,
  },

  rideTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 15,
    gap: 8,
  },

  rideTypeText: {
    fontSize: 18,
    fontWeight: '700',
    color: PRIMARY,
  },

  locationCard: {
    backgroundColor: '#F7F9FC',
    padding: 15,
    borderRadius: 16,
    marginBottom: 15,
  },

  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  locationText: {
    marginLeft: 10,
    fontSize: 14,
    color: '#333',
    flex: 1,
  },

  dotPickup: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: PRIMARY,
  },

  dotDropoff: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: SECONDARY,
  },

  verticalLine: {
    width: 2,
    height: 20,
    backgroundColor: '#ccc',
    marginLeft: 4,
    marginVertical: 4,
  },

  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },

  detailLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },

  detailValue: {
    fontSize: 15,
    fontWeight: '700',
    color: PRIMARY,
  },

  requestButton: {
    backgroundColor: PRIMARY,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 15,
  },

  requestText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
