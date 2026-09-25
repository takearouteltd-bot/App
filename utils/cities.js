// utils/cities.js
// Working cities: where a driver chooses to take jobs.
//
// Cities are managed on the dashboard (Settings, Working cities) as a centre
// and a radius, in cities/{id}. A ride belongs to the city its pickup falls
// in (cityId, set at booking). The rule, shared with offerRideToDrivers in
// functions/index.js:
//   - a driver who has chosen a city is offered only that city's jobs
//   - a driver who has not chosen one is offered jobs by search radius alone
import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../config/firebase';

export function kmBetween(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) *
      Math.cos((b.latitude * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* The cities switched on in the dashboard, A to Z. */
export function useCities() {
  const [cities, setCities] = useState([]);
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'cities'), where('active', '==', true)),
        (snap) =>
          setCities(
            snap.docs
              .map((d) => ({ id: d.id, ...d.data() }))
              .sort((a, b) => String(a.name).localeCompare(String(b.name)))
          ),
        () => setCities([])
      ),
    []
  );
  return cities;
}

/* The city a point is in: the nearest one whose radius covers it. */
export function cityFor(cities, point) {
  let best = null;
  let bestKm = Infinity;
  (cities || []).forEach((c) => {
    const km = kmBetween(point, c);
    if (km <= Number(c.radiusKm || 0) && km < bestKm) {
      best = c;
      bestKm = km;
    }
  });
  return best;
}

/* Whether a driver working `driverCityId` may be offered a ride in `rideCityId`. */
export function servesCity(driverCityId, rideCityId) {
  if (!driverCityId) return true;
  return driverCityId === rideCityId;
}
