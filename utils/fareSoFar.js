// utils/fareSoFar.js
// The fare for a trip that ends before the drop-off: the agreed fare times the
// share of the journey done, measured as how much nearer the drop-off the car
// got (straight line). Never below the minimum fare, never above the agreed
// fare. Same rule as endedEarlyFare in functions/index.js, which is what the
// passenger is actually charged; this is so the driver sees the cash to collect.
function km(a, b) {
  if (!a || !b || typeof a.latitude !== 'number' || typeof b.latitude !== 'number') {
    return Infinity;
  }
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// leftKm: distance still to go to the drop-off.
export function fareSoFar(ride, leftKm, minimumFare) {
  const full = Number(ride?.fare?.total) || 0;
  const whole = km(ride?.pickupLocation, ride?.dropoffLocation);
  let share = 1;
  if (Number.isFinite(whole) && whole > 0.05 && Number.isFinite(leftKm)) {
    share = Math.min(1, Math.max(0, 1 - leftKm / whole));
  }
  const floor = Math.min(Number(minimumFare) || 0, full);
  return Math.round(Math.min(full, Math.max(floor, full * share)) * 100) / 100;
}
