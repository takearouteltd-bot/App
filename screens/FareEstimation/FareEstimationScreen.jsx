import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  ScrollView,
  TextInput,
} from 'react-native';
import { Alert } from '../../components/ui/alert';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import MapViewDirections from 'react-native-maps-directions';
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
  getDocs,
  setDoc,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useAppConfig, currencySymbol, surgeMultiplier, cashEnabled } from '../../utils/appConfig';
import {
  COLORS,
  TYPE,
  SPACE,
  RADIUS,
  SHADOW,
  IconButton,
  RouteLine,
  MapUnavailable,
  isCoord,
  regionCovering,
} from '../../components/ui/kit';

const GOOGLE_MAPS_API_KEY = 'AIzaSyBtmcvJE-m_v44Z2lLDm8wDgI6GGYLXimQ';

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
  const mapRef = useRef(null);
  const auth = getAuth();
  const currentUser = auth.currentUser;

  const appConfig = useAppConfig();
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

    // Cash rides need no card; card rides need one on file for the hold.
    if (paymentMethod === 'card') try {
      const cardsSnap = await getDocs(collection(db, 'riders', currentUser.uid, 'cards'));
      if (cardsSnap.empty) {
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
      const fareDetails = calculateFareDetails(selectedOption.multiplier);

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
              <Ionicons name="location" size={30} color={COLORS.navy} />
            </Marker>
          ) : null}

          {isCoord(origin) && isCoord(destination) ? (
          <MapViewDirections
            origin={origin}
            destination={destination}
            apikey={GOOGLE_MAPS_API_KEY}
            strokeWidth={4}
            strokeColor={COLORS.green}
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

      <View style={styles.sheet}>
        <View style={styles.grabber} />

        <View style={styles.journey}>
          <RouteLine
            compact
            pickup={origin.address}
            dropoff={destination.description || destination.address}
          />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
          {fare.surgeMultiplier > 1 ? (
            <View style={styles.surge}>
              <Ionicons name="flash" size={16} color={COLORS.amber} />
              <Text style={styles.surgeText}>
                Busy right now, so fares are {fare.surgeMultiplier}× the usual price.
              </Text>
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
                  <MaterialCommunityIcons
                    name={item.icon}
                    size={26}
                    color={active ? COLORS.green : COLORS.muted}
                  />
                  <Text style={[styles.className, active && { color: COLORS.navy }]}>
                    {item.label}
                  </Text>
                  <Text style={styles.classSeats}>{item.passengers} seats</Text>
                  <Text style={[styles.classFare, active && { color: COLORS.navy }]}>
                    {routeCalculated ? money(itemFare.total) : '—'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={styles.classDescription}>{selectedOption.description}</Text>

          {/* Payment. Cash appears only when the dashboard allows it. */}
          {allowCash ? (
            <View style={styles.payChoice}>
              {['card', 'cash'].map((method) => {
                const on = paymentMethod === method;
                return (
                  <TouchableOpacity
                    key={method}
                    style={[styles.payOption, on && styles.payOptionOn]}
                    onPress={() => setPaymentMethod(method)}
                    activeOpacity={0.85}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <Ionicons
                      name={method === 'card' ? 'card-outline' : 'cash-outline'}
                      size={18}
                      color={on ? COLORS.navy : COLORS.muted}
                    />
                    <Text style={[styles.payOptionText, on && { color: COLORS.navy }]}>
                      {method === 'card' ? 'Card' : 'Cash'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          {paymentMethod === 'cash' ? (
            <View style={styles.payRow}>
              <Ionicons name="cash-outline" size={20} color={COLORS.navy} />
              <Text style={[styles.payLabel, { flex: 1 }]}>Pay your driver in cash at the end</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.payRow}
              onPress={() => navigation.navigate('AddPayment')}
              activeOpacity={0.7}
            >
              <Ionicons name="card-outline" size={20} color={COLORS.navy} />
              <View style={{ flex: 1 }}>
                <Text style={styles.payLabel}>
                  {defaultCard
                    ? `${(defaultCard.brand || 'Card').toUpperCase()} ···· ${defaultCard.last4}`
                    : 'No card added'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.lineStrong} />
            </TouchableOpacity>
          )}

          {/* Promo */}
          {promoApplied ? (
            <View style={styles.promoRow}>
              <Ionicons name="pricetag" size={18} color={COLORS.green} />
              <Text style={styles.promoApplied}>
                {promoCode} · {Math.round(discount * 100)}% off
              </Text>
              <TouchableOpacity onPress={removePromo}>
                <Text style={styles.promoRemove}>Remove</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.promoRow}>
              <Ionicons name="pricetag-outline" size={18} color={COLORS.muted} />
              <TextInput
                style={styles.promoInput}
                placeholder="Promo code"
                placeholderTextColor={COLORS.faint}
                autoCapitalize="characters"
                autoCorrect={false}
                value={promoInput}
                onChangeText={setPromoInput}
                onSubmitEditing={applyPromo}
                returnKeyType="done"
              />
              <TouchableOpacity onPress={applyPromo} disabled={promoChecking || !promoInput.trim()}>
                {promoChecking ? (
                  <ActivityIndicator size="small" color={COLORS.green} />
                ) : (
                  <Text
                    style={[styles.promoApply, !promoInput.trim() && { color: COLORS.faint }]}
                  >
                    Apply
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Breakdown, folded away until asked for. */}
          <TouchableOpacity
            style={styles.breakdownToggle}
            onPress={() => setShowBreakdown((v) => !v)}
            activeOpacity={0.7}
          >
            <Text style={styles.breakdownToggleText}>
              {showBreakdown ? 'Hide fare breakdown' : 'Fare breakdown'}
            </Text>
            <Ionicons
              name={showBreakdown ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={COLORS.blue}
            />
          </TouchableOpacity>

          {showBreakdown ? (
            <View style={styles.breakdown}>
              <Row label="Base fare" value={money(fare.baseFare)} />
              <Row label={`Distance · ${fare.distanceInMiles} mi`} value={money(fare.distanceFare)} />
              <Row label={`Time · ${Math.ceil(duration)} min`} value={money(fare.timeFare)} />
              {fare.surgeMultiplier > 1 ? (
                <Row label="Busy-time pricing" value={`× ${fare.surgeMultiplier}`} tone={COLORS.amber} />
              ) : null}
              {promoApplied ? (
                <Row
                  label={`Promo ${promoCode}`}
                  value={`-${money(fare.discountAmount)}`}
                  tone={COLORS.green}
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
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <>
              <Text style={styles.confirmText}>
                {routeCalculated ? `Book ${selectedOption.label}` : 'Working out your route…'}
              </Text>
              {routeCalculated ? (
                <Text style={styles.confirmPrice}>{money(fare.total)}</Text>
              ) : null}
            </>
          )}
        </TouchableOpacity>
      </View>
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
    backgroundColor: COLORS.green, borderWidth: 3, borderColor: COLORS.white,
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
  tripPillText: { fontSize: 13, fontWeight: '700', color: COLORS.navy },
  pillDivider: { width: StyleSheet.hairlineWidth, height: 16, backgroundColor: COLORS.line },

  sheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SPACE[5],
    paddingTop: SPACE[3],
    paddingBottom: SPACE[6],
    maxHeight: '62%',
    ...SHADOW.sheet,
  },
  grabber: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.line,
    alignSelf: 'center', marginBottom: SPACE[4],
  },
  journey: { paddingBottom: SPACE[4], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.line },

  classRow: { gap: SPACE[3], paddingVertical: SPACE[4], paddingRight: SPACE[4] },
  classCard: {
    width: 108, padding: SPACE[3], borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.line,
    backgroundColor: COLORS.white, gap: 2,
  },
  classCardActive: { borderColor: COLORS.green, borderWidth: 1.5, backgroundColor: COLORS.greenSoft },
  className: { fontSize: 15, fontWeight: '700', color: COLORS.inkSoft, marginTop: SPACE[2] },
  classSeats: { ...TYPE.caption },
  classFare: { fontSize: 17, fontWeight: '800', color: COLORS.inkSoft, marginTop: SPACE[1], letterSpacing: -0.3 },
  classDescription: { ...TYPE.small, marginBottom: SPACE[4] },

  payRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[3],
    paddingVertical: SPACE[3],
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
  },
  payLabel: { ...TYPE.callout },
  payChoice: { flexDirection: 'row', gap: SPACE[3], paddingTop: SPACE[3] },
  payOption: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE[2],
    height: 44, borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.line,
  },
  payOptionOn: { borderColor: COLORS.green, borderWidth: 1.5, backgroundColor: COLORS.greenSoft },
  payOptionText: { fontSize: 15, fontWeight: '700', color: COLORS.muted },

  surge: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[2],
    backgroundColor: COLORS.amberSoft, borderRadius: RADIUS.sm,
    paddingHorizontal: SPACE[3], paddingVertical: SPACE[2], marginTop: SPACE[3],
  },
  surgeText: { ...TYPE.small, color: COLORS.amber, fontWeight: '600', flex: 1 },

  promoRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[3],
    paddingVertical: SPACE[3],
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
  },
  promoInput: { flex: 1, fontSize: 15, color: COLORS.ink, paddingVertical: 0 },
  promoApplied: { flex: 1, ...TYPE.callout, color: COLORS.success },
  promoApply: { fontSize: 14, fontWeight: '700', color: COLORS.blue },
  promoRemove: { fontSize: 14, fontWeight: '700', color: COLORS.red },

  breakdownToggle: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[2],
    paddingVertical: SPACE[4],
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
  },
  breakdownToggleText: { fontSize: 14, fontWeight: '700', color: COLORS.blue },
  breakdown: { paddingBottom: SPACE[4] },
  breakdownLine: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.line, marginVertical: SPACE[2] },

  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACE[1] },
  rowLabel: { ...TYPE.body, color: COLORS.inkSoft },
  rowValue: { ...TYPE.body, color: COLORS.ink },
  rowStrong: { fontWeight: '800', color: COLORS.navy },

  confirm: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.green,
    borderRadius: RADIUS.md,
    minHeight: 56, paddingHorizontal: SPACE[5],
    marginTop: SPACE[4],
  },
  confirmText: { fontSize: 16, fontWeight: '700', color: COLORS.white, letterSpacing: -0.2 },
  confirmPrice: { fontSize: 17, fontWeight: '800', color: COLORS.white, letterSpacing: -0.3 },
});
