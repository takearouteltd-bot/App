// Next of kin / emergency contact, plus quick links to 999 and 101.
// Stored on the person's own record as emergencyContact { name, relationship, phone }.
import React, { useEffect, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  Text,
  Linking,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { Alert } from '../../components/ui/alert';
import { arrayRemove, deleteField, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../config/firebase';
import { COLORS, TYPE, ScreenHeader, Section, Card, ListRow, Button, Field, Loading } from '../../components/ui/kit';

export default function EmergencyContactScreen({ navigation, route }) {
  const role = route?.params?.role || 'rider';
  const collectionName = role === 'driver' ? 'drivers' : 'riders';
  const uid = auth.currentUser?.uid;

  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [blocked, setBlocked] = useState([]); // passengers only

  useEffect(() => {
    if (!uid) return;
    getDoc(doc(db, collectionName, uid))
      .then((snap) => {
        const data = snap.exists() ? snap.data() : {};
        const c = data.emergencyContact || null;
        if (Array.isArray(data.blockedDrivers)) {
          setBlocked(data.blockedDrivers.map((id) => ({ id, ...(data.blockedDriverInfo?.[id] || {}) })));
        }
        if (c) {
          setName(c.name || '');
          setRelationship(c.relationship || '');
          setPhone(c.phone || '');
        }
      })
      .finally(() => setLoaded(true));
  }, [uid, collectionName]);

  const allowDriver = async (driverId) => {
    try {
      await setDoc(
        doc(db, collectionName, uid),
        { blockedDrivers: arrayRemove(driverId), blockedDriverInfo: { [driverId]: deleteField() } },
        { merge: true }
      );
      setBlocked((list) => list.filter((d) => d.id !== driverId));
    } catch (error) {
      Alert.alert('Not saved', 'Please try again.');
    }
  };

  const save = async () => {
    const next = {};
    if (!name.trim()) next.name = 'Enter their name.';
    const digits = phone.replace(/[^\d+]/g, '');
    if (digits.replace('+', '').length < 10) next.phone = 'Enter a full phone number.';
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    try {
      await setDoc(
        doc(db, collectionName, uid),
        {
          emergencyContact: {
            name: name.trim(),
            relationship: relationship.trim(),
            phone: digits,
            updatedAt: serverTimestamp(),
          },
        },
        { merge: true }
      );
      Alert.alert('Saved', 'Your emergency contact is saved.');
      navigation.goBack();
    } catch (error) {
      console.log('Emergency contact save error:', error);
      Alert.alert('Not saved', 'Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return (
      <SafeAreaView style={styles.safe}>
        <Loading />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScreenHeader
            title="Safety"
            subtitle="Who we can contact for you, and quick ways to get help."
            onBack={() => navigation.goBack()}
          />

          <Section title="Get help now">
            <Card style={{ paddingVertical: 0 }}>
              <ListRow
                icon="alert-circle"
                iconColor={COLORS.red}
                title="Call 999"
                detail="Emergency: danger to life, crime in progress, serious injury"
                onPress={() => Linking.openURL('tel:999')}
              />
              <ListRow
                icon="call-outline"
                title="Call 101"
                detail="Police non-emergency"
                onPress={() => Linking.openURL('tel:101')}
                last
              />
            </Card>
          </Section>

          <Section title="Emergency contact">
            <Card>
              <Text style={[TYPE.small, { marginBottom: 16 }]}>
                Usually next of kin. You can call them from the safety button during a trip, and TakeARoute support may contact them if something serious happens.
              </Text>
              <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" error={errors.name} />
              <Field
                label="Relationship"
                value={relationship}
                onChangeText={setRelationship}
                placeholder="For example, wife, brother, friend"
                autoCapitalize="sentences"
              />
              <Field
                label="Phone number"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                placeholder="07123 456789"
                error={errors.phone}
              />
              <Button title="Save emergency contact" onPress={save} loading={saving} />
            </Card>
          </Section>

          {role === 'rider' && blocked.length ? (
            <Section title="Drivers you won't be matched with">
              <Card style={{ paddingVertical: 0 }}>
                {blocked.map((d, i) => (
                  <ListRow
                    key={d.id}
                    icon="person-remove-outline"
                    iconColor={COLORS.muted}
                    title={d.name || 'Driver'}
                    detail={d.registration || undefined}
                    right={<Button title="Allow" variant="ghost" style={{ minHeight: 36 }} onPress={() => allowDriver(d.id)} />}
                    last={i === blocked.length - 1}
                  />
                ))}
              </Card>
            </Section>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.surface },
  content: { padding: 20, paddingBottom: 48 },
});
