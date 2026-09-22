import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, Switch, Alert, Linking } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { auth } from '../../../config/firebase';
import {
  hasPushToken,
  registerForPushNotifications,
  unregisterPushNotifications,
} from '../../../utils/notifications';
import {
  COLORS,
  TYPE,
  SPACE,
  Card,
  ListRow,
  Banner,
  Loading,
  ScreenHeader,
} from '../../../components/ui/kit';

/* This screen used to offer five switches — push, email, SMS, marketing and
   location sharing — none of which were read by anything. Nothing in the app
   sends SMS or marketing email, receipts are part of paying for a ride, and a
   trip cannot run without location. So only the setting that can genuinely be
   honoured is offered, and it works by adding or removing this phone's push
   token, which is what the server actually sends to. */
export default function PreferencesScreen() {
  const navigation = useNavigation();
  const user = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pushOn, setPushOn] = useState(false);

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setPushOn(await hasPushToken(user.uid));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const togglePush = async (next) => {
    if (!user || saving) return;
    setSaving(true);
    setPushOn(next);

    try {
      if (next) {
        const token = await registerForPushNotifications(user.uid);
        if (!token) {
          setPushOn(false);
          Alert.alert(
            'Notifications are blocked',
            'Turn notifications on for TakeARoute in your phone settings, then try again.',
            [
              { text: 'Not now', style: 'cancel' },
              { text: 'Open settings', onPress: () => Linking.openSettings() },
            ]
          );
        }
      } else {
        const ok = await unregisterPushNotifications(user.uid);
        if (!ok) {
          setPushOn(true);
          Alert.alert('Could not save', 'Please try again.');
        }
      }
    } catch (error) {
      setPushOn(!next);
      Alert.alert('Could not save', 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <Loading />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          title="Notifications"
          subtitle="What TakeARoute is allowed to send to this phone."
          onBack={() => navigation.goBack()}
        />

        <Card flush style={{ marginTop: SPACE[5] }}>
          <ListRow
            icon="notifications-outline"
            title="Push notifications"
            detail="Driver on the way, arrival, messages and replies from support"
            last
            right={
              <Switch
                value={pushOn}
                onValueChange={togglePush}
                disabled={saving}
                trackColor={{ false: COLORS.line, true: COLORS.green }}
                thumbColor={COLORS.white}
              />
            }
          />
        </Card>

        {!pushOn ? (
          <Banner
            tone="warning"
            title="You will not be told when your driver arrives"
            body="Trip updates and messages from your driver will not reach this phone while this is off."
          />
        ) : null}

        <Text style={[TYPE.small, { marginTop: SPACE[6] }]}>
          Receipts are emailed for every trip you pay for, as a record of the payment. You can
          also email a copy of any receipt to yourself from the trip in Trip history.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.surface },
  content: { padding: SPACE[5], paddingBottom: SPACE[12] },
});
