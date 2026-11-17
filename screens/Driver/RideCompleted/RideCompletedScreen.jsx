// Driver's end-of-trip screen: what they earned, the journey, a rating for
// the passenger, and back to the road.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, useNavigation } from '@react-navigation/native';
import { doc, onSnapshot, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { money } from '../../../utils/appConfig';
import StarRating from '../../../components/StarRating';
import { COLORS, TYPE, SPACE, SHADOW, Banner, Card, Button, Loading, RouteLine, StatRow } from '../../../components/ui/kit';
import { distanceText } from '../../../utils/routes';
import { useNextJob } from '../../../utils/followOn';
import { acceptedChanges, extraMiles } from '../../../utils/destinationChange';

export default function RideCompletedScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { rideId } = route.params || {};

  const [ride, setRide] = useState(null);
  const [rider, setRider] = useState(null);
  // A follow-on job accepted during this trip: it starts now.
  const nextJob = useNextJob(ride?.driverId, rideId, true);
  const rise = useRef(new Animated.Value(24)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!rideId) return undefined;
    return onSnapshot(doc(db, 'rides', rideId), (snap) => snap.exists() && setRide(snap.data()));
  }, [rideId]);

  useEffect(() => {
    if (!ride?.riderId) return;
    getDoc(doc(db, 'riderPublic', ride.riderId)).then((s) => s.exists() && setRider(s.data())).catch(() => {});
  }, [ride?.riderId]);

  useEffect(() => {
    if (!ride) return;
    Animated.parallel([
      Animated.timing(rise, { toValue: 0, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
  }, [ride]);

  if (!ride) {
    return (
      <SafeAreaView style={styles.safe}>
        <Loading />
      </SafeAreaView>
    );
  }

  const fare = ride.fare || {};
  const currency = ride.currency || fare.currency;
  // finalTotal (fare plus waiting) is written by the payment function a
  // moment after completion; the estimate shows until then.
  const earned = Number(fare.finalTotal ?? fare.total ?? ride.fareEstimate ?? 0);
  const settled = fare.finalTotal !== undefined;
  const distance = ride.route?.distanceKm ? distanceText(ride.route.distanceKm) : null;
  const duration = ride.route?.durationMinutes ? `${Math.ceil(ride.route.durationMinutes)} min` : null;

  const show = (v) => money(Number(v) || 0, currency);
  const lines = [
    fare.baseFare !== undefined ? [fare.pricing === 'first_mile' ? 'First mile' : 'Base fare', show(fare.baseFare)] : null,
    fare.distanceFare !== undefined ? [fare.pricing === 'first_mile' ? 'Miles after the first' : 'Distance', show(fare.distanceFare)] : null,
    fare.timeFare !== undefined && !(fare.pricing === 'first_mile' && !(fare.timeFare > 0)) ? ['Time', show(fare.timeFare)] : null,
    fare.surgeMultiplier > 1 ? ['Busy-time pricing', `×${fare.surgeMultiplier}`] : null,
    fare.stopCharge > 0 ? [`Stops (${Number(fare.stops) || 0})`, show(fare.stopCharge)] : null,
    fare.discountAmount > 0 ? ['Promo discount', `-${show(fare.discountAmount)}`] : null,
    fare.vat > 0 ? [`VAT (${fare.vatPercent}%)`, show(fare.vat)] : null,
    fare.fullTotal > fare.total ? ['Full journey', show(fare.fullTotal)] : null,
    fare.fullTotal > fare.total ? ['Ended early, fare so far', show(fare.total)] : null,
    fare.waitingCharge > 0 ? ['Waiting time', show(fare.waitingCharge)] : null,
    // Went past the drop-off, or the passenger changed where they were going
    // (functions/destinationChange.js).
    ride.extendedTrip ? ['Extended trip', `${extraMiles(ride.extendedTrip.extraKm)} mi past the drop-off`] : null,
    acceptedChanges(ride).length ? ['Destination changed', `from ${String(ride.originalDropoffLocation?.address || 'the booking').split(',')[0]}`] : null,
    fare.cashExtra > 0 ? ['Paid by card', show(fare.cardTotal)] : null,
    fare.cashExtra > 0 ? ['Paid to you in cash', show(fare.cashExtra)] : null,
  ].filter(Boolean);

  // Cash to collect that the driver may not have been asked for before they
  // completed: an extended cash trip is priced once it ends, and a card that
  // didn't cover a raised fare leaves the rest in cash.
  const inCash = ride.paymentMethod === 'cash' && !['account', 'card', 'online'].includes(ride.collectBy);
  const collect = ride.extendedTrip && inCash
    ? earned
    : Number(fare.cashExtra || ride.cashExtraDue) || 0;

  const riderName = ride.passengerFor?.name || rider?.fullName || rider?.firstName || ride.customer?.name || 'the passenger';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Animated.View style={{ opacity: fade, transform: [{ translateY: rise }] }}>
          <Card tone="dark" style={styles.hero}>
            <View style={styles.heroBadge}>
              <Ionicons name="checkmark" size={22} color={COLORS.midnight} />
            </View>
            <Text style={styles.heroLabel}>Trip complete</Text>
            <Text style={styles.heroAmount}>{money(earned, currency)}</Text>
            <Text style={styles.heroSub}>
              {ride.paymentStatus === 'no_charge'
                ? 'The passenger had nothing to pay on this trip, so nothing was earned.'
                : ride.collectBy === 'account'
                ? `On ${ride.account?.company || 'the client'}'s account. Your fleet pays you.`
                : ride.collectBy === 'online'
                ? 'Paid online by the customer. Your fleet pays you.'
                : ride.collectBy === 'card'
                ? 'Paid on your card terminal'
                : ride.paymentMethod === 'cash'
                ? 'Paid to you in cash by the passenger'
                : ride.walletProcessed === true
                ? 'Added to your wallet'
                : settled
                ? 'Being added to your wallet'
                : 'Final amount confirming, including any waiting time'}
            </Text>
          </Card>
        </Animated.View>

        {collect > 0 && (ride.extendedTrip || !ride.cashCollected) ? (
          <View style={{ marginTop: SPACE[4] }}>
            <Banner
              tone="warning"
              title={`Collect ${money(collect, currency)} in cash`}
              body={
                ride.extendedTrip && inCash
                  ? `Extended trip: the passenger went past the drop-off, so the fare is now ${money(collect, currency)} (was ${money(ride.extendedTrip.previousFare, currency)}).`
                  : "The passenger's card didn't cover the new price. Take the rest in cash."
              }
            />
          </View>
        ) : null}

        <Card style={{ marginTop: SPACE[4] }}>
          <RouteLine
            compact
            pickup={ride.pickupLocation?.address || 'Pickup'}
            dropoff={ride.dropoffLocation?.address || 'Drop-off'}
          />
          {distance || duration ? (
            <StatRow
              style={styles.stats}
              items={[
                distance ? { value: distance, label: 'Distance' } : null,
                duration ? { value: duration, label: 'Duration' } : null,
              ]}
            />
          ) : null}
        </Card>

        {lines.length ? (
          <Card style={{ marginTop: SPACE[3] }}>
            {lines.map(([label, value]) => (
              <View key={label} style={styles.lineRow}>
                <Text style={[TYPE.body, { color: COLORS.inkSoft }]}>{label}</Text>
                <Text style={TYPE.callout}>{value}</Text>
              </View>
            ))}
            <View style={[styles.lineRow, styles.totalRow]}>
              <Text style={styles.totalLabel}>{fare.vat > 0 ? 'Fare (incl. VAT)' : 'Fare'}</Text>
              <Text style={styles.totalLabel}>{money(earned, currency)}</Text>
            </View>
          </Card>
        ) : null}

        {ride.riderId ? (
          <Card style={{ marginTop: SPACE[3] }}>
            <StarRating rideId={rideId} who="driver" existing={ride.riderRating} prompt={`How was ${riderName}?`} />
          </Card>
        ) : null}

        {nextJob ? (
          <Button
            title={`Go to next pickup: ${String(nextJob.pickupLocation?.address || '').split(',')[0] || 'next job'}`}
            icon="arrow-redo"
            variant="accent"
            style={{ marginTop: SPACE[5] }}
            onPress={() => {
              // The server does this too when the trip ends; whichever is first.
              setDoc(
                doc(db, 'drivers', ride.driverId),
                { isOnRide: true, currentRideId: nextJob.id, status: 'on_ride' },
                { merge: true }
              ).catch(() => {});
              navigation.reset({ index: 0, routes: [{ name: 'DriverRideInProgress', params: { rideId: nextJob.id } }] });
            }}
          />
        ) : (
          <Button
            title="Ready for the next trip"
            icon="arrow-forward"
            style={{ marginTop: SPACE[5] }}
            onPress={() => navigation.reset({ index: 0, routes: [{ name: 'DriverHome' }] })}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.surface },
  content: { padding: SPACE[5], paddingBottom: SPACE[10] },
  hero: { marginTop: SPACE[2], padding: SPACE[6], ...SHADOW.float },
  heroBadge: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.lime,
    alignItems: 'center', justifyContent: 'center', marginBottom: SPACE[4],
  },
  heroLabel: { ...TYPE.label, color: COLORS.lime },
  heroAmount: { ...TYPE.display, fontSize: 48, color: COLORS.white, marginTop: SPACE[2] },
  heroSub: { ...TYPE.small, color: COLORS.onDark, marginTop: SPACE[2] },
  stats: {
    marginTop: SPACE[4], paddingTop: SPACE[4],
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
  },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACE[2] },
  totalRow: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
    marginTop: SPACE[2], paddingTop: SPACE[3],
  },
  totalLabel: { ...TYPE.subhead, fontSize: 17, fontWeight: '800', color: COLORS.midnight },
});
