import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Dimensions,
  ActivityIndicator,
  Animated,
  Easing,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { collection, query, where, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../config/firebase';

const { width, height } = Dimensions.get('window');

const PRIMARY = '#79B531';
const SECONDARY = '#235594';
const DARK = '#1a1a1a';
const BG = '#F8F9FA';

export default function HomeScreen() {
  const navigation = useNavigation();
  const mapRef = useRef(null);
  const slideAnim = useRef(new Animated.Value(100)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const [location, setLocation] = useState(null);
  const [region, setRegion] = useState(null);
  const [address, setAddress] = useState('');
  const [loadingLocation, setLoadingLocation] = useState(true);
  const [savedPlaces, setSavedPlaces] = useState([]);
  const [activeRide, setActiveRide] = useState(null);

  const GOOGLE_API_KEY = 'AIzaSyBtmcvJE-m_v44Z2lLDm8wDgI6GGYLXimQ';

  // Animate bottom card on mount
  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Get location on mount
  useEffect(() => {
    getCurrentLocation();
  }, []);

  // Listen for active ride
  useFocusEffect(
    useCallback(() => {
      if (!auth.currentUser) return;
      
      const ridesQuery = query(
        collection(db, 'rides'),
        where('riderId', '==', auth.currentUser.uid),
        where('status', 'in', ['searching', 'accepted', 'arrived', 'in_progress'])
      );

      const unsubscribe = onSnapshot(
        ridesQuery,
        (snapshot) => {
          if (!snapshot.empty) {
            const ride = snapshot.docs[0];
            setActiveRide({ id: ride.id, ...ride.data() });
          } else {
            setActiveRide(null);
          }
        },
        (error) => {
          if (error.code === 'permission-denied') return;
          console.error('Active ride listener error:', error);
        }
      );

      return unsubscribe;
    }, [])
  );

  // Fetch saved places
  useFocusEffect(
    useCallback(() => {
      if (!auth.currentUser) return;

      const placesRef = collection(db, 'riders', auth.currentUser.uid, 'savedPlaces');
      const unsubscribe = onSnapshot(
        placesRef,
        (snapshot) => {
          const places = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          setSavedPlaces(places);
        },
        (error) => {
          if (error.code === 'permission-denied') return;
        }
      );

      return unsubscribe;
    }, [])
  );

  const getCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLoadingLocation(false);
        return;
      }

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const coords = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      };

      const initialRegion = {
        ...coords,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      };

      setLocation(coords);
      setRegion(initialRegion);
      await getFullAddress(coords.latitude, coords.longitude);
    } catch (error) {
      console.error('Location error:', error);
    } finally {
      setLoadingLocation(false);
    }
  };

  const getFullAddress = async (lat, lng) => {
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_API_KEY}`
      );
      const data = await response.json();

      if (data.results?.[0]) {
        // Get short address (street + locality)
        const result = data.results[0];
        const street = result.address_components.find(c => 
          c.types.includes('route') || c.types.includes('street_number')
        )?.long_name || '';
        const locality = result.address_components.find(c => 
          c.types.includes('locality') || c.types.includes('postal_town')
        )?.long_name || '';
        
        setAddress(street && locality ? `${street}, ${locality}` : result.formatted_address);
      }
    } catch (error) {
      console.error('Geocode error:', error);
    }
  };

  const recenterMap = () => {
    if (location && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: location.latitude,
        longitude: location.longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      }, 500);
    }
  };

  const handleSearchPress = () => {
    if (!location || !address) return;
    navigation.navigate('DestinationSearch', {
      origin: {
        latitude: location.latitude,
        longitude: location.longitude,
        address: address,
      },
    });
  };

  const handleSavedPlacePress = (place) => {
    if (!location) return;
    navigation.navigate('DestinationSearch', {
  origin: { latitude: place.latitude, longitude: place.longitude, address: place.address },
  pickupType: place.type, // 'home' | 'work' | 'other'
});
  };

  const getPlaceIcon = (type) => {
    switch (type) {
      case 'home': return 'home';
      case 'work': return 'briefcase';
      default: return 'location';
    }
  };

  // Active ride banner
  if (activeRide) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.activeRideBanner}>
          <View style={styles.activeRideIndicator} />
          <View style={styles.activeRideContent}>
            <Text style={styles.activeRideTitle}>
              {activeRide.status === 'searching' ? 'Finding your driver...' :
               activeRide.status === 'accepted' ? 'Driver on the way' :
               activeRide.status === 'arrived' ? 'Driver has arrived' :
               'Ride in progress'}
            </Text>
            <Text style={styles.activeRideSubtitle}>
              Tap to view ride details
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={SECONDARY} />
        </View>
        
        <TouchableOpacity 
          style={styles.viewRideButton}
          onPress={() => navigation.navigate('RideTracking', { rideId: activeRide.id })}
        >
          <Text style={styles.viewRideText}>View Ride</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Map */}
      {region ? (
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={region}
          showsUserLocation={false}
          showsMyLocationButton={false}
          showsCompass={false}
          rotateEnabled={false}
          pitchEnabled={false}
          toolbarEnabled={false}
        >
          {location && (
            <Marker coordinate={location} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={styles.markerContainer}>
                <View style={styles.markerPulse} />
                <View style={styles.markerDot} />
              </View>
            </Marker>
          )}
        </MapView>
      ) : (
        <View style={[styles.map, styles.mapLoading]}>
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      )}

      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity 
          style={styles.menuButton}
          onPress={() => navigation.openDrawer?.() || navigation.navigate('Profile')}
        >
          <Ionicons name="menu" size={24} color={DARK} />
        </TouchableOpacity>
        
        <View style={styles.locationPill}>
          <Ionicons name="location" size={14} color={PRIMARY} />
          <Text style={styles.locationPillText} numberOfLines={1}>
            {loadingLocation ? 'Locating...' : address || 'Current Location'}
          </Text>
        </View>

        <TouchableOpacity style={styles.menuButton} onPress={() => navigation.navigate('Notifications')}>
          <View style={styles.notificationBadge}>
            <Ionicons name="notifications-outline" size={22} color={DARK} />
            <View style={styles.badgeDot} />
          </View>
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <Animated.View style={[styles.searchContainer, { opacity: fadeAnim }]}>
        <TouchableOpacity style={styles.searchBar} onPress={handleSearchPress} activeOpacity={0.8}>
          <View style={styles.searchIconCircle}>
            <Ionicons name="search" size={18} color="#fff" />
          </View>
          <View style={styles.searchTextContainer}>
            <Text style={styles.searchLabel}>Where are you going?</Text>
            <Text style={styles.searchSublabel}>Choose your destination</Text>
          </View>
          <Ionicons name="arrow-forward-circle" size={32} color={PRIMARY} />
        </TouchableOpacity>
      </Animated.View>

      {/* Recenter Button */}
      <TouchableOpacity style={styles.recenterButton} onPress={recenterMap}>
        <Ionicons name="locate" size={22} color={SECONDARY} />
      </TouchableOpacity>

      {/* Bottom Sheet */}
      <Animated.View 
        style={[
          styles.bottomSheet,
          { transform: [{ translateY: slideAnim }] }
        ]}
      >
        {/* Handle */}
        <View style={styles.sheetHandle} />

        {/* Promo Banner */}
        <View style={styles.promoBanner}>
          <View style={styles.promoIcon}>
            <Ionicons name="flash" size={16} color={PRIMARY} />
          </View>
          <Text style={styles.promoText}>Save up to 25% vs traditional ride apps</Text>
        </View>

        {/* Saved Places */}
        <Text style={styles.sectionTitle}>Saved Places</Text>
        
        {savedPlaces.length > 0 ? (
          <View style={styles.savedPlacesRow}>
            {savedPlaces.slice(0, 3).map((place) => (
              <TouchableOpacity
                key={place.id}
                style={styles.savedPlaceChip}
                onPress={() => handleSavedPlacePress(place)}
              >
                <View style={[styles.savedPlaceIcon, { backgroundColor: place.type === 'home' ? '#E3F2FD' : place.type === 'work' ? '#FFF3E0' : '#E8F5E9' }]}>
                  <Ionicons 
                    name={getPlaceIcon(place.type)} 
                    size={16} 
                    color={place.type === 'home' ? SECONDARY : place.type === 'work' ? '#F57C00' : PRIMARY} 
                  />
                </View>
                <Text style={styles.savedPlaceName} numberOfLines={1}>{place.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View style={styles.emptySavedPlaces}>
            <Text style={styles.emptySavedText}>Add home and work for quick access</Text>
            <TouchableOpacity onPress={() => navigation.navigate('SavedPlaces')}>
              <Text style={styles.emptySavedLink}>Add Places →</Text>
            </TouchableOpacity>
          </View>
        )}

       
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },

  // Map
  map: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  mapLoading: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#E8E8E8',
  },

  // Marker
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerPulse: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: PRIMARY,
    opacity: 0.2,
  },
  markerDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: PRIMARY,
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },

  // Top Bar
  topBar: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  locationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    maxWidth: width * 0.5,
  },
  locationPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: DARK,
    marginLeft: 6,
  },
  notificationBadge: {
    position: 'relative',
  },
  badgeDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF4444',
    borderWidth: 1.5,
    borderColor: '#fff',
  },

  // Search
  searchContainer: {
    position: 'absolute',
    top: 110,
    left: 16,
    right: 16,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
  searchIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: PRIMARY,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchTextContainer: {
    flex: 1,
    marginLeft: 14,
  },
  searchLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: DARK,
  },
  searchSublabel: {
    fontSize: 13,
    color: '#999',
    marginTop: 2,
  },

  // Recenter
  recenterButton: {
    position: 'absolute',
    right: 16,
    bottom: 280,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },

  // Bottom Sheet
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 10,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#ddd',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },

  // Promo
  promoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F7E6',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 20,
  },
  promoIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  promoText: {
    fontSize: 13,
    fontWeight: '600',
    color: PRIMARY,
    flex: 1,
  },

  // Section
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: DARK,
    marginBottom: 14,
  },

  // Saved Places
  savedPlacesRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  savedPlaceChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BG,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#eee',
  },
  savedPlaceIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  savedPlaceName: {
    fontSize: 13,
    fontWeight: '600',
    color: DARK,
    flex: 1,
  },
  emptySavedPlaces: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: BG,
    padding: 16,
    borderRadius: 14,
    marginBottom: 20,
  },
  emptySavedText: {
    fontSize: 13,
    color: '#888',
  },
  emptySavedLink: {
    fontSize: 13,
    fontWeight: '600',
    color: PRIMARY,
  },

  // Recent Rides
  recentRidesButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  recentRidesText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: DARK,
    marginLeft: 10,
  },

  // Active Ride
  activeRideBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    margin: 16,
    marginTop: 60,
    padding: 16,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  activeRideIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: PRIMARY,
    marginRight: 14,
  },
  activeRideContent: {
    flex: 1,
  },
  activeRideTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: DARK,
  },
  activeRideSubtitle: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  viewRideButton: {
    marginHorizontal: 16,
    backgroundColor: PRIMARY,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  viewRideText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});