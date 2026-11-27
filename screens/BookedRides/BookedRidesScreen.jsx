// A passenger's rides booked for later, soonest first, each with Cancel.
// They stay here until the server sends them out about leadMinutes before
// the pickup (functions/bookLater.js); from then on they are the current
// ride on the Home screen like any booking. Cancelling here is free: no
// driver has the job yet and the card is not held until it is sent out.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { collection, doc, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { auth, db } from '../../config/firebase';
import { Alert } from '../../components/ui/alert';
import {
  COLORS, TYPE, SPACE, Screen, ScreenHeader, Card, Chip, Button, EmptyState, RouteLine, Loading,
} from '../../components/ui/kit';
import { classLabel } from '../../constants/vehicleClasses';
import { money } from '../../utils/appConfig';
import { searchStartsMs, ukClock, ukWhen } from '../../utils/bookLater';

function millis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  return Number(ts) || 0;
}

export default function BookedRidesScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const uid = auth.currentUser?.uid || null;
  const [rides, setRides] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    if (!uid) {
      setRides([]);
      return undefined;
    }
    return onSnapshot(
      query(collection(db, 'rides'), where('riderId', '==', uid), where('status', '==', 'scheduled')),
      (snap) =>
        setRides(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => millis(a.pickupAt) - millis(b.pickupAt))
        ),
      () => setRides([])
    );
  }, [uid]);

  // Just booked: the server checks it straight after (cities, price, promo
  // code, how many are booked) and may turn it down, saying why.
  const justBooked = route.params?.rideId || null;
  const told = useRef(false);
  useEffect(() => {
    if (!justBooked) return undefined;
    told.current = false;
    return onSnapshot(
      doc(db, 'rides', justBooked),
      (snap) => {
        const r = snap.data();
        if (!r || told.current) return;
        if (r.status === 'cancelled' && r.cancelledBy === 'system') {
          told.current = true;
          Alert.alert('Booking not accepted', r.cancelMessage || 'We could not take this booking. Please try again.');
        }
      },
      () => {}
    );
  }, [justBooked]);

  const cancel = (ride) =>
    Alert.alert(
      'Cancel this booking?',
      `Pickup ${ukWhen(millis(ride.pickupAt))} from ${String(ride.pickupLocation?.address || '').split(',')[0]}. You won't be charged.`,
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Cancel booking',
          style: 'destructive',
          onPress: async () => {
            setBusy(ride.id);
            try {
              await updateDoc(doc(db, 'rides', ride.id), {
                status: 'cancelled',
                cancelledBy: 'rider',
                cancelledAt: serverTimestamp(),
              });
            } catch (error) {
              // Sent out in the meantime: it is on the Home screen now.
              Alert.alert('Could not cancel', 'It may be finding your driver already. Cancel it from the Home screen.');
            } finally {
              setBusy(null);
            }
          },
        },
      ]
    );

  return (
    <Screen>
      <ScreenHeader title="Booked rides" subtitle="Pickup times are UK time" />
      {rides === null ? (
        <Loading />
      ) : !rides.length ? (
        <EmptyState
          icon="calendar-outline"
          title="No rides booked ahead"
          body="Choose a later pickup time when you book, and it shows here until we find your driver."
          action={<Button title="Book a ride" onPress={() => navigation.navigate('Home', { screen: 'HomeScreen' })} />}
        />
      ) : (
        rides.map((ride) => {
          const starts = searchStartsMs(ride);
          return (
            <Card key={ride.id} style={styles.card}>
              <View style={styles.top}>
                <Text style={TYPE.subhead}>{ukWhen(millis(ride.pickupAt))}</Text>
                <Text style={TYPE.callout}>{money(ride.fare?.total ?? ride.fareEstimate ?? 0, ride.currency || ride.fare?.currency)}</Text>
              </View>
              <View style={styles.chips}>
                <Chip label={classLabel(ride.rideType)} active />
                <Chip label={ride.paymentMethod === 'cash' ? 'Cash' : 'Card'} icon="wallet-outline" />
                {ride.stops?.length ? <Chip label={`${ride.stops.length} stop${ride.stops.length === 1 ? '' : 's'}`} icon="flag-outline" /> : null}
                {ride.passengerFor?.name ? <Chip label={`For ${ride.passengerFor.name}`} icon="person-outline" /> : null}
              </View>
              <RouteLine compact pickup={ride.pickupLocation?.address} dropoff={ride.dropoffLocation?.address} />
              <Text style={[TYPE.caption, { marginTop: SPACE[2], color: COLORS.muted }]}>
                {ride.bookedAhead
                  ? `We start finding your driver at ${ukClock(starts || millis(ride.pickupAt))}. ${ride.paymentMethod === 'cash' ? '' : 'Your card is checked then. '}Free to cancel until a driver accepts.`
                  : 'Checking your booking…'}
              </Text>
              <Button
                title="Cancel booking"
                variant="secondary"
                size="small"
                style={{ marginTop: SPACE[3] }}
                loading={busy === ride.id}
                disabled={Boolean(busy)}
                onPress={() => cancel(ride)}
              />
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: SPACE[3] },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE[2], marginVertical: SPACE[3] },
});
