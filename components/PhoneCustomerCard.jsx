// components/PhoneCustomerCard.jsx
// The customer on a fleet's phone booking (functions/fleet.js). They have no
// passenger account, so there is no in-app chat. The driver sees their name
// and the office's notes, never their number: Call rings the driver's phone
// and puts them through (startMaskedCall), showing the customer the fleet's
// line, so neither side sees the other's number.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS, TYPE, SPACE, RADIUS, Avatar, Button } from './ui/kit';
import { confirmMaskedCall } from '../utils/calling';

export default function PhoneCustomerCard({ ride, rideId, compact }) {
  const customer = ride?.customer || {};
  const name = customer.name || 'Customer';
  const id = rideId || ride?.id;
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
        {customer.phone && id ? (
          <Button
            size="small"
            variant="secondary"
            icon="call-outline"
            title="Call"
            onPress={() => confirmMaskedCall(id, 'the customer')}
          />
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
