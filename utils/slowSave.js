// utils/slowSave.js
// A Firestore save only finishes once the phone hears back from the server.
// On a poor connection that answer can take minutes, or come long after the
// server already has the save: on 10 Nov a trip completed on the server while
// the driver's button span for 6+ minutes. The phone has already queued the
// save and shows it locally, so the driver shouldn't wait for the answer.
const WAIT_MS = 6000;

/* Waits for `save` (a promise), for at most 6 s. A refusal in that time is
   thrown as usual. After that the screen carries on, and the phone sends the
   save when it can. If the app is closed first, Home brings the driver back
   to the trip (drivers/{id}.currentRideId). */
export function whenSaved(save, ms = WAIT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('queued'), ms);
    save.then(
      (result) => { clearTimeout(timer); resolve(result); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}
