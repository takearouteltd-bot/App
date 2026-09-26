import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { money } from '../../../utils/appConfig';
import { COLORS, TYPE, SPACE, Screen, Card, Button, Footer } from '../../../components/ui/kit';

export default function WithdrawalSuccessScreen() {
  const navigation = useNavigation();
  const route = useRoute();

  // Passed through from the withdrawal that was actually requested. This
  // screen used to show a hardcoded amount, transaction id and date.
  const { payoutId, amount, accountNumber, accountHolder, status } = route.params || {};
  const sent = status === 'completed';

  const requestedAt = new Date().toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Screen scroll={false}>
      <View style={styles.content}>
        <View style={styles.tick}>
          <Ionicons name="checkmark" size={40} color={COLORS.midnight} />
        </View>

        <Text style={styles.title}>{sent ? 'Payout sent' : 'Withdrawal requested'}</Text>
        <Text style={styles.amount}>{money(amount)}</Text>

        {/* Honest about what happens next: a person reviews it and sends the
            transfer. Nothing has left the bank yet. */}
        <Text style={styles.body}>
          {sent
            ? 'The transfer to your bank has been sent. Instant payouts arrive within minutes; others within 1 to 2 working days.'
            : 'Our team will check this and send the transfer, usually within 1 to 2 working days. You will get a notification when it has been paid.'}
        </Text>

        <Card flush style={styles.receipt}>
          <Row label={sent ? 'Sent' : 'Requested'} value={requestedAt} />
          {payoutId ? <Row label="Reference" value={String(payoutId).slice(0, 8).toUpperCase()} /> : null}
          {accountNumber ? <Row label="Paying into" value={accountNumber} /> : null}
          {accountHolder ? <Row label="Account name" value={accountHolder} last /> : null}
        </Card>
      </View>

      <Footer>
        <Button title="Back to earnings" onPress={() => navigation.replace('EarningsScreen')} />
      </Footer>
    </Screen>
  );
}

function Row({ label, value, last }) {
  return (
    <View style={[styles.row, !last && styles.rowLine]}>
      <Text style={TYPE.small}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingHorizontal: SPACE[5], paddingTop: SPACE[12], alignItems: 'center' },

  tick: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: COLORS.lime,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: SPACE[6],
  },
  title: { ...TYPE.title, textAlign: 'center' },
  amount: { ...TYPE.figure, fontSize: 40, letterSpacing: -1.4, marginTop: SPACE[2] },
  body: {
    ...TYPE.body, color: COLORS.muted, textAlign: 'center',
    marginTop: SPACE[4], maxWidth: 320,
  },

  receipt: { alignSelf: 'stretch', marginTop: SPACE[8] },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: SPACE[4], gap: SPACE[4],
  },
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.line },
  rowValue: { ...TYPE.callout, fontSize: 14, flexShrink: 1, textAlign: 'right' },
});
