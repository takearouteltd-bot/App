// components/PhoneCustomerCard.jsx
// The customer on a fleet's phone booking (functions/fleet.js). They have no
// passenger account, so there is no in-app chat or masked call: the driver
// sees their name, the office's notes, and can ring them directly.
import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Alert } from './ui/alert';
import { COLORS, TYPE, SPACE, RADIUS, Avatar, Button } from './ui/kit';

export default function PhoneCustomerCard({ ride, compact }) {
  const customer = ride?.customer || {};
  const name = customer.name || 'Customer';
  const call = () => {
    if (!customer.phone) return;
    Linking.openURL(`tel:${customer.phone}`).catch(() =>
      Alert.alert('Could not call', `Please dial ${customer.phone}.`)
    );
  };
  return (
    <View style={[styles.card, compact && styles.compact]}>
      <View style={styles.row}>
        <Avatar name={name} size={compact ? 40 : 48} />
        <View style={{ flex: 1 }}>
          <Text style={TYPE.subhead} numberOfLines={1}>{name}</Text>
          <Text style={TYPE.small} numberOfLines={1}>
            Phone booking · {ride?.fleetName || 'your fleet'}
          </Text>
        </View>
        {customer.phone ? (
          <Button size="small" variant="secondary" icon="call-outline" title="Call" onPress={call} />
        ) : null}
      </View>
      {ride?.notes ? (
        <View style={styles.notes}>
          <Text style={styles.notesText}>{ride.notes}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: SPACE[3], gap: SPACE[2] },
  compact: { marginTop: SPACE[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACE[3] },
  notes: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACE[3] },
  notesText: { color: COLORS.ink, fontSize: 14 },
});
