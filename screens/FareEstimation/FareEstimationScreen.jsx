import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  FlatList,
  Dimensions,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import MapViewDirections from 'react-native-maps-directions';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');
const PRIMARY = '#79B431';
const SECONDARY = '#235594';

export default function FareEstimationScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { origin, destination } = route.params;
  const mapRef = useRef(null);

  const [distance, setDistance] = useState(0);
  const [duration, setDuration] = useState(0);
  const [selectedRide, setSelectedRide] = useState('RouteMini');

  const GOOGLE_MAPS_API_KEY = 'AIzaSyBtmcvJE-m_v44Z2lLDm8wDgI6GGYLXimQ';

  // Ride types and multipliers
  const rideOptions = [
    { id: 'RouteMini', label: 'RouteMini', multiplier: 1.0 },
    { id: 'RoutePlus', label: 'RoutePlus', multiplier: 1.2 },
    { id: 'RouteXL', label: 'RouteXL', multiplier: 1.5 },
    { id: 'RouteEco', label: 'RouteEco', multiplier: 0.9 },
    { id: 'RouteExecutive', label: 'Route Executive', multiplier: 2.0 },
  ];

  // Fare calculation
  const calculateFare = (multiplier = 1) => {
    const baseFare = 2;
    const ratePerKm = 1.5;
    const ratePerMin = 0.3;
    return ((baseFare + distance * ratePerKm + duration * ratePerMin) * multiplier).toFixed(2);
  };

  return (
    <SafeAreaView style={styles.container}>

      {/* MAP */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={{
            latitude: origin.latitude,
            longitude: origin.longitude,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          }}
        >
          <Marker coordinate={origin} pinColor={PRIMARY} />
          <Marker coordinate={destination} pinColor={SECONDARY} />

          {/* Glow Line */}
          <MapViewDirections
            origin={origin}
            destination={destination}
            apikey={GOOGLE_MAPS_API_KEY}
            strokeWidth={12}
            strokeColor="rgba(121,180,49,0.2)"
          />

          {/* Main Route */}
          <MapViewDirections
            origin={origin}
            destination={destination}
            apikey={GOOGLE_MAPS_API_KEY}
            strokeWidth={6}
            strokeColor={PRIMARY}
            onReady={result => {
              setDistance(result.distance);
              setDuration(result.duration);
              mapRef.current.fitToCoordinates(result.coordinates, {
                edgePadding: { top: 120, right: 60, bottom: 350, left: 60 },
                animated: true,
              });
            }}
          />
        </MapView>

        {/* Back Button */}
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* BOTTOM SHEET */}
      <View style={styles.bottomSheet}>
        <View style={styles.sheetHandle} />

        <Text style={styles.sheetTitle}>Select Your Ride</Text>

        {/* Ride Options */}
        <FlatList
          data={rideOptions}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingVertical: 10 }}
          renderItem={({ item }) => {
            const isSelected = item.id === selectedRide;
            return (
              <TouchableOpacity
                style={[
                  styles.rideCard,
                  { borderColor: isSelected ? PRIMARY : '#eee' },
                  { backgroundColor: isSelected ? 'rgba(121,180,49,0.1)' : '#fff' }
                ]}
                onPress={() => setSelectedRide(item.id)}
              >
                <Text style={styles.rideLabel}>{item.label}</Text>
                <Text style={styles.rideFare}>£{calculateFare(item.multiplier)}</Text>
                <Text style={styles.rideETA}>{Math.ceil(duration)} min</Text>
              </TouchableOpacity>
            );
          }}
        />

        <View style={styles.separator} />

        {/* Selected Ride Summary */}
        <View style={styles.rideRow}>
          <Text style={styles.totalLabel}>Selected Ride</Text>
          <Text style={styles.totalFare}>
            £{calculateFare(rideOptions.find(r => r.id === selectedRide)?.multiplier)}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.requestButton}
          onPress={() =>
            navigation.navigate('RideRequest', {
              origin,
              destination,
              fare: calculateFare(rideOptions.find(r => r.id === selectedRide)?.multiplier),
              distance,
              duration,
              rideType: selectedRide,
            })
          }
        >
          <Text style={styles.requestText}>Confirm Ride</Text>
        </TouchableOpacity>
      </View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  mapContainer: { flex: 1 },
  map: { width: '100%', height: '100%' },

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
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ddd',
    marginBottom: 15,
  },

  sheetTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: SECONDARY,
    marginBottom: 12,
  },

  rideCard: {
    width: width * 0.28,
    marginRight: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },

  rideLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 6,
  },

  rideFare: {
    fontSize: 16,
    fontWeight: '700',
    color: PRIMARY,
    marginBottom: 4,
  },

  rideETA: {
    fontSize: 12,
    color: '#777',
  },

  separator: {
    height: 1,
    backgroundColor: '#eee',
    marginVertical: 15,
  },

  rideRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },

  totalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },

  totalFare: {
    fontSize: 20,
    fontWeight: '700',
    color: PRIMARY,
  },

  requestButton: {
    backgroundColor: PRIMARY,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 20,
  },

  requestText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
