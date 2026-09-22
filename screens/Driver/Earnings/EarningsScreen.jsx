import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { getFirestore, doc, onSnapshot, collection, query, orderBy } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { money, useAppConfig } from '../../../utils/appConfig';
import { COLORS, TYPE, Card, Button, EmptyState, Loading } from '../../../components/ui/kit';

export default function EarningsScreen() {
  const navigation = useNavigation();
  const db = getFirestore();
  const auth = getAuth();
  
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFilter, setSelectedFilter] = useState('All');
  const [subscription, setSubscription] = useState(null);

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
    
    const unsubscribeTx = onSnapshot(txQuery, (snapshot) => {
      const txList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
      setTransactions(txList);
      setLoading(false);
    });

    const driverRef = doc(db, 'drivers', driverId);
const unsubscribeSub = onSnapshot(driverRef, (snapshot) => {
  if (snapshot.exists()) {
    setSubscription(snapshot.data().subscription || null);
  }
});

    return () => {
      unsubscribeWallet();
      unsubscribeTx();
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

  const renderTransaction = ({ item }) => {
    const amount = Number(item.amount) || 0;
    const isPositive = amount > 0;
    let icon = 'car-outline';
    let title = item.description || item.type;
    if (item.type === 'ride_earning') title = 'Trip earnings';
    if (item.type === 'payout_request' || item.type === 'payout') icon = 'arrow-down-outline';
    if (isSubscription(item)) icon = 'calendar-outline';

    return (
      <View style={styles.txRow}>
        <View style={[styles.txIcon, { backgroundColor: isPositive ? COLORS.greenSoft : COLORS.blueSoft }]}>
          <Ionicons name={icon} size={18} color={isPositive ? COLORS.success : COLORS.blue} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.txTitle} numberOfLines={1}>{title}</Text>
          <Text style={TYPE.small}>{formatDate(item.createdAt)}</Text>
        </View>
        <Text style={[styles.txAmount, { color: isPositive ? COLORS.success : COLORS.ink }]}>
          {isPositive ? '+' : '-'}{money(Math.abs(amount))}
        </Text>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <Loading />
      </SafeAreaView>
    );
  }

  const header = (
    <View>
      <Text style={[TYPE.title, { marginTop: 8 }]}>Earnings</Text>

      {/* The one bold element on this screen: the balance you can take out. */}
      <View style={styles.balance}>
        <Text style={styles.balanceLabel}>Available to withdraw</Text>
        <Text style={styles.balanceValue}>{money(totalBalance)}</Text>
        <Text style={styles.balanceSub}>
          {totalBalance < minimumPayout
            ? `You can withdraw once you reach ${money(minimumPayout)}.`
            : 'Paid to your bank after admin approval.'}
        </Text>
        <Button
          title="Withdraw to bank"
          icon="wallet-outline"
          style={styles.withdrawBtn}
          disabled={totalBalance <= 0 || totalBalance < minimumPayout}
          onPress={() => navigation.navigate('WithdrawScreen')}
        />
      </View>

      <View style={styles.stats}>
        <Card style={styles.stat}>
          <Text style={TYPE.small}>This week</Text>
          <Text style={styles.statValue}>{money(earnedThisWeek)}</Text>
        </Card>
        <Card style={styles.stat}>
          <Text style={TYPE.small}>All time</Text>
          <Text style={styles.statValue}>{money(wallet ? wallet.totalEarned || 0 : 0)}</Text>
        </Card>
        <Card style={styles.stat}>
          <Text style={TYPE.small}>Pending</Text>
          <Text style={styles.statValue}>{money(wallet ? wallet.pendingBalance || 0 : 0)}</Text>
        </Card>
      </View>

      {subscription && subscription.status === 'active' ? (
        <Card style={{ marginTop: 12 }}>
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
        <Card tone="danger" style={{ marginTop: 12 }}>
          <Text style={[styles.txTitle, { color: COLORS.red }]}>Subscription suspended</Text>
          <Text style={TYPE.small}>Complete trips to top up your wallet and it will restart automatically.</Text>
        </Card>
      ) : null}

      <Text style={[TYPE.heading, { marginTop: 24, marginBottom: 10 }]}>Activity</Text>
      <View style={styles.filters}>
        {['All', 'Trips', 'Payouts', 'Subscription'].map((f) => {
          const active = selectedFilter === f;
          return (
            <TouchableOpacity key={f} onPress={() => setSelectedFilter(f)} style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && { color: COLORS.white }]}>{f}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={filteredTransactions}
        keyExtractor={(item) => item.id}
        renderItem={renderTransaction}
        ListHeaderComponent={header}
        contentContainerStyle={styles.content}
        ListEmptyComponent={
          <EmptyState
            icon="receipt-outline"
            title="Nothing here yet"
            body={selectedFilter === 'All' ? 'Trip earnings and payouts will show here.' : 'Nothing in this category yet.'}
          />
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.surface },
  content: { padding: 20, paddingBottom: 48 },
  balance: {
    marginTop: 16,
    backgroundColor: COLORS.navy,
    borderRadius: 22,
    padding: 22,
  },
  balanceLabel: { fontSize: 14, fontWeight: '600', color: COLORS.onDark },
  balanceValue: { fontSize: 40, fontWeight: '800', color: COLORS.white, letterSpacing: -1, marginTop: 4 },
  balanceSub: { fontSize: 13, color: COLORS.onDark, marginTop: 4 },
  withdrawBtn: { marginTop: 18 },
  stats: { flexDirection: 'row', gap: 10, marginTop: 12 },
  stat: { flex: 1, padding: 12 },
  statValue: { fontSize: 17, fontWeight: '800', color: COLORS.navy, marginTop: 4 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.white,
  },
  chipActive: { backgroundColor: COLORS.navy, borderColor: COLORS.navy },
  chipText: { fontSize: 14, fontWeight: '600', color: COLORS.ink },
  txRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.line,
  },
  txIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  txTitle: { fontSize: 15, fontWeight: '600', color: COLORS.ink },
  txAmount: { fontSize: 15, fontWeight: '700' },
});
