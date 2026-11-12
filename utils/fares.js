// utils/fares.js
// First-mile pricing: each job category has a price for the first mile
// (the least a trip costs) and a price for every mile after it, charged by
// the tenth of a mile. No base fare. Example, Normal at 4.50 + 1.00 a mile:
// 1 mi 4.50, 2 mi 5.50, 3 mi 6.50, 3.2 mi 6.70, 4 mi 7.50.
//
// The server works the same fare out again before a driver can take the job
// (functions/fleet.js fareFor), and the dashboard shows it on the Fares
// settings page (OperationsSettings estimateFare). Change all three together.

// rideType -> the settings prefix its prices are saved under in config/app
// fares. Old Plus and Eco bookings are priced as Normal.
export const PRICE_KEY = {
  RouteMini: 'normal',
  RoutePriority: 'priority',
  RouteUrgent: 'urgent',
  RouteXL: 'xl',
  RouteExecutive: 'executive',
  RoutePlus: 'normal',
  RouteEco: 'normal',
};

// Distance is shown and charged to one decimal place, like Google: 2.45 -> 2.5.
export function milesFromKm(km) {
  const miles = (Number(km) || 0) * 0.621371;
  return Math.round(miles * 10) / 10;
}

// The two prices for a category, from the live settings.
export function classPrices(fares, rideType) {
  const key = PRICE_KEY[rideType] || 'normal';
  return {
    firstMile: Number(fares[`${key}FirstMile`]) || 0,
    perMile: Number(fares[`${key}PerMile`]) || 0,
  };
}

/**
 * The fare for one category before any promo.
 * @param {Object} fares appConfig.fares
 * @param {string} rideType job category id
 * @param {number} distanceKm route distance
 * @param {number} durationMinutes route time
 * @param {number} surge busy-time multiplier (1 normal)
 * @return {Object} fare fields stored on the ride. baseFare holds the first
 *   mile and distanceFare the miles after it, so receipts written for the old
 *   pricing still add up.
 */
export function priceTrip(fares, rideType, distanceKm, durationMinutes, surge = 1) {
  const { firstMile, perMile } = classPrices(fares, rideType);
  const miles = milesFromKm(distanceKm);
  const distanceFare = Math.max(0, miles - 1) * perMile;
  const timeFare = (Number(durationMinutes) || 0) * (Number(fares.ratePerMinute) || 0);
  const subtotal = (firstMile + distanceFare + timeFare) * surge;
  const beforeVat = Math.max(subtotal, Number(fares.minimumFare) || 0);
  return {
    pricing: 'first_mile',
    firstMile,
    perMile,
    baseFare: firstMile,
    distanceFare,
    timeFare,
    surgeMultiplier: surge,
    rideMultiplier: 1,
    distanceInMiles: miles,
    minimumApplied: subtotal < beforeVat,
    beforeVat,
  };
}
