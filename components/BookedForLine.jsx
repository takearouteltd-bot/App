/* On the booker's screens of a ride booked for someone else: who it is for,
   and whether they get the driver's texts. See utils/bookingFor.js. */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACE, TYPE } from './ui/kit';

export default function BookedForLine({ ride, live, style }) {
  const pf = ride?.passengerFor;
  if (!pf?.name) return null;
  const note = !live
    ? ''
    : pf.hasPhone
    ? ' · we text them when the driver is on the way and outside'
    : ' · the driver will call you';
  return (
    <View style={[styles.row, style]}>
      <Ionicons name="people-outline" size={16} color={COLORS.midnight} />
      <Text style={styles.text} numberOfLines={2}>
        For {pf.name}
        <Text style={styles.note}>{note}</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE[2],
    backgroundColor: COLORS.limeSoft,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACE[3],
    paddingVertical: SPACE[2],
  },
  text: { flex: 1, ...TYPE.small, color: COLORS.midnight, fontWeight: '700' },
  note: { fontWeight: '400', color: COLORS.ink },
});
