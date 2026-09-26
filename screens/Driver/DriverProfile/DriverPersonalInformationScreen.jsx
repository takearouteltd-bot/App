// Driver personal details. Drivers cannot edit these directly: each change is
// sent to TakeARoute as a request and applied once an admin approves it.
// (This screen previously showed placeholder data and saved nothing.)
import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { Alert } from '../../../components/ui/alert';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../../../config/firebase';
import { submitChangeRequest, useChangeRequests } from '../../../utils/changeRequests';
import {
  COLORS, TYPE, SPACE, Screen, ScreenHeader, Section, Card, ListRow, StatusPill, Button, Field, Loading,
  Avatar, formatWhen,
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
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  const recent = items.filter((r) => r.kind === 'detail').slice(0, 5);

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScreenHeader
            title="Personal details"
            subtitle="Changes are checked by TakeARoute before they go live."
            onBack={() => navigation.goBack()}
          />

          <Card tone="dark" style={styles.identity}>
            <Avatar
              uri={driver.selfieUrl}
              name={valueOf(driver, 'fullName') || 'Driver'}
              size={60}
              style={styles.avatarRing}
            />
            <View style={{ flex: 1 }}>
              <Text style={[TYPE.heading, { color: COLORS.white }]} numberOfLines={1}>
                {valueOf(driver, 'fullName') || 'Driver'}
              </Text>
              <View style={{ flexDirection: 'row', marginTop: SPACE[2] }}>
                <StatusPill
                  status={driver.approved ? 'approved' : 'pending'}
                  label={driver.approved ? 'Approved driver' : 'Application under review'}
                  dot
                />
              </View>
            </View>
          </Card>

          <Section title="Your details">
            <Card flush>
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
                        <View style={{ flexDirection: 'row', gap: SPACE[3] }}>
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
              <Card flush>
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
            <Card flush>
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: SPACE[5], paddingBottom: SPACE[12] },
  identity: { flexDirection: 'row', alignItems: 'center', gap: SPACE[4], marginTop: SPACE[4] },
  // The initial-on-midnight fallback would vanish on the dark card without a ring.
  avatarRing: { borderWidth: 2, borderColor: COLORS.lime, overflow: 'hidden' },
  editBox: { paddingBottom: SPACE[4], paddingTop: SPACE[1], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.line },
});
