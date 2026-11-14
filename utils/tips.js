/* Tipping the driver after a trip. The card is charged by the server
   (functions/tips.js, tipDriver), which also records rides/{id}.tip; the
   app only asks. Settings: config/app tips (dashboard Settings > Tips). */
import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';

const ms = (t) => (t?.toMillis ? t.toMillis() : t ? Number(new Date(t)) : 0);

export const MIN_TIP = 0.5;

export function tipsEnabled(config) {
  return Number(config?.tips?.enabled) === 1;
}

/** The three amounts offered, smallest first, without repeats or zeros. */
export function tipPresets(config) {
  const t = config?.tips || {};
  return [...new Set([t.preset1, t.preset2, t.preset3].map(Number).filter((n) => n >= MIN_TIP))].sort((a, b) => a - b);
}

export function maxTip(config) {
  return Number(config?.tips?.maxAmount) || 50;
}

/** Whether this passenger can still tip for this ride. */
export function canTip(ride, config, now = Date.now()) {
  if (!tipsEnabled(config) || !ride || !ride.riderId || !ride.driverId) return false;
  if (ride.status !== 'completed' || ride.tip) return false;
  const ended = ms(ride.completedAt);
  const hours = Number(config?.tips?.windowHours) || 24;
  return !ended || now - ended <= hours * 3600 * 1000;
}

/** The tip already paid on a ride, or 0. */
export function paidTip(ride) {
  return ride?.tip?.status === 'paid' ? Number(ride.tip.amount) || 0 : 0;
}

/** Charges the passenger's saved card. Throws with the server's reason;
    error.details?.reason === 'no_card' means there is no card on file. */
export async function tipDriver(rideId, amount) {
  const res = await httpsCallable(functions, 'tipDriver')({
    rideId,
    amount: Math.round(Number(amount) * 100) / 100,
  });
  return res.data;
}
