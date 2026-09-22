// Passenger's end-of-trip screen: the amount paid, the journey, a rating for
// the driver, the receipt and the way back home.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, Animated, Easing } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { doc, onSnapshot, getDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { money } from '../../utils/appConfig';
import EmailReceiptButton from '../../components/EmailReceiptButton';
import StarRating from '../../components/StarRating';
import { COLORS, TYPE, Card, Button, Loading } from '../../components/ui/kit';

export default function RiderRideCompletedScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { rideId } = route.params || {};

  const [ride, setRide] = useState(null);
  const [driver, setDriver] = useState(null);
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
      <SafeAreaView style={styles.safe}>
        <Loading />
      </SafeAreaView>
    );
  }

  const paymentStatus = ride.payment?.status || ride.paymentStatus || 'pending';
  const isPaid = ['captured', 'authorized', 'paid', 'succeeded'].includes(paymentStatus);
  const isFailed = paymentStatus === 'failed';
  const isPending = !isPaid && !isFailed;

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
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Animated.View style={[styles.hero, { opacity: fade, transform: [{ translateY: rise }] }]}>
          <Text style={styles.heroLabel}>
            {isPaid ? 'Trip complete' : isFailed ? 'Payment did not go through' : 'Finishing up'}
          </Text>
          <Text style={styles.heroAmount}>{money(total, currency)}</Text>
          <Text style={styles.heroSub}>
            {isPaid
              ? `Charged to your card${ride.cardLast4 ? ` ending ${ride.cardLast4}` : ''}`
              : isFailed
              ? 'Update your card in Profile, Payment, then we will try again'
              : 'Confirming your payment, this takes a moment'}
          </Text>
          {isPending ? <View style={styles.pendingBar} /> : null}
        </Animated.View>

        {/* Journey */}
        <Card style={{ marginTop: 16 }}>
          <View style={styles.route}>
            <View style={styles.rail}>
              <View style={[styles.dot, { backgroundColor: COLORS.green }]} />
              <View style={styles.line} />
              <View style={[styles.dot, styles.square]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.place} numberOfLines={2}>{ride.pickupLocation?.address || 'Pickup'}</Text>
              <View style={{ height: 16 }} />
              <Text style={styles.place} numberOfLines={2}>{ride.dropoffLocation?.address || 'Drop-off'}</Text>
            </View>
          </View>
          {distance || duration ? (
            <Text style={[TYPE.small, { marginTop: 14 }]}>{[distance, duration].filter(Boolean).join(', ')}</Text>
          ) : null}
        </Card>

        {/* Breakdown */}
        {lines.length ? (
          <Card style={{ marginTop: 12 }}>
            {lines.map(([label, value]) => (
              <View key={label} style={styles.lineRow}>
                <Text style={TYPE.body}>{label}</Text>
                <Text style={[TYPE.body, value < 0 && { color: COLORS.success }]}>
                  {value < 0 ? '-' : ''}{money(Math.abs(Number(value) || 0), currency)}
                </Text>
              </View>
            ))}
            <View style={[styles.lineRow, styles.totalRow]}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalLabel}>{money(total, currency)}</Text>
            </View>
          </Card>
        ) : null}

        {/* Rating */}
        {ride.driverId ? (
          <Card style={{ marginTop: 12 }}>
            <StarRating rideId={rideId} who="rider" existing={ride.driverRating} prompt={`How was ${driverName}?`} />
          </Card>
        ) : null}

        <View style={{ marginTop: 20, gap: 10 }}>
          <EmailReceiptButton rideId={rideId} />
          <Button
            title="Book another ride"
            icon="arrow-forward"
            disabled={isPending}
            onPress={() => navigation.reset({ index: 0, routes: [{ name: 'HomeScreen' }] })}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.surface },
  content: { padding: 20, paddingBottom: 40 },
  hero: { backgroundColor: COLORS.navy, borderRadius: 24, padding: 26, marginTop: 8, overflow: 'hidden' },
  heroLabel: { fontSize: 15, fontWeight: '600', color: COLORS.onDark },
  heroAmount: { fontSize: 48, fontWeight: '800', color: COLORS.white, letterSpacing: -1.5, marginTop: 6 },
  heroSub: { fontSize: 13, color: COLORS.onDark, marginTop: 6, lineHeight: 18 },
  pendingBar: { height: 3, borderRadius: 2, backgroundColor: COLORS.green, opacity: 0.7, marginTop: 18, width: '40%' },
  route: { flexDirection: 'row', gap: 12 },
  rail: { alignItems: 'center', paddingTop: 5 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.navy },
  square: { borderRadius: 2 },
  line: { width: 2, flex: 1, minHeight: 20, backgroundColor: COLORS.line, marginVertical: 3 },
  place: { fontSize: 15, fontWeight: '600', color: COLORS.ink, lineHeight: 20 },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  totalRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line, marginTop: 6, paddingTop: 12 },
  totalLabel: { fontSize: 17, fontWeight: '800', color: COLORS.navy },
});
