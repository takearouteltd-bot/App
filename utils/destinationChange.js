/* Changing the destination during a trip. The passenger asks, the driver
   accepts or declines, and the server does everything else: the price, the
   time to answer, the new drop-off and fare, the card hold
   (functions/destinationChange.js). The app only asks and shows what the
   ride says. Builds before 1.0.37 have none of this: their passengers see no
   button, and a request their driver's app can't show runs out on the
   server. */
import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';

const ms = (t) => (t?.toMillis ? t.toMillis() : t ? Number(new Date(t)) : 0);

// The most changes one trip allows (MAX_REQUESTS on the server).
export const MAX_CHANGES = 3;

/** The latest request on the ride, or null. */
export function latestChange(ride) {
  const dc = ride?.destinationChange;
  return dc && typeof dc === 'object' && dc.n ? dc : null;
}

/** Seconds the driver has left to answer, 0 once it has run out. */
export function secondsLeft(dc, now = Date.now()) {
  if (!dc || dc.state !== 'pending') return 0;
  return Math.max(0, Math.ceil((ms(dc.expiresAt) - now) / 1000));
}

/** Whether a request is waiting for the driver right now. */
export function isPending(dc, now = Date.now()) {
  return Boolean(dc) && dc.state === 'pending' && secondsLeft(dc, now) > 0;
}

/** Whether the passenger can ask for a change on this ride now. */
export function canChangeDestination(ride, now = Date.now()) {
  if (!ride || ride.status !== 'ongoing' || !ride.driverId || ride.source === 'phone') return false;
  const dc = latestChange(ride);
  if (isPending(dc, now)) return false;
  return (Number(dc?.n) || 0) < MAX_CHANGES;
}

/** What a place picked on the search screen is sent as. */
function placeOf(p) {
  return {
    latitude: Number(p.latitude),
    longitude: Number(p.longitude),
    address: p.address || p.description || 'Pinned location',
  };
}

/** The new price, without asking the driver yet. Returns {quote}. */
export async function quoteChange(rideId, place) {
  const res = await httpsCallable(functions, 'requestDestinationChange')({
    rideId,
    destination: placeOf(place),
  });
  return res.data;
}

/** Asks the driver, at the price the passenger was shown. Returns
    {requested, n, seconds, quote} or {priceChanged, quote}. */
export async function requestChange(rideId, place, quotedTotal) {
  const res = await httpsCallable(functions, 'requestDestinationChange')({
    rideId,
    destination: placeOf(place),
    confirm: true,
    quotedTotal,
  });
  return res.data;
}

/** The driver's answer. Returns {outcome, newTotal, cashExtraDue, to}. */
export async function answerChange(rideId, n, accept) {
  const res = await httpsCallable(functions, 'answerDestinationChange')({ rideId, n, accept });
  return res.data;
}

/** Changes the driver accepted on this trip, oldest first. */
export function acceptedChanges(ride) {
  return (Array.isArray(ride?.destinationChanges) ? ride.destinationChanges : []).filter(
    (c) => c && c.outcome === 'accepted'
  );
}

/** Miles, to one decimal place, for "Extended trip: 1.4 mi past the drop-off". */
export function extraMiles(km) {
  return (Math.round((Number(km) || 0) * 0.621371 * 10) / 10).toFixed(1);
}
