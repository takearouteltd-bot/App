// utils/stops.js
// Stops between pickup and drop-off.
//
// A passenger may add as many as they like, up to MAX_STOPS (Google's route
// service takes at most 25 points in one route, including both ends). The
// fare needs no special rule: it is priced on the distance and time of the
// whole route through every stop, exactly like a trip without them.
//
// On the ride: stops = [{ latitude, longitude, address }] in order, and
// stopsCompleted = how many the driver has reached so far.

export const MAX_STOPS = 20;

export function stopsOf(ride) {
  return Array.isArray(ride?.stops)
    ? ride.stops.filter((s) => Number.isFinite(s?.latitude) && Number.isFinite(s?.longitude))
    : [];
}

/* Stops the driver has not reached yet. */
export function remainingStops(ride) {
  return stopsOf(ride).slice(Math.max(0, Number(ride?.stopsCompleted) || 0));
}

/* Turn-by-turn in Google Maps through every remaining stop. */
export function navigationUrl(destination, stops) {
  const base = `https://www.google.com/maps/dir/?api=1&destination=${destination.latitude},${destination.longitude}&travelmode=driving`;
  if (!stops?.length) return base;
  return `${base}&waypoints=${encodeURIComponent(stops.map((s) => `${s.latitude},${s.longitude}`).join('|'))}`;
}
