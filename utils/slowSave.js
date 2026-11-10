// utils/slowSave.js
// A Firestore save only finishes once the server has it. On a weak signal
// that can take minutes, and the button just spins. The save is not lost:
// the phone keeps it and sends it when the signal is back, as long as the
// app stays open. This tells the driver so after a few seconds.
import { Alert } from 'react-native';

const SLOW_MS = 10000;

/* Waits for `save` (a promise) and returns its result. If it hasn't
   finished after 10 s, shows the weak-signal notice once and keeps
   waiting. */
export async function whenSaved(save, what = 'This') {
  let done = false;
  const timer = setTimeout(() => {
    if (done) return;
    Alert.alert(
      'Weak signal',
      `${what} is saved on your phone and goes through as soon as your signal is back. Keep TakeARoute open, there's no need to tap again.`
    );
  }, SLOW_MS);
  try {
    return await save;
  } finally {
    done = true;
    clearTimeout(timer);
  }
}
