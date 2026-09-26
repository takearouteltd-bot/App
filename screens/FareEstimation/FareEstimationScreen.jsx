import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Alert } from '../../components/ui/alert';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import RouteDirections from '../../components/RouteDirections';
import { useNavigation } from '@react-navigation/native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { db } from '../../config/firebase';
import {
  addDoc,
  collection,
  serverTimestamp,
  doc,
  updateDoc,
  getDoc,
  onSnapshot,
  setDoc,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useAppConfig, currencySymbol, surgeMultiplier, cashEnabled, femaleDriverEnabled } from '../../utils/appConfig';
import { useCities, cityFor } from '../../utils/cities';
import { biddingEnabled, minOffer, fareAtPrice } from '../../utils/bidding';
import { MAX_STOPS } from '../../utils/stops';
import {
  COLORS,
  TYPE,
  SPACE,
  RADIUS,
  SHADOW,
  IconButton,
  Sheet,
  Banner,
  Chip,
  Segmented,
  ListRow,
  Field,
  RouteLine,
  MapUnavailable,
  isCoord,
  regionCovering,
} from '../../components/ui/kit';


// Vehicle classes. `multiplier` scales the fare; `passengers` is the real seat
// count. No arrival estimates are shown here because nothing measures them —
// the driver's distance is only known once a job has been offered.
const RIDE_OPTIONS = [
  { id: 'RouteMini', label: 'Mini', multiplier: 1.0, icon: 'car-hatchback', description: 'Everyday rides', passengers: 4 },
  { id: 'RoutePlus', label: 'Plus', multiplier: 1.2, icon: 'car', description: 'Comfortable saloons', passengers: 4 },
  { id: 'RouteXL', label: 'XL', multiplier: 1.5, icon: 'car-estate', description: 'Room for luggage', passengers: 6 },
  { id: 'RouteEco', label: 'Eco', multiplier: 0.9, icon: 'leaf', description: 'Hybrid and electric', passengers: 4 },
  { id: 'RouteExecutive', label: 'Executive', multiplier: 2.0, icon: 'car-sports', description: 'Premium vehicles', passengers: 4 },
];

export default function FareEstimationScreen({ route }) {
  const navigation = useNavigation();
  const { origin, destination } = route.params;

  // Stops on the way, in order. The route (and so the fare, which is priced
  // on distance and time) goes through every one.
  const [stops, setStops] = useState([]);
  useEffect(() => {
    const added = route.params?.addStop;
    if (!added) return;
    setStops((list) => (list.length < MAX_STOPS ? [...list, added] : list));
    navigation.setParams({ addStop: undefined });
  }, [route.params?.addStop, navigation]);
  const removeStop = (index) => setStops((list) => list.filter((_, i) => i !== index));
  const addStop = () => navigation.navigate('DestinationSearch', { origin, mode: 'stop' });
  const mapRef = useRef(null);
  const auth = getAuth();
  const currentUser = auth.currentUser;

  const appConfig = useAppConfig();
  // Which working city the pickup is in, so only that city's drivers get it.
  const cities = useCities();
  const [distance, setDistance] = useState(0);
  const [duration, setDuration] = useState(0);
  const [selectedRide, setSelectedRide] = useState('RouteMini');
  const [loading, setLoading] = useState(false);
  const [routeCalculated, setRouteCalculated] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [promoApplied, setPromoApplied] = useState(false);
  const [discount, setDiscount] = useState(0);
  // Card unless the dashboard allows cash and the passenger picks it.
  const [paymentMethod, setPaymentMethod] = useState('card');
  const allowCash = cashEnabled(appConfig);

  // Bidding: the passenger names their price, from the recommended fare up.
  const bidding = biddingEnabled(appConfig);
  const [offer, setOffer] = useState(null);
  useEffect(() => setOffer(null), [selectedRide, distance, duration, promoApplied]);

  // Female driver: starts from the passenger's saved preference.
  const allowFemaleOnly = femaleDriverEnabled(appConfig);
  const [femaleOnly, setFemaleOnly] = useState(false);
  useEffect(() => {
    if (!currentUser) return;
    getDoc(doc(db, 'riders', currentUser.uid))
      .then((snap) => setFemaleOnly(snap.exists() && snap.data().preferFemaleDriver === true))
      .catch(() => {});
  }, [currentUser]);
  useEffect(() => {
    if (!allowCash && paymentMethod === 'cash') setPaymentMethod('card');
  }, [allowCash, paymentMethod]);
  const [defaultCard, setDefaultCard] = useState(null);
  const [showBreakdown, setShowBreakdown] = useState(false);

  useEffect(() => {
    if (!currentUser) return undefined;
    const cardsRef = collection(db, 'riders', currentUser.uid, 'cards');
    return onSnapshot(cardsRef, (snapshot) => {
      const cards = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setDefaultCard(cards.find((c) => c.isDefault) || cards[0] || null);
    });
  }, [currentUser]);

  /* ================= FARE =================
     Rates come from the admin dashboard (config/app), with the original values
     as fallback. */
  const calculateFareDetails = useCallback(
    (multiplier = 1) => {
      const { baseFare, ratePerMile, ratePerMinute, minimumFare, vatPercent } = appConfig.fares;
      // Busy-time multiplier from the dashboard; 1 is normal pricing.
      const surge = surgeMultiplier(appConfig);
      const vatRate = vatPercent / 100;

      const distanceInMiles = distance * 0.621371;
      const distanceFare = distanceInMiles * ratePerMile;
      const timeFare = duration * ratePerMinute;

      const subtotal = (baseFare + distanceFare + timeFare) * multiplier * surge;
      const fareBeforeVAT = Math.max(subtotal, minimumFare);

      const discountedFare = promoApplied ? fareBeforeVAT * (1 - discount) : fareBeforeVAT;
      const vatAmount = discountedFare * vatRate;
      const total = discountedFare + vatAmount;

      return {
        currency: appConfig.currency,
        vatPercent,
        discountAmount: Number((fareBeforeVAT - discountedFare).toFixed(2)),
        baseFare: Number(baseFare.toFixed(2)),
        distanceFare: Number(distanceFare.toFixed(2)),
        timeFare: Number(timeFare.toFixed(2)),
        surgeMultiplier: surge,
        rideMultiplier: multiplier,
        vat: Number(vatAmount.toFixed(2)),
        total: Number(total.toFixed(2)),
        distanceInMiles: Number(distanceInMiles.toFixed(2)),
        subtotal: Number(discountedFare.toFixed(2)),
      };
    },
    [distance, duration, promoApplied, discount, appConfig]
  );

  /* ================= PROMO =================
     Codes live in the admin dashboard (promoCodes/{CODE}) as a percentage off
     the fare before VAT. */
  const [promoInput, setPromoInput] = useState('');
  const [promoChecking, setPromoChecking] = useState(false);

  const applyPromo = async () => {
    const code = promoInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 3) {
      Alert.alert('Promo code', 'Please enter a valid code.');
      return;
    }
    setPromoChecking(true);
    try {
      const snap = await getDoc(doc(db, 'promoCodes', code));
      const data = snap.exists() ? snap.data() : null;
      const percent = Number(data?.percent);
      const expired = data?.expiresAt
        ? new Date(`${data.expiresAt}T23:59:59`) < new Date()
        : false;

      if (!data || data.active === false || expired || !(percent > 0 && percent <= 100)) {
        Alert.alert('Promo code', expired ? 'This code has expired.' : 'This code is not valid.');
        return;
      }
      setPromoCode(code);
      setDiscount(percent / 100);
      setPromoApplied(true);
    } catch (error) {
      console.log('Promo check failed:', error);
      Alert.alert('Promo code', 'Could not check this code right now. Please try again.');
    } finally {
      setPromoChecking(false);
    }
  };

  const removePromo = () => {
    setPromoApplied(false);
    setPromoCode('');
    setDiscount(0);
    setPromoInput('');
  };

  /* ================= BOOK ================= */
  const handleConfirmRide = async () => {
    if (!currentUser) {
      Alert.alert('Not signed in', 'Please sign in to book a ride.');
      return;
    }

    // Cash rides need no card. Card rides need what the server actually
    // charges with: a Stripe customer and a default card on the rider record,
    // not merely a card in the list.
    if (paymentMethod === 'card') try {
      const riderSnap = await getDoc(doc(db, 'riders', currentUser.uid));
      const rider = riderSnap.exists() ? riderSnap.data() : {};
      if (!rider.stripeCustomerId || !rider.defaultPaymentMethodId) {
        Alert.alert(
          'Add a payment method',
          'You need a card on file before booking a ride.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Add card', onPress: () => navigation.navigate('AddPayment') },
          ]
        );
        return;
      }
    } catch (error) {
      console.error('Error checking cards:', error);
    }

    setLoading(true);

    try {
      const selectedOption = RIDE_OPTIONS.find((r) => r.id === selectedRide);
      const recommendedFare = calculateFareDetails(selectedOption.multiplier);
      // With bidding, the ride is priced at the passenger's offer; the
      // recommendation is kept on the fare for reference.
      const fareDetails = bidding
        ? fareAtPrice(recommendedFare, Math.max(offer ?? recommendedFare.total, minOffer(recommendedFare.total, appConfig)))
        : recommendedFare;

      // Drivers this passenger asked not to be matched with again.
      let blockedDriverIds = [];
      try {
        const riderSnap = await getDoc(doc(db, 'riders', currentUser.uid));
        const list = riderSnap.exists() ? riderSnap.data().blockedDrivers : null;
        if (Array.isArray(list)) blockedDriverIds = list;
      } catch (error) {
        console.log('Could not load blocked drivers:', error);
      }

      const rideData = {
        riderId: currentUser.uid,
        driverId: null,
        status: 'searching',
        rideType: selectedRide,

        pickupLocation: {
          latitude: origin.latitude,
          longitude: origin.longitude,
          address: origin.address || 'Pickup location',
        },

        stops: stops.map((s) => ({
          latitude: s.latitude,
          longitude: s.longitude,
          address: s.description || s.address || 'Stop',
        })),
        stopsCompleted: 0,

        dropoffLocation: {
          latitude: destination.latitude,
          longitude: destination.longitude,
          address: destination.description || destination.address || 'Dropoff location',
        },

        route: {
          distanceKm: Number(distance.toFixed(2)),
          distanceMiles: fareDetails.distanceInMiles,
          durationMinutes: Number(duration.toFixed(2)),
          status: 'calculated',
        },

        fare: {
          ...fareDetails,
          promoCode: promoApplied ? promoCode : null,
          discount: promoApplied ? discount : 0,
        },

        fareEstimate: fareDetails.total,
        bidding,
        offeredFare: bidding ? fareDetails.total : null,
        femaleDriverOnly: allowFemaleOnly && femaleOnly,
        cityId: cityFor(cities, origin)?.id || null,
        cityName: cityFor(cities, origin)?.name || null,
        currency: appConfig.currency,
        blockedDriverIds,

        // Waiting terms at the time of booking. The completion function charges
        // from these, and both apps show the waiting timer from them.
        waitingPolicy: { ...appConfig.waiting },
        // Cancellation terms at the time of booking, read the same way.
        cancellationPolicy: { ...appConfig.cancellation },

        paymentMethod,
        payment: { method: paymentMethod, status: 'pending', transactionId: null },

        timestamps: {
          createdAt: serverTimestamp(),
          acceptedAt: null,
          startedAt: null,
          completedAt: null,
        },

        cancellation: { by: null, reason: null, at: null },
        rating: { riderToDriver: null, driverToRider: null, feedback: null },

        expiresAt: new Date(Date.now() + 60 * 1000),
      };

      const rideRef = await addDoc(collection(db, 'rides'), rideData);

      await updateDoc(doc(db, 'riders', currentUser.uid), { currentRideId: rideRef.id });

      // Keyed by place id so booking the same destination twice moves it up the
      // recent list rather than adding a duplicate.
      const key =
        destination.placeId ||
        `${destination.latitude.toFixed(5)},${destination.longitude.toFixed(5)}`;
      await setDoc(
        doc(db, 'riders', currentUser.uid, 'recentSearches', key),
        {
          description: destination.description || destination.address,
          address: destination.address || destination.description,
          latitude: destination.latitude,
          longitude: destination.longitude,
          placeId: destination.placeId || null,
          searchedAt: serverTimestamp(),
        },
        { merge: true }
      ).catch(() => null);

      setLoading(false);
      navigation.navigate('RideRequest', { rideId: rideRef.id });
    } catch (error) {
      console.error(error);
      setLoading(false);
      Alert.alert('Could not book', 'Failed to request your ride. Please try again.');
    }
  };

  const selectedOption = RIDE_OPTIONS.find((r) => r.id === selectedRide);
  const fare = calculateFareDetails(selectedOption.multiplier);
  const floor = minOffer(fare.total, appConfig);
  const offerValue = Math.max(offer ?? fare.total, floor);
  const nudgeOffer = (delta) =>
    setOffer(Math.max(floor, Math.round((offerValue + delta) * 2) / 2));
  const money = (n) => `${currencySymbol()}${Number(n).toFixed(2)}`;

  // Averaging a missing coordinate gives NaN, and the map opens on 0,0.
  const initialRegion = regionCovering([origin, destination], 0.05);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.mapWrap}>
        {initialRegion ? (
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={StyleSheet.absoluteFill}
          initialRegion={initialRegion}
          showsCompass={false}
          toolbarEnabled={false}
        >
          {isCoord(origin) ? (
            <Marker coordinate={origin} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={styles.originMarker} />
            </Marker>
          ) : null}

          {isCoord(destination) ? (
            <Marker coordinate={destination} anchor={{ x: 0.5, y: 1 }}>
              <Ionicons name="location" size={30} color={COLORS.midnight} />
            </Marker>
          ) : null}

          {stops.map((s, i) => (
            <Marker key={`stop-${i}`} coordinate={s} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={styles.stopMarker}>
                <Text style={styles.stopMarkerText}>{i + 1}</Text>
              </View>
            </Marker>
          ))}

          {isCoord(origin) && isCoord(destination) ? (
          <RouteDirections
            origin={origin}
            destination={destination}
            waypoints={stops.map((s) => ({ latitude: s.latitude, longitude: s.longitude }))}
            strokeWidth={4}
            strokeColor={COLORS.primary}
            onReady={(result) => {
              setDistance(result.distance);
              setDuration(result.duration);
              setRouteCalculated(true);
              mapRef.current?.fitToCoordinates(result.coordinates, {
                edgePadding: { top: 80, right: 60, bottom: 60, left: 60 },
                animated: true,
              });
            }}
          />
          ) : null}
        </MapView>
        ) : (
          <MapUnavailable note="We could not place this journey on a map." />
        )}

        <View style={styles.topBar}>
          <IconButton icon="chevron-back" onPress={() => navigation.goBack()} accessibilityLabel="Go back" />
          {routeCalculated ? (
            <View style={styles.tripPill}>
              <Text style={styles.tripPillText}>{Math.ceil(duration)} min</Text>
              <View style={styles.pillDivider} />
              <Text style={styles.tripPillText}>{fare.distanceInMiles} mi</Text>
            </View>
          ) : null}
          <View style={{ width: 44 }} />
        </View>
      </View>

      <Sheet style={styles.sheet}>
        <View style={styles.journey}>
          <RouteLine
            compact
            pickup={origin.address}
            dropoff={destination.description || destination.address}
          />

          {/* Stops on the way. The fare follows the route through all of them. */}
          {stops.map((s, i) => (
            <View key={`stop-row-${i}`} style={styles.stopRow}>
              <View style={styles.stopDot}>
                <Text style={styles.stopDotText}>{i + 1}</Text>
              </View>
              <Text style={styles.stopText} numberOfLines={1}>
                {s.description || s.address}
              </Text>
              <TouchableOpacity
                onPress={() => removeStop(i)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel={`Remove stop ${i + 1}`}
              >
                <Ionicons name="close-circle" size={20} color={COLORS.faint} />
              </TouchableOpacity>
            </View>
          ))}
          {stops.length < MAX_STOPS ? (
            <View style={styles.addStop}>
              <Chip
                icon="add"
                label={stops.length ? 'Add another stop' : 'Add a stop'}
                onPress={addStop}
              />
            </View>
          ) : null}
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
          {fare.surgeMultiplier > 1 ? (
            <View style={{ marginTop: SPACE[4] }}>
              <Banner
                tone="warning"
                icon="flash"
                body={`Busy right now, so fares are ${fare.surgeMultiplier}× the usual price.`}
              />
            </View>
          ) : null}

          {/* Vehicle class. Price updates with the selection. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.classRow}
          >
            {RIDE_OPTIONS.map((item) => {
              const itemFare = calculateFareDetails(item.multiplier);
              const active = item.id === selectedRide;
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.classCard, active && styles.classCardActive]}
                  onPress={() => setSelectedRide(item.id)}
                  activeOpacity={0.85}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <View style={[styles.classIcon, active && styles.classIconActive]}>
                    <MaterialCommunityIcons
                      name={item.icon}
                      size={24}
                      color={active ? COLORS.lime : COLORS.midnight}
                    />
                  </View>
                  <Text style={[styles.className, active && { color: COLORS.midnight }]}>
                    {item.label}
                  </Text>
                  <Text style={styles.classSeats}>{item.passengers} seats</Text>
                  <Text style={[styles.classFare, active && { color: COLORS.midnight }]}>
                    {routeCalculated ? money(itemFare.total) : '—'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={styles.classDescription}>{selectedOption.description}</Text>

          {bidding && routeCalculated ? (
            <View style={styles.offerBox}>
              <View style={{ flex: 1 }}>
                <Text style={TYPE.label}>Your offer</Text>
                <Text style={styles.offerValue}>{money(offerValue)}</Text>
                <Text style={TYPE.caption}>
                  Recommended {money(fare.total)}. Drivers can accept or offer more.
                </Text>
              </View>
              <View
                style={offerValue <= floor && { opacity: 0.35 }}
                pointerEvents={offerValue <= floor ? 'none' : 'auto'}
              >
                <IconButton
                  icon="remove"
                  onPress={() => nudgeOffer(-0.5)}
                  accessibilityLabel="Lower your offer"
                />
              </View>
              <IconButton
                icon="add"
                tone="dark"
                onPress={() => nudgeOffer(0.5)}
                accessibilityLabel="Raise your offer"
              />
            </View>
          ) : null}

          {/* Payment. Cash appears only when the dashboard allows it. */}
          {allowCash ? (
            <Segmented
              style={styles.payChoice}
              value={paymentMethod}
              onChange={setPaymentMethod}
              options={[
                { value: 'card', label: 'Card' },
                { value: 'cash', label: 'Cash' },
              ]}
            />
          ) : null}

          <View style={styles.options}>
            {paymentMethod === 'cash' ? (
              <ListRow
                icon="cash-outline"
                iconColor={COLORS.midnight}
                title="Pay your driver in cash at the end"
                right={null}
                last={!allowFemaleOnly}
              />
            ) : (
              <ListRow
                icon="card-outline"
                iconColor={COLORS.midnight}
                title={
                  defaultCard
                    ? `${(defaultCard.brand || 'Card').toUpperCase()} ···· ${defaultCard.last4}`
                    : 'No card added'
                }
                onPress={() => navigation.navigate('AddPayment')}
                last={!allowFemaleOnly}
              />
            )}

            {allowFemaleOnly ? (
              <TouchableOpacity
                style={styles.optionRow}
                onPress={() => setFemaleOnly((v) => !v)}
                activeOpacity={0.7}
                accessibilityRole="switch"
                accessibilityState={{ checked: femaleOnly }}
              >
                <View style={styles.optionIcon}>
                  <Ionicons name="woman-outline" size={20} color={COLORS.midnight} />
                </View>
                <Text style={styles.optionLabel}>Female driver only</Text>
                <Ionicons
                  name={femaleOnly ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={femaleOnly ? COLORS.midnight : COLORS.lineStrong}
                />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Promo */}
          {promoApplied ? (
            <View style={styles.promoApplied}>
              <Ionicons name="pricetag" size={18} color={COLORS.limeInk} />
              <Text style={styles.promoAppliedText}>
                {promoCode} · {Math.round(discount * 100)}% off
              </Text>
              <TouchableOpacity onPress={removePromo} accessibilityRole="button">
                <Text style={styles.promoRemove}>Remove</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Field
              left="pricetag-outline"
              placeholder="Promo code"
              autoCapitalize="characters"
              autoCorrect={false}
              value={promoInput}
              onChangeText={setPromoInput}
              onSubmitEditing={applyPromo}
              returnKeyType="done"
              style={styles.promoField}
              right={
                <TouchableOpacity
                  onPress={applyPromo}
                  disabled={promoChecking || !promoInput.trim()}
                  accessibilityRole="button"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  {promoChecking ? (
                    <ActivityIndicator size="small" color={COLORS.midnight} />
                  ) : (
                    <Text
                      style={[styles.promoApply, !promoInput.trim() && { color: COLORS.faint }]}
                    >
                      Apply
                    </Text>
                  )}
                </TouchableOpacity>
              }
            />
          )}

          {/* Breakdown, folded away until asked for. */}
          <TouchableOpacity
            style={styles.breakdownToggle}
            onPress={() => setShowBreakdown((v) => !v)}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <Text style={styles.breakdownToggleText}>
              {showBreakdown ? 'Hide fare breakdown' : 'Fare breakdown'}
            </Text>
            <Ionicons
              name={showBreakdown ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={COLORS.midnight}
            />
          </TouchableOpacity>

          {showBreakdown ? (
            <View style={styles.breakdown}>
              <Row label="Base fare" value={money(fare.baseFare)} />
              <Row label={`Distance · ${fare.distanceInMiles} mi`} value={money(fare.distanceFare)} />
              <Row label={`Time · ${Math.ceil(duration)} min`} value={money(fare.timeFare)} />
              {fare.rideMultiplier !== 1 ? (
                <Row label={`${selectedOption.label} pricing`} value={`× ${fare.rideMultiplier}`} />
              ) : null}
              {fare.surgeMultiplier > 1 ? (
                <Row label="Busy-time pricing" value={`× ${fare.surgeMultiplier}`} tone={COLORS.amber} />
              ) : null}
              {promoApplied ? (
                <Row
                  label={`Promo ${promoCode}`}
                  value={`-${money(fare.discountAmount)}`}
                  tone={COLORS.success}
                />
              ) : null}
              <View style={styles.breakdownLine} />
              <Row label="Subtotal" value={money(fare.subtotal)} />
              <Row label={`VAT ${fare.vatPercent}%`} value={money(fare.vat)} />
              <View style={styles.breakdownLine} />
              <Row label="Total" value={money(fare.total)} strong />
            </View>
          ) : null}
        </ScrollView>

        <TouchableOpacity
          style={[styles.confirm, (loading || !routeCalculated) && { opacity: 0.5 }]}
          onPress={handleConfirmRide}
          disabled={loading || !routeCalculated}
          activeOpacity={0.9}
          accessibilityRole="button"
        >
          {loading ? (
            <ActivityIndicator color={COLORS.onPrimary} />
          ) : (
            <>
              <Text style={styles.confirmText}>
                {!routeCalculated
                  ? 'Working out your route…'
                  : bidding
                  ? `Offer for ${selectedOption.label}`
                  : `Book ${selectedOption.label}`}
              </Text>
              {routeCalculated ? (
                <Text style={styles.confirmPrice}>{money(bidding ? offerValue : fare.total)}</Text>
              ) : null}
            </>
          )}
        </TouchableOpacity>
      </Sheet>
    </SafeAreaView>
  );
}

function Row({ label, value, strong, tone }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, strong && styles.rowStrong, tone && { color: tone }]}>
        {label}
      </Text>
      <Text style={[styles.rowValue, strong && styles.rowStrong, tone && { color: tone }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.white },

  mapWrap: { flex: 1 },
  originMarker: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: COLORS.lime, borderWidth: 3, borderColor: COLORS.midnight,
  },
  topBar: {
    position: 'absolute', top: SPACE[3], left: SPACE[5], right: SPACE[5],
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  tripPill: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[3],
    backgroundColor: COLORS.white, height: 40,
    paddingHorizontal: SPACE[4], borderRadius: RADIUS.pill,
    ...SHADOW.float,
  },
  tripPillText: { fontSize: 13, fontWeight: '700', color: COLORS.midnight },
  pillDivider: { width: StyleSheet.hairlineWidth, height: 16, backgroundColor: COLORS.line },

  sheet: { maxHeight: '64%', paddingBottom: SPACE[6] },
  journey: { paddingBottom: SPACE[4], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.line },

  classRow: { gap: SPACE[3], paddingVertical: SPACE[4], paddingRight: SPACE[4] },
  classCard: {
    width: 118, padding: SPACE[3], borderRadius: RADIUS.lg,
    borderWidth: 2, borderColor: COLORS.white,
    backgroundColor: COLORS.white, gap: 2,
    ...SHADOW.card,
  },
  classCardActive: { borderColor: COLORS.midnight, backgroundColor: COLORS.limeSoft },
  classIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.fill,
    alignItems: 'center', justifyContent: 'center',
  },
  classIconActive: { backgroundColor: COLORS.midnight },
  className: { fontSize: 15, fontWeight: '700', color: COLORS.inkSoft, marginTop: SPACE[2] },
  classSeats: { ...TYPE.caption },
  classFare: { ...TYPE.figure, fontSize: 20, color: COLORS.inkSoft, marginTop: SPACE[1] },
  classDescription: { ...TYPE.small, marginBottom: SPACE[4] },

  payChoice: { marginBottom: SPACE[3] },
  options: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.line,
    paddingHorizontal: SPACE[4],
    marginBottom: SPACE[3],
  },
  optionRow: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingVertical: SPACE[3], gap: SPACE[3] },
  optionIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.fill,
    alignItems: 'center', justifyContent: 'center',
  },
  optionLabel: { flex: 1, fontSize: 16, fontWeight: '600', color: COLORS.ink, letterSpacing: -0.2 },

  stopRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE[3], marginTop: SPACE[3] },
  stopDot: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.midnight,
    alignItems: 'center', justifyContent: 'center',
  },
  stopDotText: { fontSize: 11, fontWeight: '800', color: COLORS.lime },
  stopText: { flex: 1, ...TYPE.small, color: COLORS.ink },
  addStop: { flexDirection: 'row', marginTop: SPACE[3] },
  stopMarker: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.midnight,
    borderWidth: 2, borderColor: COLORS.white, alignItems: 'center', justifyContent: 'center',
  },
  stopMarkerText: { fontSize: 11, fontWeight: '800', color: COLORS.lime },

  offerBox: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[3],
    padding: SPACE[4], marginBottom: SPACE[4],
    borderRadius: RADIUS.lg, backgroundColor: COLORS.limeSoft,
    borderWidth: 1, borderColor: COLORS.limeLine,
  },
  offerValue: { ...TYPE.figure, fontSize: 28, marginVertical: 2 },

  promoField: { marginBottom: SPACE[3] },
  promoApply: { fontSize: 14, fontWeight: '800', color: COLORS.midnight },
  promoApplied: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[3],
    paddingHorizontal: SPACE[4], minHeight: 54, marginBottom: SPACE[3],
    borderRadius: RADIUS.md, backgroundColor: COLORS.limeSoft,
    borderWidth: 1, borderColor: COLORS.limeLine,
  },
  promoAppliedText: { flex: 1, ...TYPE.callout, color: COLORS.success },
  promoRemove: { fontSize: 14, fontWeight: '700', color: COLORS.red },

  breakdownToggle: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[2],
    paddingVertical: SPACE[3],
  },
  breakdownToggleText: { fontSize: 14, fontWeight: '700', color: COLORS.midnight },
  breakdown: { paddingBottom: SPACE[4] },
  breakdownLine: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.line, marginVertical: SPACE[2] },

  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACE[1] },
  rowLabel: { ...TYPE.body, color: COLORS.inkSoft },
  rowValue: { ...TYPE.body, color: COLORS.ink },
  rowStrong: { fontWeight: '800', color: COLORS.midnight },

  confirm: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.pill,
    minHeight: 56, paddingHorizontal: SPACE[5],
    marginTop: SPACE[3],
  },
  confirmText: { fontSize: 16, fontWeight: '800', color: COLORS.onPrimary, letterSpacing: -0.2 },
  confirmPrice: { fontSize: 17, fontWeight: '800', color: COLORS.white, letterSpacing: -0.3 },
});
