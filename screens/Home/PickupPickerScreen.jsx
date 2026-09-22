import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  COLORS,
  TYPE,
  SPACE,
  RADIUS,
  SHADOW,
  Button,
  IconButton,
  isCoord,
  regionFrom,
} from '../../components/ui/kit';

const GOOGLE_API_KEY = 'AIzaSyBtmcvJE-m_v44Z2lLDm8wDgI6GGYLXimQ';

/* Drop a pin on your exact pickup point.
   The pin is fixed to the centre of the screen and the map moves underneath
   it, which is the pattern people know from other ride apps. GPS gets you to
   roughly the right street; this is for the doorway, the car park entrance, or
   the side of the building you are actually standing on. */
export default function PickupPickerScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { initial } = route.params || {};

  const mapRef = useRef(null);
  const geocodeTimer = useRef(null);
  const alive = useRef(true);

  const [region, setRegion] = useState(regionFrom(initial, 0.004));
  const [centre, setCentre] = useState(isCoord(initial) ? initial : null);
  const [address, setAddress] = useState(initial?.address || '');
  const [resolving, setResolving] = useState(false);
  const [locating, setLocating] = useState(!isCoord(initial));

  useEffect(() => () => {
    alive.current = false;
    if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
  }, []);

  // Without a starting point, find the phone first.
  useEffect(() => {
    if (isCoord(initial)) return;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          if (alive.current) setLocating(false);
          return;
        }
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const point = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        if (!alive.current) return;
        setRegion(regionFrom(point, 0.004));
        setCentre(point);
        resolveAddress(point);
      } catch (error) {
        console.log('Pickup picker location error:', error);
      } finally {
        if (alive.current) setLocating(false);
      }
    })();
  }, [initial]);

  /* Turns the pin's coordinates into something readable. Debounced, because
     this fires every time the map settles. */
  const resolveAddress = useCallback((point) => {
    if (!isCoord(point)) return;
    if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
    setResolving(true);

    geocodeTimer.current = setTimeout(async () => {
      try {
        const results = await Location.reverseGeocodeAsync(point);
        const place = results[0];
        if (!alive.current) return;
        setAddress(
          place
            ? [place.name, place.street, place.city || place.subregion, place.postalCode]
                .filter(Boolean)
                .join(', ')
            : ''
        );
      } catch (error) {
        if (alive.current) setAddress('');
      } finally {
        if (alive.current) setResolving(false);
      }
    }, 450);
  }, []);

  const handleRegionChange = (next) => {
    const point = { latitude: next.latitude, longitude: next.longitude };
    setCentre(point);
    resolveAddress(point);
  };

  const recentre = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const point = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      mapRef.current?.animateToRegion(regionFrom(point, 0.004), 400);
    } catch (error) {
      console.log('Recentre error:', error);
    } finally {
      if (alive.current) setLocating(false);
    }
  };

  const confirm = () => {
    if (!isCoord(centre)) return;
    // Handed back to the home screen, which reads it off its own route params.
    navigation.navigate('HomeScreen', {
      pickedPickup: {
        latitude: centre.latitude,
        longitude: centre.longitude,
        address: address || 'Pinned location',
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.mapWrap}>
        {region ? (
          <MapView
            ref={mapRef}
            provider={PROVIDER_GOOGLE}
            style={StyleSheet.absoluteFill}
            initialRegion={region}
            onRegionChangeComplete={handleRegionChange}
            showsUserLocation
            showsMyLocationButton={false}
            showsCompass={false}
            toolbarEnabled={false}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.mapLoading]}>
            <ActivityIndicator size="large" color={COLORS.green} />
          </View>
        )}

        {/* The pin never moves. The map moves under it. */}
        <View style={styles.pinWrap} pointerEvents="none">
          <View style={styles.pin}>
            <View style={styles.pinDot} />
          </View>
          <View style={styles.pinStem} />
          <View style={styles.pinShadow} />
        </View>

        <View style={styles.topBar}>
          <IconButton
            icon="chevron-back"
            onPress={() => navigation.goBack()}
            accessibilityLabel="Go back"
          />
        </View>

        {/* Jump straight to an address instead of dragging there. */}
        <View style={styles.searchWrap}>
          <GooglePlacesAutocomplete
            placeholder="Search for a street or postcode"
            minLength={2}
            fetchDetails
            onPress={(data, details = null) => {
              if (!details) return;
              const point = {
                latitude: details.geometry.location.lat,
                longitude: details.geometry.location.lng,
              };
              Keyboard.dismiss();
              setCentre(point);
              setAddress(data.description);
              mapRef.current?.animateToRegion(regionFrom(point, 0.004), 400);
            }}
            query={{ key: GOOGLE_API_KEY, language: 'en', components: 'country:gb' }}
            styles={{
              container: { flex: 0 },
              textInputContainer: { backgroundColor: 'transparent', padding: 0 },
              textInput: styles.searchInput,
              listView: styles.searchList,
              row: { padding: 0, height: 'auto' },
              separator: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.line },
              description: { color: COLORS.ink },
            }}
            textInputProps={{ placeholderTextColor: COLORS.faint, returnKeyType: 'search' }}
            debounce={300}
            enablePoweredByContainer={false}
          />
        </View>

        <View style={styles.recentre}>
          <IconButton
            icon="locate"
            onPress={recentre}
            accessibilityLabel="Use my current location"
          />
        </View>
      </View>

      <View style={styles.sheet}>
        <Text style={TYPE.label}>Pickup point</Text>
        <View style={styles.addressRow}>
          <View style={styles.addressDot} />
          <Text style={styles.address} numberOfLines={2}>
            {resolving ? 'Finding the address…' : address || 'Move the map to your pickup point'}
          </Text>
        </View>

        <Text style={styles.hint}>
          Drag the map so the pin sits exactly where you want to be collected.
        </Text>

        <Button
          title="Confirm pickup"
          onPress={confirm}
          disabled={!isCoord(centre) || locating}
          style={{ marginTop: SPACE[4] }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.white },
  mapWrap: { flex: 1 },
  mapLoading: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#E9ECF1' },

  // Sits at the centre of the map area, lifted by half the pin's height so the
  // point of the stem is what the coordinates refer to.
  pinWrap: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  pin: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: COLORS.green,
    borderWidth: 3, borderColor: COLORS.white,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: -2,
    ...SHADOW.float,
  },
  pinDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.white },
  pinStem: { width: 2, height: 16, backgroundColor: COLORS.green },
  pinShadow: {
    width: 10, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(15,23,42,0.28)',
    marginTop: 1,
  },

  topBar: { position: 'absolute', top: SPACE[3], left: SPACE[5] },
  recentre: { position: 'absolute', right: SPACE[5], bottom: SPACE[5] },

  searchWrap: {
    position: 'absolute',
    top: SPACE[3] + 52,
    left: SPACE[5],
    right: SPACE[5],
    zIndex: 20,
  },
  searchInput: {
    height: 48, marginBottom: 0,
    paddingHorizontal: SPACE[4],
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.white,
    fontSize: 15, color: COLORS.ink,
    ...SHADOW.float,
  },
  searchList: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.md,
    marginTop: SPACE[2],
    paddingHorizontal: SPACE[4],
    ...SHADOW.float,
  },

  sheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SPACE[5],
    paddingTop: SPACE[5],
    paddingBottom: SPACE[8],
    ...SHADOW.sheet,
  },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE[3], marginTop: SPACE[2] },
  addressDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.green, marginTop: 6 },
  address: { flex: 1, fontSize: 17, fontWeight: '700', color: COLORS.navy, letterSpacing: -0.3 },
  hint: { ...TYPE.small, marginTop: SPACE[3] },
});
