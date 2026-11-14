/* A follow-on job offered while the driver is on some other screen of the
   app (chat, earnings, account...). Mounted once in App.js for drivers, over
   the whole navigator. The trip screen shows the same offer inline
   (FollowOnCard), so the pop-up stays out of the way there.

   Outside the app (Google Maps, say) the offer push rings on the job-ring
   channel and drops down over whatever is open; tapping it brings the app
   back to the trip screen with the offer on it. */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import FollowOnCard from './FollowOnCard';
import { SPACE } from './ui/kit';
import { useFollowOnOffer } from '../utils/followOn';

// Screens that already show the offer themselves.
const SHOWS_OFFER = ['RideToDropoff'];

export default function FollowOnPopup({ driverId, routeName }) {
  const offer = useFollowOnOffer(driverId);
  if (!driverId || !offer || SHOWS_OFFER.includes(routeName)) return null;
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <SafeAreaView edges={['top']} pointerEvents="box-none" style={styles.wrap}>
        <FollowOnCard driverId={driverId} offerOnly style={styles.card} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: SPACE[4], paddingTop: SPACE[2] },
  card: {
    marginBottom: 0,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 12,
  },
});
