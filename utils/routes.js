// utils/routes.js
// Driving routes from Google's Routes API (computeRoutes), which replaced the
// Directions API. Returns the same numbers the old Directions calls gave the
// app, so fares and ETAs are worked out exactly as before.
import polyline from '@mapbox/polyline';
import { GOOGLE_MAPS_API_KEY } from '../config/maps';

const ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';

// Only ask for what is used: this keeps the request on the Basic tier.
const FIELD_MASK = [
  'routes.distanceMeters',
  'routes.duration',
  'routes.polyline.encodedPolyline',
  'routes.legs.distanceMeters',
  'routes.legs.duration',
].join(',');

const waypoint = (p) => ({
  location: { latLng: { latitude: p.latitude, longitude: p.longitude } },
});

// "882s" -> 882
const seconds = (d) => Number(String(d || '0').replace('s', '')) || 0;

/**
 * A driving route from origin to destination through any waypoints, in order.
 * Resolves to null when Google finds no route.
 *
 *   coordinates  the line to draw, [{ latitude, longitude }]
 *   distance     whole route in km          duration  whole route in minutes
 *   legs         [{ distance, duration }] per stretch, same units
 */
export async function fetchRoute({ origin, destination, waypoints = [], signal }) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      origin: waypoint(origin),
      destination: waypoint(destination),
      intermediates: waypoints.map(waypoint),
      travelMode: 'DRIVE',
      // Same as the old Directions default: no live traffic, which also
      // keeps the request on the cheaper tier.
      routingPreference: 'TRAFFIC_UNAWARE',
      units: 'METRIC',
    }),
  });
  const data = await res.json();
  const route = data?.routes?.[0];
  if (!route) {
    if (data?.error) throw new Error(data.error.message || 'Route request failed');
    return null;
  }

  const coordinates = polyline
    .decode(route.polyline?.encodedPolyline || '')
    .map(([latitude, longitude]) => ({ latitude, longitude }));

  return {
    coordinates,
    distance: (route.distanceMeters || 0) / 1000,
    duration: seconds(route.duration) / 60,
    legs: (route.legs || []).map((leg) => ({
      distance: (leg.distanceMeters || 0) / 1000,
      duration: seconds(leg.duration) / 60,
    })),
  };
}

// "12 mins", "1 hr 5 mins", the way the Directions API used to word it.
export function durationText(minutes) {
  const m = Math.max(1, Math.round(minutes || 0));
  if (m < 60) return `${m} min${m === 1 ? '' : 's'}`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return `${h} hr${h === 1 ? '' : 's'}${rest ? ` ${rest} min${rest === 1 ? '' : 's'}` : ''}`;
}

// "850 m" or "3.4 km".
export function distanceText(km) {
  if (!km || km < 1) return `${Math.round((km || 0) * 1000)} m`;
  return `${km.toFixed(1)} km`;
}
