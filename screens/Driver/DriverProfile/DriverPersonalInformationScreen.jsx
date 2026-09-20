// Driver personal details. Drivers cannot edit these directly: each change is
// sent to TakeARoute as a request and applied once an admin approves it.
// (This screen previously showed placeholder data and saved nothing.)
import React, { useEffect, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  Image,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../../../config/firebase';
import { submitChangeRequest, useChangeRequests } from '../../../utils/changeRequests';
import {
  COLORS, TYPE, ScreenHeader, Section, Card, ListRow, StatusPill, Button, Field, Loading, formatWhen,
} from '../../../components/ui/kit';

const DETAILS = [
  { field: 'fullName', label: 'Full name', icon: 'person-outline', keyboard: 'default' },
  { field: 'phoneNumber', label: 'Phone number', icon: 'call-outline', keyboard: 'phone-pad' },
  { field: 'email', label: 'Email address', icon: 'mail-outline', keyboard: 'email-address' },
  { field: 'address', label: 'Home address', icon: 'home-outline', keyboard: 'default' },
];

function valueOf(driver, field) {
  if (!driver) return '';
  if (field === 'fullName') {
    return driver.fullName || [driver.firstName, driver.lastName].filter(Boolean).join(' ');
  }
  if (field === 'email') return driver.email || auth.currentUser?.email || '';
  if (field === 'phoneNumber') return driver.phoneNumber || driver.phone || auth.currentUser?.phoneNumber || '';
  return driver[field] || '';
}

export default function DriverPersonalInformationScreen({ navigation }) {
  const driverId = auth.currentUser?.uid;
  const [driver, setDriver] = useState(null);
  const [editing, setEditing] = useState(null); // field being changed
  const [newValue, setNewValue] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const { items, pendingFor } = useChangeRequests(driverId);

  useEffect(() => {
    if (!driverId) return undefined;
    return onSnapshot(doc(db, 'drivers', driverId), (snap) => setDriver(snap.exists() ? snap.data() : {}));
  }, [driverId]);

  const startEdit = (field) => {
    setEditing(field);
    setNewValue('');
    setNote('');
  };

  const send = async (item) => {
    const value = newValue.trim();
    if (!value) {
      Alert.alert(item.label, `Enter the new ${item.label.toLowerCase()}.`);
      return;
    }
    if (value === valueOf(driver, item.field)) {
      Alert.alert(item.label, 'That is the same as the current value.');
      return;
    }
    setSending(true);
    try {
      await submitChangeRequest(driverId, valueOf(driver, 'fullName'), {
        kind: 'detail',
        field: item.field,
        fieldLabel: item.label,
        currentValue: valueOf(driver, item.field),
        requestedValue: value,
        note,
      });
      setEditing(null);
      Alert.alert('Request sent', 'We will review the change and let you know. Your current details stay in place until then.');
    } catch (error) {
      console.log('Change request error:', error);
      Alert.alert('Request not sent', 'Check your connection and try again.');
    } finally {
      setSending(false);
    }
  };

  if (!driver) {
    return (
      <SafeAreaView style={styles.safe}>
        <Loading />
      </SafeAreaView>
    );
  }

  const recent = items.filter((r) => r.kind === 'detail').slice(0, 5);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScreenHeader
            title="Personal details"
            subtitle="Changes are checked by TakeARoute before they go live."
            onBack={() => navigation.goBack()}
          />

          <View style={styles.identity}>
            {driver.selfieUrl ? (
              <Image source={{ uri: driver.selfieUrl }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarEmpty]}>
                <Text style={styles.initials}>{(valueOf(driver, 'fullName') || 'D').charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={TYPE.heading}>{valueOf(driver, 'fullName') || 'Driver'}</Text>
              <Text style={TYPE.small}>
                {driver.approved ? 'Approved driver' : 'Application under review'}
              </Text>
            </View>
          </View>

          <Section title="Your details">
            <Card style={{ paddingVertical: 0 }}>
              {DETAILS.map((item, i) => {
                const pending = pendingFor(item.field);
                const isEditing = editing === item.field;
                return (
                  <View key={item.field}>
                    <ListRow
                      icon={item.icon}
                      title={item.label}
                      detail={valueOf(driver, item.field) || 'Not set'}
                      last={i === DETAILS.length - 1 && !isEditing}
                      onPress={pending || isEditing ? undefined : () => startEdit(item.field)}
                      right={pending ? <StatusPill status="pending" label="Pending" /> : isEditing ? null : undefined}
                    />
                    {isEditing ? (
                      <View style={styles.editBox}>
                        <Field
                          label={`New ${item.label.toLowerCase()}`}
                          value={newValue}
                          onChangeText={setNewValue}
                          keyboardType={item.keyboard}
                          autoCapitalize={item.field === 'email' ? 'none' : 'words'}
                          autoFocus
                        />
                        <Field
                          label="Reason (optional)"
                          value={note}
                          onChangeText={setNote}
                          placeholder="For example, I changed my number"
                        />
                        <View style={{ flexDirection: 'row', gap: 10 }}>
                          <Button title="Cancel" variant="secondary" onPress={() => setEditing(null)} style={{ flex: 1 }} />
                          <Button title="Send request" onPress={() => send(item)} loading={sending} style={{ flex: 1.4 }} />
                        </View>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </Card>
          </Section>

          {recent.length ? (
            <Section title="Recent requests">
              <Card style={{ paddingVertical: 0 }}>
                {recent.map((r, i) => (
                  <ListRow
                    key={r.id}
                    title={`${r.fieldLabel}: ${r.requestedValue}`}
                    detail={
                      r.status === 'rejected' && r.adminNote
                        ? `Not approved: ${r.adminNote}`
                        : formatWhen(r.createdAt)
                    }
                    right={<StatusPill status={r.status} />}
                    last={i === recent.length - 1}
                  />
                ))}
              </Card>
            </Section>
          ) : null}

          <Section title="Documents">
            <Card style={{ paddingVertical: 0 }}>
              <ListRow
                icon="folder-open-outline"
                title="My documents"
                detail="Check expiry dates and upload replacements"
                onPress={() => navigation.navigate('DriverDocuments')}
                last
              />
            </Card>
          </Section>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.surface },
  content: { padding: 20, paddingBottom: 48 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 20 },
  avatar: { width: 60, height: 60, borderRadius: 18 },
  avatarEmpty: { backgroundColor: COLORS.blueSoft, alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: 24, fontWeight: '800', color: COLORS.blue },
  editBox: { paddingBottom: 16, paddingTop: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.line },
});
