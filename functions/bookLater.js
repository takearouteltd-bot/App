"use strict";

/* ======================================
   APP RIDES BOOKED FOR LATER
   A passenger picks a pickup time in the app instead of "now"
   (FareEstimationScreen, utils/bookLater.js). It reuses the phone jobs'
   booked-for-later machinery rather than a parallel one: the ride is
   "scheduled" with pickupAt and dispatchAt, and fleet.js
   dispatchScheduledRides (every minute) sends it out when dispatchAt comes.
   An app ride goes out as an ordinary app job ("searching", offered one
   driver at a time, then a BID JOB: appOffers.js, bidJobs.js), never to a
   fleet.

   1. Booking (notifyDriversOfNewRide -> checkBooking). firestore.rules lets
      a passenger create status "scheduled" with a pickupAt 10 minutes to 15
      days ahead, no dispatchAt and no bookedAhead. Here the server checks
      what the rules cannot: switched on (config/app bookLater.enabled), the
      dashboard's window (minMinutes to maxDays ahead), not a bidding ride,
      at most maxOpen booked at once, then every check a booking for now
      gets (checkNewRide: blocked passenger, App Review, cities, the price,
      the promo code). It stamps dispatchAt (pickup less leadMinutes) and
      bookedAhead {leadMinutes, checkedAt}; only then can it be sent out.
      Drivers cannot read or take a "scheduled" app ride (firestore.rules).
      The fare is fixed now, at the price the server checked.
   2. No card hold at booking: a hold lasts about 7 days and would tie up
      the passenger's money until the trip. Cancelling before it is sent
      out is free (no driver, no hold).
   3. Sent out (dispatchDue, from dispatchScheduledRides): "scheduled" ->
      "searching". startBookedSearch then tells the passenger, holds the
      card (index.js holdAtBooking, exactly as for a booking for now: a
      declined card stops the search, the passenger is told and can pick
      another card, resumeAfterNewCard), and offers it to drivers. From
      here it is an ordinary app job: authorizePaymentOnRideAccept reuses
      the hold, the cancellation terms are the usual ones from the accept.
   4. Nobody takes it: expireSearchingRides gives up at the later of the
      usual search limit from dispatchAt and the pickup time; the hold is
      released (cancelRidePayment) and the passenger told, no charge.
   5. On the day: a driver who is there before the booked time waits for
      free until then (computeWaitingCharge), and cannot report a no-show
      before it (firestore.rules driverCancels, cancellationFee).

   rides/{id} fields: pickupAt (passenger), dispatchAt and bookedAhead
   {leadMinutes, checkedAt, dispatchedAt} (server only).
   ====================================== */

const DAY_MS = 24 * 3600 * 1000;
// The app offers times from minMinutes ahead; booking takes a moment.
const SLACK_MINUTES = 5;

module.exports = (deps) => {
  const {functions, db, loadAppConfig, toMillis, sendPush, STRIPE_SECRETS,
    checkNewRide, refuseNewRide, holdAtBooking, offerRideToDrivers} = deps;
  const {FieldValue, Timestamp} = require("firebase-admin/firestore");
  const out = {};

  const UK_DAY = new Intl.DateTimeFormat("en-GB", {timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit"});
  const UK_TIME = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour: "2-digit", minute: "2-digit",
    hour12: false});
  const UK_DATE = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", weekday: "short", day: "numeric",
    month: "short"});

  /**
   * A pickup time in UK time: "14:30 today", "14:30 tomorrow" or
   * "14:30 on Tue 2 Dec".
   * @param {number} ms Time.
   * @param {number=} now Now.
   * @return {string} Words.
   */
  function ukWhen(ms, now = Date.now()) {
    if (!ms) return "the booked time";
    const day = (t) => UK_DAY.format(new Date(t));
    const time = UK_TIME.format(new Date(ms));
    if (day(ms) === day(now)) return `${time} today`;
    if (day(ms) === day(now + DAY_MS)) return `${time} tomorrow`;
    return `${time} on ${UK_DATE.format(new Date(ms)).replace(",", "")}`;
  }
  out.ukWhen = ukWhen;

  /**
   * Whether this is an app ride booked for later that the server checked.
   * @param {Object} ride Ride data.
   * @return {boolean} Booked ahead.
   */
  function isBooked(ride) {
    return Boolean(ride && ride.bookedAhead && ride.riderId &&
      ride.source !== "phone" && toMillis(ride.pickupAt));
  }
  out.isBooked = isBooked;

  /**
   * "Booked for 14:30 today. " for a driver's job offer, or "".
   * @param {Object} ride Ride data.
   * @return {string} Text.
   */
  out.driverNote = (ride) => isBooked(ride) ?
    `Booked for ${ukWhen(toMillis(ride.pickupAt))}. ` : "";

  /**
   * Checks a ride booked for later when it is created, and sets when it is
   * sent out. A booking that fails is cancelled with the reason, as for a
   * booking for now (refuseNewRide). Never throws.
   * @param {string} rideId Ride id.
   * @param {Object} ride Ride data.
   * @return {Promise<null>} Nothing.
   */
  out.checkBooking = async (rideId, ride) => {
    const ref = db.collection("rides").doc(rideId);
    const refuse = (reason, message) =>
      refuseNewRide(rideId, ride, reason, message).then(() => null);
    try {
      const cfg = await loadAppConfig();
      const s = cfg.bookLater;
      if (s.enabled !== 1) {
        return refuse("book_later_off", "Booking for later isn't " +
          "available right now. Please book a ride for now instead.");
      }
      const now = Date.now();
      const pickupMs = toMillis(ride.pickupAt);
      if (!pickupMs || pickupMs < now + (s.minMinutes - SLACK_MINUTES) *
          60000 || pickupMs > now + s.maxDays * DAY_MS + 15 * 60000) {
        return refuse("bad_pickup_time", "Please choose a pickup time " +
          `from ${s.minMinutes} minutes to ${s.maxDays} days ahead.`);
      }
      // The passenger picks between drivers' prices as they come in, so
      // there is nobody to pick from days ahead.
      if (ride.bidding === true) {
        return refuse("bidding_later", "Offering your own price isn't " +
          "available for rides booked for later. Please book again.");
      }
      const open = await db.collection("rides")
          .where("riderId", "==", ride.riderId)
          .where("status", "==", "scheduled").get();
      if (open.docs.filter((d) => d.id !== rideId).length >= s.maxOpen) {
        return refuse("too_many_booked", `You can have up to ${s.maxOpen} ` +
          "rides booked ahead. Cancel one to book another.");
      }
      // Blocked passenger, App Review, cities, price, promo code.
      if (!(await checkNewRide(rideId, ride))) return null;

      const lead = s.leadMinutes;
      const dispatchAtMs = Math.max(now, pickupMs - lead * 60000);
      const kept = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists || snap.data().status !== "scheduled") return false;
        tx.update(ref, {
          dispatchAt: Timestamp.fromMillis(dispatchAtMs),
          bookedAhead: {leadMinutes: lead,
            checkedAt: FieldValue.serverTimestamp()},
        });
        return true;
      });
      if (!kept) return null;
      const from = String((ride.pickupLocation || {}).address || "")
          .split(",")[0];
      console.log(`Booked ahead ${rideId}: pickup ${new Date(pickupMs)
          .toISOString()}, sent out ${new Date(dispatchAtMs).toISOString()}`);
      await sendPush([ride.riderId], {
        title: "Ride booked",
        body: `Pickup at ${ukWhen(pickupMs)}${from ? ` from ${from}` : ""}. ` +
          `We'll start finding your driver about ${lead} minutes before.`,
        channelId: "trip-updates",
        data: {type: "trip", rideId},
      }).catch(() => null);
    } catch (error) {
      // Not left waiting unchecked (it would never be sent out, and would
      // count as booked): turned down, so the passenger books again.
      console.error("Could not check booking for later:", rideId,
          error.message);
      await refuse("check_failed", "We couldn't take this booking just " +
        "now. Please try again.").catch(() => null);
    }
    return null;
  };

  /**
   * Sends out a checked booking whose time has come, as an app job
   * ("searching"). Called by fleet.js dispatchScheduledRides for every
   * scheduled ride that is not a phone job. Never throws.
   * @param {FirebaseFirestore.QueryDocumentSnapshot} doc The ride.
   * @return {Promise<boolean>} Sent out.
   */
  out.dispatchDue = async (doc) => {
    const ride = doc.data();
    if (!ride.riderId || !ride.bookedAhead || ride.pricing !== "checked") {
      return false;
    }
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(doc.ref);
      const r = snap.exists ? snap.data() : null;
      if (!r || r.status !== "scheduled" || !r.bookedAhead) return false;
      // Reads before writes (a transaction's rule).
      const riderRef = db.collection("riders").doc(r.riderId);
      const rider = await tx.get(riderRef);
      tx.update(doc.ref, {
        "status": "searching",
        "bookedAhead.dispatchedAt": FieldValue.serverTimestamp(),
      });
      // As a booking for now sets it, unless they are on another trip.
      if (rider.exists && !rider.data().currentRideId) {
        tx.update(riderRef, {currentRideId: doc.id});
      }
      return true;
    }).catch((error) => {
      console.error("Could not send out booking:", doc.id, error.message);
      return false;
    });
  };

  out.functions = {
    /* A booking for later has just been sent out: tell the passenger, hold
       the card as for a booking for now, and offer it to drivers.
       notifyRideUpdates leaves this change alone. */
    startBookedSearch: functions.runWith({secrets: STRIPE_SECRETS}).firestore
        .document("rides/{rideId}")
        .onUpdate(async (change, context) => {
          const before = change.before.data();
          const after = change.after.data();
          if (before.status !== "scheduled" || after.status !== "searching" ||
              !isBooked(after)) {
            return null;
          }
          const rideId = context.params.rideId;
          await sendPush([after.riderId], {
            title: "Finding your driver",
            body: `For your pickup at ${ukWhen(toMillis(after.pickupAt))}. ` +
              "We'll let you know when a driver accepts.",
            channelId: "trip-updates",
            data: {type: "trip", rideId},
          }).catch(() => null);
          // A declined card: the ride waits, the passenger is told
          // (holdAtBooking), and a new card carries on (resumeAfterNewCard).
          if (!(await holdAtBooking(rideId, after))) return null;
          return offerRideToDrivers(rideId, after);
        }),
  };

  return out;
};
