import React, { useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, Linking, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Alert } from '../../components/ui/alert';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { auth, db } from '../../config/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { COLORS, TYPE, SPACE, Button, Banner } from '../../components/ui/kit';
import { confirmLeaveSignup } from '../../utils/leaveSignup';

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

      const location = await Location.getCurrentPositionAsync({});
      const { latitude, longitude } = location.coords;

      await updateDoc(doc(db, 'riders', user.uid), {
        locationEnabled: true,
        onboardingComplete: true,
        onBoardingStep: 'complete',
        coordinates: { latitude, longitude },
      });

      setOnboardingStatus('complete');
    } catch (error) {
      console.log('Location error:', error);
      Alert.alert('Could not get your location', 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <TouchableOpacity
        onPress={() => (navigation.canGoBack() ? navigation.goBack() : confirmLeaveSignup())}
        style={styles.back}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="chevron-back" size={24} color={COLORS.navy} />
      </TouchableOpacity>

      <View style={styles.body}>
        <View style={styles.icon}>
          <Ionicons name="location" size={40} color={COLORS.green} />
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

      <View style={styles.actions}>
        <Button
          title={denied ? 'Try again' : 'Allow location'}
          onPress={enableLocation}
          loading={busy}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.white, justifyContent: 'space-between' },
  back: {
    width: 44, height: 44, justifyContent: 'center',
    marginLeft: SPACE[4], marginTop: SPACE[2],
  },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: SPACE[6] },
  icon: {
    width: 80, height: 80, borderRadius: 26,
    backgroundColor: COLORS.greenSoft,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: SPACE[6],
  },
  title: { ...TYPE.title, fontSize: 30 },
  subtitle: { ...TYPE.body, color: COLORS.muted, marginTop: SPACE[3], marginBottom: SPACE[5] },
  actions: { paddingHorizontal: SPACE[6], paddingBottom: SPACE[8] },
});
