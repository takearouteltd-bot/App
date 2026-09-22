import React from 'react';
import { View, Text, StyleSheet, SafeAreaView, Image } from 'react-native';
import { COLORS, TYPE, SPACE, Button } from '../components/ui/kit';
import { openTerms, openPrivacy } from '../utils/legal';

export default function LandingScreen({ navigation }) {

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <Image
          source={require('../assets/myicon.png')}
          style={styles.logo}
          resizeMode="contain"
        />

        <Text style={styles.wordmark}>TakeARoute</Text>
        <Text style={styles.tagline}>Your ride, your way.</Text>
      </View>

      <View style={styles.actions}>
        <Button title="Continue with phone" onPress={() => navigation.navigate('PhoneLogin')} />
        <Button
          title="Continue with email"
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.white },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACE[6] },
  logo: { width: 96, height: 96 },
  wordmark: {
    fontSize: 38, fontWeight: '800', color: COLORS.navy,
    letterSpacing: -1.2, marginTop: SPACE[5],
  },
  tagline: { ...TYPE.body, color: COLORS.muted, marginTop: SPACE[2] },

  actions: { paddingHorizontal: SPACE[6], paddingBottom: SPACE[8] },
  terms: {
    ...TYPE.small, textAlign: 'center',
    marginTop: SPACE[6], lineHeight: 19,
  },
  link: { color: COLORS.blue, fontWeight: '700', textDecorationLine: 'underline' },
});
