// components/CarMarker.jsx
// A car seen from above, for the maps: nearby drivers on the passenger's home
// screen and the passenger's own driver while they track them.
//
// Drawn from views rather than an image so it stays sharp at any density and
// takes the brand colours. The map turns it to the direction the car is
// travelling (Marker `rotation`), so it points down the road like Uber's.
import React, { useEffect, useRef, useState } from 'react';
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

/* ------------------------------------------------------------ gliding */

// Fixes arrive every few seconds, so drawing each one as it lands makes the
// car hop. Instead the car glides from where it is drawn to the new fix over
// about as long as the gap between fixes, and turns the short way round.
const MIN_GLIDE_MS = 600;
const MAX_GLIDE_MS = 4500;
const FRAME_MS = 33; // ~30 fps is plenty for a car and spares the JS thread
// A jump this far (about 2 km) is a new driver or a stale cache, not driving.
const TELEPORT_DEG = 0.02;
// Under this (about 3 m) the phone is guessing, so the angle isn't updated.
const STILL_DEG = 0.00003;

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

// Shortest signed turn from a to b, in degrees.
const turn = (a, b) => ((b - a + 540) % 360) - 180;

// Compass bearing from one point to another, for when the phone gives none.
function bearing(from, to) {
  const rad = Math.PI / 180;
  const y = Math.sin((to.longitude - from.longitude) * rad) * Math.cos(to.latitude * rad);
  const x =
    Math.cos(from.latitude * rad) * Math.sin(to.latitude * rad) -
    Math.sin(from.latitude * rad) * Math.cos(to.latitude * rad) * Math.cos((to.longitude - from.longitude) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

function useGlide(coordinate, heading) {
  const lat = coordinate?.latitude;
  const lng = coordinate?.longitude;
  const [shown, setShown] = useState(() => ({
    coordinate: { latitude: lat, longitude: lng },
    heading: isNum(heading) ? heading : 0,
  }));
  const shownRef = useRef(shown);
  const lastFixAt = useRef(0);
  const timer = useRef(null);

  useEffect(() => () => clearInterval(timer.current), []);

  useEffect(() => {
    if (!isNum(lat) || !isNum(lng)) return;
    const from = shownRef.current;
    const to = { latitude: lat, longitude: lng };
    const dLat = to.latitude - from.coordinate.latitude;
    const dLng = to.longitude - from.coordinate.longitude;
    const far = !isNum(from.coordinate.latitude) || Math.abs(dLat) + Math.abs(dLng) > TELEPORT_DEG;
    const still = Math.abs(dLat) + Math.abs(dLng) < STILL_DEG;

    // The phone's heading when it has one, else the way the car moved, else
    // keep pointing where it was (a parked car shouldn't spin).
    let target = from.heading;
    if (isNum(heading)) target = heading;
    else if (!still && !far) target = bearing(from.coordinate, to);

    const now = Date.now();
    const gap = lastFixAt.current ? now - lastFixAt.current : MIN_GLIDE_MS;
    lastFixAt.current = now;
    clearInterval(timer.current);

    const set = (next) => {
      shownRef.current = next;
      setShown(next);
    };
    if (far) {
      set({ coordinate: to, heading: target });
      return;
    }

    const duration = Math.min(MAX_GLIDE_MS, Math.max(MIN_GLIDE_MS, gap));
    const startHeading = from.heading;
    const spin = turn(startHeading, target);
    const start = now;
    timer.current = setInterval(() => {
      const t = Math.min(1, (Date.now() - start) / duration);
      // Position moves at a steady pace (cars don't ease in and out at every
      // fix); the turn eases out so corners look natural.
      const turnT = 1 - (1 - Math.min(1, t * 2)) ** 2;
      set({
        coordinate: {
          latitude: from.coordinate.latitude + dLat * t,
          longitude: from.coordinate.longitude + dLng * t,
        },
        heading: (startHeading + spin * turnT + 360) % 360,
      });
      if (t >= 1) clearInterval(timer.current);
    }, FRAME_MS);
  }, [lat, lng, heading]);

  return shown;
}

/**
 * A car on the map.
 * heading  degrees clockwise from north, as the phone reports it; null keeps
 *          the car pointing up.
 */
export default function CarMarker({ coordinate, heading, tone, size, children }) {
  const shown = useGlide(coordinate, heading);
  return (
    <Marker
      coordinate={shown.coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      flat
      rotation={shown.heading}
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
