import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  Keyboard,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import { usePlaceSearch } from '../../utils/placeSearch';
import * as Location from 'expo-location';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  COLORS,
  TYPE,
  SPACE,
  RADIUS,
  SHADOW,
  Button,
  IconButton,
  Sheet,
  isCoord,
  regionFrom,
} from '../../components/ui/kit';


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

  // Ranked near where the map was opened, not limited to it.
  const search = usePlaceSearch({ near: initial });

  const choosePlace = async (item) => {
    const place = await search.pick(item);
    if (!place) return;
    Keyboard.dismiss();
    search.clear();
    setCentre({ latitude: place.latitude, longitude: place.longitude });
    setAddress(place.description);
    mapRef.current?.animateToRegion(regionFrom(place, 0.004), 400);
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
            <ActivityIndicator size="large" color={COLORS.primary} />
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
          <TextInput
            style={styles.searchInput}
            value={search.text}
            onChangeText={search.setText}
            placeholder="Search for a street or postcode"
            placeholderTextColor={COLORS.faint}
            autoCorrect={false}
            returnKeyType="search"
          />
          {search.text.trim().length >= 2 ? (
            <View style={styles.searchList}>
              {search.error ? <Text style={styles.searchNote}>{search.error}</Text> : null}
              {search.loading && !search.results.length ? (
                <ActivityIndicator color={COLORS.midnight} style={{ marginVertical: SPACE[3] }} />
              ) : null}
              {!search.loading && !search.error && !search.results.length ? (
                <Text style={styles.searchNote}>No places match "{search.text.trim()}".</Text>
              ) : null}
              {search.results.slice(0, 5).map((item, i) => (
                <TouchableOpacity
                  key={item.placeId}
                  style={[styles.searchRow, i > 0 && styles.searchRowLine]}
                  onPress={() => choosePlace(item)}
                  activeOpacity={0.6}
                >
                  <Text style={styles.searchMain} numberOfLines={1}>{item.main}</Text>
                  {item.secondary ? (
                    <Text style={styles.searchSub} numberOfLines={1}>{item.secondary}</Text>
                  ) : null}
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.recentre}>
          <IconButton
            icon="locate"
            onPress={recentre}
            accessibilityLabel="Use my current location"
          />
        </View>
      </View>

      <Sheet>
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
          style={{ marginTop: SPACE[5] }}
        />
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.white },
  mapWrap: { flex: 1 },
  mapLoading: { alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.fill },

  // Sits at the centre of the map area, lifted by half the pin's height so the
  // point of the stem is what the coordinates refer to.
  pinWrap: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  pin: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: COLORS.lime,
    borderWidth: 3, borderColor: COLORS.midnight,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: -2,
    ...SHADOW.float,
  },
  pinDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.midnight },
  pinStem: { width: 3, height: 16, borderRadius: 2, backgroundColor: COLORS.midnight },
  pinShadow: {
    width: 10, height: 4, borderRadius: 2,
    backgroundColor: COLORS.overlay,
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
    height: 52,
    paddingHorizontal: SPACE[4],
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.white,
    fontSize: 16, color: COLORS.ink,
    ...SHADOW.float,
  },
  searchList: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    marginTop: SPACE[2],
    paddingHorizontal: SPACE[4],
    ...SHADOW.float,
  },
  searchRow: { paddingVertical: SPACE[3] },
  searchRowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line },
  searchMain: { fontSize: 16, fontWeight: '600', color: COLORS.ink },
  searchSub: { ...TYPE.small, marginTop: 1 },
  searchNote: { ...TYPE.small, paddingVertical: SPACE[3] },

  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE[3], marginTop: SPACE[2] },
  addressDot: {
    width: 12, height: 12, borderRadius: 6, marginTop: 6,
    backgroundColor: COLORS.lime, borderWidth: 2.5, borderColor: COLORS.midnight,
  },
  address: { flex: 1, ...TYPE.heading },
  hint: { ...TYPE.small, marginTop: SPACE[3] },
});
