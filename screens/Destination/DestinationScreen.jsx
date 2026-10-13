import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Text,
  FlatList,
  Keyboard,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import * as Location from 'expo-location';
import { usePlaceSearch } from '../../utils/placeSearch';
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
import { COLORS, TYPE, SPACE, RADIUS, ScreenHeader, EmptyState } from '../../components/ui/kit';


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
  const [picking, setPicking] = useState(false);
  const search = usePlaceSearch({ near: origin });
  const searching = search.text.trim().length >= 2;

  useEffect(() => {
    if (!auth.currentUser) return undefined;

    const recentRef = collection(db, 'riders', auth.currentUser.uid, 'recentSearches');
    return onSnapshot(
      query(recentRef, orderBy('searchedAt', 'desc'), limit(30)),
      (snapshot) => {
        // Older entries were saved under other keys (and picking a recent can
        // save it again by coordinates), so the same place could be listed
        // several times. Keep only the newest of each name.
        const seen = new Set();
        const unique = [];
        snapshot.docs.forEach((d) => {
          const item = { id: d.id, ...d.data() };
          const name = String(item.description || item.address || '').trim().toLowerCase();
          const key = name || item.id;
          if (seen.has(key)) return;
          seen.add(key);
          unique.push(item);
        });
        setRecentSearches(unique.slice(0, 8));
      },
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

  const handleResultPress = async (item) => {
    if (picking) return;
    setPicking(true);
    const place = await search.pick(item);
    setPicking(false);
    if (!place) return;
    const destination = {
      latitude: place.latitude,
      longitude: place.longitude,
      description: place.description,
      address: place.description,
      placeId: place.placeId,
    };
    saveRecentSearch(destination);
    Keyboard.dismiss();
    goToFare(destination);
  };

  const pickup = PICKUP[pickupType] || PICKUP.current;

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader compact title={addingStop ? 'Add a stop' : 'Where to?'} onBack={() => navigation.goBack()} />

      {/* Pickup and destination as one journey, the shape people expect. */}
      <View style={styles.journey}>
        <View style={styles.gutter}>
          <View style={styles.dotPickup} />
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
            <TextInput
              ref={searchRef}
              style={styles.input}
              value={search.text}
              onChangeText={search.setText}
              placeholder={addingStop ? 'Search for a stop' : 'Search a destination'}
              placeholderTextColor={COLORS.faint}
              autoFocus
              autoCorrect={false}
              returnKeyType="search"
            />
            {search.text ? (
              <TouchableOpacity
                style={styles.clear}
                onPress={search.clear}
                hitSlop={8}
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close-circle" size={20} color={COLORS.faint} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>

      {/* Results replace the recents while typing, as a normal list so
          nothing can sit on top of them. Recents are the fast path otherwise. */}
      <View style={styles.recents}>
        {searching ? (
          <>
            {search.error ? (
              <Text style={styles.searchError}>{search.error}</Text>
            ) : null}
            {search.loading && !search.results.length ? (
              <ActivityIndicator color={COLORS.midnight} style={{ marginTop: SPACE[4] }} />
            ) : null}
            {!search.loading && !search.error && !search.results.length ? (
              <Text style={styles.searchHint}>No places match "{search.text.trim()}".</Text>
            ) : null}
            <FlatList
              data={search.results}
              keyExtractor={(item) => item.placeId}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              ItemSeparatorComponent={() => <View style={styles.rowLine} />}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.recentRow}
                  onPress={() => handleResultPress(item)}
                  activeOpacity={0.6}
                >
                  <View style={styles.rowIcon}>
                    <Ionicons name="location-outline" size={18} color={COLORS.midnight} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.recentText} numberOfLines={1}>{item.main}</Text>
                    {item.secondary ? (
                      <Text style={styles.recentSub} numberOfLines={1}>{item.secondary}</Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
              )}
            />
          </>
        ) : recentSearches.length ? (
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
                  <View style={styles.rowIcon}>
                    <Ionicons name="time-outline" size={18} color={COLORS.midnight} />
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

  journey: { flexDirection: 'row', gap: SPACE[3], paddingHorizontal: SPACE[5], paddingTop: SPACE[2] },
  gutter: { width: 12, alignItems: 'center', paddingTop: 22 },
  dotPickup: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: COLORS.lime, borderWidth: 2.5, borderColor: COLORS.midnight,
  },
  stem: { flex: 1, width: 2, backgroundColor: COLORS.line, marginVertical: 4, minHeight: 34 },
  square: { width: 12, height: 12, borderRadius: 3, backgroundColor: COLORS.midnight },

  pickup: { flexDirection: 'row', alignItems: 'center', paddingBottom: SPACE[4] },
  pickupAddress: { ...TYPE.callout, marginTop: 2 },
  change: { ...TYPE.small, color: COLORS.midnight, fontWeight: '700' },

  searchWrap: { justifyContent: 'center' },
  input: {
    height: 54,
    paddingLeft: SPACE[4],
    paddingRight: 44,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.fill,
    backgroundColor: COLORS.fill,
    fontSize: 16,
    color: COLORS.ink,
  },
  clear: { position: 'absolute', right: SPACE[3] },
  searchError: { ...TYPE.small, color: COLORS.red, marginBottom: SPACE[2] },
  searchHint: { ...TYPE.small, marginTop: SPACE[2] },

  rowIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.fill,
    alignItems: 'center', justifyContent: 'center',
  },

  recents: { flex: 1, paddingHorizontal: SPACE[5], paddingTop: SPACE[6] },
  rowLine: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.line },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE[3], paddingVertical: SPACE[3], minHeight: 56 },
  recentText: { fontSize: 16, fontWeight: '600', color: COLORS.ink, letterSpacing: -0.2 },
  recentSub: { ...TYPE.small, marginTop: 1 },
  reuse: { transform: [{ rotate: '45deg' }] },
});
