// Driver: "Customer wants to pay by card" on a finished cash trip, for a
// passenger who can't use the app (dead phone, no app, booked for someone
// else). The server makes a Stripe payment page for the final fare
// (functions/cardSwitch.js), texts the link to the passenger's mobile, and
// this shows its QR code, then "Waiting for payment…" until the server has
// seen it paid at Stripe. Also shows when the passenger paid in the app.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View, StyleSheet } from 'react-native';
import { Alert } from './ui/alert';
import { Banner, Button, Card, COLORS, Field, SPACE, TYPE } from './ui/kit';
import { money, useAppConfig } from '../utils/appConfig';
import {
  cardSwitchOffered,
  checkCardSwitch,
  paidByCardInstead,
  reason,
  startLink,
  stopCardSwitch,
  switchOf,
} from '../utils/cardSwitch';

// How often the driver's screen asks the server, which asks Stripe.
const CHECK_MS = 4000;

/* The QR code, from the server's rows of 0 and 1. Each row is drawn as runs
   of dark squares, so a code is a few hundred views, not a thousand. */
function QrCode({ rows, size = 220 }) {
  const cells = rows.length + 8; // a quiet margin of 4 each side
  const cell = Math.max(2, Math.floor(size / cells));
  return (
    <View style={[styles.qr, { width: cell * cells, height: cell * cells, padding: cell * 4 }]} accessibilityLabel="QR code for the payment link">
      {rows.map((row, r) => {
        const runs = [];
        let start = -1;
        for (let c = 0; c <= row.length; c++) {
          const dark = row[c] === '1';
          if (dark && start < 0) start = c;
          if (!dark && start >= 0) {
            runs.push([start, c - start]);
            start = -1;
          }
        }
        return (
          <View key={r} style={{ height: cell, width: cell * rows.length }}>
            {runs.map(([at, len]) => (
              <View key={at} style={{ position: 'absolute', left: at * cell, width: len * cell, height: cell, backgroundColor: COLORS.midnight }} />
            ))}
          </View>
        );
      })}
    </View>
  );
}

export default function CardLinkPanel({ ride, rideId, autoStart, style }) {
  const config = useAppConfig();
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [typing, setTyping] = useState(false);
  const [phone, setPhone] = useState('');
  const started = useRef(false);

  const ps = switchOf(ride);
  const currency = ride?.currency || ride?.fare?.currency;
  const waitingLink = ps?.state === 'pending' && ps.method === 'link';
  const passengerPaying = ps?.state === 'pending' && ps.method === 'app';

  const begin = useCallback(async (opts = {}) => {
    setBusy(true);
    // A new or resent link starts the wait afresh.
    setStatus(null);
    try {
      const res = await startLink(rideId, opts);
      if (res.url) setLink(res);
      if (opts.phone) {
        setTyping(false);
        setPhone('');
      }
      if ((opts.resend || opts.phone) && !res.texted) {
        Alert.alert('Text not sent', res.textsLeft === 0
          ? 'The link has been texted three times already. Show the QR code instead.'
          : "We couldn't text that number. Show the QR code instead.");
      }
    } catch (error) {
      Alert.alert('Card payment', reason(error));
    } finally {
      setBusy(false);
    }
  }, [rideId]);

  // Straight from "Customer wants to pay by card" at the end of the trip,
  // or back on this screen with a link already open (same link, no text).
  useEffect(() => {
    if (started.current || !ride || paidByCardInstead(ride) || ride.cashCollected) return;
    if ((autoStart && cardSwitchOffered(ride, 'driver', Date.now(), config)) || (waitingLink && !link)) {
      started.current = true;
      begin();
    }
  }, [ride, autoStart, waitingLink, link, begin, config]);

  // Waiting for payment: the server asks Stripe (a webhook may beat it).
  useEffect(() => {
    if (!waitingLink && !passengerPaying) return undefined;
    let live = true;
    const tick = () => checkCardSwitch(rideId).then((s) => live && setStatus(s)).catch(() => null);
    tick();
    const timer = setInterval(tick, CHECK_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [waitingLink, passengerPaying, rideId]);

  const takeCash = () =>
    Alert.alert('Take cash instead?', `Take ${money(ride.fare?.finalTotal ?? ride.fare?.total, currency)} in cash, then confirm.`, [
      { text: 'Not yet', style: 'cancel' },
      {
        text: 'Cash received',
        onPress: async () => {
          setBusy(true);
          try {
            const res = await stopCardSwitch(rideId, { cash: true });
            if (['held', 'paid'].includes(res.state)) {
              Alert.alert('Already paid by card', "The passenger's card payment went through, so don't take cash.");
            }
            setLink(null);
          } catch (error) {
            Alert.alert('Could not record cash', reason(error));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);

  if (!ride) return null;

  if (paidByCardInstead(ride)) {
    return (
      <View style={style}>
        <Banner
          tone="success"
          title="Paid by card ✓"
          body={`${money(ps.amount, currency)} paid by card${ps.cardLast4 ? ` ending ${ps.cardLast4}` : ''}. Don't take cash. You're paid as on any card job.`}
        />
      </View>
    );
  }

  const offered = cardSwitchOffered(ride, 'driver', Date.now(), config);
  if (!offered && !waitingLink) return null;
  const fare = ride.fare?.finalTotal ?? ride.fare?.total;

  // The link ran out, or the card was refused: try again or take cash.
  const expired = ps?.state === 'expired' || status?.state === 'expired';
  const declined = waitingLink && status?.declined;

  if (waitingLink && link && !expired) {
    return (
      <Card style={[{ padding: SPACE[4], alignItems: 'center' }, style]}>
        <Text style={[TYPE.subhead, { alignSelf: 'stretch' }]}>Pay {money(link.amount, currency)} by card</Text>
        <Text style={[TYPE.small, { alignSelf: 'stretch', marginTop: 2 }]}>
          {link.textedTo
            ? `Texted to the mobile ending ${link.textedTo}. Or they scan this code with any phone.`
            : 'They scan this code with any phone camera.'}
        </Text>
        <View style={{ marginTop: SPACE[4] }}>
          <QrCode rows={link.qr} />
        </View>
        <Text style={[TYPE.caption, { marginTop: SPACE[2], color: COLORS.muted }]} selectable>{link.url}</Text>

        {declined ? (
          <View style={{ alignSelf: 'stretch', marginTop: SPACE[4] }}>
            <Banner tone="warning" title="Card didn't go through" body={`${status.declined} They can try again on the same page, with another card, or pay cash.`} />
          </View>
        ) : (
          <View style={styles.waiting}>
            <ActivityIndicator color={COLORS.midnight} />
            <Text style={TYPE.callout}>Waiting for payment…</Text>
          </View>
        )}

        {typing ? (
          <View style={{ alignSelf: 'stretch', marginTop: SPACE[3] }}>
            <Field label="Their mobile" left="call-outline" placeholder="07700 900123" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
            <Button size="small" title="Text the link" onPress={() => begin({ phone })} loading={busy} disabled={busy || phone.replace(/\D/g, '').length < 10} />
          </View>
        ) : (
          <View style={styles.row}>
            <Button size="small" variant="secondary" title="Text it again" style={{ flex: 1 }} onPress={() => begin({ resend: true })} disabled={busy} />
            <Button size="small" variant="secondary" title="Another number" style={{ flex: 1 }} onPress={() => setTyping(true)} disabled={busy} />
          </View>
        )}
        <Button size="small" variant="ghost" title="Take cash instead" style={{ marginTop: SPACE[2] }} onPress={takeCash} disabled={busy} />
      </Card>
    );
  }

  return (
    <Card style={[{ padding: SPACE[4] }, style]}>
      {expired ? (
        <Banner tone="warning" title="The payment link ran out" body="Make a new one, or take cash." />
      ) : passengerPaying ? (
        <Banner tone="info" title="The passenger is paying in the app…" body="This changes to Paid by card once it goes through." />
      ) : ps?.state === 'failed' && ps.error ? (
        <Banner tone="warning" title="Card didn't go through" body={ps.error} />
      ) : (
        <>
          <Text style={TYPE.subhead}>Not paid yet: {money(fare, currency)}</Text>
          <Text style={[TYPE.small, { marginTop: 2 }]}>
            Take cash, or let the passenger pay by card: we show a QR code here and text them a link. You're paid as on any card job.
          </Text>
        </>
      )}
      <Button
        title={expired || ps?.state === 'failed' ? 'Try card again' : 'Customer wants to pay by card'}
        icon="card-outline"
        style={{ marginTop: SPACE[3] }}
        onPress={() => begin()}
        loading={busy}
        disabled={busy}
      />
      <Button title="Cash received" variant="secondary" style={{ marginTop: SPACE[2] }} onPress={takeCash} disabled={busy} />
    </Card>
  );
}

const styles = StyleSheet.create({
  qr: { backgroundColor: '#FFFFFF' },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: SPACE[2], marginTop: SPACE[4] },
  row: { flexDirection: 'row', gap: SPACE[2], marginTop: SPACE[3], alignSelf: 'stretch' },
});
