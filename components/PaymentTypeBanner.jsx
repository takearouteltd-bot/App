// components/PaymentTypeBanner.jsx
// Says plainly whether a job is paid in cash or by card, so a driver who
// does not take cash can tell before accepting.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACE } from './ui/kit';

export default function PaymentTypeBanner({ method, collectBy, account, style }) {
  const cash = method === 'cash';
  // A fleet's account job: the client is billed, the driver takes no money.
  if (collectBy === 'account') {
    return (
      <View
        style={[styles.banner, styles.card, style]}
        accessibilityLabel={`Account job for ${account?.company || 'a client'}. Do not take payment.`}
      >
        <Ionicons name="business-outline" size={20} color={COLORS.limeInk} />
        <Text style={[styles.title, { color: COLORS.limeInk }]}>ACCOUNT JOB</Text>
        <Text style={styles.detail}>{account?.company ? `${account.company}. ` : ''}Do not take payment</Text>
      </View>
    );
  }
  // A fleet's web booking the customer paid online: no money to take.
  if (collectBy === 'online') {
    return (
      <View
        style={[styles.banner, styles.card, style]}
        accessibilityLabel="Paid online. Do not take payment."
      >
        <Ionicons name="checkmark-circle-outline" size={20} color={COLORS.limeInk} />
        <Text style={[styles.title, { color: COLORS.limeInk }]}>PAID ONLINE</Text>
        <Text style={styles.detail}>Do not take payment</Text>
      </View>
    );
  }
  // A fleet's phone booking paid by card on the driver's own terminal.
  const terminal = cash && collectBy === 'card';
  if (terminal) {
    return (
      <View
        style={[styles.banner, styles.cash, style]}
        accessibilityLabel="Card job. Take the fare on your own card terminal."
      >
        <Ionicons name="card-outline" size={20} color={COLORS.amber} />
        <Text style={[styles.title, { color: COLORS.amber }]}>CARD JOB</Text>
        <Text style={styles.detail}>Take the fare on your terminal</Text>
      </View>
    );
  }
  return (
    <View
      style={[styles.banner, cash ? styles.cash : styles.card, style]}
      accessibilityLabel={cash ? 'Cash job. Collect the fare from the passenger.' : 'Card job. Paid in the app.'}
    >
      <Ionicons
        name={cash ? 'cash-outline' : 'card-outline'}
        size={20}
        color={cash ? COLORS.amber : COLORS.limeInk}
      />
      <Text style={[styles.title, { color: cash ? COLORS.amber : COLORS.limeInk }]}>
        {cash ? 'CASH JOB' : 'CARD JOB'}
      </Text>
      <Text style={styles.detail}>
        {cash ? 'Collect the fare from the passenger' : 'Paid in the app'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE[2],
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    paddingVertical: SPACE[2],
    paddingHorizontal: SPACE[3],
  },
  cash: { backgroundColor: COLORS.amberSoft, borderColor: '#FCD34D' },
  card: { backgroundColor: COLORS.limeSoft, borderColor: COLORS.limeLine },
  title: { fontSize: 14, fontWeight: '800', letterSpacing: 0.8 },
  detail: { flex: 1, fontSize: 13, color: COLORS.inkSoft },
});
