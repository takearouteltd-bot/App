/* An extended trip: it ended well past the drop-off, so the server priced
   the extra miles (functions/destinationChange.js). The extra is only added
   once the passenger approves it, or the office decides when they dispute
   it; a card trip nobody answers is charged after the time allowed
   (functions/extendedTrips.js). The app only shows the state and sends the
   passenger's answer. Trips from before approval was asked for have no
   state: they were charged. */
import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';

const ms = (t) => (t?.toMillis ? t.toMillis() : t ? Number(new Date(t)) : 0);

/** The extended trip's state, or null for an ordinary trip. */
export function extendedState(ride) {
  const et = ride?.extendedTrip;
  if (!et) return null;
  return et.state || 'charged';
}

/** Whether the passenger is being asked to approve the extra now. */
export function awaitingApproval(ride, now = Date.now()) {
  const et = ride?.extendedTrip;
  return extendedState(ride) === 'pending' && (!et.decideBy || ms(et.decideBy) > now);
}

/** Whether the extra has been added to what the trip costs. */
export function extraAdded(ride) {
  return ['charged', 'collect'].includes(extendedState(ride));
}

/** The extra amount, in pounds. */
export function extraAmount(ride) {
  return Number(ride?.extendedTrip?.extra) || 0;
}

/** Hours left to answer, rounded up; 0 once the time is up. */
export function hoursLeft(ride, now = Date.now()) {
  const end = ms(ride?.extendedTrip?.decideBy);
  return end ? Math.max(0, Math.ceil((end - now) / 3600000)) : 0;
}

/** The passenger's answer. Returns {state}. */
export async function answerExtendedTrip(rideId, approve) {
  const res = await httpsCallable(functions, 'answerExtendedTrip')({ rideId, approve });
  return res.data;
}
