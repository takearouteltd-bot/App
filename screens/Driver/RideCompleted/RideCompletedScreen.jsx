// Driver's end-of-trip screen: what they earned, the journey, a rating for
// the passenger, and back to the road.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, Animated, Easing } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { doc, onSnapshot, getDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { money } from '../../../utils/appConfig';
import StarRating from '../../../components/StarRating';
import { COLORS, TYPE, Card, Button, Loading } from '../../../components/ui/kit';

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

  const lines = [
    ['Base fare', fare.baseFare],
    ['Distance', fare.distanceFare],
    ['Time', fare.timeFare],
    fare.waitingCharge > 0 ? ['Waiting time', fare.waitingCharge] : null,
  ].filter((l) => l && l[1] !== undefined);

  const riderName = rider?.fullName || rider?.firstName || 'the passenger';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Animated.View style={[styles.hero, { opacity: fade, transform: [{ translateY: rise }] }]}>
          <Text style={styles.heroLabel}>Trip complete</Text>
          <Text style={styles.heroAmount}>{money(earned, currency)}</Text>
          <Text style={styles.heroSub}>
            {settled ? 'Added to your wallet' : 'Final amount confirming, including any waiting time'}
          </Text>
        </Animated.View>

        <Card style={{ marginTop: 16 }}>
          <View style={styles.route}>
            <View style={styles.rail}>
              <View style={[styles.dot, { backgroundColor: COLORS.lime }]} />
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

        {lines.length ? (
          <Card style={{ marginTop: 12 }}>
            {lines.map(([label, value]) => (
              <View key={label} style={styles.lineRow}>
                <Text style={TYPE.body}>{label}</Text>
                <Text style={TYPE.body}>{money(Number(value) || 0, currency)}</Text>
              </View>
            ))}
            <View style={[styles.lineRow, styles.totalRow]}>
              <Text style={styles.totalLabel}>You earned</Text>
              <Text style={styles.totalLabel}>{money(earned, currency)}</Text>
            </View>
          </Card>
        ) : null}

        {ride.riderId ? (
          <Card style={{ marginTop: 12 }}>
            <StarRating rideId={rideId} who="driver" existing={ride.riderRating} prompt={`How was ${riderName}?`} />
          </Card>
        ) : null}

        <Button
          title="Ready for the next trip"
          icon="arrow-forward"
          style={{ marginTop: 20 }}
          onPress={() => navigation.reset({ index: 0, routes: [{ name: 'DriverHome' }] })}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.surface },
  content: { padding: 20, paddingBottom: 40 },
  hero: { backgroundColor: COLORS.navy, borderRadius: 24, padding: 26, marginTop: 8 },
  heroLabel: { fontSize: 15, fontWeight: '600', color: COLORS.onDark },
  heroAmount: { fontSize: 48, fontWeight: '800', color: COLORS.white, letterSpacing: -1.5, marginTop: 6 },
  heroSub: { fontSize: 13, color: COLORS.onDark, marginTop: 6, lineHeight: 18 },
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
