/* "Your trip went past your drop-off": the passenger approves or disputes
   the extra miles (functions/extendedTrips.js). Shown on the trip summary
   and in trip details while the answer is wanted; draws nothing otherwise
   (what was decided shows in TripChangeNotes). */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Alert } from '../ui/alert';
import { Button, Card, COLORS, SPACE, TYPE } from '../ui/kit';
import { money } from '../../utils/appConfig';
import { extraMiles } from '../../utils/destinationChange';
import { answerExtendedTrip, awaitingApproval, extraAmount, hoursLeft } from '../../utils/extendedTrip';

export default function ExtendedTripCard({ ride, rideId, style }) {
  const [busy, setBusy] = useState(null);
  if (!ride || !rideId || !awaitingApproval(ride)) return null;

  const et = ride.extendedTrip;
  const currency = ride.currency || ride.fare?.currency;
  const extra = money(extraAmount(ride), currency);
  const card = ride.paymentMethod === 'card';
  const hours = hoursLeft(ride);

  const send = async (approve) => {
    if (busy) return;
    setBusy(approve ? 'approve' : 'dispute');
    try {
      await answerExtendedTrip(rideId, approve);
      // The ride listener brings the outcome in.
    } catch (error) {
      Alert.alert(
        'Not sent',
        error?.message && !/internal/i.test(error?.code || '') ? error.message : 'Check your connection and try again.'
      );
    } finally {
      setBusy(null);
    }
  };

  const dispute = () =>
    Alert.alert(
      'Dispute the extra miles?',
      `You won't be charged the ${extra} for now. Our office will look at the trip and let you know what they decide.`,
      [
        { text: 'Back', style: 'cancel' },
        { text: 'Dispute', style: 'destructive', onPress: () => send(false) },
      ]
    );

  return (
    <Card tone="warning" style={style}>
      <Text style={TYPE.heading}>Your trip went past your drop-off</Text>
      <Text style={[TYPE.small, styles.body]}>
        It ended {extraMiles(et.extraKm)} mi past your drop-off, so there is {extra} extra for those miles
        (booked fare {money(et.previousFare, currency)}, with the extra {money(et.newFare, currency)}).
      </Text>
      <Text style={[TYPE.small, styles.body]}>
        {card
          ? `Approve it if you asked to go further. If you don't answer${hours ? ` within ${hours} hour${hours === 1 ? '' : 's'}` : ''}, it is charged to your card.`
          : 'Approve it if you asked to go further, and pay your driver the extra in cash.'}
      </Text>
      <View style={styles.row}>
        <Button
          title="Dispute"
          variant="secondary"
          size="small"
          style={{ flex: 1 }}
          onPress={dispute}
          disabled={Boolean(busy)}
          loading={busy === 'dispute'}
        />
        <Button
          title={`Approve ${extra}`}
          size="small"
          style={{ flex: 2 }}
          onPress={() => send(true)}
          disabled={Boolean(busy)}
          loading={busy === 'approve'}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { marginTop: SPACE[2], color: COLORS.midnight },
  row: { flexDirection: 'row', gap: SPACE[3], marginTop: SPACE[4] },
});
