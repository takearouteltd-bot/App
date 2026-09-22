import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  Animated,
  Easing,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../../config/firebase';
import {
  COLORS,
  TYPE,
  SPACE,
  RADIUS,
  SHADOW,
  Sheet,
  IconButton,
  ListRow,
  isCoord,
} from '../../components/ui/kit';
import { ACTIVE_RIDE_STATUSES } from '../../utils/modeSwitch';

const GOOGLE_API_KEY = 'AIzaSyBtmcvJE-m_v44Z2lLDm8wDgI6GGYLXimQ';

// What the banner says about a trip that is already running.
const RIDE_LABEL = {
  searching: { title: 'Finding your driver', detail: 'This usually takes under a minute.' },
  accepted: { title: 'Driver on the way', detail: 'Tap to follow them to your pickup.' },
  arrived: { title: 'Your driver has arrived', detail: 'Meet them at the pickup point.' },
  ongoing: { title: 'On your way', detail: 'Tap to follow your route.' },
};

export default function HomeScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const mapRef = useRef(null);
  const slideAnim = useRef(new Animated.Value(120)).current;

  const [location, setLocation] = useState(null);
  const [region, setRegion] = useState(null);
  const [address, setAddress] = useState('');
  const [loadingLocation, setLoadingLocation] = useState(true);
  const [locationDenied, setLocationDenied] = useState(false);
  const [savedPlaces, setSavedPlaces] = useState([]);
  const [activeRide, setActiveRide] = useState(null);
  // A pin the passenger dropped themselves, which overrides GPS as the pickup.
  const [pinnedPickup, setPinnedPickup] = useState(null);

  // The sheet rises once, on first paint.
  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 420,
      useNativeDriver: true,
      easing: Easing.out(Easing.cubic),
    }).start();
  }, [slideAnim]);

  useEffect(() => {
    getCurrentLocation();
  }, []);

  /* Coming back from the map picker. The pin wins over GPS until they clear
     it, because they chose it deliberately. */
  useEffect(() => {
    const picked = route.params?.pickedPickup;
    if (!isCoord(picked)) return;
    setPinnedPickup(picked);
    setRegion({ ...picked, latitudeDelta: 0.005, longitudeDelta: 0.005 });
    mapRef.current?.animateToRegion(
      { ...picked, latitudeDelta: 0.005, longitudeDelta: 0.005 },
      400
    );
    navigation.setParams({ pickedPickup: undefined });
  }, [route.params?.pickedPickup, navigation]);

  /* A trip already in progress. Shown at the top of the sheet rather than
     taking over the screen, so the map and the rest of the app stay usable. */
  useFocusEffect(
    useCallback(() => {
      if (!auth.currentUser) return undefined;

      const ridesQuery = query(
        collection(db, 'rides'),
        where('riderId', '==', auth.currentUser.uid),
        where('status', 'in', ACTIVE_RIDE_STATUSES)
      );

      return onSnapshot(
        ridesQuery,
        (snapshot) => {
          const ride = snapshot.docs[0];
          setActiveRide(ride ? { id: ride.id, ...ride.data() } : null);
        },
        (error) => {
          if (error.code === 'permission-denied') return;
          console.error('Active ride listener error:', error);
        }
      );
    }, [])
  );

  useFocusEffect(
    useCallback(() => {
      if (!auth.currentUser) return undefined;

      const placesRef = collection(db, 'riders', auth.currentUser.uid, 'savedPlaces');
      return onSnapshot(
        placesRef,
        (snapshot) => setSavedPlaces(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (error) => {
          if (error.code === 'permission-denied') return;
        }
      );
    }, [])
  );

  const getCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationDenied(true);
        setLoadingLocation(false);
        return;
      }

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setLocation(coords);
      setRegion({ ...coords, latitudeDelta: 0.005, longitudeDelta: 0.005 });
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
      const result = data.results?.[0];
      if (!result) return;

      const part = (...types) =>
        result.address_components.find((c) => types.some((t) => c.types.includes(t)))?.long_name || '';
      const street = part('route', 'street_number');
      const locality = part('locality', 'postal_town');

      setAddress(street && locality ? `${street}, ${locality}` : result.formatted_address);
    } catch (error) {
      console.error('Geocode error:', error);
    }
  };

  const recenterMap = () => {
    if (!location || !mapRef.current) return;
    mapRef.current.animateToRegion({ ...location, latitudeDelta: 0.005, longitudeDelta: 0.005 }, 500);
  };

  // DestinationScreen takes the pickup point as `origin`, plus a `pickupType`
  // telling it whether that came from GPS or a saved place.
  const openDestinationSearch = (origin, pickupType = 'current') => {
    if (!origin) return;
    navigation.navigate('DestinationSearch', { origin, pickupType });
  };

  /* Where we will actually collect them: the pin they dropped if they dropped
     one, otherwise wherever the phone says they are. */
  const pickup = pinnedPickup
    ? { ...pinnedPickup, address: pinnedPickup.address || 'Pinned location' }
    : location
    ? { ...location, address: address || 'Current location' }
    : null;

  const openPicker = () =>
    navigation.navigate('PickupPicker', { initial: pickup || location || null });

  const handleSearchPress = () => {
    if (!pickup) return;
    openDestinationSearch(pickup, pinnedPickup ? 'pinned' : 'current');
  };

  const handleSavedPlacePress = (place) => {
    openDestinationSearch(
      { latitude: place.latitude, longitude: place.longitude, address: place.address },
      place.type
    );
  };

  const placeIcon = (type) =>
    type === 'home' ? 'home' : type === 'work' ? 'briefcase' : 'bookmark';

  const ride = activeRide ? RIDE_LABEL[activeRide.status] || RIDE_LABEL.ongoing : null;

  return (
    <SafeAreaView style={styles.container}>
      {region ? (
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={StyleSheet.absoluteFill}
          initialRegion={region}
          showsUserLocation={false}
          showsMyLocationButton={false}
          showsCompass={false}
          rotateEnabled={false}
          pitchEnabled={false}
          toolbarEnabled={false}
        >
          {isCoord(pickup) ? (
            <Marker coordinate={pickup} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={styles.marker}>
                <View style={styles.markerHalo} />
                <View
                  style={[styles.markerDot, pinnedPickup && { backgroundColor: COLORS.navy }]}
                />
              </View>
            </Marker>
          ) : null}
        </MapView>
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.mapLoading]}>
          <ActivityIndicator size="large" color={COLORS.green} />
        </View>
      )}

      {/* Where we will pick you up. Tapping it opens the map so you can put the
          pin exactly where you are standing. */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.locationPill}
          onPress={openPicker}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Change your pickup point"
        >
          <View style={[styles.locationDot, pinnedPickup && { backgroundColor: COLORS.navy }]} />
          <Text style={styles.locationText} numberOfLines={1}>
            {loadingLocation
              ? 'Finding you…'
              : pinnedPickup
              ? pinnedPickup.address
              : locationDenied
              ? 'Location off'
              : address || 'Current location'}
          </Text>
          <Ionicons name="chevron-down" size={15} color={COLORS.muted} />
        </TouchableOpacity>
      </View>

      <View style={styles.recenter}>
        <IconButton icon="locate" onPress={recenterMap} accessibilityLabel="Recentre the map" />
      </View>

      <Animated.View style={[styles.sheetWrap, { transform: [{ translateY: slideAnim }] }]}>
        <Sheet>
          {/* A trip already running takes the top of the sheet. */}
          {ride ? (
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.activeRide}
              onPress={() => navigation.navigate('RideTracking', { rideId: activeRide.id })}
            >
              <View style={styles.activePulseWrap}>
                <View style={styles.activePulse} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.activeTitle}>{ride.title}</Text>
                <Text style={styles.activeDetail}>{ride.detail}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.onDark} />
            </TouchableOpacity>
          ) : null}

          {/* The one thing this screen is for. */}
          <TouchableOpacity
            style={[styles.search, !pickup && { opacity: 0.55 }]}
            onPress={handleSearchPress}
            disabled={!pickup}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Choose where you are going"
          >
            <Ionicons name="search" size={20} color={COLORS.navy} />
            <Text style={styles.searchText}>Where to?</Text>
            <View style={styles.searchGo}>
              <Ionicons name="arrow-forward" size={18} color={COLORS.white} />
            </View>
          </TouchableOpacity>

          {locationDenied && !pinnedPickup ? (
            <Text style={styles.denied}>
              Location is off. Turn it on in Settings, or set your pickup on the map.
            </Text>
          ) : null}

          <TouchableOpacity style={styles.pinRow} onPress={openPicker} activeOpacity={0.7}>
            <Ionicons name="pin-outline" size={18} color={COLORS.navy} />
            <Text style={styles.pinRowText}>
              {pinnedPickup ? 'Change your pickup pin' : 'Set pickup on the map'}
            </Text>
            {pinnedPickup ? (
              <Text style={styles.pinClear} onPress={() => setPinnedPickup(null)}>
                Use GPS
              </Text>
            ) : null}
          </TouchableOpacity>

          {savedPlaces.length ? (
            <View style={styles.places}>
              {savedPlaces.slice(0, 3).map((place, i) => (
                <ListRow
                  key={place.id}
                  icon={placeIcon(place.type)}
                  iconColor={COLORS.navy}
                  title={place.name}
                  detail={place.address}
                  onPress={() => handleSavedPlacePress(place)}
                  last={i === Math.min(savedPlaces.length, 3) - 1}
                />
              ))}
            </View>
          ) : (
            <TouchableOpacity
              style={styles.addPlaces}
              onPress={() => navigation.navigate('Profile', { screen: 'SavedPlaces' })}
              activeOpacity={0.7}
            >
              <Ionicons name="add-circle-outline" size={20} color={COLORS.blue} />
              <Text style={styles.addPlacesText}>Save home and work for one-tap booking</Text>
            </TouchableOpacity>
          )}
        </Sheet>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface },
  mapLoading: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#E9ECF1' },

  marker: { alignItems: 'center', justifyContent: 'center' },
  markerHalo: {
    position: 'absolute',
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.green, opacity: 0.18,
  },
  markerDot: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: COLORS.green,
    borderWidth: 3, borderColor: COLORS.white,
  },

  topBar: { position: 'absolute', top: SPACE[3], left: SPACE[5], right: SPACE[5], alignItems: 'center' },
  locationPill: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[2],
    backgroundColor: COLORS.white,
    paddingHorizontal: SPACE[4], height: 40,
    borderRadius: RADIUS.pill,
    maxWidth: '100%',
    ...SHADOW.float,
  },
  locationDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.green },
  locationText: { ...TYPE.small, color: COLORS.ink, fontWeight: '600', flexShrink: 1 },

  recenter: { position: 'absolute', right: SPACE[5], bottom: 300 },

  sheetWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },

  activeRide: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[3],
    backgroundColor: COLORS.navy,
    borderRadius: RADIUS.lg,
    padding: SPACE[4],
    marginBottom: SPACE[4],
  },
  activePulseWrap: { width: 22, alignItems: 'center', justifyContent: 'center' },
  activePulse: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.green },
  activeTitle: { fontSize: 16, fontWeight: '700', color: COLORS.white, letterSpacing: -0.2 },
  activeDetail: { ...TYPE.small, color: COLORS.onDark, marginTop: 2 },

  search: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[3],
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.line,
    paddingLeft: SPACE[4], paddingRight: SPACE[2],
    height: 62,
  },
  searchText: { flex: 1, fontSize: 19, fontWeight: '700', color: COLORS.navy, letterSpacing: -0.4 },
  searchGo: {
    width: 44, height: 44, borderRadius: RADIUS.sm,
    backgroundColor: COLORS.green,
    alignItems: 'center', justifyContent: 'center',
  },

  denied: { ...TYPE.small, color: COLORS.amber, marginTop: SPACE[3] },

  pinRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[2],
    marginTop: SPACE[4], paddingTop: SPACE[4],
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
  },
  pinRowText: { flex: 1, ...TYPE.small, color: COLORS.navy, fontWeight: '600' },
  pinClear: { ...TYPE.small, color: COLORS.blue, fontWeight: '700' },

  places: { marginTop: SPACE[2] },

  addPlaces: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[3],
    marginTop: SPACE[4], paddingVertical: SPACE[2],
  },
  addPlacesText: { ...TYPE.small, color: COLORS.blue, fontWeight: '600', flex: 1 },
});
