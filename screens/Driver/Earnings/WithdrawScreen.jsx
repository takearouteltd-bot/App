import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { getFirestore, doc, onSnapshot } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { currencySymbol, money, useAppConfig } from '../../../utils/appConfig';

export default function WithdrawScreen() {
  const navigation = useNavigation();
  const db = getFirestore();
  const auth = getAuth();
  const functions = getFunctions();

  const appConfig = useAppConfig();
  const [wallet, setWallet] = useState(null);
  const [driver, setDriver] = useState(null);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);

  const driverId = auth.currentUser ? auth.currentUser.uid : null;

  useEffect(() => {
    if (!driverId) return;

    // Listen to wallet
    const walletRef = doc(db, 'driverWallets', driverId);
    const unsubscribeWallet = onSnapshot(walletRef, (snapshot) => {
      if (snapshot.exists()) {
        setWallet(snapshot.data());
      }
    });

    // Listen to driver profile (for bank details)
    const driverRef = doc(db, 'drivers', driverId);
    const unsubscribeDriver = onSnapshot(driverRef, (snapshot) => {
      if (snapshot.exists()) {
        setDriver(snapshot.data());
      }
      setLoading(false);
    });

    return () => {
      unsubscribeWallet();
      unsubscribeDriver();
    };
  }, [driverId]);

  const availableBalance = wallet ? wallet.availableBalance : 0;
  // Minimum set on the dashboard (Settings, Drivers). Also enforced server-side.
  const minimumPayout = appConfig.drivers.minimumPayout;
  const belowMinimum = availableBalance < minimumPayout;
  const withdrawAmount = availableBalance; // Default to full balance

  const accountDetails = driver && driver.accountDetails ? driver.accountDetails : {};
  const accountHolder = accountDetails.accountHolder || '';
  const accountNumber = accountDetails.accountNumber || '';
  const sortCode = accountDetails.sortCode || '';

  // Mask account number for display (show last 4 digits)
  const maskedAccountNumber = accountNumber.length > 4
    ? '******' + accountNumber.slice(-4)
    : accountNumber;

  // Determine bank name from sort code (basic UK mapping)
  const getBankNameFromSortCode = (code) => {
    if (!code) return 'Bank Account';
    const firstTwo = code.replace(/-/g, '').substring(0, 2);
    
    const bankMap = {
      '01': 'Bank of England',
      '04': 'Monzo',
      '07': 'AIB',
      '09': 'Santander',
      '12': 'HSBC',
      '16': 'RBS',
      '18': 'Coutts',
      '20': 'Barclays',
      '23': 'Barclays',
      '30': 'Lloyds',
      '40': 'HSBC',
      '50': 'NatWest',
      '56': 'Santander',
      '57': 'NatWest',
      '60': 'NatWest',
      '77': 'Lloyds',
      '80': 'Barclays',
      '83': 'Royal Bank of Scotland',
    };
    
    return bankMap[firstTwo] || 'Bank Account';
  };

  const bankName = getBankNameFromSortCode(sortCode);

  const handleWithdraw = async () => {
    if (availableBalance <= 0) {
      Alert.alert('Error', 'You have no balance to withdraw');
      return;
    }

    if (belowMinimum) {
      Alert.alert('Not enough to withdraw', `The minimum withdrawal is ${money(minimumPayout)}.`);
      return;
    }

    if (!accountNumber || !sortCode) {
      Alert.alert('Error', 'Bank details not found. Please update your profile.');
      return;
    }

    setRequesting(true);

    try {
      const requestPayout = httpsCallable(functions, 'requestDriverPayout');
      const result = await requestPayout({
        driverId: driverId,
        amount: withdrawAmount,
      });

      Alert.alert(
        'Success',
        'Payout request submitted. It will be processed by admin shortly.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );

    } catch (error) {
      console.error('Withdrawal failed:', error);
      Alert.alert(
        'Error',
        error.message || 'Failed to request payout. Please try again.'
      );
    } finally {
      setRequesting(false);
    }
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
      {/* Upper Blue Section */}
      <View style={styles.upperContainer}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>

          <Text style={styles.headerTitle}>Withdraw Funds</Text>

          <TouchableOpacity>
            <Ionicons name="help-circle-outline" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>AVAILABLE BALANCE</Text>
          <Text style={styles.balanceValue}>
            {currencySymbol()}{availableBalance.toFixed(2)}
          </Text>
        </View>
      </View>

      {/* Lower Section */}
      <View style={styles.bottomContainer}>
        
        {/* Amount to Withdraw */}
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.label}>Amount to Withdraw</Text>

            <View style={styles.maxBadge}>
              <Text style={styles.maxText}>MAX</Text>
            </View>
          </View>

          <Text style={styles.amount}>
            {currencySymbol()}{withdrawAmount.toFixed(2)}
          </Text>
        </View>

        {/* Bank Details */}
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View>
              <Text style={styles.label}>Bank Account</Text>
              <Text style={styles.bankName}>{bankName}</Text>
              <Text style={styles.accountNumber}>{maskedAccountNumber}</Text>
              <Text style={styles.accountHolder}>{accountHolder}</Text>
            </View>

            <TouchableOpacity onPress={() => navigation.navigate('EditBankDetails')}>
              <Text style={styles.changeBtn}>Change</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Processing Time */}
        <View style={styles.card}>
          <Text style={styles.label}>Processing Time</Text>
          <Text style={styles.value}>
            Manual processing (1-2 business days)
          </Text>
        </View>

        {/* Transaction Fee */}
        <View style={styles.card}>
          <Text style={styles.label}>Transaction Fee</Text>
          <Text style={styles.freeText}>{money(0)}</Text>
          <Text style={styles.subNote}>
            Free withdrawal
          </Text>
        </View>
      </View>

      {/* Sticky Bottom Button */}
      <View style={styles.footer}>
        <TouchableOpacity
          onPress={handleWithdraw}
          disabled={requesting || availableBalance <= 0 || belowMinimum}
          style={[
            styles.confirmBtn,
            (requesting || availableBalance <= 0 || belowMinimum) && { opacity: 0.5 }
          ]}
        >
          {requesting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.confirmText}>
              Confirm Withdrawal
            </Text>
          )}
        </TouchableOpacity>
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
    height: '28%',
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 50,
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },

  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },

  balanceCard: {
    backgroundColor: '#D0E6FF',
    borderRadius: 18,
    padding: 18,
  },

  balanceLabel: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '600',
  },

  balanceValue: {
    fontSize: 26,
    fontWeight: '800',
    color: '#111827',
    marginTop: 4,
  },

  bottomContainer: {
    flex: 1,
    padding: 16,
  },

  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
  },

  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 6,
  },

  amount: {
    fontSize: 24,
    fontWeight: '700',
    color: '#235594',
    marginTop: 6,
  },

  bankName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },

  accountNumber: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },

  accountHolder: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },

  changeBtn: {
    color: '#235594',
    fontWeight: '600',
  },

  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  value: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },

  freeText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#16A34A',
  },

  subNote: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },

  maxBadge: {
    backgroundColor: '#79B531',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
  },

  maxText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },

  footer: {
    padding: 16,
    backgroundColor: '#f5f5f5',
  },

  confirmBtn: {
    backgroundColor: '#79B531',
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: 'center',
  },

  confirmText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
});