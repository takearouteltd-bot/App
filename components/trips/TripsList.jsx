// Shared trip history for passengers and drivers (their Trips tab).
// Replaces two near-identical screens. Defaults to "All" so the list is never
// empty just because there was no trip today.
import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView, View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { auth, db } from '../../config/firebase';
import { money } from '../../utils/appConfig';
import { COLORS, TYPE, SPACE, RADIUS, ScreenHeader, EmptyState, Loading, Chip } from '../ui/kit';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
];

function tripDate(trip) {
  const ts = trip.timestamps?.createdAt || trip.createdAt;
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  if (ts.seconds) return new Date(ts.seconds * 1000);
  return new Date(ts);
}

function whenLabel(date) {
  if (!date) return '';
  const now = new Date();
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return `Today, ${time}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (date.toDateString() === y.toDateString()) return `Yesterday, ${time}`;
  return `${date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}

const STATUS = {
  completed: { label: 'Completed', fg: COLORS.success, bg: COLORS.greenSoft },
  cancelled: { label: 'Cancelled', fg: COLORS.red, bg: COLORS.redSoft },
  canceled: { label: 'Cancelled', fg: COLORS.red, bg: COLORS.redSoft },
  ongoing: { label: 'On the way', fg: COLORS.blue, bg: COLORS.blueSoft },
  accepted: { label: 'Driver assigned', fg: COLORS.blue, bg: COLORS.blueSoft },
  arrived: { label: 'Driver arrived', fg: COLORS.blue, bg: COLORS.blueSoft },
  searching: { label: 'Finding driver', fg: COLORS.amber, bg: COLORS.amberSoft },
};

function TripRow({ trip, role, onPress }) {
  const s = STATUS[trip.status] || { label: trip.status || 'Unknown', fg: COLORS.muted, bg: COLORS.surface };
  const cancelled = trip.status === 'cancelled' || trip.status === 'canceled';
  const amount = trip.fare?.finalTotal ?? trip.fare?.total ?? trip.fareEstimate ?? 0;
  return (
    <TouchableOpacity activeOpacity={0.8} onPress={onPress} style={styles.card}>
      <View style={styles.top}>
        <Text style={TYPE.small}>{whenLabel(tripDate(trip))}</Text>
        <View style={[styles.pill, { backgroundColor: s.bg }]}>
          <Text style={[styles.pillText, { color: s.fg }]}>{s.label}</Text>
        </View>
      </View>

      {/* Route: pickup dot, line, drop-off square */}
      <View style={styles.route}>
        <View style={styles.rail}>
          <View style={[styles.dot, { backgroundColor: COLORS.green }]} />
          <View style={styles.line} />
          <View style={[styles.dot, styles.square, { backgroundColor: COLORS.navy }]} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.place} numberOfLines={1}>{trip.pickupLocation?.address || 'Pickup'}</Text>
          <View style={{ height: 14 }} />
          <Text style={styles.place} numberOfLines={1}>{trip.dropoffLocation?.address || 'Drop-off'}</Text>
        </View>
      </View>

      <View style={styles.bottom}>
        <Text style={TYPE.small}>
          {trip.route?.distanceKm ? `${trip.route.distanceKm} km` : ''}
          {trip.route?.durationMinutes ? `, ${Math.ceil(trip.route.durationMinutes)} min` : ''}
        </Text>
        <Text style={[styles.amount, cancelled && { color: COLORS.muted, textDecorationLine: 'line-through' }]}>
          {role === 'driver' && !cancelled ? '+' : ''}
          {money(amount, trip.currency || trip.fare?.currency)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function TripsList({ role = 'rider' }) {
  const navigation = useNavigation();
  const [trips, setTrips] = useState(null);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState(null);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setTrips([]);
      return undefined;
    }
    const q = query(
      collection(db, 'rides'),
      where(role === 'driver' ? 'driverId' : 'riderId', '==', uid),
      orderBy('timestamps.createdAt', 'desc')
    );
    return onSnapshot(
      q,
      (snap) => {
        setTrips(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setError(null);
      },
      (err) => {
        console.log('Trips load error:', err);
        setError(err?.message?.includes('index') ? 'index' : 'load');
        setTrips([]);
      }
    );
  }, [role]);

  const visible = useMemo(() => {
    if (!trips) return [];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7)); // Monday
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const from = filter === 'week' ? weekStart : filter === 'month' ? monthStart : null;
    return from ? trips.filter((t) => (tripDate(t) || 0) >= from) : trips;
  }, [trips, filter]);

  const completed = visible.filter((t) => t.status === 'completed');
  const total = completed.reduce((sum, t) => sum + Number(t.fare?.finalTotal ?? t.fare?.total ?? 0), 0);

  const open = (trip) => navigation.navigate(role === 'driver' ? 'DriverTripDetails' : 'RiderTripDetails', { trip });

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={visible}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.content}
        renderItem={({ item }) => <TripRow trip={item} role={role} onPress={() => open(item)} />}
        ListHeaderComponent={
          <View style={{ marginBottom: 16 }}>
            <ScreenHeader title="Your trips" />
            <View style={styles.filters}>
              {FILTERS.map((f) => (
                <Chip
                  key={f.key}
                  label={f.label}
                  active={filter === f.key}
                  onPress={() => setFilter(f.key)}
                />
              ))}
            </View>
            {completed.length ? (
              <Text style={[TYPE.small, { marginTop: 12 }]}>
                {completed.length} completed {completed.length === 1 ? 'trip' : 'trips'},{' '}
                {role === 'driver' ? 'earned' : 'spent'} {money(total)}
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          trips === null ? (
            <Loading />
          ) : (
            <EmptyState
              icon={error ? 'cloud-offline-outline' : 'car-outline'}
              title={error ? 'Trips could not load' : 'No trips here yet'}
              body={
                error === 'index'
                  ? 'The trips index is still building in Firebase. Try again in a few minutes.'
                  : error
                  ? 'Check your connection and try again.'
                  : filter === 'all'
                  ? role === 'driver'
                    ? 'Trips you complete will show here.'
                    : 'Trips you book will show here.'
                  : 'No trips in this period. Try All.'
              }
            />
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.surface },
  content: { padding: SPACE[5], paddingBottom: SPACE[12] },
  filters: { flexDirection: 'row', gap: SPACE[2], marginTop: SPACE[4] },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.line,
    padding: SPACE[4],
    marginBottom: SPACE[3],
  },
  top: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: SPACE[3],
  },
  pill: { paddingHorizontal: SPACE[3], paddingVertical: 4, borderRadius: RADIUS.pill },
  pillText: { fontSize: 12, fontWeight: '700' },
  route: { flexDirection: 'row', gap: SPACE[3] },
  rail: { alignItems: 'center', paddingTop: 5 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  square: { borderRadius: 2 },
  line: { width: 2, flex: 1, minHeight: 18, backgroundColor: COLORS.line, marginVertical: 3 },
  place: { fontSize: 15, fontWeight: '600', color: COLORS.ink },
  bottom: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: SPACE[4], paddingTop: SPACE[3],
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
  },
  amount: { fontSize: 17, fontWeight: '800', color: COLORS.navy },
});
