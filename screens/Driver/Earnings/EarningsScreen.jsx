import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

export default function EarningsScreen() {
  const navigation = useNavigation();
  const totalBalance = 1245.75;

  const [selectedFilter, setSelectedFilter] = useState('All');

  const transactions = [
    {
      id: '1',
      type: 'Trip',
      title: 'Trip to Downtown',
      date: 'Oct 12',
      amount: 18.5,
    },
    {
      id: '2',
      type: 'Trip',
      title: 'Trip to Airport',
      date: 'Oct 10',
      amount: 32.0,
    },
    {
      id: '3',
      type: 'Subscription',
      title: 'Monthly Subscription',
      date: 'Oct 01',
      amount: -29.99,
    },
    {
      id: '4',
      type: 'Payout',
      title: 'Bank Withdrawal',
      date: 'Sep 30',
      amount: -150,
    },
  ];

  const filteredTransactions =
    selectedFilter === 'All'
      ? transactions
      : transactions.filter(t => t.type === selectedFilter);

  const renderTransaction = ({ item }) => {
    const isPositive = item.amount > 0;

    return (
      <View style={styles.transactionCard}>
        <View style={styles.transactionLeft}>
          <View style={styles.iconContainer}>
            <Ionicons
              name={
                item.type === 'Trip'
                  ? 'car-outline'
                  : item.type === 'Subscription'
                  ? 'calendar-outline'
                  : 'arrow-down-outline'
              }
              size={20}
              color="#235594"
            />
          </View>

          <View>
            <Text style={styles.transactionTitle}>{item.title}</Text>
            <Text style={styles.transactionDate}>{item.date}</Text>
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
          style={styles.withdrawBtn}>
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
        {/* Next Payout */}
        <TouchableOpacity style={styles.nextPayoutCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.nextPayoutLabel}>Next Payout</Text>
            <Text style={styles.nextPayoutDate}>Wed Oct 18</Text>
            <Text style={styles.nextPayoutSubtext}>
              Scheduled automated payout to ****
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ fontWeight: '600', color: '#235594' }}>
              Schedule
            </Text>
            <View style={styles.scheduleBtn}>
              <Ionicons name="arrow-forward" size={20} color="#235594" />
            </View>
          </View>
        </TouchableOpacity>

        {/* Transaction History Title */}
        <Text style={styles.sectionTitle}>Transaction History</Text>

        {/* Filters */}
        <View style={styles.filterContainer}>
          {['All', 'Trip', 'Subscription', 'Payout'].map(filter => (
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
});
