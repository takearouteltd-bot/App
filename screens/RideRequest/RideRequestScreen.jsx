import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Animated,
  Easing,
} from 'react-native';
import { Alert } from '../../components/ui/alert';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import RouteDirections from '../../components/RouteDirections';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { collection, doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { getAuth } from 'firebase/auth';
import { currencySymbol, useAppConfig, money } from '../../utils/appConfig';
import { acceptCounterOffer, raiseOffer } from '../../utils/bidding';
import {
  COLORS, TYPE, SPACE, RADIUS, Screen, Sheet, Card, Button, Banner, Avatar, IconButton,
  RouteLine, Loading, MapUnavailable, isCoord, validCoords, regionCovering,
} from '../../components/ui/kit';


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
      <Screen scroll={false}>
        <Loading label="Loading your ride…" />
      </Screen>
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
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
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
              <Ionicons name="location" size={30} color={COLORS.midnight} />
            </Marker>
          ) : null}
          {isCoord(pickupLocation) && isCoord(dropoffLocation) ? (
            <RouteDirections
              origin={pickupLocation}
              destination={dropoffLocation}
              strokeWidth={4}
              strokeColor={COLORS.primary}
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

      <Sheet style={styles.sheet}>
        {isSearching ? (
          <View style={styles.searching}>
            <View style={styles.radar}>
              <Animated.View style={[styles.halo, haloStyle]} />
              <View style={styles.radarCore}>
                <Ionicons name="car-sport" size={26} color={COLORS.lime} />
              </View>
            </View>

            <Text style={TYPE.label}>Searching</Text>
            <Text style={styles.searchTitle}>
              {rideData.femaleDriverOnly ? 'Finding a female driver' : 'Finding your driver'}
            </Text>
            <Text style={styles.searchClock}>Looking for {clock}</Text>

            {askToWiden ? (
              <View style={styles.widen}>
                <Banner
                  tone="warning"
                  title="No female driver is free right now"
                  body="Switch the preference off for this ride and we will find the nearest driver."
                  action={
                    <View style={styles.widenRow}>
                      <Button
                        title="Keep waiting"
                        variant="secondary"
                        size="small"
                        style={{ flex: 1 }}
                        onPress={() => setKeepWaitingUntil(elapsed + femaleWait)}
                      />
                      <Button
                        title="Find any driver"
                        size="small"
                        style={{ flex: 1 }}
                        onPress={findAnyDriver}
                        loading={widening}
                      />
                    </View>
                  }
                />
              </View>
            ) : null}

            {rideData.bidding ? (
              <View style={styles.bid}>
                <Card tone="accent" style={styles.bidRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.bidLabel}>Your offer</Text>
                    <Text style={styles.bidValue}>{money(rideData.offeredFare ?? fareEstimate, rideData.currency)}</Text>
                  </View>
                  <Button
                    title={`Raise ${money(1, rideData.currency)}`}
                    variant="dark"
                    size="small"
                    onPress={() => bumpOffer(1)}
                    loading={raising}
                  />
                </Card>

                {liveOffers.length ? (
                  <Text style={[TYPE.label, { marginTop: SPACE[4], marginBottom: SPACE[2] }]}>Drivers offering</Text>
                ) : (
                  <Text style={[TYPE.small, { marginTop: SPACE[3] }]}>
                    Nearby drivers can accept your offer or come back with theirs.
                  </Text>
                )}
                {liveOffers.map((o) => {
                  const left = Math.max(0, Math.round((Number(o.expiresAtMs) - Date.now()) / 1000));
                  return (
                    <Card key={o.id} style={styles.driverOffer}>
                      <Avatar name={o.driverName || 'D'} size={44} />
                      <View style={{ flex: 1 }}>
                        <View style={styles.offerNameRow}>
                          <Text style={styles.offerName} numberOfLines={1}>{o.driverName}</Text>
                          {o.rating ? (
                            <View style={styles.rating}>
                              <Ionicons name="star" size={13} color={COLORS.star} />
                              <Text style={styles.ratingText}>{Number(o.rating).toFixed(1)}</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={TYPE.caption} numberOfLines={1}>
                          {[o.vehicle, `${left}s left`].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                      <View style={styles.offerRight}>
                        <Text style={styles.offerPrice}>{money(o.price, rideData.currency)}</Text>
                        <Button
                          title={taking === o.driverId ? '…' : 'Accept'}
                          size="small"
                          style={styles.acceptBtn}
                          onPress={() => takeOffer(o)}
                          disabled={!!taking}
                          accessibilityLabel={`Accept ${o.driverName}'s offer of ${money(o.price, rideData.currency)}`}
                        />
                      </View>
                    </Card>
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
                <Ionicons name="checkmark" size={18} color={COLORS.midnight} />
              </View>
              <View>
                <Text style={TYPE.label}>Good news</Text>
                <Text style={styles.foundText}>Driver found</Text>
              </View>
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
      </Sheet>
    </SafeAreaView>
  );
}

function Fact({ icon, text }) {
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={15} color={COLORS.inkSoft} />
      <Text style={styles.factText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface },

  originMarker: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: COLORS.lime, borderWidth: 3, borderColor: COLORS.midnight,
  },

  topBar: { position: 'absolute', top: SPACE[3], left: SPACE[5] },

  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0 },

  searching: { alignItems: 'center' },
  radar: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center', marginBottom: SPACE[4] },
  halo: {
    position: 'absolute', width: 96, height: 96, borderRadius: 48,
    backgroundColor: COLORS.lime,
  },
  radarCore: {
    width: 62, height: 62, borderRadius: 31,
    backgroundColor: COLORS.midnight,
    alignItems: 'center', justifyContent: 'center',
  },
  searchTitle: { ...TYPE.title, marginTop: SPACE[1], textAlign: 'center' },
  searchClock: { ...TYPE.small, marginTop: SPACE[1] },

  widen: { alignSelf: 'stretch', marginTop: SPACE[4] },
  widenRow: { flexDirection: 'row', gap: SPACE[2] },

  bid: { alignSelf: 'stretch', marginTop: SPACE[4] },
  bidRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE[3], padding: SPACE[4] },
  bidLabel: { ...TYPE.label, color: COLORS.midnight },
  bidValue: { ...TYPE.figure, marginTop: 2 },
  driverOffer: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[3],
    padding: SPACE[3], marginBottom: SPACE[2],
  },
  offerNameRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE[2] },
  offerName: { ...TYPE.callout, flexShrink: 1 },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  ratingText: { ...TYPE.caption, color: COLORS.inkSoft, fontWeight: '700' },
  offerRight: { alignItems: 'flex-end', gap: SPACE[1] },
  offerPrice: { ...TYPE.figure, fontSize: 18 },
  acceptBtn: { minHeight: 36, paddingHorizontal: SPACE[3] },

  facts: {
    flexDirection: 'row', gap: SPACE[2], flexWrap: 'wrap',
    marginTop: SPACE[5], alignSelf: 'stretch', justifyContent: 'center',
  },
  fact: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[2],
    paddingHorizontal: SPACE[3], height: 34, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.fill,
  },
  factText: { ...TYPE.small, color: COLORS.ink, fontWeight: '700' },

  // A quiet red pill: destructive, but not the screen's main action.
  cancel: {
    alignSelf: 'stretch', minHeight: 52,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.redSoft,
    marginTop: SPACE[5],
  },
  cancelText: { fontSize: 16, fontWeight: '800', color: COLORS.red, letterSpacing: -0.2 },

  accepted: { paddingBottom: SPACE[2] },
  foundRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE[3] },
  foundTick: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.lime,
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
