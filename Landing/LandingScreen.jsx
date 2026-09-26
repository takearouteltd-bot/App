import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { COLORS, TYPE, SPACE, RADIUS, Button, Screen } from '../components/ui/kit';
import { openTerms, openPrivacy } from '../utils/legal';

export default function LandingScreen({ navigation }) {
  return (
    <Screen scroll={false} style={styles.safe}>
      <View style={styles.body}>
        <View style={styles.logoWrap}>
          <Image
            source={require('../assets/myicon.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        <Text style={styles.wordmark}>TakeARoute</Text>
        <Text style={styles.tagline}>Your ride, your way.</Text>
      </View>

      <View style={styles.actions}>
        <Button
          title="Continue with phone"
          icon="call-outline"
          onPress={() => navigation.navigate('PhoneLogin')}
        />
        <Button
          title="Continue with email"
          icon="mail-outline"
          variant="secondary"
          style={{ marginTop: SPACE[3] }}
          onPress={() => navigation.navigate('EmailAuth')}
        />

        <Text style={styles.terms}>
          By continuing you accept our{' '}
          <Text style={styles.link} onPress={openTerms}>
            Terms of use
          </Text>{' '}
          and{' '}
          <Text style={styles.link} onPress={openPrivacy}>
            Privacy policy
          </Text>
          .
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: COLORS.white },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACE[6] },
  logoWrap: {
    width: 128, height: 128, borderRadius: RADIUS.lg + 8,
    backgroundColor: COLORS.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  logo: { width: 96, height: 96 },
  wordmark: { ...TYPE.display, marginTop: SPACE[6] },
  tagline: { ...TYPE.body, color: COLORS.muted, marginTop: SPACE[2] },

  actions: { paddingHorizontal: SPACE[6], paddingBottom: SPACE[8] },
  terms: {
    ...TYPE.small, textAlign: 'center',
    marginTop: SPACE[6], lineHeight: 19,
  },
  link: { color: COLORS.midnight, fontWeight: '700', textDecorationLine: 'underline' },
});
