// components/ModeSwitchRow.jsx
// "Switch to driving" / "Switch to passenger" on the account screens.
//
// One account can be both. utils/modeSwitch.js does the checking and the
// setting up; this row describes the other mode, confirms the change, and
// reports anything that stops it. On success App.js swaps the navigator, so
// this component is unmounted rather than navigating anywhere itself.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Alert } from './ui/alert';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, RADIUS, SPACE } from './ui/kit';
import { describeMode, loadModeRecord, otherMode, switchMode } from '../utils/modeSwitch';

export default function ModeSwitchRow({ uid, currentRole }) {
  const target = otherMode(currentRole);
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const alive = useRef(true);

  useEffect(() => () => {
    alive.current = false;
  }, []);

  // Re-read on focus: an admin may have approved the driver application, or
  // the person may have finished onboarding, since this screen last rendered.
  const load = useCallback(() => {
    if (!uid) {
      setLoading(false);
      return;
    }
    loadModeRecord(target, uid)
      .then((data) => {
        if (alive.current) setRecord(data);
      })
      .catch(() => null)
      .finally(() => {
        if (alive.current) setLoading(false);
      });
  }, [uid, target]);

  useFocusEffect(load);

  const run = useCallback(async () => {
    setSwitching(true);
    try {
      await switchMode(uid, target);
      // App.js's users/{uid} listener takes it from here.
    } catch (error) {
      if (alive.current) setSwitching(false);
      Alert.alert('Cannot switch yet', error?.message || 'Please try again.');
    }
  }, [uid, target]);

  const onPress = useCallback(() => {
    const copy = describeMode(target, record);
    Alert.alert(copy.confirmTitle, copy.confirmBody, [
      { text: 'Not now', style: 'cancel' },
      { text: copy.confirmAction, onPress: run },
    ]);
  }, [target, record, run]);

  if (!uid || loading) return null;

  const copy = describeMode(target, record);

  // Both modes get the same bold black box, easy to spot at a glance.
  const label = target === 'rider' ? 'PASSENGER MODE' : 'DRIVER MODE';
  const icon = target === 'driver' ? 'car-sport-outline' : 'person-outline';
  // A driver application still in progress or under review.
  const pending = copy.tone === 'warning';

  return (
    <TouchableOpacity
      style={[styles.box, switching && { opacity: 0.7 }]}
      onPress={switching ? undefined : onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={copy.title}
    >
      <Ionicons name={icon} size={22} color={COLORS.lime} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{label}</Text>
        <Text style={[styles.detail, pending && styles.detailPending]}>
          {switching ? 'Switching…' : copy.detail}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={COLORS.lime} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE[3],
    backgroundColor: COLORS.midnight,
    borderRadius: RADIUS.lg,
    paddingVertical: SPACE[4],
    paddingHorizontal: SPACE[5],
  },
  title: { color: COLORS.lime, fontSize: 17, fontWeight: '800', letterSpacing: 1.2 },
  detail: { color: COLORS.faint, fontSize: 13, marginTop: 2 },
  detailPending: { color: '#FCD34D' },
});
