import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Text,
  FlatList,
  Keyboard,
} from 'react-native';
import * as Location from 'expo-location';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import { GOOGLE_MAPS_API_KEY, PLACES_NEW_PROPS, placeCoords } from '../../config/maps';
import { Ionicons } from '@expo/vector-icons';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { auth, db } from '../../config/firebase';
import { COLORS, TYPE, SPACE, RADIUS, EmptyState } from '../../components/ui/kit';


const PICKUP = {
  home: { label: 'Home', icon: 'home' },
  work: { label: 'Work', icon: 'briefcase' },
  other: { label: 'Saved place', icon: 'bookmark' },
  current: { label: 'Current location', icon: 'locate' },
  pinned: { label: 'Your pinned pickup', icon: 'pin' },
};

export default function DestinationSearchScreen({ navigation, route }) {
  const { origin, pickupType = 'current', mode } = route.params || {};
  // Opened from the fare screen's "Add stop": the chosen place comes back
  // there as a stop instead of starting a new booking.
  const addingStop = mode === 'stop';
  const searchRef = useRef(null);

  const [currentAddress, setCurrentAddress] = useState('');
  const [recentSearches, setRecentSearches] = useState([]);

  useEffect(() => {
    if (!auth.currentUser) return undefined;

    const recentRef = collection(db, 'riders', auth.currentUser.uid, 'recentSearches');
    return onSnapshot(
      query(recentRef, orderBy('searchedAt', 'desc'), limit(8)),
      (snapshot) => setRecentSearches(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (error) => {
        if (error.code === 'permission-denied') return;
        console.error('Recent searches error:', error);
      }
    );
  }, []);

  useEffect(() => {
    if (origin?.address) setCurrentAddress(origin.address);
    else if (origin) getAddress();
  }, [origin]);

  const getAddress = async () => {
    try {
      const result = await Location.reverseGeocodeAsync({
        latitude: origin.latitude,
        longitude: origin.longitude,
      });
      const place = result[0];
      if (!place) return;
      setCurrentAddress(
        [place.name, place.street, place.city, place.region].filter(Boolean).join(', ')
      );
    } catch (error) {
      console.log(error);
    }
  };

  /* One document per place, keyed by its Google place id, so searching the
     same destination twice moves it up the list instead of adding a second
     copy. Places without an id fall back to their coordinates. */
  const saveRecentSearch = async (destination) => {
    if (!auth.currentUser) return;
    const key =
      destination.placeId ||
      `${destination.latitude.toFixed(5)},${destination.longitude.toFixed(5)}`;

    try {
      await setDoc(
        doc(db, 'riders', auth.currentUser.uid, 'recentSearches', key),
        {
          description: destination.description || destination.address,
          address: destination.address,
          latitude: destination.latitude,
          longitude: destination.longitude,
          placeId: destination.placeId || null,
          searchedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      console.error('Save recent search error:', error);
    }
  };

  const goToFare = (destination) => {
    if (addingStop) {
      navigation.navigate({ name: 'FareEstimation', params: { addStop: destination }, merge: true });
      return;
    }
    navigation.navigate('FareEstimation', { origin, destination });
  };

  const handleRecentSearchPress = (item) => {
    goToFare({
      latitude: item.latitude,
      longitude: item.longitude,
      description: item.description,
      address: item.address,
      placeId: item.placeId,
    });
  };

  const pickup = PICKUP[pickupType] || PICKUP.current;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={24} color={COLORS.navy} />
        </TouchableOpacity>
        <Text style={TYPE.title}>Where to?</Text>
      </View>

      {/* Pickup and destination as one journey, the shape people expect. */}
      <View style={styles.journey}>
        <View style={styles.gutter}>
          <View style={styles.dotGreen} />
          <View style={styles.stem} />
          <View style={styles.square} />
        </View>

        <View style={{ flex: 1 }}>
          <TouchableOpacity
            style={styles.pickup}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={TYPE.label}>{pickup.label}</Text>
              <Text style={styles.pickupAddress} numberOfLines={1}>
                {currentAddress || 'Finding your location…'}
              </Text>
            </View>
            <Text style={styles.change}>Change</Text>
          </TouchableOpacity>

          <View style={styles.searchWrap}>
            <GooglePlacesAutocomplete
              ref={searchRef}
              placeholder={addingStop ? 'Search for a stop' : 'Search a destination'}
              minLength={2}
              autoFocus
              returnKeyType="search"
              fetchDetails
              {...PLACES_NEW_PROPS}
              onPress={(data, details = null) => {
                const point = placeCoords(details);
                if (!point) return;
                const destination = {
                  ...point,
                  description: data.description,
                  address: data.description,
                  placeId: data.place_id,
                };
                saveRecentSearch(destination);
                Keyboard.dismiss();
                goToFare(destination);
              }}
              query={{ key: GOOGLE_MAPS_API_KEY, languageCode: 'en' }}
              styles={{
                container: { flex: 0 },
                textInputContainer: styles.inputContainer,
                textInput: styles.input,
                listView: styles.listView,
                row: styles.suggestionRow,
                separator: styles.separator,
              }}
              textInputProps={{
                placeholderTextColor: COLORS.faint,
                returnKeyType: 'search',
                clearButtonMode: 'while-editing',
              }}
              debounce={300}
              enablePoweredByContainer={false}
              renderRow={(rowData) => (
                <View style={styles.suggestion}>
                  <Ionicons name="location-outline" size={20} color={COLORS.muted} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.suggestionMain} numberOfLines={1}>
                      {rowData.structured_formatting?.main_text || rowData.description}
                    </Text>
                    {rowData.structured_formatting?.secondary_text ? (
                      <Text style={styles.suggestionSub} numberOfLines={1}>
                        {rowData.structured_formatting.secondary_text}
                      </Text>
                    ) : null}
                  </View>
                </View>
              )}
            />
          </View>
        </View>
      </View>

      {/* Recents sit under the search and are the fast path for most trips. */}
      <View style={styles.recents}>
        {recentSearches.length ? (
          <>
            <Text style={[TYPE.label, { marginBottom: SPACE[2] }]}>Recent</Text>
            <FlatList
              data={recentSearches}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              ItemSeparatorComponent={() => <View style={styles.rowLine} />}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.recentRow}
                  onPress={() => handleRecentSearchPress(item)}
                  activeOpacity={0.6}
                >
                  <View style={styles.recentIcon}>
                    <Ionicons name="time-outline" size={18} color={COLORS.muted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.recentText} numberOfLines={1}>
                      {item.description}
                    </Text>
                    {item.address && item.address !== item.description ? (
                      <Text style={styles.recentSub} numberOfLines={1}>
                        {item.address}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons name="arrow-up-outline" size={16} color={COLORS.lineStrong} style={styles.reuse} />
                </TouchableOpacity>
              )}
            />
          </>
        ) : (
          <EmptyState
            icon="navigate-outline"
            title="No recent trips yet"
            body="Search for a destination above and it will appear here for next time."
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.white },

  header: { paddingHorizontal: SPACE[5], paddingTop: SPACE[2], paddingBottom: SPACE[4] },
  backBtn: {
    width: 40, height: 40, marginLeft: -SPACE[2], marginBottom: SPACE[2],
    alignItems: 'center', justifyContent: 'center',
  },

  journey: { flexDirection: 'row', gap: SPACE[3], paddingHorizontal: SPACE[5], zIndex: 10 },
  gutter: { width: 12, alignItems: 'center', paddingTop: 22 },
  dotGreen: { width: 11, height: 11, borderRadius: 6, backgroundColor: COLORS.limeDeep },
  stem: { flex: 1, width: 2, backgroundColor: COLORS.line, marginVertical: 4, minHeight: 34 },
  square: { width: 11, height: 11, borderRadius: 3, backgroundColor: COLORS.navy },

  pickup: { flexDirection: 'row', alignItems: 'center', paddingBottom: SPACE[4] },
  pickupAddress: { ...TYPE.callout, marginTop: 2 },
  change: { ...TYPE.small, color: COLORS.blue, fontWeight: '700' },

  searchWrap: { zIndex: 20 },
  inputContainer: { backgroundColor: 'transparent', padding: 0 },
  input: {
    height: 52,
    marginBottom: 0,
    paddingHorizontal: SPACE[4],
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.lineStrong,
    backgroundColor: COLORS.surface,
    fontSize: 16,
    color: COLORS.ink,
  },
  listView: {
    position: 'absolute',
    top: 58,
    left: 0,
    right: 0,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.line,
    zIndex: 30,
  },
  suggestionRow: { padding: 0, height: 'auto' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.line },
  suggestion: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[3],
    paddingHorizontal: SPACE[4], paddingVertical: SPACE[3],
  },
  suggestionMain: { fontSize: 15, fontWeight: '600', color: COLORS.ink },
  suggestionSub: { ...TYPE.small, marginTop: 1 },

  recents: { flex: 1, paddingHorizontal: SPACE[5], paddingTop: SPACE[6] },
  rowLine: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.line },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE[3], paddingVertical: SPACE[3], minHeight: 56 },
  recentIcon: {
    width: 38, height: 38, borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  recentText: { fontSize: 15, fontWeight: '600', color: COLORS.ink },
  recentSub: { ...TYPE.small, marginTop: 1 },
  reuse: { transform: [{ rotate: '45deg' }] },
});
