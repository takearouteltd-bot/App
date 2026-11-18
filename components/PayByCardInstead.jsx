// Passenger: "Pay by card instead" on a cash trip, from pickup until a while
// after it (functions/cardSwitch.js). Stripe's payment sheet does the rest
// on this phone: a saved card or a new one, and any bank check (3D Secure).
// During the trip it holds the fare so far; the card is charged the final
// fare when the trip ends. Nothing counts until the server has seen the
// payment at Stripe.
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useStripe } from '@stripe/stripe-react-native';
import { Alert } from './ui/alert';
import { Banner, Button, Card, COLORS, SPACE, TYPE } from './ui/kit';
import { money, useAppConfig } from '../utils/appConfig';
import {
  WALLETS,
  cardSwitchOffered,
  checkCardSwitch,
  paidByCardInstead,
  reason,
  startInApp,
  switchOf,
} from '../utils/cardSwitch';

export default function PayByCardInstead({ ride, rideId, style }) {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const config = useAppConfig();
  const [busy, setBusy] = useState(false);
  // The window closes while the screen is open: check it now and then.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const ps = switchOf(ride);
  const currency = ride?.currency || ride?.fare?.currency;

  if (paidByCardInstead(ride)) {
    const ending = ps.cardLast4 ? ` ending ${ps.cardLast4}` : '';
    return (
      <View style={style}>
        <Banner
          tone="success"
          title={ps.state === 'held' ? 'Paying by card ✓' : 'Paid by card ✓'}
          body={
            ps.state === 'held'
              ? `No cash needed. Your card${ending} is charged the final fare when the trip ends.`
              : `${money(ps.amount, currency)} paid by card${ending}. No cash needed.`
          }
        />
      </View>
    );
  }

  if (!cardSwitchOffered(ride, 'passenger', now, config)) return null;

  const pay = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await startInApp(rideId);
      if (['held', 'paid'].includes(res.state)) return;
      const { error: setupError } = await initPaymentSheet({
        merchantDisplayName: 'TakeARoute',
        customerId: res.customerId,
        customerEphemeralKeySecret: res.ephemeralKey,
        paymentIntentClientSecret: res.clientSecret,
        returnURL: 'takearoute://stripe-redirect',
        primaryButtonLabel: `${res.hold ? 'Use this card' : 'Pay'} (${money(res.amount, res.currency)})`,
        ...(WALLETS.googlePay
          ? { googlePay: { merchantCountryCode: 'GB', currencyCode: res.currency || 'GBP', testEnv: false } }
          : {}),
        ...(WALLETS.applePayMerchantId ? { applePay: { merchantCountryCode: 'GB' } } : {}),
      });
      if (setupError) throw setupError;
      const { error } = await presentPaymentSheet();
      if (error) {
        if (error.code === 'Canceled') return;
        throw error;
      }
      // The server asks Stripe before the trip counts as paid by card.
      const after = await checkCardSwitch(rideId);
      if (!['held', 'paid'].includes(after.state)) {
        Alert.alert(
          'Not confirmed yet',
          after.state === 'pending'
            ? 'We are still confirming your card. This screen updates once it goes through.'
            : after.error || 'Your card payment did not go through. Please try again, or pay the driver in cash.'
        );
      }
    } catch (error) {
      Alert.alert('Card payment', reason(error));
    } finally {
      setBusy(false);
    }
  };

  const during = ride.status === 'ongoing';
  return (
    <Card style={[{ padding: SPACE[4] }, style]}>
      <Text style={TYPE.subhead}>No cash?</Text>
      <Text style={[TYPE.small, { marginTop: 2 }]}>
        {during
          ? 'Pay by card instead. Your card is charged the final fare when the trip ends.'
          : `Pay ${money(ride.fare?.finalTotal ?? ride.fare?.total, currency)} by card instead of cash.`}
      </Text>
      {ps?.state === 'failed' && ps.error ? (
        <Text style={[TYPE.small, { marginTop: SPACE[2], color: COLORS.amber }]}>{ps.error}</Text>
      ) : null}
      <Button
        title="Pay by card instead"
        icon="card-outline"
        variant="secondary"
        size="small"
        style={{ marginTop: SPACE[3] }}
        onPress={pay}
        loading={busy}
        disabled={busy}
      />
    </Card>
  );
}
