// utils/cancellation.js
// Whether cancelling a ride now costs the passenger a fee, and how much.
//
// Same rule as cancellationFee in functions/index.js, which is what actually
// takes the money; this is so the passenger (or driver) is told before they
// confirm. The terms come from the ride itself (cancellationPolicy, saved at
// booking), so a later change on the dashboard never alters a booked ride.
//
// Card rides only (there is no card hold to take it from on cash), and only
// before pickup:
//   - driver has arrived and `arrivedFee` is above zero: the passenger pays
//     `arrivedFee` for cancelling, free window or not. A driver's no-show
//     charges the same, once they have waited `noShowWaitMinutes`.
//   - otherwise: `fee`, if more than `freeMinutes` have passed since the
//     driver accepted.
const BEFORE_PICKUP = ['accepted', 'arrived'];

function millis(ts) {
  if (!ts) return null;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  const n = Number(ts);
  return Number.isFinite(n) ? n : null;
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const round2 = (n) => Math.round(n * 100) / 100;

// Minutes the driver must wait at the pickup before a no-show is charged.
export function noShowWaitMs(ride) {
  return num(ride?.cancellationPolicy?.noShowWaitMinutes, 5) * 60000;
}

// What the passenger pays if they cancel now.
export function cancellationFeeFor(ride, now = Date.now()) {
  if (!ride || ride.paymentMethod === 'cash') return 0;
  if (!BEFORE_PICKUP.includes(ride.status)) return 0;

  const policy = ride.cancellationPolicy || {};
  const arrivedFee = num(policy.arrivedFee, 0);
  if (ride.status === 'arrived' && arrivedFee > 0) return round2(arrivedFee);

  const fee = num(policy.fee, 0);
  if (!(fee > 0)) return 0;
  const accepted = millis(ride.acceptedAt);
  if (!accepted) return 0;
  return now - accepted > num(policy.freeMinutes, 2) * 60000 ? round2(fee) : 0;
}

// What the passenger pays if the driver reports a no-show now. 0 until the
// driver has waited long enough.
export function noShowFeeFor(ride, now = Date.now()) {
  if (!ride || ride.paymentMethod === 'cash' || ride.status !== 'arrived') return 0;
  const arrivedFee = num(ride.cancellationPolicy?.arrivedFee, 0);
  const arrived = millis(ride.arrivedAt);
  if (!(arrivedFee > 0) || !arrived) return 0;
  return now - arrived >= noShowWaitMs(ride) ? round2(arrivedFee) : 0;
}
