import React from 'react';
import { View, Text, StyleSheet, SafeAreaView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { money } from '../../../utils/appConfig';
import { COLORS, TYPE, SPACE, RADIUS, Card, Button } from '../../../components/ui/kit';

export default function WithdrawalSuccessScreen() {
  const navigation = useNavigation();
  const route = useRoute();

  // Passed through from the withdrawal that was actually requested. This
  // screen used to show a hardcoded amount, transaction id and date.
  const { payoutId, amount, accountNumber, accountHolder } = route.params || {};

  const requestedAt = new Date().toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <View style={styles.tick}>
          <Ionicons name="checkmark" size={38} color={COLORS.white} />
        </View>

        <Text style={styles.title}>Withdrawal requested</Text>
        <Text style={styles.amount}>{money(amount)}</Text>

        {/* Honest about what happens next: a person reviews it and sends the
            transfer. Nothing has left the bank yet. */}
        <Text style={styles.body}>
          Our team will check this and send the transfer, usually within 1 to 2 working days.
          You will get a notification when it has been paid.
        </Text>

        <Card style={styles.receipt}>
          <Row label="Requested" value={requestedAt} />
          {payoutId ? <Row label="Reference" value={String(payoutId).slice(0, 8).toUpperCase()} /> : null}
          {accountNumber ? <Row label="Paying into" value={accountNumber} /> : null}
          {accountHolder ? <Row label="Account name" value={accountHolder} last /> : null}
        </Card>
      </View>

      <View style={styles.footer}>
        <Button title="Back to earnings" onPress={() => navigation.replace('EarningsScreen')} />
      </View>
    </SafeAreaView>
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
  safe: { flex: 1, backgroundColor: COLORS.surface, justifyContent: 'space-between' },
  content: { paddingHorizontal: SPACE[5], paddingTop: SPACE[12], alignItems: 'center' },

  tick: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: SPACE[6],
  },
  title: { ...TYPE.title, textAlign: 'center' },
  amount: { fontSize: 40, fontWeight: '800', color: COLORS.navy, letterSpacing: -1.4, marginTop: SPACE[2] },
  body: {
    ...TYPE.body, color: COLORS.muted, textAlign: 'center',
    marginTop: SPACE[4], maxWidth: 320,
  },

  receipt: { alignSelf: 'stretch', marginTop: SPACE[8], paddingVertical: 0 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: SPACE[4], gap: SPACE[4],
  },
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.line },
  rowValue: { fontSize: 14, fontWeight: '700', color: COLORS.ink, flexShrink: 1, textAlign: 'right' },

  footer: { padding: SPACE[5] },
});
