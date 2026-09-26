import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Switch, Linking } from 'react-native';
import { Alert } from '../../../components/ui/alert';
import { auth, db } from '../../../config/firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { useAppConfig, femaleDriverEnabled } from '../../../utils/appConfig';
import {
  hasPushToken,
  registerForPushNotifications,
  unregisterPushNotifications,
} from '../../../utils/notifications';
import {
  COLORS,
  TYPE,
  SPACE,
  Screen,
  Section,
  RowGroup,
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
  const user = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pushOn, setPushOn] = useState(false);

  // Ride preference: ask for a female driver by default. Can still be changed
  // for a single booking on the fare screen.
  const appConfig = useAppConfig();
  const [femaleOnly, setFemaleOnly] = useState(false);
  useEffect(() => {
    if (!user) return undefined;
    return onSnapshot(doc(db, 'riders', user.uid), (snap) =>
      setFemaleOnly(snap.exists() && snap.data().preferFemaleDriver === true)
    );
  }, [user]);
  const toggleFemaleOnly = async (next) => {
    if (!user) return;
    setFemaleOnly(next);
    try {
      await setDoc(doc(db, 'riders', user.uid), { preferFemaleDriver: next }, { merge: true });
    } catch (error) {
      setFemaleOnly(!next);
      Alert.alert('Could not save', 'Please try again.');
    }
  };

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
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader
        title="Preferences"
        subtitle="How your rides work, and what this phone is sent."
      />

      {femaleDriverEnabled(appConfig) ? (
        <Section title="Rides">
          <RowGroup
            items={[
              {
                icon: 'woman-outline',
                title: 'Female drivers only',
                detail: 'We look for a female driver first. If none is free, we ask before finding anyone else.',
                right: (
                  <Switch
                    value={femaleOnly}
                    onValueChange={toggleFemaleOnly}
                    trackColor={{ false: COLORS.line, true: COLORS.limeDeep }}
                    thumbColor={COLORS.white}
                  />
                ),
              },
            ]}
          />
        </Section>
      ) : null}

      <Section title="Notifications">
        <RowGroup
          items={[
            {
              icon: 'notifications-outline',
              title: 'Push notifications',
              detail: 'Driver on the way, arrival, messages and replies from support',
              right: (
                <Switch
                  value={pushOn}
                  onValueChange={togglePush}
                  disabled={saving}
                  trackColor={{ false: COLORS.line, true: COLORS.limeDeep }}
                  thumbColor={COLORS.white}
                />
              ),
            },
          ]}
        />
        {!pushOn ? (
          <View style={{ marginTop: SPACE[3] }}>
            <Banner
              tone="warning"
              title="You will not be told when your driver arrives"
              body="Trip updates and messages from your driver will not reach this phone while this is off."
            />
          </View>
        ) : null}
      </Section>

      <Text style={[TYPE.small, { marginTop: SPACE[6] }]}>
        Receipts are emailed for every trip you pay for, as a record of the payment. You can
        also email a copy of any receipt to yourself from the trip in Trip history.
      </Text>
    </Screen>
  );
}
