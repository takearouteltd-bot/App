// Shared trip history for passengers and drivers (their Trips tab).
// Replaces two near-identical screens. Defaults to "All" so the list is never
// empty just because there was no trip today.
import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView, View, Text, FlatList, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { auth, db } from '../../config/firebase';
import { money } from '../../utils/appConfig';
import {
  COLORS, TYPE, SPACE, ScreenHeader, Card, StatusPill, RouteLine, EmptyState, Loading, Chip,
} from '../ui/kit';

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

// Trip statuses the kit's StatusPill does not know, in its own words.
const STATUS_LABEL = {
  completed: 'Completed',
  cancelled: 'Cancelled',
  canceled: 'Cancelled',
  ongoing: 'On the way',
  accepted: 'Driver assigned',
  arrived: 'Driver arrived',
  searching: 'Finding driver',
};

// Map each trip status onto a pill tone the kit already styles.
const STATUS_PILL = {
  completed: 'approved',
  cancelled: 'rejected',
  canceled: 'rejected',
  ongoing: 'open',
  accepted: 'open',
  arrived: 'open',
  searching: 'pending',
};

function TripRow({ trip, role, onPress }) {
  const cancelled = trip.status === 'cancelled' || trip.status === 'canceled';
  const amount = trip.fare?.finalTotal ?? trip.fare?.total ?? trip.fareEstimate ?? 0;
  return (
    <Card onPress={onPress} style={styles.card}>
      <View style={styles.top}>
        <Text style={TYPE.small}>{whenLabel(tripDate(trip))}</Text>
        <StatusPill
          status={STATUS_PILL[trip.status] || trip.status}
          label={STATUS_LABEL[trip.status] || trip.status || 'Unknown'}
        />
      </View>

      <RouteLine
        compact
        pickup={trip.pickupLocation?.address || 'Pickup'}
        dropoff={trip.dropoffLocation?.address || 'Drop-off'}
      />

      <View style={styles.bottom}>
        <Text style={TYPE.small}>
          {trip.route?.distanceKm ? `${trip.route.distanceKm} km` : ''}
          {trip.route?.durationMinutes ? `, ${Math.ceil(trip.route.durationMinutes)} min` : ''}
        </Text>
        <Text style={[TYPE.figure, cancelled && { color: COLORS.muted, textDecorationLine: 'line-through' }]}>
          {role === 'driver' && !cancelled ? '+' : ''}
          {money(amount, trip.currency || trip.fare?.currency)}
        </Text>
      </View>
    </Card>
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
          <View style={{ marginBottom: SPACE[4] }}>
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
              <Card tone="dark" style={styles.summary}>
                <Text style={[TYPE.label, { color: COLORS.onDark }]}>
                  {completed.length} completed {completed.length === 1 ? 'trip' : 'trips'}
                </Text>
                <Text style={[TYPE.figure, { color: COLORS.lime, marginTop: SPACE[1] }]}>
                  {role === 'driver' ? 'Earned' : 'Spent'} {money(total)}
                </Text>
              </Card>
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
  summary: { marginTop: SPACE[4] },
  card: { marginBottom: SPACE[3] },
  top: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: SPACE[3],
  },
  bottom: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: SPACE[4], paddingTop: SPACE[3],
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
  },
});
