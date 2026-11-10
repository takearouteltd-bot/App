// functions/ukArea.js
// "All of the UK" (dashboard Settings, Working cities): a rough outline of
// Great Britain and of Northern Ireland, generous at the coast so islands
// and beaches count, and following the border so the Republic of Ireland
// and France don't. A copy lives in utils/ukArea.js (the app): keep
// them the same.

// [latitude, longitude] corners, in order.
const GREAT_BRITAIN = [
  [49.85, -6.6], [49.85, -5.0], [50.4, -3.4], [50.5, -2.0], [50.55, -1.3],
  [50.7, 0.3], [50.88, 1.05], [51.1, 1.55], [51.4, 1.55], [52.0, 1.85],
  [52.6, 1.95], [52.98, 1.4], [53.6, 0.35], [54.6, -0.45], [55.8, -1.5],
  [56.3, -2.35], [57.5, -1.6], [58.9, -1.3], [60.95, -0.6], [60.95, -1.9],
  [59.2, -3.7], [58.7, -5.2], [58.6, -6.4], [57.9, -8.8], [56.7, -7.8],
  [55.6, -6.6], [55.25, -5.85], [54.6, -5.05], [54.0, -5.0], [53.3, -4.8],
  [52.8, -4.9], [51.7, -5.5], [51.45, -5.4], [50.05, -5.9],
];

const NORTHERN_IRELAND = [
  [55.32, -6.0], [55.27, -6.5], [55.22, -6.95], [55.05, -7.3],
  [54.85, -7.45], [54.6, -7.85], [54.45, -8.2], [54.25, -7.8],
  [54.15, -7.2], [54.1, -6.6], [54.03, -6.25], [54.0, -6.0],
  [54.2, -5.6], [54.6, -5.3], [55.0, -5.65],
];

/**
 * Whether a point is inside a polygon (ray casting).
 * @param {Array<Array<number>>} polygon [lat, lng] corners.
 * @param {number} lat Latitude.
 * @param {number} lng Longitude.
 * @return {boolean} Inside.
 */
function inside(polygon, lat, lng) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ai, oi] = polygon[i];
    const [aj, oj] = polygon[j];
    if ((oi > lng) !== (oj > lng) &&
        lat < ((aj - ai) * (lng - oi)) / (oj - oi) + ai) {
      hit = !hit;
    }
  }
  return hit;
}

/**
 * Whether a {latitude, longitude} point is in the UK.
 * @param {Object} point Pickup.
 * @return {boolean} In the UK.
 */
function inUk(point) {
  const lat = Number(point && point.latitude);
  const lng = Number(point && point.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return inside(GREAT_BRITAIN, lat, lng) ||
    inside(NORTHERN_IRELAND, lat, lng);
}

module.exports = {inUk};
