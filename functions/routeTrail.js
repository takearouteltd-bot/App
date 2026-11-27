"use strict";

/* ======================================
   ROUTE HISTORY (the way the driver actually went), for disputes
   The driver's phone keeps only its latest position on drivers/{id}
   (location, speedKph, lastUpdated; utils/driverLocation.js: about every
   10 s on a job, sooner after a 150 m move, once a minute while parked).
   While the driver is on a job, the drivers/{id} update trigger that
   already runs for every save (createWalletOnOnboardingComplete in
   index.js, which also notes reaching the drop-off) appends each new
   position to the ride's trail here. Server side only, so it works with
   the driver apps already in use, and the phone cannot write or rewrite
   the trail (firestore.rules: admins and the ride's fleet staff read it,
   nobody but the server writes it).

   rides/{rideId}/trail/{leg}-{bucket}, one document per leg per 10
   minutes:
     leg        "pickup" (status accepted or arrived: on the way to and
                waiting at the pickup) or "trip" (ongoing, passenger on
                board)
     driverId   the driver whose phone sent the points
     from       start of the 10 minutes (Timestamp)
     points     [{t, lat, lng, kph, s}] t = ms (server time of the save),
                kph = the phone's speed or null, s = ride status code:
                "a" accepted, "w" arrived (waiting), "o" ongoing
     expireAt   when Firestore's TTL policy deletes it (from + KEEP_DAYS;
                firestore.indexes.json)
     updatedAt  last append
   Appended with arrayUnion, so no read is needed and a trigger run twice
   adds the point once. Points may arrive out of order: sort by t.
   Firestore takes about one sustained write a second on the driver's
   record, so ten minutes holds a few thousand points at the very most
   (about 70 bytes each), far below the 1 MiB document limit.
   ====================================== */

// Ride statuses that count as on the job, and the leg each belongs to.
const LEG = {accepted: "pickup", arrived: "pickup", ongoing: "trip"};
const STATUS_CODE = {accepted: "a", arrived: "w", ongoing: "o"};
// One document per leg per this long.
const BUCKET_MS = 10 * 60 * 1000;
// Kept this long, then removed by the TTL policy on trail.expireAt. Card
// chargebacks can be raised up to about 120 days after a payment.
const KEEP_DAYS = 180;
// A save this close to the last one is GPS drift at the kerb, not driving.
const MIN_METRES = 10;
// Nor is a second save within this long, unless it moved further than
// MIN_JUMP_METRES (bounds the size of a chunk if a phone saves too often).
const MIN_GAP_MS = 2000;
const MIN_JUMP_METRES = 50;

module.exports = (deps) => {
  const {db, toMillis} = deps;
  const {FieldValue, Timestamp} = require("firebase-admin/firestore");
  const out = {};

  /**
   * A position from the driver's record, or null.
   * @param {*} p drivers/{id}.location
   * @return {?Object} {latitude, longitude}
   */
  function coords(p) {
    if (!p || typeof p !== "object") return null;
    const lat = Number(p.latitude);
    const lng = Number(p.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
        Math.abs(lat) > 90 || Math.abs(lng) > 180 ||
        (lat === 0 && lng === 0)) {
      return null;
    }
    return {latitude: lat, longitude: lng};
  }

  /**
   * Metres between two {latitude, longitude} points.
   * @param {Object} a Point.
   * @param {Object} b Point.
   * @return {number} Metres.
   */
  function metresApart(a, b) {
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(b.latitude - a.latitude);
    const dLng = rad(b.longitude - a.longitude);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(h));
  }

  /**
   * Whether this save of the driver's record is a position worth looking
   * at for a trip: on a job, with a position that moved (or a job that
   * just started). No reads, so the trigger leaves at once otherwise.
   * @param {Object} before Driver record before.
   * @param {Object} after Driver record after.
   * @return {boolean} Worth reading the ride for.
   */
  function onJobMove(before, after) {
    if (!after || after.isOnRide !== true || !after.currentRideId) {
      return false;
    }
    const loc = coords(after.location);
    if (!loc) return false;
    const prev = coords(before && before.location);
    const sameRide = Boolean(before) &&
      before.currentRideId === after.currentRideId &&
      before.isOnRide === true;
    if (!prev || !sameRide) return true;
    return prev.latitude !== loc.latitude || prev.longitude !== loc.longitude;
  }
  out.onJobMove = onJobMove;

  /**
   * The ride the driver is on, read once for each position save during a
   * job and shared with destinationChange.notePosition. Null when there is
   * nothing to look at. Never throws.
   * @param {Object} before Driver record before.
   * @param {Object} after Driver record after.
   * @return {Promise<?Object>} Ride snapshot, or null.
   */
  async function rideFor(before, after) {
    if (!onJobMove(before, after)) return null;
    try {
      return await db.collection("rides").doc(after.currentRideId).get();
    } catch (error) {
      console.error("Route trail ride read failed:", after.currentRideId,
          error.message);
      return null;
    }
  }
  out.rideFor = rideFor;

  /**
   * Appends the driver's new position to the trail of the ride they are on.
   * One write per point kept; nothing when the driver is not on one of the
   * ride's live legs, or the car hardly moved.
   * @param {string} driverId Driver.
   * @param {Object} before Driver record before.
   * @param {Object} after Driver record after.
   * @param {?Object} rideSnap The ride (rideFor).
   * @param {number} atMs When the save happened (the trigger's event time).
   * @return {Promise<boolean>} Whether a point was added.
   */
  async function recordPosition(driverId, before, after, rideSnap, atMs) {
    if (!rideSnap || !rideSnap.exists) return false;
    const ride = rideSnap.data();
    const leg = LEG[ride.status];
    if (!leg || ride.driverId !== driverId) return false;
    const loc = coords(after.location);
    if (!loc) return false;

    // The first save of a job is always kept; after that, only real moves.
    const prev = coords(before && before.location);
    const sameRide = Boolean(before) && before.isOnRide === true &&
      before.currentRideId === after.currentRideId;
    if (prev && sameRide) {
      const moved = metresApart(prev, loc);
      if (moved < MIN_METRES) return false;
      const gap = (toMillis(after.lastUpdated) || 0) -
        (toMillis(before.lastUpdated) || 0);
      if (gap >= 0 && gap < MIN_GAP_MS && moved < MIN_JUMP_METRES) {
        return false;
      }
    }

    const t = Number.isFinite(atMs) ? atMs : Date.now();
    const bucket = Math.floor(t / BUCKET_MS);
    const from = bucket * BUCKET_MS;
    const r6 = (n) => Math.round(n * 1e6) / 1e6;
    const kph = typeof after.speedKph === "number" ? after.speedKph : NaN;
    const point = {
      t,
      lat: r6(loc.latitude),
      lng: r6(loc.longitude),
      kph: Number.isFinite(kph) && kph >= 0 && kph < 400 ?
        Math.round(kph) : null,
      s: STATUS_CODE[ride.status],
    };
    // Fixed-width bucket number so the ids sort by time.
    const id = `${leg}-${String(bucket).padStart(9, "0")}`;
    await rideSnap.ref.collection("trail").doc(id).set({
      leg,
      driverId,
      from: Timestamp.fromMillis(from),
      points: FieldValue.arrayUnion(point),
      expireAt: Timestamp.fromMillis(from + KEEP_DAYS * 86400000),
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    return true;
  }
  out.recordPosition = recordPosition;

  return out;
};
