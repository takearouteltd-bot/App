// components/ui/alert.jsx
// The app's own alert dialog, in place of the platform's grey system alert.
//
// It is a drop-in for React Native's Alert: the same
// `Alert.alert(title, message, buttons, options)` call, the same button
// objects ({ text, onPress, style: 'cancel' | 'destructive' }), the same
// "no buttons means one OK" rule. Screens only change their import.
//
// What it adds:
//   - A tone, read from the words and buttons, so an error looks like an error
//     and a confirmation looks like a question: red, amber, green or blue, each
//     with its own icon.
//   - Plain language for raw Firebase errors. "Firebase: Error
//     (auth/network-request-failed)." becomes "No internet connection…". A
//     message a screen wrote itself is left exactly as it is.
//   - A queue: a second alert waits for the first instead of replacing it.
//
// <AlertHost /> draws the dialogs. App.js mounts one at the root; a screen
// that shows its own <Modal> mounts another inside it, because on iOS a dialog
// cannot appear over a modal from outside it. The most recently mounted host
// is the one that shows alerts.
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, COLORS, RADIUS, SHADOW, SPACE, TYPE } from './kit';

/* ---------------------------------------------------------------- queue */

const hosts = [];      // mounted AlertHosts, newest last
const waiting = [];    // alerts raised before any host was mounted
let nextId = 1;

function dispatch(item) {
  const host = hosts[hosts.length - 1];
  if (host) host(item);
  else waiting.push(item);
}

export const Alert = {
  alert(title, message, buttons, options) {
    dispatch({
      id: nextId++,
      title: title == null ? '' : String(title),
      message: message == null ? '' : String(message),
      buttons: Array.isArray(buttons) && buttons.length ? buttons : [{ text: 'OK' }],
      options: options || {},
    });
  },
};

/* ------------------------------------------------------------ wording */

// Firebase codes, without their "auth/" style prefix, in words a rider or
// driver can act on.
const FRIENDLY = {
  'invalid-phone-number': "That phone number doesn't look right. Check the country code and the number.",
  'missing-phone-number': 'Please enter your phone number.',
  'invalid-verification-code': "That code isn't right. Check the SMS and try again.",
  'missing-verification-code': 'Please enter the 6-digit code we sent you.',
  'code-expired': 'That code has expired. Request a new one and try again.',
  'session-expired': 'That code has expired. Request a new one and try again.',
  'invalid-verification-id': 'That code has expired. Request a new one and try again.',
  'too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
  'quota-exceeded': "We can't send codes right now. Please try again later.",
  'network-request-failed': 'No internet connection. Check your connection and try again.',
  'user-disabled': 'This account has been disabled. Please contact support.',
  'email-already-in-use': 'An account already uses this email. Try signing in instead.',
  'invalid-email': "That email address doesn't look right.",
  'wrong-password': 'The email or password is incorrect.',
  'invalid-credential': 'The email or password is incorrect.',
  'invalid-login-credentials': 'The email or password is incorrect.',
  'user-not-found': "We couldn't find an account with those details.",
  'weak-password': 'Please choose a stronger password, at least 6 characters.',
  'requires-recent-login': 'For your security, please sign out and back in, then try again.',
  'credential-already-in-use': 'That login is already linked to another account.',
  'captcha-check-failed': "The security check didn't complete. Please try again.",
  'app-not-authorized': "This version of the app can't sign you in. Please update TakeARoute.",
  'permission-denied': "You don't have permission to do that.",
  'unauthenticated': 'Your session has expired. Please sign in again.',
  'unavailable': 'The service is unavailable right now. Please try again in a moment.',
  'deadline-exceeded': 'That took too long. Check your connection and try again.',
  'internal': 'Something went wrong on our side. Please try again.',
  'unauthorized': "You don't have permission to upload this file.",
  'canceled': 'The upload was cancelled.',
  'retry-limit-exceeded': 'The upload kept failing. Check your connection and try again.',
};

// Only rewrites text that came straight from the Firebase SDK. Anything a
// screen or a cloud function wrote on purpose is shown untouched.
export function friendlyMessage(message) {
  const text = String(message ?? '').trim();
  if (!text) return '';

  if (/^network request failed$/i.test(text)) return FRIENDLY['network-request-failed'];
  if (/^(internal|INTERNAL)$/.test(text)) return FRIENDLY.internal;

  const raw =
    text.match(/^Firebase:.*?\(([\w-]+)\/([\w-]+)\)/) ||    // web SDK
    text.match(/^\[([\w-]+)\/([\w-]+)\]/);                 // native SDK
  if (!raw) return text;

  return FRIENDLY[raw[2]] || 'Something went wrong. Please try again.';
}

// Titles that say nothing get a friendlier stand-in.
function friendlyTitle(title) {
  if (/^error!?$/i.test(title)) return 'Something went wrong';
  if (/^success!?$/i.test(title)) return 'All set';
  return title;
}

/* --------------------------------------------------------------- tone */

const TONES = {
  error: { icon: 'alert-circle', fg: COLORS.red, bg: COLORS.redSoft },
  warning: { icon: 'information-circle', fg: COLORS.amber, bg: COLORS.amberSoft },
  success: { icon: 'checkmark-circle', fg: COLORS.success, bg: COLORS.successSoft },
  danger: { icon: 'warning', fg: COLORS.red, bg: COLORS.redSoft },
  confirm: { icon: 'help-circle', fg: COLORS.blue, bg: COLORS.blueSoft },
  info: { icon: 'information-circle', fg: COLORS.blue, bg: COLORS.blueSoft },
};

function toneFor(title, message, buttons) {
  if (buttons.some((b) => b.style === 'destructive')) return 'danger';
  const head = title.toLowerCase();
  const all = `${title} ${message}`.toLowerCase();
  if (/\b(success|saved|sent|added|updated|submitted|complete|completed|done|thank|welcome|approved|activated|requested|verified|all set)\b/.test(head)) {
    return 'success';
  }
  if (/(error|fail|could ?n.?t|can.?t|cannot|unable|not (sent|saved|added|taken|connected|available|signed|allowed|found)|denied|invalid|expired|wrong|unavailable|something went wrong|no internet)/.test(all)) {
    return 'error';
  }
  if (/(missing|required|permission|needed|weak|mismatch|please (enter|select|choose|add|fill|upload)|incomplete|select|choose)/.test(all)) {
    return 'warning';
  }
  return buttons.length > 1 ? 'confirm' : 'info';
}

/* --------------------------------------------------------------- host */

export function AlertHost() {
  const [queue, setQueue] = useState([]);
  const current = queue[0];

  useEffect(() => {
    const receive = (item) => setQueue((q) => [...q, item]);
    hosts.push(receive);
    if (waiting.length) setQueue((q) => [...q, ...waiting.splice(0)]);
    return () => {
      const i = hosts.indexOf(receive);
      if (i !== -1) hosts.splice(i, 1);
    };
  }, []);

  // Close the dialog first, then run the button's handler, so a handler that
  // raises another alert or navigates away does so from a clean screen.
  const finish = (handler) => {
    setQueue((q) => q.slice(1));
    if (typeof handler === 'function') setTimeout(handler, 0);
  };

  // Back button or a tap outside: what the system alert would do. A lone
  // button or an explicit Cancel button counts as the answer; otherwise the
  // question stays until it is answered.
  const dismiss = () => {
    if (!current) return;
    const { buttons, options } = current;
    const cancel = buttons.find((b) => b.style === 'cancel');
    if (cancel) return finish(cancel.onPress);
    if (buttons.length === 1) return finish(buttons[0].onPress);
    if (options.cancelable) return finish(options.onDismiss);
  };

  return (
    <Modal
      visible={!!current}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismiss}
    >
      {current ? <Dialog key={current.id} item={current} onButton={finish} onBackdrop={dismiss} /> : null}
    </Modal>
  );
}

function Dialog({ item, onButton, onBackdrop }) {
  const { width } = useWindowDimensions();
  const scale = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    Animated.spring(scale, { toValue: 1, friction: 7, tension: 90, useNativeDriver: true }).start();
  }, [scale]);

  const title = friendlyTitle(item.title);
  const message = friendlyMessage(item.message);
  const tone = TONES[toneFor(title || item.title, message, item.buttons)];

  // Two buttons sit side by side, Cancel on the left; three or more stack.
  const buttons = item.buttons;
  const row = buttons.length <= 2;
  const ordered = row
    ? [...buttons].sort((a, b) => (a.style === 'cancel' ? -1 : b.style === 'cancel' ? 1 : 0))
    : buttons;

  const variantFor = (b) => {
    if (b.style === 'destructive') return 'danger';
    if (b.style === 'cancel') return 'secondary';
    if (buttons.length === 1) return 'dark';   // an acknowledgement, not an action
    return 'primary';
  };

  return (
    <Pressable style={styles.backdrop} onPress={onBackdrop} accessibilityRole="none">
      <Animated.View
        style={[styles.card, { width: Math.min(360, width - SPACE[6] * 2), transform: [{ scale }] }]}
        accessibilityViewIsModal
        accessibilityRole="alert"
      >
        {/* Swallows taps so pressing the card does not count as outside. */}
        <Pressable onPress={() => {}} accessible={false}>
          <View style={[styles.badge, { backgroundColor: tone.bg }]}>
            <Ionicons name={tone.icon} size={30} color={tone.fg} />
          </View>

          {title ? <Text style={styles.title}>{title}</Text> : null}
          {message ? <Text style={styles.message}>{message}</Text> : null}

          <View style={[styles.actions, row ? styles.actionsRow : styles.actionsColumn]}>
            {ordered.map((b, i) => (
              <Button
                key={`${b.text}-${i}`}
                title={b.text || 'OK'}
                variant={variantFor(b)}
                onPress={() => onButton(b.onPress)}
                style={row ? styles.rowButton : styles.columnButton}
              />
            ))}
          </View>
        </Pressable>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACE[6],
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.xl,
    paddingHorizontal: SPACE[6],
    paddingTop: SPACE[6],
    paddingBottom: SPACE[5],
    ...SHADOW.float,
  },
  badge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: SPACE[4],
  },
  title: {
    ...TYPE.heading,
    textAlign: 'center',
  },
  message: {
    ...TYPE.body,
    color: COLORS.inkSoft,
    textAlign: 'center',
    marginTop: SPACE[2],
  },
  actions: {
    marginTop: SPACE[6],
    gap: SPACE[3],
  },
  actionsRow: { flexDirection: 'row' },
  actionsColumn: { flexDirection: 'column' },
  rowButton: { flex: 1 },
  columnButton: { alignSelf: 'stretch' },
});
