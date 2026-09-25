// utils/cancellation.js
// Whether cancelling a ride now costs the passenger a fee, and how much.
//
// Same rule as cancelRidePayment in functions/index.js, which is what actually
// takes the money; this is so the passenger is told before they confirm.
// The terms come from the ride itself (cancellationPolicy, saved at booking),
// so a later change on the dashboard never alters a booked ride.
//
// A fee applies only when all of these are true:
//   - the ride is paid by card (there is no card hold to take it from on cash)
//   - a driver has accepted and the passenger has not been picked up yet
//   - more than `freeMinutes` have passed since the driver accepted
//   - the policy's fee is above zero
const BEFORE_PICKUP = ['accepted', 'arrived'];

function millis(ts) {
  if (!ts) return null;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  const n = Number(ts);
  return Number.isFinite(n) ? n : null;
}

export function cancellationFeeFor(ride, now = Date.now()) {
  if (!ride || ride.paymentMethod === 'cash') return 0;
  if (!BEFORE_PICKUP.includes(ride.status)) return 0;

  const policy = ride.cancellationPolicy || {};
  const fee = Number(policy.fee);
  if (!(fee > 0)) return 0;

  const accepted = millis(ride.acceptedAt);
  if (!accepted) return 0;

  const free = Number(policy.freeMinutes);
  const freeMs = (Number.isFinite(free) && free >= 0 ? free : 2) * 60000;
  return now - accepted > freeMs ? Math.round(fee * 100) / 100 : 0;
}
