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
//
// The watcher only runs while the app is on screen. During a job the driver
// usually switches to Google Maps to navigate, so while they have a job a
// background task (with an Android notification and the iOS location
// indicator) keeps writing drivers/{uid}; otherwise the passenger's map
// shows the car frozen where the driver left the app.
//
// No background permission is needed for that. On Android a location service
// with a notification, started while the app is on screen, runs on the normal
// "while using the app" permission and keeps going while another app is
// showing (expo-location: "user-initiated foreground service"). What it cannot
// do is START with the app in the background, so a failed start is retried
// when the driver comes back, and shown on the job screens (jobSharing).
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { getAuth } from 'firebase/auth';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';

const FIX_TIMEOUT_MS = 10000;

/* ---------------------------------------------------------------- store */

// status: 'idle' | 'locating' | 'granted' | 'denied' | 'timeout' | 'error'
// jobSharing: 'off' | 'on' | 'failed' (keeping the position going in other apps)
const state = { coords: null, status: 'idle', jobSharing: 'off' };
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
// How often the position is saved. Every save also refreshes each screen
// watching the driver record, and on a weak signal saves queue up in front
// of the driver's own taps (finishing a trip), so: at most one save in
// flight, every 10 s on a job and 20 s while waiting for one, sooner after
// a big move. The dashboard and dispatch treat 5 minutes as stale.
const SAVE_EVERY_MS_ON_JOB = 10000;
const SAVE_EVERY_MS_IDLE = 20000;
const SAVE_AFTER_METRES = 150;
let saving = false;
let lastSave = null;

function metresApart(a, b) {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function writeDriverLocation(driverId, coords, force = false) {
  if (saving && !force) return;
  const now = Date.now();
  if (!force && lastSave && lastSave.driverId === driverId) {
    const every = jobDriverId ? SAVE_EVERY_MS_ON_JOB : SAVE_EVERY_MS_IDLE;
    if (now - lastSave.at < every && metresApart(lastSave.coords, coords) < SAVE_AFTER_METRES) return;
  }
  saving = true;
  lastSave = { driverId, at: now, coords: { latitude: coords.latitude, longitude: coords.longitude } };
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
  } finally {
    saving = false;
  }
}

/* ------------------------------------------------- background (on a job) */

const JOB_LOCATION_TASK = 'takearoute-job-location';
let jobDriverId = null;

// Defined when this module loads (App imports it at startup), as the task
// manager requires, so it exists when the OS wakes the task.
TaskManager.defineTask(JOB_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.log('Background location error:', error.message || error);
    return;
  }
  const fixes = data?.locations;
  if (!fixes?.length) return;
  const fix = fixes[fixes.length - 1];
  const driverId = jobDriverId || getAuth().currentUser?.uid;
  if (!driverId) return;
  update({ coords: fix.coords, status: 'granted' });
  await writeDriverLocation(driverId, fix.coords);
});

async function startJobSharing(driverId) {
  jobDriverId = driverId;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(JOB_LOCATION_TASK)) {
      update({ jobSharing: 'on' });
      return;
    }
    await Location.startLocationUpdatesAsync(JOB_LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 4000,
      distanceInterval: 10,
      activityType: Location.ActivityType.AutomotiveNavigation,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Sharing your location with your passenger',
        notificationBody: 'Until this trip ends, so they can see you coming.',
        notificationColor: '#B8F03A',
      },
    });
    if (jobDriverId === driverId) update({ jobSharing: 'on' });
  } catch (error) {
    // Still covered while the app is open (the watcher above), but the driver
    // has to know their passenger loses them in Google Maps.
    console.log('Could not start background location:', error?.message || error);
    if (jobDriverId === driverId) update({ jobSharing: 'failed' });
  }
}

/* The job screens' "Try again": re-asks for location, then starts sharing. */
export async function retryJobSharing(driverId) {
  if (!driverId) return;
  await requestDriverPosition(driverId);
  await startJobSharing(driverId);
}

async function stopJobSharing() {
  jobDriverId = null;
  update({ jobSharing: 'off' });
  try {
    if (await Location.hasStartedLocationUpdatesAsync(JOB_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(JOB_LOCATION_TASK);
    }
  } catch (error) {
    console.log('Could not stop background location:', error?.message || error);
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
      await writeDriverLocation(driverId, fix.coords, true);
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
  const [presence, setPresence] = useState({ isFree: false, onRide: false, vehicleType: null });
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
          onRide: data.isOnRide === true,
          vehicleType: data.vehicleType || null,
        });
      },
      () => {}
    );
  }, [driverId, enabled]);

  // Keep the passenger's map live while the driver is in another app.
  const onRide = presence.onRide;
  useEffect(() => {
    if (!driverId || !enabled || !onRide) return undefined;
    startJobSharing(driverId);
    // Android refuses to start it while the app is in the background.
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && state.jobSharing === 'failed') startJobSharing(driverId);
    });
    return () => {
      sub.remove();
      stopJobSharing();
    };
  }, [driverId, enabled, onRide]);

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
