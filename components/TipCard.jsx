/* "Do you want to tip your driver?" after a trip: three amounts from the
   dashboard (Settings > Tips), the passenger's own amount, or not now.
   Charged to their saved card by the server (utils/tips.js). Once paid it
   shows the thank you; past the time allowed, or with tips off, nothing. */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Alert } from './ui/alert';
import { Button, Card, Chip, Field, COLORS, SPACE, TYPE } from './ui/kit';
import { currencySymbol, money, useAppConfig } from '../utils/appConfig';
import { MIN_TIP, canTip, maxTip, paidTip, tipDriver, tipPresets } from '../utils/tips';

export default function TipCard({ ride, rideId, driverName = 'your driver', onAddCard, style }) {
  const config = useAppConfig();
  const [choice, setChoice] = useState(null);
  const [custom, setCustom] = useState('');
  const [ownAmount, setOwnAmount] = useState(false);
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const currency = ride?.currency || ride?.fare?.currency;

  const paid = paidTip(ride);
  if (paid > 0) {
    return (
      <Card style={style}>
        <Text style={TYPE.heading}>Thanks for the tip</Text>
        <Text style={[TYPE.small, { marginTop: SPACE[1] }]}>
          {money(paid, currency)} went to {driverName}, all of it.
        </Text>
      </Card>
    );
  }
  // A tip being charged right now keeps the card up, with a note.
  const open = canTip(ride?.tip?.status === 'pending' ? { ...ride, tip: null } : ride, config);
  if (skipped || !open) return null;

  const presets = tipPresets(config);
  const most = maxTip(config);
  const amount = ownAmount ? Number(String(custom).replace(',', '.')) : choice;
  const valid = Number.isFinite(amount) && amount >= MIN_TIP && amount <= most;

  const send = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await tipDriver(rideId, amount);
      // The ride listener brings the thank you in when the server records it.
    } catch (error) {
      if (error?.details?.reason === 'no_card') {
        Alert.alert('Add a card', 'Tips are paid by card. Add one, then come back to tip.', [
          { text: 'Not now', style: 'cancel' },
          onAddCard ? { text: 'Add card', onPress: onAddCard } : null,
        ].filter(Boolean));
      } else {
        Alert.alert('Tip not sent', error?.message && !/internal/i.test(error?.code || '')
          ? error.message
          : 'Check your connection and try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={style}>
      <Text style={TYPE.heading}>Do you want to tip {driverName}?</Text>
      <Text style={[TYPE.small, { marginTop: SPACE[1] }]}>
        All of it goes to your driver. Charged to your card.
      </Text>
      <View style={styles.row}>
        {presets.map((p) => (
          <Chip
            key={p}
            label={money(p, currency)}
            active={!ownAmount && choice === p}
            onPress={() => {
              setOwnAmount(false);
              setChoice(p);
            }}
            style={styles.chip}
          />
        ))}
        <Chip label="Other" active={ownAmount} onPress={() => setOwnAmount(true)} style={styles.chip} />
      </View>
      {ownAmount ? (
        <Field
          label={`Your tip (${currencySymbol(currency)})`}
          value={custom}
          onChangeText={(t) => setCustom(t.replace(/[^0-9.,]/g, '').slice(0, 6))}
          placeholder="3.00"
          keyboardType="decimal-pad"
          hint={`From ${money(MIN_TIP, currency)} to ${money(most, currency)}`}
          error={custom && !valid ? `From ${money(MIN_TIP, currency)} to ${money(most, currency)}` : null}
          style={{ marginTop: SPACE[3], marginBottom: 0 }}
        />
      ) : null}
      <View style={[styles.row, { marginTop: SPACE[4] }]}>
        <Button title="Not now" variant="secondary" size="small" style={{ flex: 1 }} onPress={() => setSkipped(true)} disabled={busy} />
        <Button
          title={valid ? `Tip ${money(amount, currency)}` : 'Tip'}
          size="small"
          icon="heart"
          style={{ flex: 2 }}
          onPress={send}
          disabled={!valid || busy}
          loading={busy}
        />
      </View>
      {ride?.tip?.status === 'pending' ? (
        <Text style={[TYPE.small, { marginTop: SPACE[2], color: COLORS.muted }]}>Sending your tip…</Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE[2], marginTop: SPACE[3] },
  chip: { minWidth: 64, justifyContent: 'center' },
});
