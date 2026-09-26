// utils/notifications.js
// Push notifications on the phone.
//
// The phone's FCM registration token is saved to pushTokens/{uid}, and Cloud
// Functions send through Firebase Cloud Messaging (admin.messaging()). This
// does not depend on the Expo account that owns the project.
//
// The token comes from @react-native-firebase/messaging on both platforms.
// expo-notifications' getDevicePushTokenAsync() gives a raw APNs token on
// iOS, which admin.messaging() rejects, so every iPhone send failed and the
// token was pruned. Permission is still asked through expo-notifications,
// which also owns the Android channels and the tap handling.
//
// iOS still needs an APNs key in Firebase (Project settings, Cloud Messaging)
// before anything is delivered.
//
// Channels (Android sets sound and importance per channel, not per message):
//   job-alerts    new job offers. Loud, 20 second chime, vibration.
//   trip-updates  driver arrived, ride cancelled, and similar.
//   messages      chat and support replies.
//   general       announcements from TakeARoute.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { signOut } from 'firebase/auth';
import { arrayRemove, arrayUnion, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { getMessaging, getToken, registerDeviceForRemoteMessages } from '@react-native-firebase/messaging';
import { auth, db } from '../config/firebase';

// Show notifications while the app is open too.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let channelsReady = false;

async function ensureChannels() {
  if (Platform.OS !== 'android' || channelsReady) return;
  await Notifications.setNotificationChannelAsync('job-alerts', {
    name: 'New job offers',
    description: 'Rings when a new job is offered to you.',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'job_alert.wav',
    vibrationPattern: [0, 800, 400, 800, 400, 800, 400, 800],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: false,
  });
  await Notifications.setNotificationChannelAsync('trip-updates', {
    name: 'Trip updates',
    description: 'Driver arrived, ride cancelled and other trip changes.',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 300, 200, 300],
  });
  await Notifications.setNotificationChannelAsync('messages', {
    name: 'Messages',
    description: 'Chat during a trip and replies from support.',
    importance: Notifications.AndroidImportance.HIGH,
  });
  await Notifications.setNotificationChannelAsync('general', {
    name: 'News from TakeARoute',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  channelsReady = true;
}

// This phone's FCM registration token, or null when there is none (simulator,
// or iOS before APNs registration succeeds). One code path for both platforms
// so register and unregister always agree on which token they mean.
async function getPushToken() {
  if (!Device.isDevice) return null;
  const messaging = getMessaging();
  if (Platform.OS === 'ios') {
    await registerDeviceForRemoteMessages(messaging);
  }
  const token = await getToken(messaging);
  return token || null;
}

// Asks permission once, then saves this phone's token against the user.
// Safe to call on every sign-in; it does nothing on simulators.
export async function registerForPushNotifications(uid) {
  try {
    if (!uid || !Device.isDevice) return null;
    await ensureChannels();

    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== 'granted') {
      const asked = await Notifications.requestPermissionsAsync();
      status = asked.status;
    }
    if (status !== 'granted') return null;

    const token = await getPushToken();
    if (!token) return null;

    await setDoc(
      doc(db, 'pushTokens', uid),
      {
        tokens: arrayUnion(token),
        platform: Platform.OS,
        tokenType: 'fcm',
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return token;
  } catch (error) {
    console.log('Push registration error:', error);
    return null;
  }
}

/* Removes this phone's token so the person genuinely stops receiving pushes.
   sendPush() reads pushTokens/{uid}, so with no token there is nothing to send
   to. Turning notifications "off" in a settings screen has to do this — a flag
   the server never reads is just a switch that lies. */
export async function unregisterPushNotifications(uid) {
  try {
    if (!uid) return false;
    const token = await getPushToken().catch(() => null);
    if (token) {
      await setDoc(
        doc(db, 'pushTokens', uid),
        { tokens: arrayRemove(token), updatedAt: serverTimestamp() },
        { merge: true }
      );
    } else {
      // No token to hand (simulator, or permission already withdrawn): clear
      // the lot so nothing is left pointing at this account.
      await setDoc(doc(db, 'pushTokens', uid), { tokens: [], updatedAt: serverTimestamp() }, { merge: true });
    }
    return true;
  } catch (error) {
    console.log('Push unregister error:', error);
    return false;
  }
}

/* Signs out properly: this phone's token is removed from the account first,
   so the next person to sign in on the phone does not keep receiving the
   previous account's job alerts, trip updates and messages. Every sign-out
   in the app goes through here. */
export async function signOutEverywhere() {
  const uid = auth.currentUser?.uid;
  if (uid) await unregisterPushNotifications(uid);
  await signOut(auth);
}

// Whether this phone currently has a token saved against the account.
export async function hasPushToken(uid) {
  try {
    if (!uid) return false;
    const snap = await getDoc(doc(db, 'pushTokens', uid));
    const tokens = snap.exists() ? snap.data().tokens || [] : [];
    return tokens.length > 0;
  } catch (error) {
    return false;
  }
}

// Clears job alerts still showing, e.g. after the driver accepts a job.
export async function clearJobAlerts() {
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      shown
        .filter((n) => n.request?.content?.data?.type === 'job_offer')
        .map((n) => Notifications.dismissNotificationAsync(n.request.identifier))
    );
  } catch (error) {
    // Not critical.
  }
}

// Calls onOpen(data) when the person taps a notification while the app is
// running or in the background.
export function onNotificationOpened(onOpen) {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    onOpen(response?.notification?.request?.content?.data || {});
  });
  return () => sub.remove();
}

// The notification that launched the app from cold, if any. Cleared once
// read, so the same tap is never acted on twice.
export async function takeLaunchNotification() {
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    if (!response) return null;
    await Notifications.clearLastNotificationResponseAsync().catch(() => {});
    return response?.notification?.request?.content?.data || null;
  } catch (error) {
    return null;
  }
}
