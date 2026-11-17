import React, { useCallback } from 'react';
import { View, StyleSheet, Image, StatusBar } from 'react-native';
import * as NativeSplash from 'expo-splash-screen';

// The navy of the splash artwork (Sarfaraz's design, 18 Nov 2026). The native launch screen uses
// the same colour (app.json → expo-splash-screen), so the hand-over from the
// native splash to this one is seamless.
export const SPLASH_BACKGROUND = '#01164B';

// Shown by App.js while the auth state and the user's record are loading.
//
// The artwork is full-bleed, so it covers the screen and is allowed to crop
// at the edges rather than being fitted inside it: "contain" left white bars
// on any phone whose shape differs from the image's. The logo and wordmark sit
// in the middle, so cropping only ever loses plain navy and the green
// waves at the edges.
export default function SplashScreen() {
  // Take the native launch screen down only once this one is on screen, so
  // there is never a frame of empty white between the two.
  const onReady = useCallback(() => {
    NativeSplash.hideAsync().catch(() => {});
  }, []);

  return (
    <View style={styles.container} onLayout={onReady}>
      <StatusBar barStyle="light-content" backgroundColor={SPLASH_BACKGROUND} />
      <Image
        // The same artwork as the iPhone launch screen (assets/splash-icon.png,
        // app.json), as a small JPEG. Kept small: the old 23 MB PNG made up a
        // quarter of the app download.
        source={require('../assets/splash-art.jpg')}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        onLoadEnd={onReady}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: SPLASH_BACKGROUND,
  },
});
