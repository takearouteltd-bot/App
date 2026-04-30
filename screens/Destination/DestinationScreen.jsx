import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Text,
  FlatList,
  Dimensions,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import { Ionicons } from '@expo/vector-icons';
import {
  collection,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from '../../config/firebase';

const { width } = Dimensions.get('window');

const PRIMARY = '#79B431';
const SECONDARY = '#235594';

export default function DestinationSearchScreen({ navigation, route }) {
  const { origin, pickupType = 'current' } = route.params || {};
  const searchRef = useRef(null);

  const [currentAddress, setCurrentAddress] = useState('');
  const [recentSearches, setRecentSearches] = useState([]);

  // Fetch real recent searches from subcollection
  useEffect(() => {
    if (!auth.currentUser) return;

    const recentRef = collection(db, 'riders', auth.currentUser.uid, 'recentSearches');
    const q = query(recentRef, orderBy('searchedAt', 'desc'), limit(10));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const searches = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setRecentSearches(searches);
      },
      (error) => {
        if (error.code === 'permission-denied') return;
        console.error('Recent searches error:', error);
      }
    );

    return unsubscribe;
  }, []);

  // Set pickup address
  useEffect(() => {
    if (origin?.address) {
      setCurrentAddress(origin.address);
    } else {
      getAddress();
    }
  }, [origin]);

  const getAddress = async () => {
    try {
      const result = await Location.reverseGeocodeAsync({
        latitude: origin.latitude,
        longitude: origin.longitude,
      });
      if (result.length > 0) {
        const place = result[0];
        const formatted = [place.name, place.street, place.city, place.region]
          .filter(Boolean)
          .join(', ');
        setCurrentAddress(formatted);
      }
    } catch (err) {
      console.log(err);
    }
  };

  const saveRecentSearch = async (destination) => {
    if (!auth.currentUser) return;

    try {
      const recentRef = collection(db, 'riders', auth.currentUser.uid, 'recentSearches');

      // Check for duplicates (same placeId or very close lat/lng)
      const q = query(
        recentRef,
        where('placeId', '==', destination.placeId || '')
      );

      // Add new search entry with server timestamp
      await addDoc(recentRef, {
        description: destination.description || destination.address,
        address: destination.address,
        latitude: destination.latitude,
        longitude: destination.longitude,
        placeId: destination.placeId || null,
        searchedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Save recent search error:', error);
    }
  };

  const handleRecentSearchPress = (item) => {
    navigation.navigate('FareEstimation', {
      origin: origin,
      destination: {
        latitude: item.latitude,
        longitude: item.longitude,
        description: item.description,
        address: item.address,
        placeId: item.placeId,
      },
    });
  };

  const getPickupLabel = () => {
    switch (pickupType) {
      case 'home': return 'HOME';
      case 'work': return 'WORK';
      case 'other': return 'SAVED';
      default: return 'CURRENT LOCATION';
    }
  };

  const getPickupIcon = () => {
    switch (pickupType) {
      case 'home': return 'home';
      case 'work': return 'briefcase';
      case 'other': return 'location';
      default: return 'locate';
    }
  };

  const dismissKeyboard = () => {
    Keyboard.dismiss();
    searchRef.current?.blur();
  };

  return (
    <TouchableWithoutFeedback onPress={dismissKeyboard}>
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>

          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={24} color={SECONDARY} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Where to?</Text>
            <View style={styles.backBtn} />
          </View>

          {/* Pickup Indicator */}
          <View style={styles.pickupCard}>
            <View style={[
              styles.pickupIcon,
              { backgroundColor: pickupType === 'current' ? '#E8F5E9' : '#E3F2FD' }
            ]}>
              <Ionicons
                name={getPickupIcon()}
                size={18}
                color={pickupType === 'current' ? PRIMARY : SECONDARY}
              />
            </View>
            <View style={styles.pickupTextContainer}>
              <Text style={styles.pickupLabel}>{getPickupLabel()}</Text>
              <Text style={styles.pickupAddress} numberOfLines={2}>
                {currentAddress || 'Fetching location...'}
              </Text>
            </View>
            <TouchableOpacity onPress={() => navigation.goBack()}>
              <Text style={styles.changeText}>Change</Text>
            </TouchableOpacity>
          </View>

          {/* Search */}
          <View style={styles.searchContainer}>
            <GooglePlacesAutocomplete
              ref={searchRef}
              placeholder="Search destination"
              minLength={2}
              autoFocus={false}
              returnKeyType="search"
              fetchDetails={true}
              onPress={(data, details = null) => {
                if (!details) return;

                const destination = {
                  latitude: details.geometry.location.lat,
                  longitude: details.geometry.location.lng,
                  description: data.description,
                  address: data.description,
                  placeId: data.place_id,
                };

                saveRecentSearch(destination);

                navigation.navigate('FareEstimation', {
                  origin: origin,
                  destination: destination,
                });
              }}
              query={{
                key: 'AIzaSyBtmcvJE-m_v44Z2lLDm8wDgI6GGYLXimQ',
                language: 'en',
                types: 'geocode|establishment',
              }}
              styles={{
                container: styles.autocompleteContainer,
                textInput: styles.autocompleteInput,
                textInputContainer: styles.autocompleteInputContainer,
                listView: styles.autocompleteListView,
                row: styles.autocompleteRow,
                separator: styles.autocompleteSeparator,
                description: styles.autocompleteDescription,
                predefinedPlacesDescription: styles.autocompletePredefined,
                loader: styles.autocompleteLoader,
              }}
              textInputProps={{
                placeholderTextColor: '#999',
                returnKeyType: 'search',
                clearButtonMode: 'while-editing',
              }}
              listViewDisplayed="auto"
              debounce={300}
              enablePoweredByContainer={false}
              nearbyPlacesAPI="GooglePlacesSearch"
              GoogleReverseGeocodingQuery={{}}
              GooglePlacesSearchQuery={{
                rankby: 'distance',
              }}
              filterReverseGeocodingByTypes={[
                'locality',
                'administrative_area_level_3',
              ]}
              predefinedPlaces={recentSearches.map((r) => ({
                description: r.description,
                geometry: {
                  location: { lat: r.latitude, lng: r.longitude },
                },
              }))}
              renderRow={(rowData) => (
                <View style={styles.suggestionRow}>
                  <View style={styles.suggestionIcon}>
                    <Ionicons
                      name={rowData.isPredefinedPlace ? 'time-outline' : 'location-outline'}
                      size={20}
                      color={rowData.isPredefinedPlace ? PRIMARY : '#999'}
                    />
                  </View>
                  <View style={styles.suggestionTextContainer}>
                    <Text style={styles.suggestionMainText} numberOfLines={1}>
                      {rowData.structured_formatting?.main_text || rowData.description}
                    </Text>
                    {rowData.structured_formatting?.secondary_text && (
                      <Text style={styles.suggestionSubText} numberOfLines={1}>
                        {rowData.structured_formatting.secondary_text}
                      </Text>
                    )}
                  </View>
                </View>
              )}
              renderDescription={(description) => description}
            />
          </View>

          {/* Map Preview */}
          <View style={styles.mapContainer} pointerEvents="none">
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
              pitchEnabled={false}
              rotateEnabled={false}
            >
              <Marker coordinate={origin}>
                <View style={styles.markerContainer}>
                  <View style={styles.markerDot} />
                  <View style={styles.markerRing} />
                </View>
              </Marker>
            </MapView>

            <View style={styles.mapOverlay} />

            <View style={styles.mapTextContainer}>
              <View style={styles.mapLabelRow}>
                <Ionicons name={getPickupIcon()} size={12} color="#ccc" />
                <Text style={styles.mapLabel}>{getPickupLabel()}</Text>
              </View>
              <Text style={styles.mapAddress} numberOfLines={2}>
                {currentAddress || 'Fetching location...'}
              </Text>
            </View>
          </View>

          {/* Quick Actions */}
          <View style={styles.quickRow}>
            <TouchableOpacity style={styles.quickCard}>
              <View style={[styles.quickIcon, { backgroundColor: '#FFF3E0' }]}>
                <Ionicons name="calendar-outline" size={22} color="#F57C00" />
              </View>
              <Text style={styles.quickTitle}>Schedule</Text>
              <Text style={styles.quickSub}>Book for later</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.quickCard}>
              <View style={[styles.quickIcon, { backgroundColor: '#E3F2FD' }]}>
                <Ionicons name="briefcase-outline" size={22} color={SECONDARY} />
              </View>
              <Text style={styles.quickTitle}>Business</Text>
              <Text style={styles.quickSub}>Expense trip</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.quickCard}>
              <View style={[styles.quickIcon, { backgroundColor: '#F3E5F5' }]}>
                <Ionicons name="people-outline" size={22} color="#7B1FA2" />
              </View>
              <Text style={styles.quickTitle}>Group</Text>
              <Text style={styles.quickSub}>Split fare</Text>
            </TouchableOpacity>
          </View>

          {/* Real Recent Searches */}
          {recentSearches.length > 0 && (
            <View style={styles.recentContainer}>
              <Text style={styles.recentTitle}>Recent Destinations</Text>
              <FlatList
                data={recentSearches}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.recentItem}
                    onPress={() => handleRecentSearchPress(item)}
                  >
                    <View style={styles.recentIcon}>
                      <Ionicons name="time-outline" size={18} color={PRIMARY} />
                    </View>
                    <View style={styles.recentTextContainer}>
                      <Text style={styles.recentText} numberOfLines={1}>
                        {item.description}
                      </Text>
                      <Text style={styles.recentSub} numberOfLines={1}>
                        {item.address}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color="#ccc" />
                  </TouchableOpacity>
                )}
                scrollEnabled={false}
              />
            </View>
          )}

        </View>
      </SafeAreaView>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },

  content: {
    flex: 1,
    paddingHorizontal: 20,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    paddingBottom: 16,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: SECONDARY,
  },

  // Pickup Card
  pickupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    padding: 14,
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#eee',
  },
  pickupIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  pickupTextContainer: {
    flex: 1,
  },
  pickupLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#888',
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  pickupAddress: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
    lineHeight: 20,
  },
  changeText: {
    fontSize: 13,
    fontWeight: '600',
    color: PRIMARY,
  },

  // Search
  searchContainer: {
    zIndex: 9999,
    elevation: 9999,
    marginBottom: 8,
  },
  autocompleteContainer: {
    flex: 0,
  },
  autocompleteInputContainer: {
    backgroundColor: 'transparent',
    borderTopWidth: 0,
    borderBottomWidth: 0,
  },
  autocompleteInput: {
    backgroundColor: '#f4f6f8',
    borderRadius: 14,
    paddingHorizontal: 15,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#eee',
    height: 50,
  },
  autocompleteListView: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginTop: 4,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    borderWidth: 1,
    borderColor: '#eee',
    maxHeight: 250,
  },
  autocompleteRow: {
    padding: 14,
    height: 'auto',
    minHeight: 50,
  },
  autocompleteSeparator: {
    height: 1,
    backgroundColor: '#f0f0f0',
  },
  autocompleteDescription: {
    fontSize: 14,
    color: '#1a1a1a',
  },
  autocompletePredefined: {
    color: PRIMARY,
  },
  autocompleteLoader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    height: 20,
  },

  // Suggestion Row
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  suggestionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  suggestionTextContainer: {
    flex: 1,
  },
  suggestionMainText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1a1a1a',
  },
  suggestionSubText: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },

  // Map
  mapContainer: {
    height: 130,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
    zIndex: 1,
  },
  map: {
    width: '100%',
    height: '100%',
  },
  mapOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  mapTextContainer: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
  },
  mapLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  mapLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#ccc',
    letterSpacing: 0.8,
  },
  mapAddress: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
    lineHeight: 18,
  },

  // Marker
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: PRIMARY,
    borderWidth: 3,
    borderColor: '#fff',
  },
  markerRing: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: PRIMARY,
    opacity: 0.3,
  },

  // Quick Actions
  quickRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
    zIndex: 1,
  },
  quickCard: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#eee',
  },
  quickIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  quickTitle: {
    fontWeight: '600',
    fontSize: 13,
    color: '#1a1a1a',
    marginBottom: 2,
  },
  quickSub: {
    fontSize: 11,
    color: '#888',
  },

  // Recent Searches
  recentContainer: {
    flex: 1,
    zIndex: 1,
  },
  recentTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 12,
  },
  recentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  recentIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F0F7E6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  recentTextContainer: {
    flex: 1,
  },
  recentText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#1a1a1a',
  },
  recentSub: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
});