// Driver documents: expiry status from the admin dashboard, and replacement
// uploads. A replacement is sent for approval; the current document stays
// live until an admin accepts the new one.
import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  Linking,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { Alert } from '../../../components/ui/alert';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../../../config/firebase';
import { selectUploadAsset } from '../../../helpers/uploadPicker';
import { DRIVER_DOCUMENTS, expiryStatus, describeExpiry, expiryAlertsFor } from '../../../constants/driverDocuments';
import { submitChangeRequest, uploadPendingDocument, useChangeRequests } from '../../../utils/changeRequests';
import {
  COLORS, TYPE, SPACE, Screen, ScreenHeader, Section, Card, StatusPill, Button, Field, Loading,
} from '../../../components/ui/kit';

// "31/12/2027" -> "2027-12-31", or null if not a real date.
function parseUkDate(text) {
  const m = String(text || '').trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m.map(Number);
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export default function DriverDocumentsScreen({ navigation }) {
  const driverId = auth.currentUser?.uid;
  const [driver, setDriver] = useState(null);
  const [active, setActive] = useState(null); // doc id being replaced
  const [asset, setAsset] = useState(null);
  const [expiryText, setExpiryText] = useState('');
  const [sending, setSending] = useState(false);
  const { pendingFor } = useChangeRequests(driverId);

  useEffect(() => {
    if (!driverId) return undefined;
    return onSnapshot(doc(db, 'drivers', driverId), (snap) => setDriver(snap.exists() ? snap.data() : {}));
  }, [driverId]);

  const pickFile = async () => {
    const picked = await selectUploadAsset();
    if (!picked) return;
    if (picked.error) {
      Alert.alert('Upload', picked.error);
      return;
    }
    setAsset(picked);
  };

  const send = async (item) => {
    if (!asset) {
      Alert.alert(item.label, 'Choose the new document first.');
      return;
    }
    let expiry = null;
    if (item.expiryKey) {
      expiry = parseUkDate(expiryText);
      if (!expiry) {
        Alert.alert('Expiry date', 'Enter the expiry date as DD/MM/YYYY.');
        return;
      }
    }
    setSending(true);
    try {
      const fileUrl = await uploadPendingDocument(driverId, item.id, asset);
      await submitChangeRequest(driverId, driver?.fullName, {
        kind: 'document',
        field: item.urlField,
        fieldLabel: item.label,
        currentValue: driver?.[item.urlField] || null,
        requestedValue: expiry, // new expiry date, if the document has one
        fileUrl,
        note: item.expiryKey ? `expiryKey:${item.expiryKey}` : '',
      });
      setActive(null);
      setAsset(null);
      setExpiryText('');
      Alert.alert('Document sent', 'We will check it and update your record. You can keep driving on your current document until it expires.');
    } catch (error) {
      console.log('Document request error:', error);
      Alert.alert('Upload failed', error?.code ? `Please try again. (${error.code})` : 'Please try again.');
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

  const alerts = expiryAlertsFor(driver);
  const uploaded = DRIVER_DOCUMENTS.filter(
    (item) => driver[item.urlField] || (item.urlField.startsWith('driverLicense') ? driver.driverLicenseUrl : null)
  ).length;

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScreenHeader
            title="My documents"
            subtitle="Keep these in date to stay on the road."
            onBack={() => navigation.goBack()}
          />

          <Card tone="dark" style={styles.hero}>
            <Text style={styles.heroLabel}>Uploaded</Text>
            <Text style={styles.heroValue}>
              {uploaded} of {DRIVER_DOCUMENTS.length}
            </Text>
            <View style={styles.heroPill}>
              <StatusPill
                status={alerts.length ? (alerts[0].status === 'expired' ? 'expired' : 'expiring') : 'valid'}
                label={alerts.length ? `${alerts.length} to update` : 'All in date'}
                dot
              />
            </View>
          </Card>

          {alerts.length ? (
            <Card tone={alerts[0].status === 'expired' ? 'danger' : 'warning'} style={{ marginTop: SPACE[4] }}>
              <Text style={[TYPE.heading, { color: alerts[0].status === 'expired' ? COLORS.red : COLORS.amber }]}>
                {alerts.length === 1 ? '1 document needs updating' : `${alerts.length} documents need updating`}
              </Text>
              {alerts.map((a) => (
                <Text key={a.key} style={[TYPE.body, { marginTop: 4 }]}>
                  {a.label}: {describeExpiry(a).toLowerCase()}
                </Text>
              ))}
            </Card>
          ) : null}

          <Section title="Documents">
            {DRIVER_DOCUMENTS.map((item) => {
              const e = item.expiryKey ? expiryStatus(driver.documentExpiry?.[item.expiryKey]) : null;
              const pending = pendingFor(item.urlField);
              const url = driver[item.urlField] || (item.urlField.startsWith('driverLicense') ? driver.driverLicenseUrl : null);
              const isActive = active === item.id;
              return (
                <Card key={item.id} style={{ marginBottom: SPACE[3] }}>
                  <View style={styles.docHead}>
                    <View style={{ flex: 1, paddingRight: SPACE[3] }}>
                      <Text style={styles.docTitle}>{item.label}</Text>
                      <Text style={TYPE.small}>
                        {e ? describeExpiry(e) : 'No expiry date'}
                        {!url ? '. Not uploaded yet' : ''}
                      </Text>
                    </View>
                    {pending ? <StatusPill status="pending" label="In review" /> : e ? <StatusPill status={e.status} /> : null}
                  </View>

                  {isActive ? (
                    <View style={{ marginTop: SPACE[4] }}>
                      <Button
                        title={asset ? `Chosen: ${asset.name || 'document'}` : 'Choose file or photo'}
                        variant="secondary"
                        icon={asset ? 'checkmark-circle' : 'cloud-upload-outline'}
                        onPress={pickFile}
                      />
                      {item.expiryKey ? (
                        <Field
                          style={{ marginTop: SPACE[4] }}
                          label="New expiry date"
                          placeholder="DD/MM/YYYY"
                          keyboardType="numbers-and-punctuation"
                          value={expiryText}
                          onChangeText={setExpiryText}
                        />
                      ) : <View style={{ height: SPACE[4] }} />}
                      <View style={{ flexDirection: 'row', gap: SPACE[3] }}>
                        <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => { setActive(null); setAsset(null); }} />
                        <Button title="Send for approval" style={{ flex: 1.5 }} loading={sending} onPress={() => send(item)} />
                      </View>
                    </View>
                  ) : (
                    <View style={styles.docActions}>
                      {url ? <Button title="View" variant="ghost" style={styles.smallBtn} onPress={() => Linking.openURL(url)} /> : null}
                      {!pending ? (
                        <Button
                          title={url ? 'Upload new' : 'Upload'}
                          variant="ghost"
                          style={styles.smallBtn}
                          onPress={() => { setActive(item.id); setAsset(null); setExpiryText(''); }}
                        />
                      ) : null}
                    </View>
                  )}
                </Card>
              );
            })}
          </Section>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: SPACE[5], paddingBottom: SPACE[12] },
  hero: { marginTop: SPACE[4] },
  heroLabel: { ...TYPE.label, color: COLORS.onDark },
  heroValue: { ...TYPE.display, color: COLORS.white, marginTop: SPACE[1] },
  heroPill: { marginTop: SPACE[3], flexDirection: 'row' },
  docHead: { flexDirection: 'row', alignItems: 'flex-start' },
  docTitle: { ...TYPE.subhead, marginBottom: 2 },
  docActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: SPACE[2], marginRight: -SPACE[3] },
  smallBtn: { minHeight: 36, paddingHorizontal: SPACE[3] },
});
