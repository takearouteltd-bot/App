// components/ModeSwitchRow.jsx
// "Switch to driving" / "Switch to passenger" on the account screens.
//
// One account can be both. utils/modeSwitch.js does the checking and the
// setting up; this row describes the other mode, confirms the change, and
// reports anything that stops it. On success App.js swaps the navigator, so
// this component is unmounted rather than navigating anywhere itself.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Alert } from './ui/alert';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, Card, ListRow } from './ui/kit';
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
  const icon = target === 'driver' ? 'car-sport-outline' : 'person-outline';
  const iconColor = copy.tone === 'warning' ? COLORS.amber : COLORS.green;

  return (
    <View>
      <Card style={{ paddingVertical: 0 }}>
        <ListRow
          icon={icon}
          iconColor={iconColor}
          title={copy.title}
          detail={switching ? 'Switching…' : copy.detail}
          onPress={switching ? undefined : onPress}
          last
        />
      </Card>
    </View>
  );
}
