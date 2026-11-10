import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Alert } from '../../../components/ui/alert';
import { auth, db, functions } from '../../../config/firebase';
import { doc, collection, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useNavigation } from '@react-navigation/native';
import { money, useAppConfig } from '../../../utils/appConfig';
import {
  COLORS,
  TYPE,
  SPACE,
  Screen,
  Card,
  Button,
  Banner,
  RowGroup,
  StatusPill,
  ScreenHeader,
  Loading,
} from '../../../components/ui/kit';

export default function SubscriptionScreen() {
  // Price comes from the admin dashboard (Settings, Subscription).
  const appConfig = useAppConfig();
  const MONTHLY_PRICE = appConfig.subscription.monthlyPrice;

  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [subscription, setSubscription] = useState(null);
  const [approval, setApproval] = useState(null);
  // A company driver's card fares go to the fleet, so their wallet never
  // fills: their membership comes off their card.
  const [companyDriver, setCompanyDriver] = useState(false);
  const navigation = useNavigation();
  const driverId = auth.currentUser?.uid;

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
        Alert.alert('Membership paid', `${money(res.data?.amount ?? MONTHLY_PRICE)} was charged to your card.`);
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

  // Activation runs on the server (activateDriverMembership), which sets
  // the membership up and takes the first month from the wallet or card.
  // The app used to write the wallet balance itself.
  const handleActivate = async () => {
    if (!driverId) {
      Alert.alert('Not signed in', 'Please sign in again.');
      return;
    }
    setLoading(true);
    try {
      const activate = httpsCallable(functions, 'activateDriverMembership');
      const { data } = await activate({});

      // What was actually taken or is owed: a re-activated suspended driver
      // keeps their debt, which can differ from the monthly price.
      const amount = money(data?.amount ?? MONTHLY_PRICE);
      Alert.alert(
        data?.alreadyActive || data?.paid ? 'Membership active' : data?.stillSuspended ? 'Account still paused' : 'Payment needed',
        data?.alreadyActive
          ? 'Your membership is already active.'
          : data?.paid
          ? data.method === 'card'
            ? `${amount} was charged to your card. You are all set.`
            : `${amount} has been taken from your wallet. You are all set.`
          : data?.stillSuspended
          ? `${amount} is still unpaid, so your account stays paused. Pay it by card under Membership to start driving again.`
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

  const formatDate = (timestamp) => {
    if (!timestamp) return '—';
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch {
      return '—';
    }
  };

  if (checking) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  /* ================= ACTIVE ================= */
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
            <Text style={styles.heroPlan}>Monthly driver plan</Text>
            <StatusPill status="approved" label="Active" />
          </View>
          <Text style={[styles.heroPrice, { fontSize: 28 }]}>Paid by your fleet</Text>
          <Text style={styles.heroSub}>{subscription.fleetName || 'Your fleet'} pays your membership while you drive for them.</Text>
        </Card>
      </Screen>
    );
  }

  if (status === 'suspended') {
    return (
      <Screen>
        <ScreenHeader title="Membership" />

        <Card tone="dark" style={styles.hero}>
          <View style={styles.heroTop}>
            <Text style={styles.heroPlan}>Monthly driver plan</Text>
            <StatusPill status="expired" label="Paused" />
          </View>
          <Text style={styles.heroPrice}>{money(Number(subscription.debtAmount) || MONTHLY_PRICE)}</Text>
          <Text style={styles.heroSub}>unpaid</Text>
        </Card>

        <View style={styles.gap}>
          <Banner
            tone="danger"
            title="Your account is paused"
            body={`Your membership of ${money(Number(subscription.debtAmount) || MONTHLY_PRICE)} is unpaid, so you cannot go online. Pay by card now to start driving again straight away.${companyDriver ? '' : ' Card rides you complete also top up your wallet; cash rides do not.'}`}
          />
        </View>
        <Button
          title={card ? `Pay ${money(Number(subscription.debtAmount) || MONTHLY_PRICE)} by card` : 'Add a card to pay'}
          onPress={payByCard}
          loading={paying}
          style={{ marginTop: SPACE[4] }}
        />
        {cardRow}
      </Screen>
    );
  }

  if (subscription && (status === 'active' || status === 'past_due')) {
    const debtAmount = Number(subscription.debtAmount) || 0;
    // Nothing paid yet: the driver cannot go online until this is settled.
    const firstMonthOwed = debtAmount > 0 && !subscription.lastPaidAt;

    return (
      <Screen>
        <ScreenHeader title="Membership" />

        <Card tone="dark" style={styles.hero}>
          <View style={styles.heroTop}>
            <Text style={styles.heroPlan}>Monthly driver plan</Text>
            {status === 'past_due' || firstMonthOwed ? (
              <StatusPill status="expiring" label="Payment due" />
            ) : (
              <StatusPill status="approved" label="Active" />
            )}
          </View>
          <Text style={styles.heroPrice}>{money(MONTHLY_PRICE)}</Text>
          <Text style={styles.heroSub}>{companyDriver ? 'per month, charged to your card' : 'per month, taken from your earnings'}</Text>
          <View style={styles.heroRenewal}>
            <Text style={styles.heroRenewalLabel}>Next payment</Text>
            <Text style={styles.heroRenewalValue}>{formatDate(subscription.nextBillingDate)}</Text>
          </View>
        </Card>

        {status === 'past_due' ? (
          <View style={styles.gap}>
            <Banner
              tone="warning"
              title="Payment due"
              body={`We could not take this month's ${money(debtAmount || MONTHLY_PRICE)} from your ${companyDriver ? 'card' : 'wallet or card'}.${
                subscription.graceUntil ? ` Pay by ${formatDate(subscription.graceUntil)} to keep driving.` : ' Pay now to keep driving.'
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
              icon: 'calendar-outline',
              iconColor: COLORS.midnight,
              title: 'Next payment',
              detail: formatDate(subscription.nextBillingDate),
            },
            { icon: 'wallet-outline', iconColor: COLORS.midnight, title: 'Paid from', detail: companyDriver ? 'Your saved card' : 'Your earnings wallet' },
            {
              icon: 'cash-outline',
              iconColor: COLORS.midnight,
              title: 'Amount',
              detail: `${money(MONTHLY_PRICE)} each month`,
            },
          ]}
        />

        <View style={styles.gap}>
          <Banner
            tone="info"
            body={companyDriver
              ? 'Your membership renews every month on the card below. Your card fares go to your fleet, so they do not build up a wallet here. If the card cannot be charged, you have a few days to pay before your account is paused.'
              : 'Your membership renews every month from your wallet, which card rides top up (cash fares stay with you and do not count). If there is not enough in it, we charge the card below. If neither works, you have a few days to pay before your account is paused.'}
          />
        </View>
        {cardRow}
      </Screen>
    );
  }

  /* ================= NOT YET ACTIVE ================= */
  return (
    <Screen>
      <ScreenHeader
        title="Activate your account"
        subtitle="One monthly fee, paid before you start driving."
      />

      <Card tone="dark" style={styles.hero}>
        <Text style={styles.heroPlan}>Monthly driver plan</Text>
        <Text style={styles.heroPrice}>{money(MONTHLY_PRICE)}</Text>
        <Text style={styles.heroSub}>per month</Text>
      </Card>

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
            detail: 'First month before you go online',
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
              ? `We charge ${money(MONTHLY_PRICE)} to your saved card. You can go online once it is paid. Your card fares go to your fleet, so they do not build up a wallet here.`
              : `If your wallet already holds ${money(MONTHLY_PRICE)} we take it now. If not, we charge your saved card. You can go online once it is paid. Card rides you complete top up your wallet for next month; cash fares stay with you and do not count.`}
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
});
