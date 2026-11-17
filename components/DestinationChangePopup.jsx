/* The passenger asked to go somewhere else: the driver accepts or declines,
   with a countdown. Mounted once in App.js for drivers, over the whole
   navigator, so it shows whichever screen is open (the trip screen usually).
   The server keeps the time (functions/destinationChange.js): when the
   countdown ends the request is closed there and the trip carries on as
   booked, whether or not this phone answered. A driver can never change the
   destination themselves; they only answer the passenger's request.

   Outside the app the request rings on the job-ring channel; tapping it
   brings the app back with this on top. */
import React, { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { Alert } from './ui/alert';
import { Button, COLORS, RADIUS, SPACE, TYPE } from './ui/kit';
import { money } from '../utils/appConfig';
import { answerChange, isPending, latestChange, secondsLeft } from '../utils/destinationChange';
import { navigationUrl, remainingStops } from '../utils/stops';
import { ringBriefly, stopJobRing } from '../utils/notifications';

const short = (p) => String(p?.address || '').split(',')[0] || 'the new place';

// The last request rung for, so moving between screens does not ring again.
let rungFor = null;

export default function DestinationChangePopup({ driverId }) {
  const [rideId, setRideId] = useState(null);
  const [ride, setRide] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(null);
  // Answered on this phone: hidden at once, before the ride catches up.
  const answered = useRef(null);

  // The trip the driver is on (drivers/{id}.currentRideId).
  useEffect(() => {
    if (!driverId) return undefined;
    return onSnapshot(
      doc(db, 'drivers', driverId),
      (snap) => setRideId(snap.exists() ? snap.data().currentRideId || null : null),
      () => {}
    );
  }, [driverId]);

  useEffect(() => {
    if (!rideId) {
      setRide(null);
      return undefined;
    }
    return onSnapshot(
      doc(db, 'rides', rideId),
      (snap) => setRide(snap.exists() ? snap.data() : null),
      () => {}
    );
  }, [rideId]);

  const dc = latestChange(ride);
  const mine = ride && ride.driverId === driverId && ride.status === 'ongoing';
  const open = mine && isPending(dc, now) && answered.current !== `${rideId}:${dc?.n}`;

  // A tick a second while a request is open, for the countdown.
  useEffect(() => {
    if (!open) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open]);

  const key = open ? `${rideId}:${dc.n}` : null;
  useEffect(() => {
    if (!key || rungFor === key) return;
    rungFor = key;
    ringBriefly();
  }, [key]);

  if (!open) return null;

  const left = secondsLeft(dc, now);
  const currency = ride.currency || dc.currency;

  const answer = async (accept) => {
    if (busy) return;
    setBusy(accept ? 'accept' : 'decline');
    stopJobRing();
    try {
      const result = await answerChange(rideId, dc.n, accept);
      answered.current = key;
      if (accept) {
        const cash = Number(result?.cashExtraDue) || 0;
        const to = result?.to || dc.to;
        Alert.alert(
          'Destination changed',
          `Now going to ${short(to)}. The fare is ${money(dc.newTotal, currency)}.` +
            (cash > 0 ? ` The passenger's card didn't cover it: collect ${money(cash, currency)} extra in cash.` : '') +
            ' If you are using Maps, open the new route.',
          [
            { text: 'OK', style: 'cancel' },
            {
              text: 'Open in Maps',
              onPress: () =>
                Linking.openURL(navigationUrl(to, remainingStops(ride))).catch(() =>
                  Alert.alert('Could not open maps', 'No maps app is available.')
                ),
            },
          ]
        );
      }
    } catch (error) {
      answered.current = key;
      Alert.alert('That did not go through', error?.message || 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <SafeAreaView edges={['top']} pointerEvents="box-none" style={styles.wrap}>
        <View style={styles.card} accessibilityLiveRegion="polite">
          <View style={styles.row}>
            <Ionicons name="swap-horizontal" size={18} color={COLORS.midnight} />
            <Text style={[TYPE.callout, { flex: 1 }]}>Change of destination</Text>
            <Text style={TYPE.callout}>{left}s</Text>
          </View>
          <Text style={[TYPE.body, { marginTop: SPACE[2] }]}>
            Passenger wants to go to {short(dc.to)} instead.
          </Text>
          <Text style={[TYPE.small, { color: COLORS.muted }]} numberOfLines={2}>
            {dc.to?.address}
          </Text>
          <Text style={[TYPE.subhead, { marginTop: SPACE[2] }]}>
            New price {money(dc.newTotal, currency)} (was {money(dc.oldTotal, currency)})
          </Text>
          <View style={[styles.row, { marginTop: SPACE[3] }]}>
            <Button
              title="Decline"
              variant="secondary"
              size="small"
              style={{ flex: 1 }}
              onPress={() => answer(false)}
              disabled={Boolean(busy)}
              loading={busy === 'decline'}
            />
            <Button
              title={`Accept · ${left}s`}
              size="small"
              style={{ flex: 2 }}
              onPress={() => answer(true)}
              disabled={Boolean(busy)}
              loading={busy === 'accept'}
            />
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: SPACE[4], paddingTop: SPACE[2] },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.md,
    borderWidth: 2,
    borderColor: COLORS.lime,
    padding: SPACE[4],
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACE[2] },
});
