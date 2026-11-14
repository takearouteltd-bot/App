/* The driver's photo with their number plate straight underneath, so the
   passenger can check the car that pulls up is the right one. Used wherever
   a passenger sees their driver (RideTrackingScreen, RideInProgressScreen). */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Avatar, COLORS } from './ui/kit';

export function plateOf(driver) {
  return String(driver?.registrationNumber || '').replace(/\s+/g, ' ').trim().toUpperCase();
}

export default function DriverPhotoPlate({ driver, size = 52, badge }) {
  const plate = plateOf(driver);
  return (
    <View style={styles.wrap}>
      <Avatar uri={driver?.selfieUrl} name={driver?.fullName} size={size} badge={badge} />
      {plate ? (
        <View style={[styles.plate, { minWidth: size }]} accessibilityLabel={`Number plate ${plate}`}>
          <Text style={[styles.plateText, size < 48 && styles.plateSmall]} numberOfLines={1}>
            {plate}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  // A UK rear plate: yellow, black characters, thin black edge.
  plate: {
    marginTop: 4,
    backgroundColor: '#F7D117',
    borderColor: COLORS.midnight,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    alignItems: 'center',
  },
  plateText: { fontSize: 12, fontWeight: '900', color: COLORS.midnight, letterSpacing: 0.5 },
  plateSmall: { fontSize: 10 },
});
