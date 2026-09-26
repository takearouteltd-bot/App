import React, { useState } from 'react';
import { View, Text, StyleSheet, Linking } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Alert } from '../../components/ui/alert';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { auth, db } from '../../config/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import {
  COLORS,
  TYPE,
  SPACE,
  Button,
  Banner,
  Footer,
  Screen,
  ScreenHeader,
} from '../../components/ui/kit';
import { confirmLeaveSignup } from '../../utils/leaveSignup';

// { latitude, longitude } within a few seconds, or null.
async function bestEffortPosition() {
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 8000));
  try {
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      timeout,
    ]);
    const position = fresh || (await Location.getLastKnownPositionAsync().catch(() => null));
    if (!position?.coords) return null;
    return { latitude: position.coords.latitude, longitude: position.coords.longitude };
  } catch (error) {
    return null;
  }
}

export default function EnableLocationScreen({ setOnboardingStatus }) {
  const navigation = useNavigation();
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  const enableLocation = async () => {
    setBusy(true);
    try {
      const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();

      if (status !== 'granted') {
        // Denying used to leave people on this screen with no way forward and
        // no route into Settings, and App.js gates the whole app on this.
        setDenied(true);
        if (!canAskAgain) {
          Alert.alert(
            'Location is turned off',
            'Turn on location for TakeARoute in your phone settings, then come back.',
            [
              { text: 'Not now', style: 'cancel' },
              { text: 'Open settings', onPress: () => Linking.openSettings() },
            ]
          );
        }
        return;
      }

      const user = auth.currentUser;
      if (!user) {
        Alert.alert('Not signed in', 'Please sign in again.');
        return;
      }

      // Permission is all sign-up needs. A first fix is taken if the phone
      // gives one quickly; GPS that is switched off or slow must not keep
      // someone on this screen (getCurrentPositionAsync can hang for good).
      const coords = await bestEffortPosition();

      await updateDoc(doc(db, 'riders', user.uid), {
        locationEnabled: true,
        onboardingComplete: true,
        onBoardingStep: 'complete',
        ...(coords ? { coordinates: coords } : {}),
      });

      setOnboardingStatus('complete');
    } catch (error) {
      console.log('Location error:', error);
      Alert.alert('Could not save', 'Please check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll={false}>
      <View style={styles.top}>
        <ScreenHeader
          compact
          title=""
          onBack={() => (navigation.canGoBack() ? navigation.goBack() : confirmLeaveSignup())}
        />
      </View>

      <View style={styles.body}>
        <View style={styles.icon}>
          <Ionicons name="location" size={40} color={COLORS.midnight} />
        </View>

        <Text style={styles.title}>Turn on location</Text>
        <Text style={styles.subtitle}>
          We use your location to set your pickup point and find drivers near you. Booking a ride
          does not work without it.
        </Text>

        {denied ? (
          <Banner
            tone="warning"
            title="Location is off"
            body="TakeARoute cannot find you a driver until location is allowed."
            action={
              <Button
                title="Open phone settings"
                variant="secondary"
                size="small"
                onPress={() => Linking.openSettings()}
              />
            }
          />
        ) : null}
      </View>

      <Footer>
        <Button
          title={denied ? 'Try again' : 'Allow location'}
          icon="navigate-outline"
          onPress={enableLocation}
          loading={busy}
        />
      </Footer>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: SPACE[5] },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: SPACE[6] },
  icon: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: COLORS.lime,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: SPACE[6],
  },
  title: { ...TYPE.title },
  subtitle: { ...TYPE.body, color: COLORS.muted, marginTop: SPACE[3], marginBottom: SPACE[5] },
});
