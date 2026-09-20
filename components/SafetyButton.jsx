// Shield button shown on live trip screens (driver and passenger).
// Opens a sheet with 999, 101, the saved emergency contact, and the trip
// reference. A Modal is used rather than Alert because Android shows at most
// three Alert buttons.
import React, { useEffect, useState } from 'react';
import { TouchableOpacity, Modal, View, Text, Linking, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { COLORS, TYPE, ListRow, Button } from './ui/kit';

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
        style={[styles.btn, style]}
        accessibilityRole="button"
        accessibilityLabel="Safety options"
      >
        <Ionicons name="shield-checkmark" size={20} color={COLORS.red} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={TYPE.title}>Safety</Text>
          <Text style={[TYPE.small, { marginTop: 4, marginBottom: 8 }]}>
            If you are in danger, call 999.
            {rideId ? ` Trip reference ${String(rideId).slice(0, 8).toUpperCase()}.` : ''}
          </Text>
          <ListRow icon="alert-circle" iconColor={COLORS.red} title="Call 999" detail="Emergency services" onPress={() => call('999')} />
          <ListRow icon="call-outline" title="Call 101" detail="Police non-emergency" onPress={() => call('101')} last={!contact?.phone} />
          {contact?.phone ? (
            <ListRow
              icon="person-outline"
              iconColor={COLORS.green}
              title={`Call ${contact.name || 'emergency contact'}`}
              detail={contact.relationship || 'Your emergency contact'}
              onPress={() => call(contact.phone)}
              last
            />
          ) : null}
          <Button title="Close" variant="secondary" style={{ marginTop: 16 }} onPress={() => setOpen(false)} />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)' },
  sheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 36,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.line, marginBottom: 16 },
});
