import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ActivityIndicator, ScrollView } from 'react-native';
import { Alert } from '../../../components/ui/alert';
import { auth, db, functions } from '../../../config/firebase';
import { doc, getDoc, collection, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useNavigation } from '@react-navigation/native';
import { money, useAppConfig } from '../../../utils/appConfig';
import {
  COLORS,
  TYPE,
  SPACE,
  Card,
  Button,
  Banner,
  ListRow,
  StatusPill,
  ScreenHeader,
} from '../../../components/ui/kit';

export default function SubscriptionScreen({ setOnboardingStatus }) {
  // Price comes from the admin dashboard (Settings, Subscription).
  const appConfig = useAppConfig();
  const MONTHLY_PRICE = appConfig.subscription.monthlyPrice;

  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [subscription, setSubscription] = useState(null);
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
      Alert.alert('Membership paid', `${money(res.data?.amount ?? MONTHLY_PRICE)} was charged to your card.`);
      await loadSubscription();
    } catch (error) {
      Alert.alert('Payment did not go through', error.message || 'Please try again.');
    } finally {
      setPaying(false);
    }
  };

  const loadSubscription = useCallback(async () => {
    if (!driverId) {
      setChecking(false);
      return;
    }
    try {
      const snap = await getDoc(doc(db, 'drivers', driverId));
      setSubscription(snap.exists() ? snap.data().subscription || null : null);
    } catch (err) {
      console.log('Error fetching subscription:', err);
    } finally {
      setChecking(false);
    }
  }, [driverId]);

  useEffect(() => {
    loadSubscription();
  }, [loadSubscription]);

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

      setOnboardingStatus?.('complete');

      Alert.alert(
        'Membership active',
        data?.alreadyActive
          ? 'Your membership is already active.'
          : data?.paid
          ? data.method === 'card'
            ? `${money(MONTHLY_PRICE)} was charged to your card. You are all set.`
            : `${money(MONTHLY_PRICE)} has been taken from your wallet. You are all set.`
          : `${money(MONTHLY_PRICE)} will come out of your earnings as soon as your wallet reaches that amount.`
      );

      // Staying put and re-reading, rather than replacing to a screen in
      // another tab's stack, which throws.
      await loadSubscription();
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
      <SafeAreaView style={[styles.safe, styles.centered]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </SafeAreaView>
    );
  }

  /* ================= ACTIVE ================= */
  const status = subscription?.status;
  const cardLabel = card ? `${(card.brand || 'Card').toUpperCase()} ···· ${card.last4}` : null;
  const cardRow = (
    <Card flush style={{ marginTop: SPACE[4] }}>
      <ListRow
        icon="card-outline"
        title="Card for membership"
        detail={cardLabel || 'Used if your wallet is short at renewal'}
        onPress={openCards}
        last
      />
    </Card>
  );

  if (status === 'suspended') {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ScreenHeader title="Membership" />

          {status === 'past_due' ? (
            <Banner
              tone="warning"
              title="Payment due"
              body={`We could not take this month's ${money(MONTHLY_PRICE)} from your wallet or card. Pay by ${formatDate(subscription.graceUntil)} to keep driving.`}
              action={
                <Button
                  title={card ? 'Pay by card now' : 'Add a card'}
                  size="small"
                  onPress={payByCard}
                  loading={paying}
                />
              }
            />
          ) : null}
          <Banner
            tone="danger"
            title="Your account is paused"
            body={`Your membership of ${money(Number(subscription.debtAmount) || MONTHLY_PRICE)} is unpaid, so you cannot go online. Pay now to start driving again straight away, or it is taken automatically once your wallet can cover it.`}
          />
          <Button
            title={card ? `Pay ${money(Number(subscription.debtAmount) || MONTHLY_PRICE)} by card` : 'Add a card to pay'}
            onPress={payByCard}
            loading={paying}
            style={{ marginTop: SPACE[4] }}
          />
          {cardRow}
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (subscription && (status === 'active' || status === 'past_due')) {
    const debtAmount = Number(subscription.debtAmount) || 0;

    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ScreenHeader title="Membership" />

          <Card tone="dark" style={styles.hero}>
            <View style={styles.heroTop}>
              <Text style={styles.heroPlan}>Monthly driver plan</Text>
              <StatusPill status="approved" label="Active" />
            </View>
            <Text style={styles.heroPrice}>{money(MONTHLY_PRICE)}</Text>
            <Text style={styles.heroSub}>per month, taken from your earnings</Text>
          </Card>

          {debtAmount > 0 ? (
            <Banner
              tone="warning"
              title={`${money(debtAmount)} outstanding`}
              body="This comes out automatically as soon as your wallet reaches that amount."
            />
          ) : null}

          <Card flush style={{ marginTop: SPACE[4] }}>
            <ListRow
              icon="calendar-outline"
              title="Next payment"
              detail={formatDate(subscription.nextBillingDate)}
            />
            <ListRow icon="wallet-outline" title="Paid from" detail="Your earnings wallet" />
            <ListRow
              icon="cash-outline"
              title="Amount"
              detail={`${money(MONTHLY_PRICE)} each month`}
              last
            />
          </Card>

          <Banner
            tone="info"
            body="Your membership renews every month from your wallet. If there is not enough in it, we charge the card below. If neither works, you have a few days to pay before your account is paused."
          />
          {cardRow}
        </ScrollView>
      </SafeAreaView>
    );
  }

  /* ================= NOT YET ACTIVE ================= */
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          title="Activate your account"
          subtitle="One monthly fee, taken from what you earn."
        />

        <Card tone="dark" style={styles.hero}>
          <Text style={styles.heroPlan}>Monthly driver plan</Text>
          <Text style={styles.heroPrice}>{money(MONTHLY_PRICE)}</Text>
          <Text style={styles.heroSub}>per month</Text>
        </Card>

        {/* Only what the platform genuinely does. */}
        <Card flush style={{ marginTop: SPACE[4] }}>
          <ListRow
            icon="cash-outline"
            iconColor={COLORS.primary}
            title="You keep the whole fare"
            detail="No commission is taken from any ride"
          />
          <ListRow
            icon="infinite-outline"
            iconColor={COLORS.primary}
            title="No limit on jobs"
            detail="Take as much work as you like"
          />
          <ListRow
            icon="wallet-outline"
            iconColor={COLORS.primary}
            title="Paid from your earnings"
            detail="Nothing to pay up front"
            last
          />
        </Card>

        <Banner
          tone="info"
          body={`If your wallet already holds ${money(MONTHLY_PRICE)} we take it now. If not, it comes out automatically once you have earned enough.`}
        />

        <Button
          title="Activate and start driving"
          onPress={handleActivate}
          loading={loading}
          style={{ marginTop: SPACE[6] }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.surface },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: SPACE[5], paddingBottom: SPACE[12] },

  hero: { marginTop: SPACE[5] },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroPlan: { ...TYPE.small, color: COLORS.onDark },
  heroPrice: { fontSize: 40, fontWeight: '800', color: COLORS.white, letterSpacing: -1.4, marginTop: SPACE[2] },
  heroSub: { ...TYPE.small, color: COLORS.onDark, marginTop: 2 },
});
