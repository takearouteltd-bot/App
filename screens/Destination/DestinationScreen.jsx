import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Text,
  FlatList,
  Dimensions,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

const PRIMARY = '#79B431';
const SECONDARY = '#235594';

export default function DestinationSearchScreen({ navigation, route }) {
  const { origin } = route.params;

  const [currentAddress, setCurrentAddress] = useState('');
  const [recentSearches, setRecentSearches] = useState([
    { description: 'Airport', latitude: origin.latitude + 0.01, longitude: origin.longitude + 0.01 },
    { description: 'Train Station', latitude: origin.latitude + 0.02, longitude: origin.longitude + 0.02 },
    { description: 'City Center', latitude: origin.latitude + 0.03, longitude: origin.longitude + 0.03 },
  ]);
  

  useEffect(() => {
    getAddress();
  }, []);

  const getAddress = async () => {
    try {
      const result = await Location.reverseGeocodeAsync(origin);
      if (result.length > 0) {
        const place = result[0];
        const formatted = [
          place.name,
          place.street,
          place.city,
          place.region,
        ]
          .filter(Boolean)
          .join(', ');
        setCurrentAddress(formatted);
      }
    } catch (err) {
      console.log(err);
    }
  };

  const handleRecentSearchPress = (item) => {
    navigation.navigate('FareEstimation', {
      origin: origin,
      destination: item,
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>

        {/* Greeting */}
        <Text style={styles.greeting}>GOOD MORNING</Text>
        <Text style={styles.subtitle}>Where to today?</Text>

        {/* Search Bar (UNCHANGED LOGIC) */}
        <GooglePlacesAutocomplete
          placeholder="Search Destination"
          fetchDetails
          onPress={(data, details = null) => {
            if (!details) return;

            const destination = {
              latitude: details.geometry.location.lat,
              longitude: details.geometry.location.lng,
              description: data.description,
            };

            setRecentSearches((prev) => [
              destination,
              ...prev.filter(d => d.description !== destination.description),
            ].slice(0, 5));

            navigation.navigate('FareEstimation', {
              origin: origin,
              destination: destination,
            });
          }}
          query={{
            key: 'AIzaSyBtmcvJE-m_v44Z2lLDm8wDgI6GGYLXimQ',
            language: 'en',
          }}
          styles={{
            container: { flex: 0, zIndex: 1000 },
            textInput: styles.input,
            listView: styles.listView,
            row: styles.listRow,
            description: { color: '#000' },
          }}
          debounce={400}
          enablePoweredByContainer={false}
        />

        {/* Map Container */}
     {/* Map Container */}
<View style={styles.mapContainer}>

  <MapView
    style={styles.map}
    initialRegion={{
      latitude: origin.latitude,
      longitude: origin.longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    }}
    scrollEnabled={false}
    zoomEnabled={false}
  >
    <Marker coordinate={origin} />
  </MapView>

  {/* Dark Overlay */}
  <View style={styles.mapOverlay} />

  {/* Text On Map */}
  <View style={styles.mapTextContainer}>
    <Text style={styles.mapLabel}>CURRENT LOCATION</Text>
    <Text style={styles.mapAddress}>
      {currentAddress || 'Fetching location...'}
    </Text>
  </View>

</View>

        {/* Quick Action Cards */}
        <View style={styles.quickRow}>
          <TouchableOpacity style={styles.quickCard}>
            <Ionicons name="calendar-outline" size={26} color={PRIMARY} />
            <Text style={styles.quickTitle}>Schedule a ride</Text>
            <Text style={styles.quickSub}>Book for later</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.quickCard}>
            <Ionicons name="briefcase-outline" size={26} color={SECONDARY} />
            <Text style={styles.quickTitle}>Business</Text>
            <Text style={styles.quickSub}>Expense Trips</Text>
          </TouchableOpacity>
        </View>

        {/* Recent Searches */}
        {recentSearches.length > 0 && (
          <View style={styles.recentContainer}>
            <Text style={styles.recentTitle}>Recent Searches</Text>
            <FlatList
              data={recentSearches}
              keyExtractor={(item, index) => index.toString()}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.recentItem}
                  onPress={() => handleRecentSearchPress(item)}
                >
                  <Ionicons name="time-outline" size={20} color={PRIMARY} />
                  <Text style={styles.recentText}>{item.description}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        )}

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { flex: 1, paddingHorizontal: 20 },

  greeting: {
    marginTop: 20,
    fontSize: 13,
    letterSpacing: 1,
    color: '#999',
  },

  subtitle: {
    fontSize: 24,
    fontWeight: '700',
    color: SECONDARY,
    marginBottom: 20,
  },

  input: {
    backgroundColor: '#f4f6f8',
    borderRadius: 14,
    paddingHorizontal: 15,
    paddingVertical: 14,
    fontSize: 16,
  },

  listView: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginTop: 10,
    elevation: 5,
  },

  listRow: {
    padding: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#eee',
  },

mapContainer: {
  marginTop: 25,
  height: 160,
  borderRadius: 18,
  overflow: 'hidden',
},

map: {
  width: '100%',
  height: '100%',
},

mapOverlay: {
  ...StyleSheet.absoluteFillObject,
  backgroundColor: 'rgba(0,0,0,0.35)', // opacity effect
},

mapTextContainer: {
  position: 'absolute',
  bottom: 15,
  left: 15,
  right: 15,
},

mapLabel: {
  fontSize: 11,
  letterSpacing: 1,
  color: '#ccc',
  marginBottom: 4,
},

mapAddress: {
  fontSize: 14,
  fontWeight: '600',
  color: '#fff',
},

  quickRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 25,
  },

  quickCard: {
    width: '48%',
    backgroundColor: '#f4f6f8',
    borderRadius: 16,
    padding: 15,
  },

  quickTitle: {
    marginTop: 10,
    fontWeight: '600',
    fontSize: 14,
  },

  quickSub: {
    fontSize: 12,
    color: '#777',
    marginTop: 4,
  },

  recentContainer: {
    marginTop: 30,
  },

  recentTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 10,
  },

  recentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },

  recentText: {
    marginLeft: 10,
    fontSize: 15,
  },
});
