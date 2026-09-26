// Shield button shown on live trip screens (driver and passenger).
// Opens a sheet with 999, 101, the saved emergency contact, and the trip
// reference. A Modal is used rather than Alert because Android shows at most
// three Alert buttons.
import React, { useEffect, useState } from 'react';
import { TouchableOpacity, Modal, View, Text, Linking, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { COLORS, TYPE, SPACE, SHADOW, ListRow, Button, Sheet } from './ui/kit';

import { AlertHost } from './ui/alert';
export default function SafetyButton({ role = 'rider', rideId, style }) {
  const [contact, setContact] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    getDoc(doc(db, role === 'driver' ? 'drivers' : 'riders', uid))
      .then((snap) => setContact(snap.exists() ? snap.data().emergencyContact || null : null))
      .catch(() => {});
  }, [role]);

  const call = (number) => {
    setOpen(false);
    Linking.openURL(`tel:${number}`);
  };

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        style={[styles.btn, SHADOW.float, style]}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Safety options"
      >
        <Ionicons name="shield-checkmark" size={20} color={COLORS.lime} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <Sheet>
          <Text style={TYPE.title}>Safety</Text>
          <Text style={[TYPE.small, { marginTop: SPACE[1], marginBottom: SPACE[2] }]}>
            If you are in danger, call 999.
            {rideId ? ` Trip reference ${String(rideId).slice(0, 8).toUpperCase()}.` : ''}
          </Text>
          <ListRow icon="alert-circle" iconColor={COLORS.red} title="Call 999" detail="Emergency services" onPress={() => call('999')} />
          <ListRow icon="call-outline" iconColor={COLORS.midnight} title="Call 101" detail="Police non-emergency" onPress={() => call('101')} last={!contact?.phone} />
          {contact?.phone ? (
            <ListRow
              icon="person-outline"
              iconColor={COLORS.limeInk}
              title={`Call ${contact.name || 'emergency contact'}`}
              detail={contact.relationship || 'Your emergency contact'}
              onPress={() => call(contact.phone)}
              last
            />
          ) : null}
          <Button title="Close" variant="secondary" style={{ marginTop: SPACE[4] }} onPress={() => setOpen(false)} />
        </Sheet>
        <AlertHost />
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.midnight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: { flex: 1, backgroundColor: COLORS.overlay },
});
