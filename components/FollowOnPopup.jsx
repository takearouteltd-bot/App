/* A follow-on job offered while the driver is on a trip: pops up in the
   middle of the screen, over whichever screen of the app is open (the trip
   screen included), like a BID JOB, with Accept, No thanks and the
   countdown. Mounted once in App.js for drivers, over the whole navigator.
   It used to sit inside the trip screen's panel, and as a small card at the
   top of other screens, and drivers missed it (M&S, 18 Nov 2026: "follow on
   job comes but in notifications, doesn't pop up").

   Outside the app (Google Maps, say) the offer push rings on the job-ring
   channel and drops down over whatever is open; tapping it brings the app
   back with the offer popped up. */
import React from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import FollowOnCard from './FollowOnCard';
import { COLORS, RADIUS, SPACE } from './ui/kit';
import { useFollowOnOffer } from '../utils/followOn';

export default function FollowOnPopup({ driverId }) {
  const offer = useFollowOnOffer(driverId);
  if (!driverId || !offer) return null;
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={styles.box} accessibilityViewIsModal>
          <View style={styles.banner} accessibilityRole="header">
            <Text style={styles.bannerTitle}>{offer.forMe ? 'NEXT JOB' : 'FOLLOW-ON JOB'}</Text>
            <Text style={styles.bannerText} numberOfLines={2}>
              Starts after your drop-off · pickup in about {offer.etaMinutes} min
            </Text>
          </View>
          <FollowOnCard driverId={driverId} offerOnly style={styles.card} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 13, 31, 0.55)',
    justifyContent: 'center',
    paddingHorizontal: SPACE[4],
  },
  box: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg || 20,
    padding: SPACE[4],
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 16,
  },
  banner: {
    backgroundColor: COLORS.lime,
    borderRadius: 12,
    paddingVertical: SPACE[2],
    paddingHorizontal: SPACE[3],
    marginBottom: SPACE[3],
  },
  bannerTitle: { color: COLORS.midnight, fontWeight: '800', fontSize: 16, letterSpacing: 0.5 },
  bannerText: { color: COLORS.midnight, fontWeight: '600', marginTop: 2 },
  card: { marginBottom: 0, borderWidth: 0, padding: 0 },
});
