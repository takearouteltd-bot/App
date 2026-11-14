import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Switch } from 'react-native';
import { Alert } from '../../../components/ui/alert';
import { auth, db, functions } from '../../../config/firebase';
import { doc, collection, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useNavigation } from '@react-navigation/native';
import { money, useAppConfig } from '../../../utils/appConfig';
import {
  buyMembership,
  perPeriod,
  periodWord,
  planName,
  planPrice,
  plansOffered,
  shortDate,
  tierOf,
  updateMembership,
  useMembershipPurchases,
} from '../../../utils/membership';
import { ChoiceCard } from '../../../components/onboarding/kit';
import {
  COLORS,
  TYPE,
  SPACE,
  Screen,
  Card,
  Button,
  Banner,
  RowGroup,
  Section,
  StatusPill,
  ScreenHeader,
  Loading,
} from '../../../components/ui/kit';

/* Membership: weekly or monthly plan, auto-renew, recent purchases. Prices
   come from the admin dashboard (Settings, Driver subscription); the server
   decides every amount (see utils/membership.js). */
export default function SubscriptionScreen() {
  const appConfig = useAppConfig();

  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [subscription, setSubscription] = useState(null);
  const [approval, setApproval] = useState(null);
  // A company driver's card fares go to the fleet, so their wallet never
  // fills: their membership comes off their card.
  const [companyDriver, setCompanyDriver] = useState(false);
  const [chosenTier, setChosenTier] = useState(null);
  const [saving, setSaving] = useState(null);
  const navigation = useNavigation();
  const driverId = auth.currentUser?.uid;
  const purchases = useMembershipPurchases(driverId);

  const tier = tierOf(subscription);
  const price = planPrice(appConfig, tier);
  const plans = plansOffered(appConfig);
  // The plan picked on screen (start / buy again), else the current one.
  const pick = plans.some((p) => p.tier === chosenTier) ? chosenTier : plans.some((p) => p.tier === tier) ? tier : 'monthly';

  // The card on the account, used when the wallet cannot cover a renewal.
  const [card, setCard] = useState(null);
  const [paying, setPaying] = useState(false);
  useEffect(() => {
    if (!driverId) return undefined;
    return onSnapshot(
      collection(db, 'riders', driverId, 'cards'),
      (snap) => {
        const cards = snap.docs.map((d) => d.data());
        setCard(cards.find((c) => c.isDefault) || cards[0] || null);
      },
      () => setCard(null)
    );
  }, [driverId]);

  const openCards = () =>
    navigation.navigate(card ? 'AllPaymentMethods' : 'AddPaymentMethod');

  const payByCard = async () => {
    if (!card) {
      openCards();
      return;
    }
    setPaying(true);
    try {
      const pay = httpsCallable(functions, 'payDriverMembership');
      const res = await pay({ cardOnly: true });
      if (res.data?.reason === 'nothing_due') {
        Alert.alert('Nothing to pay', 'Nothing to pay right now.');
      } else {
        Alert.alert('Membership paid', `${money(res.data?.amount ?? price)} was charged to your card.`);
      }
    } catch (error) {
      Alert.alert('Payment did not go through', error.message || 'Please try again.');
    } finally {
      setPaying(false);
    }
  };

  // Live, so a payment, a renewal or an admin's change shows straight away.
  useEffect(() => {
    if (!driverId) {
      setChecking(false);
      return undefined;
    }
    return onSnapshot(
      doc(db, 'drivers', driverId),
      (snap) => {
        const data = snap.exists() ? snap.data() : null;
        setSubscription(data?.subscription || null);
        setApproval(data ? { approved: data.approved === true, rejected: data.onboardingStatus === 'rejected', reason: data.rejectionReason || '' } : null);
        setCompanyDriver(Boolean(data?.fleetId) && data?.fleetDriverType !== 'self');
        setChecking(false);
      },
      (err) => {
        console.log('Error fetching subscription:', err);
        setChecking(false);
      }
    );
  }, [driverId]);

  // Activation (and buying again after a membership ended) runs on the
  // server (activateDriverMembership), which takes the chosen plan's price
  // from the wallet or card.
  const handleActivate = async () => {
    if (!driverId) {
      Alert.alert('Not signed in', 'Please sign in again.');
      return;
    }
    setLoading(true);
    try {
      const data = await buyMembership(pick);

      // What was actually taken or is owed: a re-activated suspended driver
      // keeps their debt, which can differ from the plan's price.
      const amount = money(data?.amount ?? planPrice(appConfig, pick));
      Alert.alert(
        data?.alreadyActive || data?.paid
          ? 'Membership active'
          : data?.stillSuspended
          ? 'Account still paused'
          : data?.stillExpired
          ? 'Not bought yet'
          : 'Payment needed',
        data?.alreadyActive
          ? 'Your membership is already active.'
          : data?.paid
          ? data.method === 'card'
            ? `${amount} was charged to your card. You are all set.`
            : `${amount} has been taken from your wallet. You are all set.`
          : data?.stillSuspended
          ? `${amount} is still unpaid, so your account stays paused. Pay it by card under Membership to start driving again.`
          : data?.stillExpired
          ? data.reason === 'card_declined'
            ? `Your card was declined, so ${amount} was not taken. Try another card.`
            : `Your wallet doesn't hold ${amount}. Add a card, then buy again.`
          : `${amount} is owed. Add a card under Membership and pay it, then you can go online.`
      );

      // Staying put: the listener above shows the result. Replacing to a
      // screen in another tab's stack throws.
    } catch (err) {
      console.log('Activation error:', err);
      Alert.alert('Could not activate', err.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const change = async (what, value) => {
    setSaving(what);
    try {
      await updateMembership({ [what]: value });
    } catch (err) {
      Alert.alert('Not changed', err.message || 'Check your connection and try again.');
    } finally {
      setSaving(null);
    }
  };

  const confirmAutoRenew = (on) => {
    if (on) {
      change('autoRenew', true);
      return;
    }
    Alert.alert(
      'Switch off auto-renew?',
      `Your membership ends on ${shortDate(subscription?.nextBillingDate)} and nothing more is taken. After that you can't go online until you buy again.`,
      [
        { text: 'Keep it on', style: 'cancel' },
        { text: 'Switch off', style: 'destructive', onPress: () => change('autoRenew', false) },
      ]
    );
  };

  const switchPlan = (to) => {
    if (to === (subscription?.nextTier || tier)) return;
    const firstOwed = Number(subscription?.debtAmount) > 0 && !subscription?.lastPaidAt;
    Alert.alert(
      `Switch to the ${periodWord(to)}ly plan?`,
      firstOwed
        ? `You'll pay ${money(planPrice(appConfig, to))} ${perPeriod(to)} instead, starting now.`
        : to === tier
        ? `You'll stay on the ${periodWord(tier)}ly plan.`
        : `From ${shortDate(subscription?.nextBillingDate)} you'll pay ${money(planPrice(appConfig, to))} ${perPeriod(to)}. Nothing changes before then.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Switch', onPress: () => change('tier', to) },
      ]
    );
  };

  if (checking) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  const status = subscription?.status;
  const cardLabel = card ? `${(card.brand || 'Card').toUpperCase()} ···· ${card.last4}` : null;
  const cardRow = (
    <RowGroup
      style={{ marginTop: SPACE[4] }}
      items={[
        {
          icon: 'card-outline',
          iconColor: COLORS.midnight,
          title: 'Card for membership',
          detail: cardLabel || (companyDriver ? 'Your membership is charged to this card' : 'Used if your wallet is short at renewal'),
          onPress: openCards,
        },
      ]}
    />
  );

  const planPicker = (selected, onPick) =>
    plans.length > 1 ? (
      <View style={styles.plans}>
        {plans.map((p) => (
          <ChoiceCard
            key={p.tier}
            title={planName(p.tier)}
            detail={p.tier === 'weekly' ? 'Pay as you go, a week at a time' : 'Best value for full-time drivers'}
            meta={`${money(p.price)} / ${periodWord(p.tier)}`}
            icon={p.tier === 'weekly' ? 'calendar-week' : 'calendar-month'}
            selected={selected === p.tier}
            onPress={() => onPick(p.tier)}
          />
        ))}
      </View>
    ) : null;

  const history = purchases.length ? (
    <Section title="Recent purchases" style={{ marginTop: SPACE[5] }}>
      <RowGroup
        items={purchases.map((p) => ({
          key: p.id,
          icon: p.method === 'card' ? 'card-outline' : 'wallet-outline',
          iconColor: COLORS.midnight,
          title: `${p.plan === 'weekly' ? 'Weekly' : p.plan === 'monthly' ? 'Monthly' : 'Membership'} · ${money(p.amount)}`,
          detail: `${shortDate(p.at)} · ${p.method === 'card' ? 'Card' : 'Wallet'}${p.periodEnd ? ` · until ${shortDate(p.periodEnd)}` : ''}`,
        }))}
      />
    </Section>
  ) : null;

  // Given by a TakeARoute admin: nothing to pay.
  if (subscription?.paymentMethod === 'admin_granted') {
    return (
      <Screen>
        <ScreenHeader title="Membership" />
        <Card tone="dark" style={styles.hero}>
          <View style={styles.heroTop}>
            <Text style={styles.heroPlan}>Driver membership</Text>
            <StatusPill status="approved" label="Active" />
          </View>
          <Text style={[styles.heroPrice, { fontSize: 28 }]}>Given by TakeARoute</Text>
          <Text style={styles.heroSub}>There is nothing to pay.</Text>
        </Card>
        {history}
      </Screen>
    );
  }

  // A fleet pays this driver's membership (functions/fleet.js).
  if (subscription?.paymentMethod === 'fleet') {
    return (
      <Screen>
        <ScreenHeader title="Membership" />
        <Card tone="dark" style={styles.hero}>
          <View style={styles.heroTop}>
            <Text style={styles.heroPlan}>Driver membership</Text>
            <StatusPill status="approved" label="Active" />
          </View>
          <Text style={[styles.heroPrice, { fontSize: 28 }]}>Paid by your fleet</Text>
          <Text style={styles.heroSub}>{subscription.fleetName || 'Your fleet'} pays your membership while you drive for them.</Text>
        </Card>
        {history}
      </Screen>
    );
  }

  if (status === 'suspended') {
    const owed = Number(subscription.debtAmount) || price;
    return (
      <Screen>
        <ScreenHeader title="Membership" />

        <Card tone="dark" style={styles.hero}>
          <View style={styles.heroTop}>
            <Text style={styles.heroPlan}>{planName(tier)}</Text>
            <StatusPill status="expired" label="Paused" />
          </View>
          <Text style={styles.heroPrice}>{money(owed)}</Text>
          <Text style={styles.heroSub}>unpaid</Text>
        </Card>

        <View style={styles.gap}>
          <Banner
            tone="danger"
            title="Your account is paused"
            body={`Your membership of ${money(owed)} is unpaid, so you cannot go online. Pay by card now to start driving again straight away.${companyDriver ? '' : ' Card rides you complete also top up your wallet; cash rides do not.'}`}
          />
        </View>
        <Button
          title={card ? `Pay ${money(owed)} by card` : 'Add a card to pay'}
          onPress={payByCard}
          loading={paying}
          style={{ marginTop: SPACE[4] }}
        />
        {cardRow}
        {history}
      </Screen>
    );
  }

  // Auto-renew was off and the period ended: buy again to drive.
  if (status === 'expired') {
    return (
      <Screen>
        <ScreenHeader title="Membership" />

        <Card tone="dark" style={styles.hero}>
          <View style={styles.heroTop}>
            <Text style={styles.heroPlan}>{planName(pick)}</Text>
            <StatusPill status="expired" label="Ended" />
          </View>
          <Text style={styles.heroPrice}>{money(planPrice(appConfig, pick))}</Text>
          <Text style={styles.heroSub}>{perPeriod(pick)}</Text>
        </Card>

        <View style={styles.gap}>
          <Banner
            tone="warning"
            title="Your membership has ended"
            body={`Auto-renew was off, so it ended${subscription.endedAt ? ` on ${shortDate(subscription.endedAt)}` : ''} and nothing more was taken. Buy again to go online.`}
          />
        </View>
        {planPicker(pick, setChosenTier)}
        <Button
          title={`Buy ${periodWord(pick)}ly plan · ${money(planPrice(appConfig, pick))}`}
          onPress={handleActivate}
          loading={loading}
          style={{ marginTop: SPACE[4] }}
        />
        {cardRow}
        {history}
      </Screen>
    );
  }

  /* ================= ACTIVE ================= */
  if (subscription && (status === 'active' || status === 'past_due')) {
    const debtAmount = Number(subscription.debtAmount) || 0;
    // Nothing paid yet: the driver cannot go online until this is settled.
    const firstMonthOwed = debtAmount > 0 && !subscription.lastPaidAt;
    const autoRenew = subscription.autoRenew !== false;
    const nextTier = subscription.nextTier && subscription.nextTier !== tier ? subscription.nextTier : null;

    return (
      <Screen>
        <ScreenHeader title="Membership" />

        <Card tone="dark" style={styles.hero}>
          <View style={styles.heroTop}>
            <Text style={styles.heroPlan}>{planName(tier)}</Text>
            {status === 'past_due' || firstMonthOwed ? (
              <StatusPill status="expiring" label="Payment due" />
            ) : !autoRenew ? (
              <StatusPill status="expiring" label="Ends soon" />
            ) : (
              <StatusPill status="approved" label="Active" />
            )}
          </View>
          <Text style={styles.heroPrice}>{money(price)}</Text>
          <Text style={styles.heroSub}>{`${perPeriod(tier)}, ${companyDriver ? 'charged to your card' : 'taken from your earnings'}`}</Text>
          <View style={styles.heroRenewal}>
            <Text style={styles.heroRenewalLabel}>{autoRenew ? 'Next payment' : 'Ends on'}</Text>
            <Text style={styles.heroRenewalValue}>{shortDate(subscription.nextBillingDate)}</Text>
          </View>
        </Card>

        {status === 'past_due' ? (
          <View style={styles.gap}>
            <Banner
              tone="warning"
              title="Payment due"
              body={`We could not take this ${periodWord(tier)}'s ${money(debtAmount || price)} from your ${companyDriver ? 'card' : 'wallet or card'}.${
                subscription.graceUntil ? ` Pay by ${shortDate(subscription.graceUntil)} to keep driving.` : ' Pay now to keep driving.'
              }`}
              action={
                <Button
                  title={card ? 'Pay by card now' : 'Add a card to pay'}
                  size="small"
                  onPress={payByCard}
                  loading={paying}
                />
              }
            />
          </View>
        ) : debtAmount > 0 ? (
          <View style={styles.gap}>
            <Banner
              tone="warning"
              title={`${money(debtAmount)} outstanding`}
              body={firstMonthOwed
                ? 'Pay this by card to go online.'
                : companyDriver
                ? 'This is charged to your saved card. You can pay it now.'
                : 'Card rides you complete top up your wallet and this is taken from it. Otherwise it is charged to your saved card.'}
              action={
                <Button
                  title={card ? 'Pay by card now' : 'Add a card to pay'}
                  size="small"
                  onPress={payByCard}
                  loading={paying}
                />
              }
            />
          </View>
        ) : null}

        <RowGroup
          style={{ marginTop: SPACE[4] }}
          items={[
            {
              icon: 'repeat-outline',
              iconColor: autoRenew ? COLORS.midnight : COLORS.muted,
              title: 'Auto-renew',
              detail: autoRenew
                ? `On: renews every ${periodWord(nextTier || tier)}`
                : `Off: ends ${shortDate(subscription.nextBillingDate)}, nothing more is taken`,
              right: (
                <Switch
                  value={autoRenew}
                  disabled={saving === 'autoRenew'}
                  onValueChange={confirmAutoRenew}
                  trackColor={{ true: COLORS.lime }}
                  accessibilityLabel="Auto-renew membership"
                />
              ),
            },
            {
              icon: 'calendar-outline',
              iconColor: COLORS.midnight,
              title: autoRenew ? 'Next payment' : 'Ends on',
              detail: shortDate(subscription.nextBillingDate),
            },
            { icon: 'wallet-outline', iconColor: COLORS.midnight, title: 'Paid from', detail: companyDriver ? 'Your saved card' : 'Your earnings wallet' },
            {
              icon: 'cash-outline',
              iconColor: COLORS.midnight,
              title: 'Amount',
              detail: nextTier
                ? `${money(price)} this ${periodWord(tier)}, then ${money(planPrice(appConfig, nextTier))} each ${periodWord(nextTier)}`
                : `${money(price)} each ${periodWord(tier)}`,
            },
          ]}
        />

        {plans.length > 1 ? (
          <Section title={nextTier ? `Switching to ${periodWord(nextTier)}ly on ${shortDate(subscription.nextBillingDate)}` : 'Your plan'} style={{ marginTop: SPACE[5] }}>
            {planPicker(nextTier || tier, switchPlan)}
          </Section>
        ) : null}

        <View style={styles.gap}>
          <Banner
            tone="info"
            body={!autoRenew
              ? `Auto-renew is off. Your membership ends on ${shortDate(subscription.nextBillingDate)} and nothing more is taken. Switch it back on to keep driving without a break.`
              : companyDriver
              ? `Your membership renews every ${periodWord(tier)} on the card below. Your card fares go to your fleet, so they do not build up a wallet here. If the card cannot be charged, you have a few days to pay before your account is paused.`
              : `Your membership renews every ${periodWord(tier)} from your wallet, which card rides top up (cash fares stay with you and do not count). If there is not enough in it, we charge the card below. If neither works, you have a few days to pay before your account is paused.`}
          />
        </View>
        {cardRow}
        {history}
      </Screen>
    );
  }

  /* ================= NOT YET ACTIVE ================= */
  const pickPrice = planPrice(appConfig, pick);
  return (
    <Screen>
      <ScreenHeader
        title="Activate your account"
        subtitle={plans.length > 1 ? 'Pick weekly or monthly, paid before you start driving.' : 'One monthly fee, paid before you start driving.'}
      />

      <Card tone="dark" style={styles.hero}>
        <Text style={styles.heroPlan}>{planName(pick)}</Text>
        <Text style={styles.heroPrice}>{money(pickPrice)}</Text>
        <Text style={styles.heroSub}>{perPeriod(pick)}</Text>
      </Card>

      {planPicker(pick, setChosenTier)}

      {/* Only what the platform genuinely does. */}
      <RowGroup
        style={{ marginTop: SPACE[4] }}
        items={[
          {
            icon: 'cash-outline',
            iconColor: COLORS.limeInk,
            title: 'You keep the whole fare',
            detail: 'No commission is taken from any ride',
          },
          {
            icon: 'infinite-outline',
            iconColor: COLORS.limeInk,
            title: 'No limit on jobs',
            detail: 'Take as much work as you like',
          },
          {
            icon: 'wallet-outline',
            iconColor: COLORS.limeInk,
            title: companyDriver ? 'Paid by card' : 'Paid from your wallet or card',
            detail: `First ${periodWord(pick)} before you go online. Renews automatically; switch it off any time.`,
          },
        ]}
      />

      <View style={styles.gap}>
        {approval && !approval.approved ? (
          <Banner
            tone={approval.rejected ? 'danger' : 'warning'}
            title={approval.rejected ? 'Application not approved' : 'Application under review'}
            body={
              approval.rejected
                ? approval.reason || 'Your application was not approved, so a membership cannot be started.'
                : 'You can activate your membership as soon as your application has been approved.'
            }
          />
        ) : (
          <Banner
            tone="info"
            body={companyDriver
              ? `We charge ${money(pickPrice)} to your saved card. You can go online once it is paid. Your card fares go to your fleet, so they do not build up a wallet here.`
              : `If your wallet already holds ${money(pickPrice)} we take it now. If not, we charge your saved card. You can go online once it is paid. Card rides you complete top up your wallet for next ${periodWord(pick)}; cash fares stay with you and do not count.`}
          />
        )}
      </View>

      {approval && !approval.approved ? null : (
        <Button
          title="Activate and start driving"
          onPress={handleActivate}
          loading={loading}
          style={{ marginTop: SPACE[6] }}
        />
      )}
      {history}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { marginTop: SPACE[5] },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE[3] },
  heroPlan: { ...TYPE.label, color: COLORS.lime },
  heroPrice: { ...TYPE.display, color: COLORS.white, marginTop: SPACE[2] },
  heroSub: { ...TYPE.small, color: COLORS.onDark, marginTop: 2 },
  heroRenewal: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: SPACE[5], paddingTop: SPACE[4],
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.midnightLine,
  },
  heroRenewalLabel: { ...TYPE.small, color: COLORS.onDark },
  heroRenewalValue: { ...TYPE.callout, color: COLORS.white },
  gap: { marginTop: SPACE[4] },
  plans: { marginTop: SPACE[4], gap: SPACE[2] },
});
