// Driver's end-of-trip screen: what they earned, the journey, a rating for
// the passenger, and back to the road.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, useNavigation } from '@react-navigation/native';
import { doc, onSnapshot, getDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { money } from '../../../utils/appConfig';
import StarRating from '../../../components/StarRating';
import { COLORS, TYPE, SPACE, SHADOW, Card, Button, Loading, RouteLine, StatRow } from '../../../components/ui/kit';

export default function RideCompletedScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { rideId } = route.params || {};

  const [ride, setRide] = useState(null);
  const [rider, setRider] = useState(null);
  const rise = useRef(new Animated.Value(24)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!rideId) return undefined;
    return onSnapshot(doc(db, 'rides', rideId), (snap) => snap.exists() && setRide(snap.data()));
  }, [rideId]);

  useEffect(() => {
    if (!ride?.riderId) return;
    getDoc(doc(db, 'riders', ride.riderId)).then((s) => s.exists() && setRider(s.data())).catch(() => {});
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
  const distance = ride.route?.distanceKm ? `${ride.route.distanceKm} km` : null;
  const duration = ride.route?.durationMinutes ? `${Math.ceil(ride.route.durationMinutes)} min` : null;

  const show = (v) => money(Number(v) || 0, currency);
  const lines = [
    fare.baseFare !== undefined ? ['Base fare', show(fare.baseFare)] : null,
    fare.distanceFare !== undefined ? ['Distance', show(fare.distanceFare)] : null,
    fare.timeFare !== undefined ? ['Time', show(fare.timeFare)] : null,
    fare.surgeMultiplier > 1 ? ['Busy-time pricing', `×${fare.surgeMultiplier}`] : null,
    fare.discountAmount > 0 ? ['Promo discount', `-${show(fare.discountAmount)}`] : null,
    fare.vat !== undefined ? [`VAT (${fare.vatPercent || 20}%)`, show(fare.vat)] : null,
    fare.waitingCharge > 0 ? ['Waiting time', show(fare.waitingCharge)] : null,
  ].filter(Boolean);

  const riderName = rider?.fullName || rider?.firstName || 'the passenger';

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
              {settled ? 'Added to your wallet' : 'Final amount confirming, including any waiting time'}
            </Text>
          </Card>
        </Animated.View>

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
              <Text style={styles.totalLabel}>Fare (incl. VAT)</Text>
              <Text style={styles.totalLabel}>{money(earned, currency)}</Text>
            </View>
          </Card>
        ) : null}

        {ride.riderId ? (
          <Card style={{ marginTop: SPACE[3] }}>
            <StarRating rideId={rideId} who="driver" existing={ride.riderRating} prompt={`How was ${riderName}?`} />
          </Card>
        ) : null}

        <Button
          title="Ready for the next trip"
          icon="arrow-forward"
          style={{ marginTop: SPACE[5] }}
          onPress={() => navigation.reset({ index: 0, routes: [{ name: 'DriverHome' }] })}
        />
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
