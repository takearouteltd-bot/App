// utils/notifications.js
// Push notifications on the phone.
//
// Android: the phone's FCM token is saved to pushTokens/{uid}, and Cloud
// Functions send through Firebase Cloud Messaging (admin.messaging()). This
// does not depend on the Expo account that owns the project.
// iOS: needs the Apple developer account renewed and an APNs key added to
// Firebase before it will deliver; the code below already asks permission.
//
// Channels (Android sets sound and importance per channel, not per message):
//   job-alerts    new job offers. Loud, 20 second chime, vibration.
//   trip-updates  driver arrived, ride cancelled, and similar.
//   messages      chat and support replies.
//   general       announcements from TakeARoute.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { arrayUnion, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

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

    const { data: token, type } = await Notifications.getDevicePushTokenAsync();
    if (!token) return null;

    await setDoc(
      doc(db, 'pushTokens', uid),
      {
        tokens: arrayUnion(token),
        platform: Platform.OS,
        tokenType: type || null,
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

// Calls onOpen(data) when the person taps a notification.
export function onNotificationOpened(onOpen) {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    onOpen(response?.notification?.request?.content?.data || {});
  });
  return () => sub.remove();
}
