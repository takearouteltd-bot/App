import React from 'react';
import { View, StyleSheet, Image, Dimensions } from 'react-native';
import { COLORS } from '../components/ui/kit';

const { width, height } = Dimensions.get('window');

// Shown by App.js while the auth state and the user's record are loading.
export default function SplashScreen() {
  return (
    <View style={styles.container}>
      <Image
        source={require('../assets/splash-icon.png')}
        style={styles.image}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: { width, height },
});
