import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ActivityIndicator, ScrollView } from 'react-native';
import { Alert } from '../../../components/ui/alert';
import { auth, db } from '../../../config/firebase';
import { doc, getDoc, updateDoc, Timestamp } from 'firebase/firestore';
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

  const handleActivate = async () => {
    if (!driverId) {
      Alert.alert('Not signed in', 'Please sign in again.');
      return;
    }
    setLoading(true);
    try {
      const driverRef = doc(db, 'drivers', driverId);
      const driverSnap = await getDoc(driverRef);
      if (!driverSnap.exists()) throw new Error('Driver profile not found.');

      const walletRef = doc(db, 'driverWallets', driverId);
      const walletSnap = await getDoc(walletRef);
      if (!walletSnap.exists()) throw new Error('Wallet not found.');

      const walletData = walletSnap.data();
      const available = walletData.availableBalance || 0;
      const now = new Date();
      const nextBilling = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
      const payingNow = available >= MONTHLY_PRICE;

      if (payingNow) {
        await updateDoc(walletRef, {
          availableBalance: available - MONTHLY_PRICE,
          totalWithdrawn: (walletData.totalWithdrawn || 0) + MONTHLY_PRICE,
          updatedAt: Timestamp.now(),
        });
      }

      await updateDoc(driverRef, {
        subscription: {
          status: 'active',
          tier: 'monthly',
          amount: MONTHLY_PRICE,
          nextBillingDate: Timestamp.fromDate(nextBilling),
          lastPaidAt: payingNow ? Timestamp.now() : null,
          paymentMethod: 'wallet_deduction',
          debtAmount: payingNow ? 0 : MONTHLY_PRICE,
        },
        // The field App.js and the profile screen actually read. This used to
        // write "onboardingCompleted", which nothing has ever read.
        onboardingComplete: true,
      });

      setOnboardingStatus?.('complete');

      Alert.alert(
        'Subscription active',
        payingNow
          ? `${money(MONTHLY_PRICE)} has been taken from your wallet. You are all set.`
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
        <ActivityIndicator size="large" color={COLORS.green} />
      </SafeAreaView>
    );
  }

  /* ================= ACTIVE ================= */
  if (subscription && subscription.status === 'active') {
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
            body="Your membership renews every month and comes out of your wallet. If there is not enough in it, your account is suspended until you have earned enough."
          />
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
            iconColor={COLORS.green}
            title="You keep the whole fare"
            detail="No commission is taken from any ride"
          />
          <ListRow
            icon="infinite-outline"
            iconColor={COLORS.green}
            title="No limit on jobs"
            detail="Take as much work as you like"
          />
          <ListRow
            icon="wallet-outline"
            iconColor={COLORS.green}
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
