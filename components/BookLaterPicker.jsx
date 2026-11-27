// Picking a pickup time for a ride booked for later (FareEstimationScreen).
// A day, then an hour, then the minutes, in 5-minute steps from the
// dashboard's soonest time to its furthest day ahead, all in UK time
// (utils/bookLater.js).
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { COLORS, TYPE, SPACE, Button, Chip, Sheet } from './ui/kit';
import { pickupDays, ukParts, ukWhen } from '../utils/bookLater';

const pad = (n) => String(n).padStart(2, '0');

export default function BookLaterPicker({ visible, settings, value, onPick, onNow, onClose }) {
  // Worked out afresh each time it opens, so the soonest time is right.
  const [openedAt, setOpenedAt] = useState(Date.now());
  useEffect(() => {
    if (visible) setOpenedAt(Date.now());
  }, [visible]);
  const days = useMemo(
    () => pickupDays(settings, openedAt),
    [settings.minMinutes, settings.maxDays, openedAt]
  );

  // Set when it opens only, so the passenger's choice is not reset while
  // they pick.
  const [picked, setPicked] = useState(null);
  useEffect(() => {
    if (!visible || !days.length) return;
    const all = days.flatMap((d) => d.slots);
    // The time already chosen if it is still on offer, else the soonest.
    setPicked(value && all.includes(value) ? value : all[0]);
  }, [visible, openedAt]);

  const day = days.find((d) => d.slots.includes(picked)) || days[0];
  const hours = useMemo(() => {
    if (!day) return [];
    const list = [];
    day.slots.forEach((t) => {
      const h = ukParts(t).hour;
      // The autumn hour that happens twice shows once; its first slot is used.
      if (!list.some((x) => x.hour === h)) list.push({ hour: h, first: t });
    });
    return list;
  }, [day]);
  const pickedHour = picked ? ukParts(picked).hour : null;
  const minutes = day ? day.slots.filter((t) => ukParts(t).hour === pickedHour) : [];

  // Same minute past the hour where it exists, else the first one.
  const moveTo = (slots) => {
    if (!slots.length) return;
    const m = picked ? ukParts(picked).minute : 0;
    setPicked(slots.find((t) => ukParts(t).minute === m) || slots[0]);
  };
  const pickDay = (d) => moveTo(d.slots.filter((t) => ukParts(t).hour === pickedHour).length
    ? d.slots.filter((t) => ukParts(t).hour === pickedHour)
    : d.slots);
  const pickHour = (h) => moveTo(day.slots.filter((t) => ukParts(t).hour === h));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <Sheet>
        <Text style={TYPE.heading}>When should we pick you up?</Text>
        <Text style={[TYPE.small, { marginTop: SPACE[1] }]}>
          UK time. From {settings.minMinutes} minutes to {settings.maxDays} days ahead.
        </Text>

        <Text style={[TYPE.label, styles.label]}>Day</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {days.map((d) => (
            <Chip key={d.key} label={d.label} active={day?.key === d.key} onPress={() => pickDay(d)} />
          ))}
        </ScrollView>

        <Text style={[TYPE.label, styles.label]}>Hour</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {hours.map((h) => (
            <Chip key={`${day?.key}-${h.hour}`} label={pad(h.hour)} active={h.hour === pickedHour} onPress={() => pickHour(h.hour)} />
          ))}
        </ScrollView>

        <Text style={[TYPE.label, styles.label]}>Minutes</Text>
        <View style={styles.grid}>
          {minutes.map((t) => (
            <Chip key={t} label={`:${pad(ukParts(t).minute)}`} active={t === picked} onPress={() => setPicked(t)} />
          ))}
        </View>

        <Text style={[TYPE.subhead, { marginTop: SPACE[5] }]}>{picked ? ukWhen(picked, openedAt) : ''}</Text>
        <Text style={[TYPE.small, { marginBottom: SPACE[4] }]}>
          We start finding your driver about {settings.leadMinutes} minutes before.
        </Text>

        <Button title="Set pickup time" disabled={!picked} onPress={() => onPick(picked)} />
        <Button title="Book for now instead" variant="ghost" style={{ marginTop: SPACE[2] }} onPress={onNow} />
      </Sheet>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: COLORS.overlay },
  label: { marginTop: SPACE[4], marginBottom: SPACE[2] },
  row: { gap: SPACE[2], paddingRight: SPACE[4] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE[2] },
});
