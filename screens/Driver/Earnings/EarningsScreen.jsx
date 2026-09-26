import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getFirestore, doc, onSnapshot, collection, query, orderBy, where } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { money, useAppConfig } from '../../../utils/appConfig';
import {
  COLORS,
  TYPE,
  SPACE,
  RADIUS,
  Screen,
  ScreenHeader,
  Section,
  Card,
  ListRow,
  Button,
  Chip,
  StatRow,
  EmptyState,
  Loading,
  Banner,
} from '../../../components/ui/kit';

export default function EarningsScreen() {
  const navigation = useNavigation();
  const db = getFirestore();
  const auth = getAuth();

  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFilter, setSelectedFilter] = useState('All');
  const [subscription, setSubscription] = useState(null);
  const [loadError, setLoadError] = useState(false);
  // Withdrawals requested but not yet approved by an admin.
  const [awaitingPayout, setAwaitingPayout] = useState(0);

  const driverId = auth.currentUser ? auth.currentUser.uid : null;
  const appConfig = useAppConfig();

  useEffect(() => {
    if (!driverId) return;

    // Listen to wallet document
    const walletRef = doc(db, 'driverWallets', driverId);
    const unsubscribeWallet = onSnapshot(walletRef, (snapshot) => {
      if (snapshot.exists()) {
        setWallet(snapshot.data());
      } else {
        setWallet({
          availableBalance: 0,
          totalEarned: 0,
          pendingBalance: 0,
        });
      }
    });

    // Listen to transactions subcollection
    const txQuery = query(
      collection(db, 'driverWallets', driverId, 'transactions'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribeTx = onSnapshot(
      txQuery,
      (snapshot) => {
        const txList = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));
        setTransactions(txList);
        setLoadError(false);
        setLoading(false);
      },
      (error) => {
        console.log('Transactions load error:', error);
        setLoadError(true);
        setLoading(false);
      }
    );

    const payoutsQuery = query(
      collection(db, 'driverPayouts'),
      where('driverId', '==', driverId),
      where('status', '==', 'pending_admin')
    );
    const unsubscribePayouts = onSnapshot(
      payoutsQuery,
      (snapshot) => {
        setAwaitingPayout(
          snapshot.docs.reduce((sum, d) => sum + (Number(d.data().amount) || 0), 0)
        );
      },
      () => setAwaitingPayout(0)
    );

    const driverRef = doc(db, 'drivers', driverId);
const unsubscribeSub = onSnapshot(driverRef, (snapshot) => {
  if (snapshot.exists()) {
    setSubscription(snapshot.data().subscription || null);
  }
});

    return () => {
      unsubscribeWallet();
      unsubscribeTx();
      unsubscribePayouts();
      unsubscribeSub();
    };
  }, [driverId]);

  const totalBalance = wallet ? wallet.availableBalance || 0 : 0;
  const minimumPayout = appConfig.drivers.minimumPayout;

  // Subscription deductions are written as "subscription_deduction" by the
  // payment function; the old filter looked for "subscription" and found none.
  const isSubscription = (t) => t.type === 'subscription_deduction' || t.type === 'subscription';
  const filteredTransactions =
    selectedFilter === 'All'
      ? transactions
      : transactions.filter((t) => {
          if (selectedFilter === 'Trips') return t.type === 'ride_earning';
          if (selectedFilter === 'Payouts') return t.type === 'payout_request' || t.type === 'payout';
          if (selectedFilter === 'Subscription') return isSubscription(t);
          return true;
        });

  // Earned this week (Monday onwards), from trip earnings.
  const weekStart = (() => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getTime();
  })();
  const earnedThisWeek = transactions
    .filter((t) => t.type === 'ride_earning' && (t.createdAt?.toMillis?.() || 0) >= weekStart)
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

  const formatDate = (timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' +
      date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  };

  const renderTransaction = ({ item, index }) => {
    const amount = Number(item.amount) || 0;
    const isPositive = amount > 0;
    let icon = 'car-outline';
    let title = item.description || item.type;
    if (item.type === 'ride_earning') title = 'Trip earnings';
    if (item.type === 'payout_request' || item.type === 'payout') icon = 'arrow-down-outline';
    if (isSubscription(item)) icon = 'calendar-outline';

    return (
      <View style={[styles.txCard, index === 0 && styles.txCardFirst, index === filteredTransactions.length - 1 && styles.txCardLast]}>
        <ListRow
          icon={icon}
          iconColor={isPositive ? COLORS.limeInk : COLORS.midnight}
          title={title}
          detail={formatDate(item.createdAt)}
          last={index === filteredTransactions.length - 1}
          right={
            <Text style={[styles.txAmount, { color: isPositive ? COLORS.success : COLORS.ink }]}>
              {isPositive ? '+' : '-'}{money(Math.abs(amount))}
            </Text>
          }
        />
      </View>
    );
  };

  if (loading) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  const header = (
    <View>
      <ScreenHeader title="Earnings" />

      {/* The one bold element on this screen: the balance you can take out. */}
      <Card tone="dark" style={styles.hero}>
        <Text style={styles.heroLabel}>Available balance</Text>
        <Text style={styles.heroValue}>{money(totalBalance)}</Text>
        <Text style={styles.heroSub}>
          {totalBalance < minimumPayout
            ? `You can withdraw once you reach ${money(minimumPayout)}.`
            : 'Paid to your bank after admin approval.'}
        </Text>

        <StatRow
          tone="onDark"
          style={styles.heroStats}
          items={[
            { value: money(earnedThisWeek), label: 'This week' },
            { value: money(wallet ? wallet.totalEarned || 0 : 0), label: 'All time' },
            { value: money(awaitingPayout), label: 'Awaiting payout' },
          ]}
        />

        <Button
          title="Withdraw to bank"
          variant="accent"
          icon="wallet-outline"
          style={styles.withdrawBtn}
          disabled={totalBalance <= 0 || totalBalance < minimumPayout}
          onPress={() => navigation.navigate('WithdrawScreen')}
        />
      </Card>

      {subscription && subscription.status === 'active' ? (
        <Card style={{ marginTop: SPACE[3] }}>
          <Text style={styles.txTitle}>Subscription {money(appConfig.subscription.monthlyPrice)} a month</Text>
          <Text style={TYPE.small}>
            Next payment{' '}
            {subscription.nextBillingDate?.toDate
              ? subscription.nextBillingDate.toDate().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
              : 'date not set'}
            , taken from your wallet.
          </Text>
        </Card>
      ) : null}

      {subscription && subscription.status === 'suspended' ? (
        <Card tone="danger" style={{ marginTop: SPACE[3] }}>
          <Text style={[styles.txTitle, { color: COLORS.red }]}>Subscription suspended</Text>
          <Text style={TYPE.small}>Pay by card under Membership to start again, or complete card rides to top up your wallet.</Text>
        </Card>
      ) : null}

      {loadError ? (
        <View style={{ marginTop: SPACE[3] }}>
          <Banner
            tone="warning"
            title="Could not load your activity"
            body="Check your connection and open this screen again."
          />
        </View>
      ) : null}

      <Section title="Activity">
        <View style={styles.filters}>
          {['All', 'Trips', 'Payouts', 'Subscription'].map((f) => (
            <Chip
              key={f}
              label={f}
              active={selectedFilter === f}
              onPress={() => setSelectedFilter(f)}
            />
          ))}
        </View>
      </Section>
    </View>
  );

  return (
    <Screen scroll={false}>
      <FlatList
        data={filteredTransactions}
        keyExtractor={(item) => item.id}
        renderItem={renderTransaction}
        ListHeaderComponent={header}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <EmptyState
            icon="receipt-outline"
            title="Nothing here yet"
            body={selectedFilter === 'All' ? 'Trip earnings and payouts will show here.' : 'Nothing in this category yet.'}
          />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: SPACE[5], paddingBottom: SPACE[12] },

  hero: { marginTop: SPACE[5] },
  heroLabel: { ...TYPE.label, color: COLORS.lime },
  heroValue: { ...TYPE.display, color: COLORS.white, marginTop: SPACE[1] },
  heroSub: { ...TYPE.small, color: COLORS.onDark, marginTop: SPACE[1] },
  heroStats: { marginTop: SPACE[5], justifyContent: 'space-between' },
  withdrawBtn: { marginTop: SPACE[5] },

  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE[2] },

  // One white block for the whole list: rounded at the top of the first
  // row and the bottom of the last, straight edges in between.
  txCard: { backgroundColor: COLORS.white, paddingHorizontal: SPACE[4] },
  txCardFirst: { borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg },
  txCardLast: { borderBottomLeftRadius: RADIUS.lg, borderBottomRightRadius: RADIUS.lg },
  txTitle: { ...TYPE.callout },
  txAmount: { ...TYPE.callout },
});
