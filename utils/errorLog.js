/* App errors, with the message and stack Play's crash report leaves out
   (it only shows "JavascriptException"). Written to appErrors (admins read
   them; firestore.rules limits what can be written). Never throws, and a
   loop of errors writes at most a few. */
import { Platform } from 'react-native';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../config/firebase';

const APP = require('../app.json').expo;
let lastAt = 0;
let written = 0;

export function logAppError(error, extra = {}) {
  try {
    const now = Date.now();
    if (now - lastAt < 2000 || written >= 20) return Promise.resolve();
    lastAt = now;
    written += 1;
    return addDoc(collection(db, 'appErrors'), {
      message: String(error?.message || error || 'Unknown error').slice(0, 500),
      stack: String(error?.stack || '').slice(0, 4000),
      componentStack: String(extra.componentStack || '').slice(0, 2000),
      screen: extra.screen ? String(extra.screen).slice(0, 80) : null,
      kind: extra.kind === 'render' ? 'render' : 'global',
      fatal: extra.fatal === true,
      version: String(APP.version || ''),
      build: Number(APP.android?.versionCode) || 0,
      platform: Platform.OS,
      uid: auth.currentUser?.uid || null,
      at: serverTimestamp(),
    }).catch(() => {});
  } catch (e) {
    return Promise.resolve();
  }
}

/* Errors outside a screen's drawing (a timer, a listener, a promise): log
   them, then let React Native handle them as before. A fatal one closes the
   app, so it gets a moment to send first. */
export function installGlobalErrorLogging(getScreen) {
  const EU = global.ErrorUtils;
  if (!EU?.getGlobalHandler || !EU?.setGlobalHandler) return;
  const previous = EU.getGlobalHandler();
  EU.setGlobalHandler((error, isFatal) => {
    const sent = logAppError(error, { fatal: isFatal, screen: getScreen?.(), kind: 'global' });
    if (!isFatal) return previous(error, isFatal);
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      previous(error, isFatal);
    };
    sent.then(go, go);
    setTimeout(go, 1500);
  });
}
