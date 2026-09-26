// components/CarMarker.jsx
// A car seen from above, for the maps: nearby drivers on the passenger's home
// screen and the passenger's own driver while they track them.
//
// Drawn from views rather than an image so it stays sharp at any density and
// takes the brand colours. The map turns it to the direction the car is
// travelling (Marker `rotation`), so it points down the road like Uber's.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { COLORS } from './ui/kit';

export function CarShape({ tone = 'navy', size = 1 }) {
  // "green" is the passenger's own driver: lime with dark glass, so it stands
  // out from the midnight cars around it.
  const mine = tone === 'green';
  const body = mine ? COLORS.lime : COLORS.midnight;
  const glass = mine ? { backgroundColor: COLORS.midnight } : null;
  return (
    <View style={[styles.car, { backgroundColor: body, transform: [{ scale: size }] }, mine && { borderColor: COLORS.midnight }]}>
      <View style={[styles.windscreen, glass]} />
      <View style={styles.roof} />
      <View style={[styles.rearWindow, glass]} />
      <View style={[styles.light, styles.lightLeft]} />
      <View style={[styles.light, styles.lightRight]} />
    </View>
  );
}

/**
 * A car on the map.
 * heading  degrees clockwise from north, as the phone reports it; null keeps
 *          the car pointing up.
 */
export default function CarMarker({ coordinate, heading, tone, size, children }) {
  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      flat
      rotation={typeof heading === 'number' ? heading : 0}
      // The drawing never changes, only its position and angle, so the map
      // can keep its snapshot instead of re-rendering it on every move.
      tracksViewChanges={false}
    >
      <View style={styles.wrap}>
        {children}
        <CarShape tone={tone} size={size} />
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  car: {
    width: 18,
    height: 34,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: COLORS.white,
    alignItems: 'center',
    shadowColor: '#0B1220',
    shadowOpacity: 0.3,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  windscreen: {
    position: 'absolute',
    top: 6,
    width: 12,
    height: 7,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    borderBottomLeftRadius: 1,
    borderBottomRightRadius: 1,
    backgroundColor: '#D3D7DE',
  },
  roof: {
    position: 'absolute',
    top: 14,
    width: 12,
    height: 9,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  rearWindow: {
    position: 'absolute',
    bottom: 3,
    width: 11,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D3D7DE',
  },
  light: { position: 'absolute', top: 1, width: 4, height: 2, borderRadius: 1, backgroundColor: '#FFF6C7' },
  lightLeft: { left: 2 },
  lightRight: { right: 2 },
});
