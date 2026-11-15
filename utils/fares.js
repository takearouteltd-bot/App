// utils/fares.js
// First-mile pricing: each job category has a price for the first mile
// (the least a trip costs) and a price for every mile after it, charged by
// the tenth of a mile. No base fare. Example, Normal at 4.50 + 1.00 a mile:
// 1 mi 4.50, 2 mi 5.50, 3 mi 6.50, 3.2 mi 6.70, 4 mi 7.50.
//
// The server works the same fare out again before a driver can take the job
// (functions/fleet.js fareFor), and the dashboard shows it on the Fares
// settings page (OperationsSettings estimateFare). Change all three together.
// Each stop between pickup and drop-off adds the category's per-stop price.

// rideType -> the settings prefix its prices are saved under in config/app
// fares. Old Plus and Eco bookings are priced as Normal.
export const PRICE_KEY = {
  RouteMini: 'normal',
  RoutePriority: 'priority',
  RouteUrgent: 'urgent',
  RouteXL: 'xl',
  RouteExecutive: 'executive',
  RouteWheelchair: 'wheelchair',
  RoutePlus: 'normal',
  RouteEco: 'normal',
};

// Distance is shown and charged to one decimal place, like Google: 2.45 -> 2.5.
export function milesFromKm(km) {
  const miles = (Number(km) || 0) * 0.621371;
  return Math.round(miles * 10) / 10;
}

// The prices for a category, from the live settings. perStop is charged
// for each stop between pickup and drop-off (0 = stops cost only their
// extra miles and minutes).
export function classPrices(fares, rideType) {
  const key = PRICE_KEY[rideType] || 'normal';
  return {
    firstMile: Number(fares[`${key}FirstMile`]) || 0,
    perMile: Number(fares[`${key}PerMile`]) || 0,
    perStop: Math.max(0, Number(fares[`${key}PerStop`]) || 0),
  };
}

/**
 * The fare for one category before any promo.
 * @param {Object} fares appConfig.fares
 * @param {string} rideType job category id
 * @param {number} distanceKm route distance
 * @param {number} durationMinutes route time
 * @param {number} surge busy-time multiplier (1 normal)
 * @param {number} stopCount stops between pickup and drop-off
 * @return {Object} fare fields stored on the ride. baseFare holds the first
 *   mile and distanceFare the miles after it, so receipts written for the old
 *   pricing still add up. The stop charge is added after the busy-time
 *   multiplier (a stop costs the same at any time) and counts towards the
 *   minimum fare.
 */
export function priceTrip(fares, rideType, distanceKm, durationMinutes, surge = 1, stopCount = 0) {
  const { firstMile, perMile, perStop } = classPrices(fares, rideType);
  const miles = milesFromKm(distanceKm);
  const distanceFare = Math.max(0, miles - 1) * perMile;
  const timeFare = (Number(durationMinutes) || 0) * (Number(fares.ratePerMinute) || 0);
  const stops = Math.max(0, Math.floor(Number(stopCount) || 0));
  const stopCharge = stops * perStop;
  const subtotal = (firstMile + distanceFare + timeFare) * surge + stopCharge;
  const beforeVat = Math.max(subtotal, Number(fares.minimumFare) || 0);
  return {
    pricing: 'first_mile',
    firstMile,
    perMile,
    baseFare: firstMile,
    distanceFare,
    timeFare,
    stops,
    perStop,
    stopCharge,
    surgeMultiplier: surge,
    rideMultiplier: 1,
    distanceInMiles: miles,
    minimumApplied: subtotal < beforeVat,
    beforeVat,
  };
}
