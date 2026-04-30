import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { getFirestore, doc, onSnapshot, collection, query, orderBy } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

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

  const totalBalance = wallet ? wallet.availableBalance : 0;

  const filteredTransactions =
    selectedFilter === 'All'
      ? transactions
      : transactions.filter(t => {
          if (selectedFilter === 'Trip') return t.type === 'ride_earning';
          if (selectedFilter === 'Payout') return t.type === 'payout_request';
          if (selectedFilter === 'Subscription') return t.type === 'subscription';
          return true;
        });

  const formatDate = (timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };

  const renderTransaction = ({ item }) => {
    const isPositive = item.amount > 0;

    let iconName = 'car-outline';
    if (item.type === 'payout_request') iconName = 'arrow-down-outline';
    else if (item.type === 'subscription') iconName = 'calendar-outline';

    let title = item.description || item.type;
    if (item.type === 'ride_earning') title = 'Ride Earning';

    return (
      <View style={styles.transactionCard}>
        <View style={styles.transactionLeft}>
          <View style={styles.iconContainer}>
            <TouchableOpacity
            onPress={() => navigation.navigate('AdminPayout')}
            >
              <Ionicons name={iconName} size={20} color="#235594" />
            </TouchableOpacity>
          </View>

          <View>
            <Text style={styles.transactionTitle}>{title}</Text>
            <Text style={styles.transactionDate}>{formatDate(item.createdAt)}</Text>
          </View>
        </View>

        <Text
          style={[
            styles.transactionAmount,
            { color: isPositive ? '#16A34A' : '#DC2626' },
          ]}
        >
          {isPositive ? '+' : '-'}£{Math.abs(item.amount).toFixed(2)}
        </Text>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#235594" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Upper Half */}
      <View style={styles.upperContainer}>
        <View style={styles.header}>
          <View style={{ width: 28 }} />
          <Text style={styles.headerTitle}>My Wallet</Text>
          <TouchableOpacity>
            <Ionicons name="help-circle-outline" size={28} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>TOTAL BALANCE</Text>
          <Text style={styles.balanceValue}>£{totalBalance.toFixed(2)}</Text>
          <Text style={styles.balanceSubtext}>
            Available for immediate withdrawal
          </Text>

          <TouchableOpacity 
            onPress={() => navigation.navigate('WithdrawScreen')}
            style={[
              styles.withdrawBtn,
              totalBalance <= 0 && { opacity: 0.5 }
            ]}
            disabled={totalBalance <= 0}
          >
            <Ionicons
              name="wallet-outline"
              size={20}
              color="#fff"
              style={{ marginRight: 8 }}
            />
            <Text style={styles.withdrawBtnText}>Withdraw to Bank</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Bottom Half */}
      <View style={styles.bottomContainer}>
        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Total Earned</Text>
            <Text style={styles.statValue}>
              £{(wallet ? wallet.totalEarned : 0).toFixed(2)}
            </Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Pending</Text>
            <Text style={styles.statValue}>
              £{(wallet ? (wallet.pendingBalance || 0) : 0).toFixed(2)}
            </Text>
          </View>
        </View>

        {subscription && subscription.status === 'active' && (
  <View style={styles.subBanner}>
    <Ionicons name="calendar-outline" size={18} color="#235594" />
    <Text style={styles.subBannerText}>
      Next subscription due: {subscription.nextBillingDate ? subscription.nextBillingDate.toDate().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}
    </Text>
    <Text style={styles.subBannerAmount}>£{subscription.amount || 99.99}</Text>
  </View>
)}

{subscription && subscription.status === 'suspended' && (
  <View style={[styles.subBanner, { backgroundColor: '#FEF2F2', borderColor: '#EF4444' }]}>
    <Ionicons name="alert-circle-outline" size={18} color="#EF4444" />
    <Text style={[styles.subBannerText, { color: '#EF4444' }]}>
      Subscription suspended. Top up wallet to reactivate.
    </Text>
  </View>
)}

        {/* Transaction History Title */}
        <Text style={styles.sectionTitle}>Transaction History</Text>

        {/* Filters */}
        <View style={styles.filterContainer}>
          {['All', 'Trip', 'Payout'].map(filter => (
            <TouchableOpacity
              key={filter}
              style={[
                styles.filterButton,
                selectedFilter === filter && styles.activeFilter,
              ]}
              onPress={() => setSelectedFilter(filter)}
            >
              <Text
                style={[
                  styles.filterText,
                  selectedFilter === filter && styles.activeFilterText,
                ]}
              >
                {filter}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Transaction List */}
        <FlatList
          data={filteredTransactions}
          keyExtractor={item => item.id}
          renderItem={renderTransaction}
          contentContainerStyle={{ paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <Text style={{ textAlign: 'center', color: '#6B7280', marginTop: 40 }}>
              No transactions yet
            </Text>
          }
        />
      </View>
    </View>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  upperContainer: {
    backgroundColor: '#235594',
    height: '37%',
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 50,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
  },
  balanceCard: {
    backgroundColor: '#D0E6FF',
    borderRadius: 20,
    padding: 16,
  },
  balanceLabel: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '600',
  },
  balanceValue: {
    fontSize: 32,
    fontWeight: '800',
    color: '#111827',
  },
  subBanner: {
  flexDirection: 'row',
  alignItems: 'center',
  backgroundColor: '#EFF6FF',
  borderWidth: 1,
  borderColor: '#235594',
  borderRadius: 12,
  marginTop: 15,
  padding: 14,
  marginBottom: 10,
  gap: 10,
},
subBannerText: {
  flex: 1,
  fontSize: 13,
  fontWeight: '600',
  color: '#235594',
},
subBannerAmount: {
  fontSize: 14,
  fontWeight: '700',
  color: '#235594',
},
  balanceSubtext: {
    fontSize: 12,
    color: '#374151',
    marginBottom: 16,
  },
  withdrawBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#79B531',
    paddingVertical: 12,
    borderRadius: 25,
    justifyContent: 'center',
  },
  withdrawBtnText: {
    color: '#fff',
    fontWeight: '700',
  },
  bottomContainer: {
    flex: 1,
    paddingHorizontal: 16,
  },
  nextPayoutCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginTop: 15,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    elevation: 2,
  },
  nextPayoutLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
  },
  nextPayoutDate: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  nextPayoutSubtext: {
    fontSize: 12,
    color: '#6B7280',
  },
  scheduleBtn: {
    backgroundColor: '#D0E6FF',
    borderRadius: 20,
    padding: 10,
    marginLeft: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 20,
    marginBottom: 12,
  },
  filterContainer: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  filterButton: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#E5E7EB',
    marginRight: 10,
  },
  activeFilter: {
    backgroundColor: '#235594',
  },
  filterText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
  },
  activeFilterText: {
    color: '#fff',
  },
  transactionCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  transactionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    backgroundColor: '#E6F0FA',
    padding: 10,
    borderRadius: 12,
    marginRight: 12,
  },
  transactionTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  transactionDate: {
    fontSize: 12,
    color: '#6B7280',
  },
  transactionAmount: {
    fontSize: 14,
    fontWeight: '700',
  },
    statsRow: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 12,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '600',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
});
