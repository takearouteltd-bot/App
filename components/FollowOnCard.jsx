/* On the trip screen (passenger on board): a follow-on job on offer, with
   Accept and No thanks and a countdown, or the next job already accepted,
   with a way to give it back. See utils/followOn.js.

   offerOnly: just the offer, for FollowOnPopup, which shows it over any
   other screen the driver has open. */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Alert } from './ui/alert';
import { Button, COLORS, RADIUS, SPACE, TYPE } from './ui/kit';
import { classLabel } from '../constants/vehicleClasses';
import { currencySymbol } from '../utils/appConfig';
import { distanceText } from '../utils/routes';
import { answerFollowOn, followOnError, useFollowOnOffer, useNextJob } from '../utils/followOn';
import { ringBriefly, stopJobRing } from '../utils/notifications';

const short = (p) => String(p?.address || '').split(',')[0] || 'Pickup';

// The last offer rung for, across every card and the pop-up, so moving
// between screens does not ring for the same offer again.
let rungFor = null;

export default function FollowOnCard({ driverId, rideId, offerOnly = false, style }) {
  const offer = useFollowOnOffer(driverId);
  const next = useNextJob(offerOnly ? null : driverId, rideId);
  const [busy, setBusy] = useState(null);

  // A short ring when an offer arrives, so the driver notices it like any
  // new job, but not the long loop with a passenger on board.
  const offerId = offer?.rideId || null;
  useEffect(() => {
    if (!offerId || rungFor === offerId) return;
    rungFor = offerId;
    ringBriefly();
  }, [offerId]);

  const answer = async (what) => {
    const id = what === 'drop' ? next?.id : offer?.rideId;
    if (!id || busy) return;
    setBusy(what);
    stopJobRing();
    try {
      await answerFollowOn(id, what);
    } catch (error) {
      Alert.alert(what === 'accept' ? 'Job not taken' : 'That did not work', followOnError(error));
    } finally {
      setBusy(null);
    }
  };

  if (next) {
    return (
      <View style={[styles.card, styles.next, style]}>
        <View style={styles.row}>
          <Ionicons name="arrow-redo" size={18} color={COLORS.lime} />
          <Text style={[TYPE.callout, styles.onDark, { flex: 1 }]} numberOfLines={1}>
            Next job: {short(next.pickupLocation)}
          </Text>
          <TouchableOpacity
            onPress={() =>
              Alert.alert(
                'Give back your next job?',
                'It goes back to be offered to other drivers, the same as giving back any job you accepted.',
                [
                  { text: 'Keep it', style: 'cancel' },
                  { text: 'Give it back', style: 'destructive', onPress: () => answer('drop') },
                ]
              )
            }
            disabled={Boolean(busy)}
            accessibilityRole="button"
            accessibilityLabel="Give back your next job"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.link}>{busy === 'drop' ? 'Giving back…' : "Can't do it"}</Text>
          </TouchableOpacity>
        </View>
        <Text style={[TYPE.small, { color: COLORS.onDark, marginTop: 2 }]} numberOfLines={2}>
          Starts when you finish this trip. The passenger has been told you're on your way after it.
        </Text>
      </View>
    );
  }

  if (!offer) return null;
  return (
    <View style={[styles.card, style]}>
      <View style={styles.row}>
        <Ionicons name="arrow-redo" size={18} color={COLORS.midnight} />
        <Text style={[TYPE.callout, { flex: 1 }]} numberOfLines={1}>
          {offer.forMe ? `Your next job from ${offer.fleetName || 'the office'}` : 'Follow-on job'}
        </Text>
        <Text style={TYPE.callout}>
          {currencySymbol()}
          {Number(offer.fare || 0).toFixed(2)}
        </Text>
      </View>
      <Text style={[TYPE.small, { marginTop: SPACE[1] }]} numberOfLines={2}>
        {short(offer.pickupLocation)} → {short(offer.dropoffLocation)}
      </Text>
      <Text style={[TYPE.small, { color: COLORS.muted }]} numberOfLines={1}>
        {classLabel(offer.rideType)}
        {offer.paymentMethod === 'cash' && !['account', 'card', 'online'].includes(offer.collectBy) ? ' · Cash' : ''}
        {' · '}
        {distanceText(offer.gapKm || 0)} from your drop-off · pickup in about {offer.etaMinutes} min
      </Text>
      <View style={[styles.row, { marginTop: SPACE[3] }]}>
        <Button
          title="No thanks"
          variant="secondary"
          size="small"
          style={{ flex: 1 }}
          onPress={() => answer('decline')}
          disabled={Boolean(busy)}
          loading={busy === 'decline'}
        />
        <Button
          title={`Accept · ${offer.secondsLeft}s`}
          size="small"
          style={{ flex: 2 }}
          onPress={() => answer('accept')}
          disabled={Boolean(busy)}
          loading={busy === 'accept'}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.md,
    borderWidth: 2,
    borderColor: COLORS.lime,
    padding: SPACE[4],
    marginBottom: SPACE[3],
  },
  next: { backgroundColor: COLORS.midnight, borderColor: COLORS.midnight },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACE[2] },
  onDark: { color: COLORS.white },
  link: { color: COLORS.lime, fontWeight: '700', fontSize: 14 },
});
