// "Email receipt" for a completed trip. Sends to the passenger's own address,
// or to another one they type in (for example an employer or accountant).
import React, { useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { Alert, AlertHost } from './ui/alert';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';
import { COLORS, TYPE, Button, Field } from './ui/kit';

export default function EmailReceiptButton({ rideId, style, variant = 'secondary', title = 'Email receipt' }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);

  const send = async (to) => {
    if (sending || !rideId) return;
    setSending(true);
    try {
      const call = httpsCallable(functions, 'resendRideReceipt');
      const result = await call(to ? { rideId, email: to } : { rideId });
      setOpen(false);
      setEmail('');
      Alert.alert('Receipt sent', `We have emailed your receipt to ${result?.data?.to || 'your email address'}.`);
    } catch (error) {
      Alert.alert('Not sent', error?.message || 'Please try again in a moment.');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Button title={title} icon="mail-outline" variant={variant} style={style} onPress={() => setOpen(true)} />

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={TYPE.title}>Email receipt</Text>
          <Text style={[TYPE.small, { marginTop: 4, marginBottom: 18 }]}>
            We will send it to the email on your account, or to another address if you prefer.
          </Text>

          <Button title="Send to my email" loading={sending} onPress={() => send(null)} />

          <Text style={[TYPE.small, { textAlign: 'center', marginVertical: 14 }]}>or</Text>

          <Field
            label="Another email address"
            placeholder="name@company.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            value={email}
            onChangeText={setEmail}
          />
          <Button
            title="Send to this address"
            variant="secondary"
            disabled={!email.trim()}
            loading={sending}
            onPress={() => send(email.trim())}
          />
          <Button title="Close" variant="ghost" style={{ marginTop: 6 }} onPress={() => setOpen(false)} />
        </View>
        <AlertHost />
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)' },
  sheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 34,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.line, marginBottom: 16 },
});
