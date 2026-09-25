import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  TouchableOpacity,
  Animated,
  Easing,
} from 'react-native';
import { Alert } from '../../components/ui/alert';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import MapViewDirections from 'react-native-maps-directions';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { collection, doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { getAuth } from 'firebase/auth';
import { currencySymbol, useAppConfig, money } from '../../utils/appConfig';
import { acceptCounterOffer, raiseOffer } from '../../utils/bidding';
import {
  COLORS, TYPE, SPACE, RADIUS, SHADOW, IconButton, RouteLine,
  MapUnavailable, isCoord, validCoords, regionCovering,
} from '../../components/ui/kit';

const GOOGLE_MAPS_API_KEY = 'AIzaSyBtmcvJE-m_v44Z2lLDm8wDgI6GGYLXimQ';

// How long we have been looking. Real elapsed time, rather than a progress bar
// that implies we know how far through the search we are — we do not.
function useElapsed(active) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setSeconds((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  return seconds;
}

export default function RideRequestScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { rideId } = route.params;

  const mapRef = useRef(null);
  const pulse = useRef(new Animated.Value(0)).current;

  const [rideData, setRideData] = useState(null);
  const [rideStatus, setRideStatus] = useState('searching');
  const [cancelling, setCancelling] = useState(false);

  const hasNavigatedToTracking = useRef(false);
  const hasLeftScreen = useRef(false);
  const cancelledByMe = useRef(false);
  const handoverTimer = useRef(null);

  const isSearching = rideStatus === 'searching';
  const elapsed = useElapsed(isSearching);

  // Female driver only: after the dashboard's wait with no taker, offer to
  // look for any driver instead (the passenger can also keep waiting).
  const appConfig = useAppConfig();
  const femaleWait = Number(appConfig.femaleDriver?.waitSeconds) || 60;
  const [keepWaitingUntil, setKeepWaitingUntil] = useState(femaleWait);
  const [widening, setWidening] = useState(false);
  const askToWiden =
    isSearching && rideData?.femaleDriverOnly === true && elapsed >= keepWaitingUntil;

  // Bidding: drivers' counter-offers for this ride, live.
  const [offers, setOffers] = useState([]);
  const [taking, setTaking] = useState(null);
  const [raising, setRaising] = useState(false);
  useEffect(() => {
    if (!rideId || !rideData?.bidding) return undefined;
    return onSnapshot(collection(db, 'rides', rideId, 'offers'), (snap) =>
      setOffers(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
  }, [rideId, rideData?.bidding]);

  // `elapsed` ticks every second, so expired offers drop out on their own.
  const liveOffers = offers
    .filter((o) => o.status === 'pending' && Number(o.expiresAtMs) > Date.now())
    .sort((a, b) => a.price - b.price)
    .slice(0, 4);

  const takeOffer = async (offer) => {
    setTaking(offer.driverId);
    try {
      await acceptCounterOffer(rideId, offer);
      // The ride listener hands over to tracking.
    } catch (error) {
      Alert.alert('Could not take that offer', error.message || 'Please try again.');
    } finally {
      setTaking(null);
    }
  };

  const bumpOffer = async (by) => {
    if (!rideData) return;
    setRaising(true);
    try {
      await raiseOffer(rideId, rideData, Number(rideData.offeredFare || rideData.fareEstimate) + by);
    } catch (error) {
      Alert.alert('Could not raise your offer', 'Please try again.');
    } finally {
      setRaising(false);
    }
  };

  const findAnyDriver = async () => {
    setWidening(true);
    try {
      await updateDoc(doc(db, 'rides', rideId), {
        femaleDriverOnly: false,
        femalePreferenceDropped: true,
      });
    } catch (error) {
      Alert.alert('Could not update your ride', 'Please try again.');
    } finally {
      setWidening(false);
    }
  };

  /* A radar sweep: it says "we are looking", without claiming to know how
     close we are to finding someone. */
  useEffect(() => {
    if (!isSearching) return undefined;
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 2000,
        useNativeDriver: true,
        easing: Easing.out(Easing.ease),
      })
    );
    loop.start();
    return () => loop.stop();
  }, [isSearching, pulse]);

  useEffect(() => {
    if (!rideId) return undefined;

    const unsubscribe = onSnapshot(doc(db, 'rides', rideId), (docSnap) => {
      if (!docSnap.exists()) {
        Alert.alert('Ride not found', 'We could not load this ride.');
        navigation.goBack();
        return;
      }

      const data = docSnap.data();
      setRideData(data);
      setRideStatus(data.status);

      // Let the "driver found" card be read before handing over to tracking.
      if (data.status === 'accepted' && data.driverId && !hasNavigatedToTracking.current) {
        hasNavigatedToTracking.current = true;
        handoverTimer.current = setTimeout(() => {
          navigation.replace('RideTracking', { rideId });
        }, 2500);
      }

      // Leave once. Cancelling used to call goBack twice, popping an extra screen.
      if ((data.status === 'cancelled' || data.status === 'canceled') && !hasLeftScreen.current) {
        hasLeftScreen.current = true;
        if (!cancelledByMe.current) {
          Alert.alert('Ride cancelled', 'This ride has been cancelled.');
        }
        navigation.goBack();
      }
    });

    return () => {
      unsubscribe();
      // Without this, cancelling inside the handover window navigates a screen
      // that is already gone.
      if (handoverTimer.current) clearTimeout(handoverTimer.current);
    };
  }, [rideId, navigation]);

  const fitMap = () => {
    if (!mapRef.current || !rideData) return;
    const coords = validCoords(rideData.pickupLocation, rideData.dropoffLocation);
    if (!coords.length) return;
    mapRef.current.fitToCoordinates(coords, {
      edgePadding: { top: 120, right: 60, bottom: 400, left: 60 },
      animated: true,
    });
  };

  const handleCancelRequest = () => {
    Alert.alert('Cancel this ride?', 'You have not been charged.', [
      { text: 'Keep looking', style: 'cancel' },
      {
        text: 'Cancel ride',
        style: 'destructive',
        onPress: async () => {
          const currentUser = getAuth().currentUser;
          if (!currentUser) return;
          try {
            setCancelling(true);
            cancelledByMe.current = true;
            await updateDoc(doc(db, 'rides', rideId), {
              status: 'cancelled',
              cancelledBy: 'rider',
              cancelledAt: serverTimestamp(),
            });
            await updateDoc(doc(db, 'riders', currentUser.uid), { currentRideId: null });
            // The listener above leaves the screen.
          } catch (error) {
            cancelledByMe.current = false;
            console.error('Failed to cancel ride:', error);
            Alert.alert('Could not cancel', 'Please try again.');
            setCancelling(false);
          }
        },
      },
    ]);
  };

  if (!rideData) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={COLORS.green} />
        <Text style={[TYPE.small, { marginTop: SPACE[4] }]}>Loading your ride…</Text>
      </SafeAreaView>
    );
  }

  const { pickupLocation, dropoffLocation, fareEstimate, route: rideRoute } = rideData;
  const distanceKm = rideRoute?.distanceKm || 0;
  const durationMinutes = rideRoute?.durationMinutes || 0;
  const isAccepted = rideStatus === 'accepted' && rideData.driverId;

  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;

  // No usable coordinates means no map, rather than a map of the Atlantic.
  const initialRegion = regionCovering([pickupLocation, dropoffLocation], 0.05);

  const haloStyle = {
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.4] }) }],
  };

  return (
    <SafeAreaView style={styles.container}>
      {initialRegion ? (
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={StyleSheet.absoluteFill}
          initialRegion={initialRegion}
          onMapReady={fitMap}
          showsCompass={false}
          toolbarEnabled={false}
        >
          {isCoord(pickupLocation) ? (
            <Marker coordinate={pickupLocation} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={styles.originMarker} />
            </Marker>
          ) : null}
          {isCoord(dropoffLocation) ? (
            <Marker coordinate={dropoffLocation} anchor={{ x: 0.5, y: 1 }}>
              <Ionicons name="location" size={30} color={COLORS.navy} />
            </Marker>
          ) : null}
          {isCoord(pickupLocation) && isCoord(dropoffLocation) ? (
            <MapViewDirections
              origin={pickupLocation}
              destination={dropoffLocation}
              apikey={GOOGLE_MAPS_API_KEY}
              strokeWidth={4}
              strokeColor={COLORS.green}
            />
          ) : null}
        </MapView>
      ) : (
        <View style={StyleSheet.absoluteFill}>
          <MapUnavailable note="We do not have map coordinates for this trip." />
        </View>
      )}

      <View style={styles.topBar}>
        <IconButton icon="chevron-back" onPress={() => navigation.goBack()} accessibilityLabel="Go back" />
      </View>

      <View style={styles.sheet}>
        <View style={styles.grabber} />

        {isSearching ? (
          <View style={styles.searching}>
            <View style={styles.radar}>
              <Animated.View style={[styles.halo, haloStyle]} />
              <View style={styles.radarCore}>
                <Ionicons name="car-sport" size={26} color={COLORS.white} />
              </View>
            </View>

            <Text style={styles.searchTitle}>
              {rideData.femaleDriverOnly ? 'Finding a female driver' : 'Finding your driver'}
            </Text>
            <Text style={styles.searchClock}>Looking for {clock}</Text>

            {askToWiden ? (
              <View style={styles.widen}>
                <Text style={styles.widenTitle}>No female driver is free right now</Text>
                <Text style={styles.widenBody}>
                  Switch the preference off for this ride and we will find the nearest driver.
                </Text>
                <View style={styles.widenRow}>
                  <TouchableOpacity
                    style={[styles.widenButton, styles.widenSecondary]}
                    onPress={() => setKeepWaitingUntil(elapsed + femaleWait)}
                  >
                    <Text style={[styles.widenButtonText, { color: COLORS.navy }]}>Keep waiting</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.widenButton, widening && { opacity: 0.6 }]}
                    onPress={findAnyDriver}
                    disabled={widening}
                  >
                    <Text style={styles.widenButtonText}>Find any driver</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {rideData.bidding ? (
              <View style={styles.bid}>
                <View style={styles.bidRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={TYPE.label}>Your offer</Text>
                    <Text style={styles.bidValue}>{money(rideData.offeredFare ?? fareEstimate, rideData.currency)}</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.raise, raising && { opacity: 0.6 }]}
                    onPress={() => bumpOffer(1)}
                    disabled={raising}
                  >
                    <Text style={styles.raiseText}>Raise {money(1, rideData.currency)}</Text>
                  </TouchableOpacity>
                </View>

                {liveOffers.length ? (
                  <Text style={[TYPE.label, { marginTop: SPACE[3] }]}>Drivers offering</Text>
                ) : (
                  <Text style={[TYPE.small, { marginTop: SPACE[2] }]}>
                    Nearby drivers can accept your offer or come back with theirs.
                  </Text>
                )}
                {liveOffers.map((o) => {
                  const left = Math.max(0, Math.round((Number(o.expiresAtMs) - Date.now()) / 1000));
                  return (
                    <View key={o.id} style={styles.driverOffer}>
                      <View style={styles.offerAvatar}>
                        <Text style={styles.offerInitial}>{(o.driverName || 'D').charAt(0).toUpperCase()}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.offerName} numberOfLines={1}>
                          {o.driverName}{o.rating ? `  ★ ${Number(o.rating).toFixed(1)}` : ''}
                        </Text>
                        <Text style={TYPE.caption} numberOfLines={1}>
                          {[o.vehicle, `${left}s left`].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.takeOffer, taking && { opacity: 0.6 }]}
                        onPress={() => takeOffer(o)}
                        disabled={!!taking}
                        accessibilityLabel={`Accept ${o.driverName}'s offer of ${money(o.price, rideData.currency)}`}
                      >
                        <Text style={styles.takeOfferText}>
                          {taking === o.driverId ? '…' : money(o.price, rideData.currency)}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            ) : null}

            <View style={styles.facts}>
              <Fact icon="card-outline" text={`${currencySymbol()}${fareEstimate}`} />
              <Fact icon="navigate-outline" text={`${distanceKm} km`} />
              <Fact icon="time-outline" text={`${Math.ceil(durationMinutes)} min`} />
            </View>

            <TouchableOpacity
              style={[styles.cancel, cancelling && { opacity: 0.5 }]}
              onPress={handleCancelRequest}
              disabled={cancelling}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <Text style={styles.cancelText}>
                {cancelling ? 'Cancelling…' : 'Cancel ride'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {isAccepted ? (
          <View style={styles.accepted}>
            <View style={styles.foundRow}>
              <View style={styles.foundTick}>
                <Ionicons name="checkmark" size={18} color={COLORS.white} />
              </View>
              <Text style={styles.foundText}>Driver found</Text>
            </View>

            <View style={styles.journey}>
              <RouteLine
                compact
                pickup={pickupLocation.address}
                dropoff={dropoffLocation.address}
              />
            </View>

            <View style={styles.fareRow}>
              <View>
                <Text style={TYPE.label}>Trip fare</Text>
                <Text style={styles.fareSub}>Includes VAT</Text>
              </View>
              <Text style={styles.fareValue}>
                {currencySymbol()}
                {fareEstimate}
              </Text>
            </View>

            <Text style={styles.handover}>Opening live tracking…</Text>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function Fact({ icon, text }) {
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={15} color={COLORS.muted} />
      <Text style={styles.factText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bid: { alignSelf: 'stretch', marginTop: SPACE[4] },
  bidRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[3],
    padding: SPACE[4], borderRadius: RADIUS.md, backgroundColor: COLORS.greenSoft,
  },
  bidValue: { fontSize: 24, fontWeight: '800', color: COLORS.navy, letterSpacing: -0.5, marginTop: 2 },
  raise: {
    height: 40, paddingHorizontal: SPACE[4], borderRadius: RADIUS.sm,
    backgroundColor: COLORS.white, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.lineStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  raiseText: { fontSize: 14, fontWeight: '700', color: COLORS.navy },
  driverOffer: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[3],
    paddingVertical: SPACE[3],
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.line,
  },
  offerAvatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.blueSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  offerInitial: { fontSize: 16, fontWeight: '800', color: COLORS.navy },
  offerName: { ...TYPE.callout, color: COLORS.navy },
  takeOffer: {
    minWidth: 84, height: 42, paddingHorizontal: SPACE[3], borderRadius: RADIUS.sm,
    backgroundColor: COLORS.green, alignItems: 'center', justifyContent: 'center',
  },
  takeOfferText: { fontSize: 15, fontWeight: '800', color: COLORS.white },
  widen: {
    alignSelf: 'stretch', marginTop: SPACE[4], padding: SPACE[4],
    borderRadius: RADIUS.md, backgroundColor: COLORS.amberSoft,
  },
  widenTitle: { ...TYPE.callout, color: COLORS.amber },
  widenBody: { ...TYPE.small, color: COLORS.inkSoft, marginTop: SPACE[1] },
  widenRow: { flexDirection: 'row', gap: SPACE[3], marginTop: SPACE[3] },
  widenButton: {
    flex: 1, height: 44, borderRadius: RADIUS.sm, backgroundColor: COLORS.green,
    alignItems: 'center', justifyContent: 'center',
  },
  widenSecondary: { backgroundColor: COLORS.white, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.lineStrong },
  widenButtonText: { fontSize: 15, fontWeight: '700', color: COLORS.white },
  container: { flex: 1, backgroundColor: COLORS.white },
  centered: { alignItems: 'center', justifyContent: 'center' },

  originMarker: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: COLORS.green, borderWidth: 3, borderColor: COLORS.white,
  },

  topBar: { position: 'absolute', top: SPACE[3], left: SPACE[5] },

  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: COLORS.white,
    borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SPACE[5], paddingTop: SPACE[3], paddingBottom: SPACE[8],
    ...SHADOW.sheet,
  },
  grabber: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.line,
    alignSelf: 'center', marginBottom: SPACE[5],
  },

  searching: { alignItems: 'center' },
  radar: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
  halo: {
    position: 'absolute', width: 96, height: 96, borderRadius: 48,
    backgroundColor: COLORS.green,
  },
  radarCore: {
    width: 62, height: 62, borderRadius: 31,
    backgroundColor: COLORS.navy,
    alignItems: 'center', justifyContent: 'center',
  },
  searchTitle: { ...TYPE.title, marginTop: SPACE[5] },
  searchClock: { ...TYPE.small, marginTop: SPACE[1] },

  facts: {
    flexDirection: 'row', gap: SPACE[5],
    marginTop: SPACE[6], paddingTop: SPACE[5],
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
    alignSelf: 'stretch', justifyContent: 'center',
  },
  fact: { flexDirection: 'row', alignItems: 'center', gap: SPACE[2] },
  factText: { ...TYPE.small, color: COLORS.ink, fontWeight: '600' },

  cancel: {
    alignSelf: 'stretch', minHeight: 52,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.lineStrong,
    marginTop: SPACE[6],
  },
  cancelText: { fontSize: 15, fontWeight: '700', color: COLORS.red },

  accepted: { paddingBottom: SPACE[2] },
  foundRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE[3] },
  foundTick: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: COLORS.green,
    alignItems: 'center', justifyContent: 'center',
  },
  foundText: { ...TYPE.heading },

  journey: {
    marginTop: SPACE[5], paddingTop: SPACE[5],
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
  },

  fareRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: SPACE[5], paddingTop: SPACE[4],
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
  },
  fareSub: { ...TYPE.small, marginTop: 2 },
  fareValue: { ...TYPE.figure },

  handover: { ...TYPE.small, textAlign: 'center', marginTop: SPACE[5] },
});
