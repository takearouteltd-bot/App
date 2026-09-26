// "Email receipt" for a completed trip. Sends to the passenger's own address,
// or to another one they type in (for example an employer or accountant).
import React, { useState } from 'react';
import { Modal, Text, Pressable, StyleSheet } from 'react-native';
import { Alert, AlertHost } from './ui/alert';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';
import { COLORS, TYPE, SPACE, Button, Field, Sheet } from './ui/kit';

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
        <Sheet>
          <Text style={TYPE.title}>Email receipt</Text>
          <Text style={[TYPE.small, { marginTop: SPACE[1], marginBottom: SPACE[5] }]}>
            We will send it to the email on your account, or to another address if you prefer.
          </Text>

          <Button title="Send to my email" icon="mail-outline" loading={sending} onPress={() => send(null)} />

          <Text style={[TYPE.small, { textAlign: 'center', marginVertical: SPACE[4] }]}>or</Text>

          <Field
            label="Another email address"
            left="at-outline"
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
          <Button title="Close" variant="ghost" style={{ marginTop: SPACE[2] }} onPress={() => setOpen(false)} />
        </Sheet>
        <AlertHost />
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: COLORS.overlay },
});
