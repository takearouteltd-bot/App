import React, { useCallback } from 'react';
import { View, StyleSheet, Image, StatusBar } from 'react-native';
import * as NativeSplash from 'expo-splash-screen';

// The navy of the splash artwork (the clean artwork M&S sent on 19 Nov 2026). The native launch screen uses
// the same colour (app.json → expo-splash-screen), so the hand-over from the
// native splash to this one is seamless.
export const SPLASH_BACKGROUND = '#00124E';

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
        // A bundled image gets its own size (841 x 1803) as a default width and
        // height, and those beat left/right/top/bottom: the art drew at full
        // size from the top-left corner, so only "TAKE A ROU" showed. Size it
        // to the screen explicitly.
        style={styles.art}
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
  art: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
});
