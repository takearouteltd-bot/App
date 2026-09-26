// utils/driverLocation.js
// The driver's position for the whole session.
//
// One GPS watcher runs for as long as the driver tabs are mounted (see
// navigation/DriverTabs.js), whichever screen is showing. It writes the
// position to drivers/{uid} (what the ride screens, the passenger's tracking
// map and the dashboard read) and, while the driver is online and free, to
// driverLocations/{uid} (the bare position passengers see as nearby cars).
//
// Before this lived here it lived on the driver home screen, which is
// replaced by the ride screens when a job starts, so the car froze at its
// accept-time position for the whole trip.
import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';

const FIX_TIMEOUT_MS = 10000;

/* ---------------------------------------------------------------- store */

// status: 'idle' | 'locating' | 'granted' | 'denied' | 'timeout' | 'error'
const state = { coords: null, status: 'idle' };
const listeners = new Set();
let watcher = null;
let watchingFor = null;

function update(patch) {
  Object.assign(state, patch);
  listeners.forEach((listener) => listener({ ...state }));
}

/* The latest position and how getting it went. Re-renders on every fix. */
export function useDriverPosition() {
  const [snapshot, setSnapshot] = useState({ ...state });
  useEffect(() => {
    listeners.add(setSnapshot);
    setSnapshot({ ...state });
    return () => listeners.delete(setSnapshot);
  }, []);
  return snapshot;
}

/* ------------------------------------------------------------- writing */

// Same fields the home screen always wrote. Shown on the dashboard's Live
// drivers page and read by every ride screen.
async function writeDriverLocation(driverId, coords) {
  try {
    await setDoc(
      doc(db, 'drivers', driverId),
      {
        location: { latitude: coords.latitude, longitude: coords.longitude },
        // The phone reports speed in m/s, or a negative number when it
        // doesn't know.
        speedKph:
          typeof coords.speed === 'number' && coords.speed >= 0
            ? Math.round(coords.speed * 3.6)
            : null,
        heading:
          typeof coords.heading === 'number' && coords.heading >= 0
            ? Math.round(coords.heading)
            : null,
        lastUpdated: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    console.log('Location update error:', error);
  }
}

/* ------------------------------------------------------------ watching */

async function startWatching(driverId) {
  if (watcher && watchingFor === driverId) return;
  stopWatching();
  watchingFor = driverId;
  watcher = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: 4000 },
    async (fix) => {
      update({ coords: fix.coords, status: 'granted' });
      if (driverId) await writeDriverLocation(driverId, fix.coords);
    }
  );
}

function stopWatching() {
  if (watcher) watcher.remove();
  watcher = null;
  watchingFor = null;
}

/**
 * Ask for permission and a first fix, then keep watching. Safe to call again
 * from a "Try again" button: it re-asks and restarts the watcher if needed.
 * Resolves to the resulting status.
 */
export async function requestDriverPosition(driverId) {
  update({ status: 'locating' });
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      update({ status: 'denied' });
      return 'denied';
    }

    let fix = null;
    try {
      fix = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), FIX_TIMEOUT_MS)),
      ]);
    } catch (error) {
      // GPS off, or slow to lock on: a recent fix is better than none.
      fix = await Location.getLastKnownPositionAsync().catch(() => null);
      if (!fix) {
        update({ status: 'timeout' });
        // Permission is granted, so the watcher can still deliver a fix later.
        if (driverId) startWatching(driverId).catch(() => {});
        return 'timeout';
      }
    }

    update({ coords: fix.coords, status: 'granted' });
    if (driverId) {
      await writeDriverLocation(driverId, fix.coords);
      await startWatching(driverId);
    }
    return 'granted';
  } catch (error) {
    console.log('Location error:', error);
    update({ status: 'error' });
    return 'error';
  }
}

/* -------------------------------------------------------------- hook */

/**
 * Mount once for the driver session. Owns the watcher and the two Firestore
 * positions. `enabled` false stops everything (e.g. while signed out).
 */
export function useDriverLocationPublisher(driverId, enabled = true) {
  // Online, free and vehicle class, from the driver record: decides whether
  // the public position is published.
  const [presence, setPresence] = useState({ isFree: false, vehicleType: null });
  const position = useDriverPosition();

  useEffect(() => {
    if (!driverId || !enabled) return undefined;
    requestDriverPosition(driverId);
    return () => {
      stopWatching();
      update({ coords: null, status: 'idle' });
    };
  }, [driverId, enabled]);

  useEffect(() => {
    if (!driverId || !enabled) return undefined;
    return onSnapshot(
      doc(db, 'drivers', driverId),
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        setPresence({
          isFree: data.status === 'online' && data.isOnRide !== true,
          vehicleType: data.vehicleType || null,
        });
      },
      () => {}
    );
  }, [driverId, enabled]);

  /* Passengers see nearby cars on their home map. They must never read the
     driver record itself (name, phone, documents), so an online driver also
     publishes a bare position to driverLocations/{uid}: coordinates, heading
     and whether they are free. It is taken down whenever they go offline or
     start a trip, whatever caused it. */
  const [publishedFree, setPublishedFree] = useState(null);
  const { isFree, vehicleType } = presence;
  const coords = position.coords;
  useEffect(() => {
    if (!driverId || !enabled) return;
    const ref = doc(db, 'driverLocations', driverId);

    if (isFree && coords && Number.isFinite(coords.latitude)) {
      setPublishedFree(true);
      setDoc(
        ref,
        {
          latitude: coords.latitude,
          longitude: coords.longitude,
          heading:
            typeof coords.heading === 'number' && coords.heading >= 0
              ? Math.round(coords.heading)
              : null,
          vehicleType: vehicleType || null,
          online: true,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ).catch(() => {});
    } else if (publishedFree !== false) {
      // Only once per change to offline, not on every GPS tick.
      setPublishedFree(false);
      setDoc(ref, { online: false, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
    }
    // publishedFree is the guard, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverId, enabled, isFree, coords, vehicleType]);
}
