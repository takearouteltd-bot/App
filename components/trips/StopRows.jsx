// The stops on a booked trip, shown under its RouteLine, and the numbered pin
// for them on the map. Passenger screens only.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, TYPE, SPACE } from '../ui/kit';
import { stopsOf } from '../../utils/stops';

export function StopPin({ number }) {
  return (
    <View style={styles.pin}>
      <Text style={styles.pinText}>{number}</Text>
    </View>
  );
}

// Stops the driver has already reached are greyed out.
export default function StopRows({ ride, style }) {
  const stops = stopsOf(ride);
  if (!stops.length) return null;
  const reached = Math.max(0, Number(ride?.stopsCompleted) || 0);
  return (
    <View style={[styles.wrap, style]}>
      <Text style={TYPE.label}>{stops.length === 1 ? 'Stop on the way' : 'Stops on the way'}</Text>
      {stops.map((s, i) => (
        <View key={`stop-${i}`} style={styles.row}>
          <View style={[styles.dot, i < reached && styles.dotDone]}>
            <Text style={styles.dotText}>{i + 1}</Text>
          </View>
          <Text style={[styles.text, i < reached && { color: COLORS.muted }]} numberOfLines={2}>
            {s.address || 'Stop'}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: SPACE[3], gap: SPACE[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACE[3] },
  dot: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.midnight,
    alignItems: 'center', justifyContent: 'center',
  },
  dotDone: { backgroundColor: COLORS.faint },
  dotText: { fontSize: 11, fontWeight: '800', color: COLORS.lime },
  text: { flex: 1, ...TYPE.small, color: COLORS.ink },
  pin: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.midnight,
    borderWidth: 2, borderColor: COLORS.white, alignItems: 'center', justifyContent: 'center',
  },
  pinText: { fontSize: 11, fontWeight: '800', color: COLORS.lime },
});
