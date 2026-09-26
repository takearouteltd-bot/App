// Passenger's end-of-trip screen: the amount paid, the journey, a rating for
// the driver, the receipt and the way back home.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { doc, onSnapshot, getDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { money } from '../../utils/appConfig';
import EmailReceiptButton from '../../components/EmailReceiptButton';
import StarRating from '../../components/StarRating';
import { COLORS, TYPE, SPACE, Screen, Card, Button, Loading, RouteLine } from '../../components/ui/kit';

export default function RiderRideCompletedScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { rideId } = route.params || {};

  const [ride, setRide] = useState(null);
  const [driver, setDriver] = useState(null);
  // Payment is confirmed by a Cloud Function after the driver completes. If
  // that takes a while, say so rather than leaving the screen looking stuck.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 45000);
    return () => clearTimeout(timer);
  }, []);

  const rise = useRef(new Animated.Value(24)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!rideId) return undefined;
    return onSnapshot(doc(db, 'rides', rideId), (snap) => snap.exists() && setRide(snap.data()));
  }, [rideId]);

  useEffect(() => {
    if (!ride?.driverId) return;
    getDoc(doc(db, 'drivers', ride.driverId)).then((s) => s.exists() && setDriver(s.data())).catch(() => {});
  }, [ride?.driverId]);

  // One entrance: the total settles into place. Nothing else moves.
  useEffect(() => {
    if (!ride) return;
    Animated.parallel([
      Animated.timing(rise, { toValue: 0, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
  }, [ride]);

  if (!ride) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  // paymentStatus is what the payment function writes; the nested payment
  // object is only kept up to date by the Stripe webhook.
  const paymentStatus = ride.paymentStatus || ride.payment?.status || 'pending';
  const isPaid = ['captured', 'authorized', 'paid', 'succeeded'].includes(paymentStatus);
  const isFailed = paymentStatus === 'failed';
  const isPending = !isPaid && !isFailed;
  const isCash = ride.paymentMethod === 'cash';

  const fare = ride.fare || {};
  const total = Number(fare.finalTotal ?? fare.total ?? ride.fareEstimate ?? 0);
  const currency = ride.currency || fare.currency;
  const distance = ride.route?.distanceKm ? `${ride.route.distanceKm} km` : null;
  const duration = ride.route?.durationMinutes ? `${Math.ceil(ride.route.durationMinutes)} min` : null;

  const lines = [
    ['Fare', fare.subtotal],
    fare.discountAmount > 0 ? ['Promo discount', -fare.discountAmount] : null,
    fare.vat !== undefined ? [`VAT (${fare.vatPercent || 20}%)`, fare.vat] : null,
    fare.waitingCharge > 0 ? ['Waiting time', fare.waitingCharge] : null,
  ].filter(Boolean);

  const driverName = driver?.fullName || driver?.firstName || 'your driver';

  return (
    <Screen>
      <Animated.View style={{ opacity: fade, transform: [{ translateY: rise }] }}>
        <Card tone="dark" style={styles.hero}>
          <Text style={styles.heroLabel}>
            {isCash || isPaid ? 'Trip complete' : isFailed ? 'Payment did not go through' : 'Finishing up'}
          </Text>
          <Text style={styles.heroAmount}>{money(total, currency)}</Text>
          <Text style={styles.heroSub}>
            {isCash
              ? ride.cashCollected
                ? 'Paid in cash'
                : `Please pay ${driverName} in cash`
              : isPaid
              ? `Charged to your card${ride.cardLast4 ? ` ending ${ride.cardLast4}` : ''}`
              : isFailed
              ? "Please contact support and we'll sort it out."
              : slow
              ? 'This is taking longer than usual. Your receipt is emailed once the payment goes through.'
              : 'Confirming your payment. You can book your next ride while we finish.'}
          </Text>
          {isPending && !isCash && !slow ? <View style={styles.pendingBar} /> : null}
          {ride.extraChargeFailed ? (
            <Text style={styles.heroNote}>Waiting charges could not be taken.</Text>
          ) : null}
        </Card>
      </Animated.View>

      {/* Journey */}
      <Card style={{ marginTop: SPACE[4] }}>
        <RouteLine pickup={ride.pickupLocation?.address || 'Pickup'} dropoff={ride.dropoffLocation?.address || 'Drop-off'} />
        {distance || duration ? (
          <Text style={[TYPE.small, { marginTop: SPACE[3] }]}>{[distance, duration].filter(Boolean).join(', ')}</Text>
        ) : null}
      </Card>

      {/* Breakdown */}
      {lines.length ? (
        <Card style={{ marginTop: SPACE[3] }}>
          {lines.map(([label, value]) => (
            <View key={label} style={styles.lineRow}>
              <Text style={TYPE.small}>{label}</Text>
              <Text style={[TYPE.callout, value < 0 && { color: COLORS.success }]}>
                {value < 0 ? '-' : ''}{money(Math.abs(Number(value) || 0), currency)}
              </Text>
            </View>
          ))}
          <View style={[styles.lineRow, styles.totalRow]}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{money(total, currency)}</Text>
          </View>
        </Card>
      ) : null}

      {/* Rating */}
      {ride.driverId ? (
        <Card style={{ marginTop: SPACE[3] }}>
          <StarRating rideId={rideId} who="rider" existing={ride.driverRating} prompt={`How was ${driverName}?`} />
        </Card>
      ) : null}

      <View style={{ marginTop: SPACE[5], gap: SPACE[3] }}>
        <EmailReceiptButton rideId={rideId} />
        {/* Never locked: payment finishes on the server whether or not the
            passenger waits here. It used to stay disabled until payment
            confirmed, which froze the app for good if it never did. */}
        <Button
          title="Book another ride"
          icon="arrow-forward"
          onPress={() => navigation.reset({ index: 0, routes: [{ name: 'HomeScreen' }] })}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { padding: SPACE[6], marginTop: SPACE[2], overflow: 'hidden' },
  heroLabel: { ...TYPE.label, color: COLORS.lime },
  heroAmount: { ...TYPE.display, color: COLORS.white, fontSize: 48, letterSpacing: -1.6, marginTop: SPACE[2] },
  heroSub: { ...TYPE.small, color: COLORS.onDark, marginTop: SPACE[2] },
  heroNote: { ...TYPE.caption, color: COLORS.amberSoft, marginTop: SPACE[3] },
  pendingBar: { height: 4, borderRadius: 2, backgroundColor: COLORS.lime, opacity: 0.8, marginTop: SPACE[5], width: '40%' },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACE[2] },
  totalRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line, marginTop: SPACE[2], paddingTop: SPACE[3] },
  totalLabel: { ...TYPE.subhead, color: COLORS.midnight },
  totalValue: { ...TYPE.figure, fontSize: 20 },
});
