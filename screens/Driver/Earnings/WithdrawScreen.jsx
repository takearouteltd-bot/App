import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getFirestore, doc, onSnapshot } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { money, useAppConfig } from '../../../utils/appConfig';
import {
  COLORS,
  TYPE,
  SPACE,
  Card,
  Button,
  Banner,
  ScreenHeader,
} from '../../../components/ui/kit';

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
    if (!driverId) return undefined;

    const unsubscribeWallet = onSnapshot(doc(db, 'driverWallets', driverId), (snap) => {
      if (snap.exists()) setWallet(snap.data());
    });

    const unsubscribeDriver = onSnapshot(doc(db, 'drivers', driverId), (snap) => {
      if (snap.exists()) setDriver(snap.data());
      setLoading(false);
    });

    return () => {
      unsubscribeWallet();
      unsubscribeDriver();
    };
  }, [db, driverId]);

  const availableBalance = wallet ? wallet.availableBalance || 0 : 0;
  // Minimum set on the dashboard (Settings, Drivers). Also enforced server-side.
  const minimumPayout = appConfig.drivers.minimumPayout;
  const belowMinimum = availableBalance < minimumPayout;

  const accountDetails = (driver && driver.accountDetails) || {};
  const accountHolder = accountDetails.accountHolder || '';
  const accountNumber = accountDetails.accountNumber || '';
  const sortCode = accountDetails.sortCode || '';
  const hasBank = Boolean(accountNumber && sortCode);

  const maskedAccountNumber =
    accountNumber.length > 4 ? `······${accountNumber.slice(-4)}` : accountNumber;

  const handleWithdraw = async () => {
    if (availableBalance <= 0) {
      Alert.alert('Nothing to withdraw', 'Your available balance is zero.');
      return;
    }
    if (belowMinimum) {
      Alert.alert('Below the minimum', `The smallest withdrawal is ${money(minimumPayout)}.`);
      return;
    }
    if (!hasBank) {
      Alert.alert(
        'No bank details',
        'We do not have your bank details on file. Contact support to add them.'
      );
      return;
    }

    setRequesting(true);
    try {
      const requestPayout = httpsCallable(functions, 'requestDriverPayout');
      const result = await requestPayout({ driverId, amount: availableBalance });

      navigation.replace('WithdrawSuccess', {
        payoutId: result.data?.payoutId || null,
        amount: result.data?.amount ?? availableBalance,
        accountNumber: maskedAccountNumber,
        accountHolder,
      });
    } catch (error) {
      console.error('Withdrawal failed:', error);
      Alert.alert('Could not request', error.message || 'Please try again.');
      setRequesting(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, styles.centered]}>
        <ActivityIndicator size="large" color={COLORS.green} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader title="Withdraw" onBack={() => navigation.goBack()} />

        <Card tone="dark" style={styles.balance}>
          <Text style={styles.balanceLabel}>Available to withdraw</Text>
          <Text style={styles.balanceValue}>{money(availableBalance)}</Text>
          {wallet?.totalEarned ? (
            <Text style={styles.balanceSub}>{money(wallet.totalEarned)} earned in total</Text>
          ) : null}
        </Card>

        {belowMinimum && availableBalance > 0 ? (
          <Banner
            tone="warning"
            title={`Minimum is ${money(minimumPayout)}`}
            body="Keep earning and you will be able to withdraw."
          />
        ) : null}

        {!hasBank ? (
          <Banner
            tone="danger"
            title="No bank details on file"
            body="We cannot pay you out until your bank details are added. Contact support and they will set them up for you."
          />
        ) : (
          <Card style={{ marginTop: SPACE[4] }}>
            <Text style={TYPE.label}>Paying into</Text>
            <Text style={styles.bankValue}>{maskedAccountNumber}</Text>
            <Text style={TYPE.small}>
              Sort code {sortCode}
              {accountHolder ? ` · ${accountHolder}` : ''}
            </Text>
            <Text style={[TYPE.small, { marginTop: SPACE[3] }]}>
              To change these, contact support. Bank details cannot be edited in the app for
              security.
            </Text>
          </Card>
        )}

        <Card style={{ marginTop: SPACE[3] }}>
          <View style={styles.row}>
            <Text style={TYPE.body}>Amount</Text>
            <Text style={styles.rowValue}>{money(availableBalance)}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={TYPE.body}>Fee</Text>
            <Text style={styles.rowValue}>{money(0)}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={TYPE.body}>You receive</Text>
            <Text style={[styles.rowValue, { color: COLORS.navy }]}>{money(availableBalance)}</Text>
          </View>
        </Card>

        {/* Payouts are reviewed and sent by hand, so this does not promise a
            bank transfer that has not happened yet. */}
        <Text style={[TYPE.small, { marginTop: SPACE[4] }]}>
          Withdrawals are checked by our team before the transfer is sent, usually within 1 to 2
          working days.
        </Text>

        <Button
          title="Request withdrawal"
          onPress={handleWithdraw}
          loading={requesting}
          disabled={!hasBank || belowMinimum || availableBalance <= 0}
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

  balance: { marginTop: SPACE[5], marginBottom: SPACE[4] },
  balanceLabel: { ...TYPE.small, color: COLORS.onDark },
  balanceValue: { fontSize: 38, fontWeight: '800', color: COLORS.white, letterSpacing: -1.2, marginTop: 2 },
  balanceSub: { ...TYPE.small, color: COLORS.onDark, marginTop: 2 },

  bankValue: { fontSize: 18, fontWeight: '700', color: COLORS.ink, letterSpacing: 1, marginVertical: SPACE[1] },

  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACE[2] },
  rowValue: { fontSize: 16, fontWeight: '700', color: COLORS.ink },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.line },
});
