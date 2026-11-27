// utils/offerAlerts.js
// Accept / Decline buttons on job offer and follow-on offer alerts.
//
// During a trip the driver usually has Google Maps (or Waze) in front, so
// an offer arrives as a notification over the map, not as the in-app
// pop-up. Drivers missed follow-on jobs that way: answering meant switching
// back to TakeARoute in time. With the buttons they answer from the alert.
//
//   Follow-on offer  Accept and No thanks both work without opening the
//                    app: answerFollowOnJob is called in the background
//                    (the app keeps running during a trip for the location
//                    sharing, utils/driverLocation.js) and the alert turns
//                    into "Follow-on job accepted" or the reason it wasn't.
//   Job offer        Accept opens the app and takes the job straight away
//                    (DriverHomeScreen, acceptJobId), because the driver
//                    needs the job screen next. Decline works in the
//                    background, as the in-app Decline does.
//   Tapping the alert itself opens the app on the offer, as before (App.js).
//
// How the buttons get there:
//   iPhone   the push names the button set (aps.category, functions
//            sendPush); this file registers the sets at start-up.
//   Android  the system draws the push itself while the app is in the
//            background, and that copy cannot have buttons. So the push
//            also reaches this app (the background message handler below)
//            and is drawn again, with the buttons, under the same tag,
//            replacing the system's copy. If that fails for any reason the
//            plain alert stays, exactly as before.
//
// Imported from index.js before the app itself, so the handlers exist when
// Android starts the app in the background just to handle a button press.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
import { arrayUnion, doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { answerFollowOn, followOnError } from './followOn';

// Category ids: no ':' or '-' (expo-notifications). The server sends the
// same names (functions/index.js OFFER_ALERTS).
const CATEGORY = { job_offer: 'job_offer', follow_on_offer: 'follow_on_offer' };
const TAG_PREFIX = { job_offer: 'offer', follow_on_offer: 'followon' };
export const ACCEPT = 'accept';
export const DECLINE = 'decline';

// Silent: the copy with buttons replaces an alert that has just rung on the
// job-ring channel, and ringing again a moment later sounded like a stutter.
const BUTTONS_CHANNEL = 'job-offer-buttons';
const ACTION_TASK = 'offer-alert-action';

/** The tag (Android) / identifier (iPhone) of the alert for an offer. */
export function alertTagFor(type, rideId) {
  const prefix = TAG_PREFIX[type];
  return prefix && rideId ? `${prefix}_${rideId}`.slice(0, 64) : null;
}

/* The push's data, whichever way the platform hands it over: in
   content.data (Android, and local alerts), as a JSON string (Android, in a
   background task) or only in trigger.payload (iPhone pushes not sent
   through Expo's push service, like ours). */
export function notificationData(notification) {
  const request = notification?.request || {};
  const content = request.content || {};
  let data = content.data;
  if ((!data || typeof data !== 'object') && typeof content.dataString === 'string') {
    try {
      data = JSON.parse(content.dataString);
    } catch (error) {
      data = null;
    }
  }
  const payload = request.trigger?.payload;
  const fromPayload = {};
  if (payload && typeof payload === 'object') {
    Object.keys(payload).forEach((key) => {
      if (key !== 'aps' && !key.startsWith('gcm.') && !key.startsWith('google.')) fromPayload[key] = payload[key];
    });
  }
  return { ...fromPayload, ...(data && typeof data === 'object' ? data : {}) };
}

/* ---------------------------------------------------------- button sets */

async function setUpCategories() {
  await Notifications.setNotificationCategoryAsync(CATEGORY.follow_on_offer, [
    { identifier: ACCEPT, buttonTitle: 'Accept', options: { opensAppToForeground: false } },
    { identifier: DECLINE, buttonTitle: 'No thanks', options: { opensAppToForeground: false, isDestructive: true } },
  ]);
  await Notifications.setNotificationCategoryAsync(CATEGORY.job_offer, [
    { identifier: ACCEPT, buttonTitle: 'Accept', options: { opensAppToForeground: true } },
    { identifier: DECLINE, buttonTitle: 'Decline', options: { opensAppToForeground: false, isDestructive: true } },
  ]);
}
const categoriesReady = setUpCategories().catch((error) => console.log('Offer buttons setup error:', error));

let buttonsChannelReady = false;
async function ensureButtonsChannel() {
  if (Platform.OS !== 'android' || buttonsChannelReady) return;
  await Notifications.setNotificationChannelAsync(BUTTONS_CHANNEL, {
    name: 'Job offer buttons',
    description: 'Accept and Decline on a job offer that has just rung. Silent.',
    importance: Notifications.AndroidImportance.HIGH,
    sound: null,
    enableVibrate: false,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  buttonsChannelReady = true;
}

/* ---------------------------------------- Android: redraw with buttons */

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const expiresAtOf = (data) => Number(data?.expiresAt) || 0;

/* An offer push that arrived with the app in the background (Android). The
   system has drawn it, or is about to; a moment later the same alert is
   drawn again under the server's tag, with the buttons, which replaces it. */
async function addButtons(message) {
  const data = message?.data || {};
  const note = message?.notification || {};
  const category = CATEGORY[data.type];
  // Only when the server tagged the push: without the tag ours would be a
  // second alert instead of a replacement.
  if (!category || !data.rideId || !data.alertTag || !(note.title || note.body)) return;
  const expiresAt = expiresAtOf(data);
  if (expiresAt && expiresAt <= Date.now()) return;
  await categoriesReady;
  await ensureButtonsChannel();
  // Let the system's copy go up first, or it would replace ours.
  await wait(600);
  await Notifications.scheduleNotificationAsync({
    identifier: data.alertTag,
    content: {
      title: note.title || 'TakeARoute',
      body: note.body || '',
      data,
      categoryIdentifier: category,
      priority: Notifications.AndroidNotificationPriority.MAX,
    },
    trigger: { channelId: BUTTONS_CHANNEL },
  });
  // Gone when the offer runs out, if the app is still running then. Only
  // this very alert: a new offer of the same job (a BID JOB straight after,
  // say) has taken its place under the same tag and must stay.
  if (expiresAt) {
    setTimeout(() => dismissIfStillShowing(data.alertTag, expiresAt), Math.max(0, expiresAt - Date.now()) + 2000);
  }
}

async function dismissIfStillShowing(identifier, expiresAt) {
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    const mine = shown.find(
      (n) => n.request?.identifier === identifier && expiresAtOf(notificationData(n)) === expiresAt
    );
    if (mine) await Notifications.dismissNotificationAsync(identifier);
  } catch (error) {
    // Not critical.
  }
}

if (Platform.OS === 'android') {
  try {
    setBackgroundMessageHandler(getMessaging(), async (message) => {
      try {
        await addButtons(message);
      } catch (error) {
        console.log('Offer buttons error:', error);
      }
    });
  } catch (error) {
    console.log('Background message handler error:', error);
  }
}

/* ------------------------------------------------------ button presses */

// Answers already sent from this phone, so a press seen twice (the listener
// and the Android background task both hear it) is answered once.
const answered = new Set();

async function signedInUid() {
  try {
    if (typeof auth.authStateReady === 'function') await auth.authStateReady();
  } catch (error) {
    // Fall through to whatever is known.
  }
  return auth.currentUser?.uid || null;
}

async function tell(identifier, title, body, data = {}) {
  try {
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: { title, body, data, sound: 'default' },
      trigger: Platform.OS === 'android' ? { channelId: 'trip-updates' } : null,
    });
  } catch (error) {
    // Not critical.
  }
}

// A press handed over again long after the event (a launch response read on
// a later start, say) is not acted on: the offer has gone by then.
function stale(response, data) {
  const expiresAt = expiresAtOf(data);
  if (expiresAt) return Date.now() > expiresAt + 30 * 1000;
  let at = Number(response?.notification?.date) || 0;
  if (at && at < 1e12) at *= 1000; // seconds on some versions
  return at > 0 && Date.now() - at > 5 * 60 * 1000;
}

/* Whether a response was a button answered here, in the background, so the
   tap handler in App.js leaves it alone. Accept on a job offer is not: it
   opens the app, and App.js takes the driver to the job to take it. */
export function answeredInBackground(data) {
  const action = data?.tapAction;
  if (!action || action === Notifications.DEFAULT_ACTION_IDENTIFIER) return false;
  return !(data.type === 'job_offer' && action === ACCEPT);
}

async function answer(response) {
  const action = response?.actionIdentifier;
  if (action !== ACCEPT && action !== DECLINE) return;
  const data = notificationData(response.notification);
  const type = data.type;
  const rideId = data.rideId;
  if (!CATEGORY[type] || !rideId) return;
  if (type === 'job_offer' && action === ACCEPT) return; // App.js, in the app
  const key = `${type}|${rideId}|${action}`;
  if (answered.has(key)) return;
  answered.add(key);
  if (stale(response, data)) return;

  const tag = data.alertTag || alertTagFor(type, rideId);
  const shown = response.notification?.request?.identifier;
  if (shown) Notifications.dismissNotificationAsync(shown).catch(() => {});
  if (tag && tag !== shown) Notifications.dismissNotificationAsync(tag).catch(() => {});

  const uid = await signedInUid();
  if (!uid) {
    if (action === ACCEPT) {
      await tell(`result_${rideId}`, 'Job not taken', 'You are signed out on this phone. Open TakeARoute to sign in.', { type });
    }
    return;
  }

  if (type === 'job_offer') {
    // As the in-app Decline: off this driver's list, and the server asks the
    // next driver (functions/appOffers.js).
    await updateDoc(doc(db, 'rides', rideId), { declinedBy: arrayUnion(uid) }).catch(() => {});
    return;
  }

  if (action === DECLINE) {
    await answerFollowOn(rideId, 'decline').catch(() => {});
    return;
  }

  const pickup = data.pickup ? `Pickup at ${data.pickup} ` : 'Head to the pickup ';
  const taken = () =>
    tell(`result_${rideId}`, 'Follow-on job accepted', `${pickup}when you drop off this passenger.`, { type: 'trip', rideId });
  try {
    await answerFollowOn(rideId, 'accept');
    await taken();
  } catch (error) {
    // Answered twice (an earlier press got through): the job is ours.
    const ride = await getDoc(doc(db, 'rides', rideId)).catch(() => null);
    const r = ride?.exists() ? ride.data() : null;
    if (r && r.driverId === uid && r.followOn) {
      await taken();
      return;
    }
    await tell(`result_${rideId}`, 'Follow-on job not taken', followOnError(error), { type: 'trip' });
  }
}

function answerSafely(response) {
  return answer(response).catch((error) => console.log('Offer answer error:', error));
}

// While the app is running, in front or behind another app (iPhone: always
// this way; it wakes the app for the press).
Notifications.addNotificationResponseReceivedListener(answerSafely);

// A press that started the app before this listener existed.
Notifications.getLastNotificationResponseAsync()
  .then((response) => (response ? answerSafely(response) : null))
  .catch(() => {});

// Android runs this for a button press while the app is in the background
// or not running at all.
TaskManager.defineTask(ACTION_TASK, async ({ data, error }) => {
  if (error || !data || typeof data !== 'object' || !('actionIdentifier' in data)) return;
  await answerSafely(data);
});
if (Platform.OS === 'android') {
  Notifications.registerTaskAsync(ACTION_TASK).catch((error) => console.log('Offer task error:', error));
}

/* ------------------------------------------------------------ clearing */

/** Takes down the alert for an offer that has been answered or has gone
    (every alert of that type when rideId is null). */
export async function dismissOfferAlerts(type, rideId) {
  const tag = rideId ? alertTagFor(type, rideId) : null;
  const prefix = `${TAG_PREFIX[type]}_`;
  // Android names the system's own copy of a push by its tag inside the id
  // (...?tag=offer_abc&id=0); its data is not readable there.
  const byId = (id) =>
    tag ? id === tag || id.includes(`tag=${tag}&`) || id.endsWith(`tag=${tag}`) : id.startsWith(prefix) || id.includes(`tag=${prefix}`);
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      shown
        .filter((n) => {
          const id = n.request?.identifier || '';
          const data = notificationData(n);
          return byId(id) || (data.type === type && (!rideId || data.rideId === rideId));
        })
        .map((n) => Notifications.dismissNotificationAsync(n.request.identifier))
    );
  } catch (error) {
    // Not critical.
  }
}
