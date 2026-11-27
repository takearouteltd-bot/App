"use strict";

/* ======================================
   CHANGING THE DESTINATION DURING A TRIP, AND EXTENDED TRIPS
   The client's rules (M&S, 17 Nov 2026):
   - Only the passenger may ask to go somewhere else, once they are on
     board (status "ongoing"). A driver can never change the destination:
     they could send the fare up themselves.
   - "Customer can be funny, may enter wrong location, so let driver accept
     as well": the driver has destinationChange.acceptSeconds (config/app,
     default 20) to accept. Declining, or no answer, leaves the trip as
     booked and the passenger is told. The server keeps the time
     (timeDestinationChanges, as appOffers.js does for job offers) and
     refuses a late accept, so a phone that never shows the request (driver
     app 1.0.36 and earlier) simply lets it run out.
   - "If customer cannot update due to him being drunk, just calculate miles
     automatically": a trip completed well past the drop-off, after the car
     had been at the drop-off, is priced for the extra miles (extended
     trip). Since the driver chooses where to press Complete, the extra
     waits for the passenger to approve it, or the office when they dispute
     it (Sarfaraz, 19 Nov 2026; extendedTrips.js).

   The new price for a change is the whole journey priced as one trip at
   the ride's class rates (one first mile): what has been driven, worked out
   by Google's Routes from the pickup through the stops already passed to
   where the car is now, plus the car's route on to the new destination
   through any stops still ahead. The ride's own busy-time multiplier and
   promo percentage apply, as at booking. A price agreed by bidding or a
   counter-offer (fare.agreedPrice) stays agreed: it goes up by the normal
   price of the extra distance and time over the booked route. The new
   price is never below the fare already agreed, so a change cannot be used
   to cut the fare. Where the car is comes from the driver's own position
   record (drivers/{id}.location, saved by their phone about every 10 s on a
   job), never from the passenger's phone, and it must be under 2 minutes
   old.

   An extended trip: when the trip is completed more than 0.5 km (straight
   line) from the drop-off, and the server saw the car within 250 m of the
   drop-off earlier in the trip (reachedDropoffAt, from notePosition below),
   the price is the booked route plus the drive from the drop-off to
   where the trip ended, again at the class rates with one first mile and
   never below the agreed fare. Rides already re-priced (a destination
   change, an agreed price) keep their price and add the normal price of the
   extra miles. Switched off with extendedTrips.enabled 0. Not for taxi firm
   bookings paid online (fleetWeb.js holds exactly the quoted price on the
   card); other phone jobs are paid to the driver or the fleet, and their
   extra goes to the office, as there is no passenger app to ask. The
   booked fare is charged as usual; extendedTrips.js adds the extra once
   approved.

   Card rides: the hold on the passenger's card is raised to the new price.
   The original hold is not created to be raised (Stripe's incremental
   authorisation has to be asked for when the PaymentIntent is created, and
   is only offered on some pricing plans), so a second hold for the
   difference is placed instead (rides/{id}.extraHolds), unless Stripe says
   the first one can be raised. If the card refuses, the change still goes
   ahead and the difference is paid in cash: rides/{id}.cashExtraDue, shown
   to the driver. chargeOnRideCompletion then takes from the card only what
   is held and records the cash part (fare.cashExtra), and the driver's
   wallet is credited only the card part.

   rides/{id} fields, written here only (firestore.rules keeps them from
   clients):
     destinationChange   the latest request: {n, state: "pending" |
                         "accepted" | "declined" | "expired", to, from,
                         oldTotal, newTotal, fare, basis, km figures, carAt,
                         requestedAt, expiresAt, seconds, answeredAt, hold}
     destinationChanges  history, one entry per request once answered
     originalDropoffLocation  the drop-off as first booked
     fareBasis           the distance and time the fare is now based on
     bookedBasis         the booked route, kept for agreed prices
     extraHolds          second card holds [{id, amount (pence)}]
     cashExtraDue        what the driver collects in cash on a card ride
     reachedDropoffAt, reachedDropoffPoint   the car was at the drop-off
     extendedTrip        {extraKm, previousFare, newFare, endPoint,
                         flagged: true, ...} for the office to check
   ====================================== */

// Most requests a passenger can make on one trip.
const MAX_REQUESTS = 3;
// The car's position must be newer than this to price a change.
const POSITION_FRESH_MS = 2 * 60 * 1000;
// Longest the timer trigger waits; well within its timeout.
const MAX_WAIT_MS = 240 * 1000;
// A moment after the time runs out, so an accept at the last second wins.
const GRACE_MS = 700;
// Within this of the drop-off, the car has been there.
const REACHED_KM = 0.25;
// Completed further than this past the drop-off: an extended trip.
const EXTENDED_KM = 0.5;
// A new destination this close to the booked one is no change.
const SAME_PLACE_KM = 0.05;
// The car moves between the quote and the confirm, so the price may too.
// Within this the passenger pays what they were shown.
const QUOTE_SLACK = 0.5;

module.exports = (deps) => {
  const {functions, db, stripe, STRIPE_SECRETS, sendPush, loadAppConfig,
    toMillis, distanceKm, rideCurrency, emailMoney, shared,
    paymentAlerts} = deps;
  const {HttpsError} = functions.https;
  const {FieldValue, Timestamp} = require("firebase-admin/firestore");
  const {waitThen} = require("./offerTimer");
  const out = {};

  const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

  /* ------------------------------ helpers ---------------------------- */

  /**
   * A place from the app: {latitude, longitude, address}, or null.
   * @param {*} p Raw place.
   * @return {?Object} Clean place.
   */
  function place(p) {
    if (!p || typeof p !== "object") return null;
    const lat = Number(p.latitude);
    const lng = Number(p.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
        Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return null;
    }
    const address = typeof p.address === "string" && p.address.trim() ?
      p.address.trim().slice(0, 300) : "Pinned location";
    return {latitude: lat, longitude: lng, address};
  }

  /**
   * Just the coordinates, for records.
   * @param {Object} p Point.
   * @return {?Object} {latitude, longitude}
   */
  function coords(p) {
    return p && Number.isFinite(Number(p.latitude)) ?
      {latitude: Number(p.latitude), longitude: Number(p.longitude)} : null;
  }

  /**
   * A price agreed by bidding, a counter-offer or the office.
   * @param {Object} fare Ride fare.
   * @return {boolean} Agreed.
   */
  function isAgreed(fare) {
    return Boolean(fare) && fare.agreedPrice !== undefined &&
      fare.agreedPrice !== null && fare.agreedPrice !== false;
  }

  /**
   * The promo percentage on the fare, as a fraction. Only a code checked at
   * booking (checkNewRide) counts, and never on an agreed price
   * (promoTopUpAmount in index.js).
   * @param {Object} fare Ride fare.
   * @return {number} 0 to 1.
   */
  function discountOf(fare) {
    if (!fare || !fare.promoCode || isAgreed(fare)) return 0;
    return Math.min(1, Math.max(0, Number(fare.discount) || 0));
  }

  /**
   * The distance and time the ride's fare is based on: after a change, what
   * was priced then; otherwise the route the server checked at booking
   * (priceCheck), or the booked route.
   * @param {Object} ride Ride data.
   * @return {Object} {distanceKm, durationMinutes, stops}
   */
  function basisOf(ride) {
    const b = ride.fareBasis ||
      (ride.priceCheck && Number(ride.priceCheck.distanceKm) > 0 ?
        ride.priceCheck : ride.route) || {};
    return {
      distanceKm: Number(b.distanceKm) || 0,
      durationMinutes: Number(b.durationMinutes) || 0,
      stops: Array.isArray(ride.stops) ? ride.stops.length : 0,
    };
  }

  /**
   * config/app with the ride's own busy-time multiplier, so a change is
   * priced at the busy-time pricing the passenger booked at.
   * @param {Object} ride Ride data.
   * @return {Promise<Object>} Raw config for fareFor.
   */
  async function pricingConfig(ride) {
    const raw = await shared.rawConfig();
    const surge = Number(ride.fare && ride.fare.surgeMultiplier);
    return Object.assign({}, raw,
        {surge: {multiplier: surge >= 1 ? surge : 1}});
  }

  /**
   * A fare at the class rates, less the ride's promo, VAT on.
   * @param {Object} raw From pricingConfig.
   * @param {Object} basis {distanceKm, durationMinutes, stops}
   * @param {Object} ride Ride data.
   * @return {Object} {normal: fareFor's fare, total}
   */
  function priced(raw, basis, ride) {
    const normal = shared.fareFor(raw, basis, ride.rideType);
    if (isAgreed(ride.fare)) return {normal, total: normal.total};
    const net = normal.subtotal * (1 - discountOf(ride.fare));
    return {normal, total: r2(net * (1 + normal.vatPercent / 100))};
  }

  /**
   * The ride's fare object at a new total. The breakdown is the new
   * route's (receipts list it when it adds up, else one "Trip fare" line);
   * VAT, the subtotal and any promo discount follow the total, as the app
   * writes them at booking.
   * @param {Object} ride Ride data.
   * @param {Object} normal fareFor's fare for the new route.
   * @param {number} total New total.
   * @return {Object} Fare.
   */
  function fareAfter(ride, normal, total) {
    const old = ride.fare || {};
    const vatPercent = Number.isFinite(Number(old.vatPercent)) ?
      Number(old.vatPercent) : normal.vatPercent;
    const fare = Object.assign({}, old, {total: r2(total), vatPercent});
    ["pricing", "firstMile", "perMile", "baseFare", "distanceFare",
      "timeFare", "stops", "perStop", "stopCharge", "distanceInMiles"]
        .forEach((k) => {
          if (normal[k] !== undefined) fare[k] = normal[k];
        });
    delete fare.minimumApplied;
    const subtotal = r2(total / (1 + vatPercent / 100));
    fare.subtotal = subtotal;
    fare.vat = r2(total - subtotal);
    if (isAgreed(old)) {
      if (typeof old.agreedPrice === "number") fare.agreedPrice = fare.total;
      // The price agreed at booking: later changes add to it, not to each
      // other.
      fare.agreedFrom = old.agreedFrom !== undefined ? old.agreedFrom :
        Number(old.total) || 0;
    } else {
      const d = discountOf(old);
      fare.discountAmount = d >= 1 ? r2(normal.subtotal) :
        d > 0 ? r2(subtotal * d / (1 - d)) : Number(old.discountAmount) || 0;
    }
    return fare;
  }

  /**
   * Driving distance and time, or the straight line when Google cannot be
   * reached (which can only under-charge).
   * @param {Object} from Start.
   * @param {Object} to End.
   * @param {Array} stops In between.
   * @param {boolean} strict Throw instead of falling back.
   * @return {Promise<Object>} {distanceKm, durationMinutes, source}
   */
  async function leg(from, to, stops, strict) {
    try {
      const r = await shared.routeFor(from, to, stops || []);
      return {distanceKm: r.distanceKm, durationMinutes: r.durationMinutes,
        source: "routes"};
    } catch (error) {
      if (strict) throw error;
      const points = [from].concat(stops || [], to);
      let km = 0;
      for (let i = 1; i < points.length; i++) {
        const d = distanceKm(points[i - 1], points[i]);
        km += Number.isFinite(d) ? d : 0;
      }
      return {distanceKm: km, durationMinutes: 0, source: "straight_line"};
    }
  }

  /**
   * The driver's position from their own record, and how old it is.
   * @param {string} driverId Driver.
   * @return {Promise<?Object>} {point, ageMs}
   */
  async function carPosition(driverId) {
    if (!driverId) return null;
    const snap = await db.collection("drivers").doc(driverId).get();
    const d = snap.exists ? snap.data() : {};
    const point = coords(d.location);
    if (!point) return null;
    const seen = toMillis(d.lastUpdated);
    return {point, ageMs: seen ? Date.now() - seen : Infinity};
  }

  /**
   * The price of going to `to` instead, from where the car is.
   * @param {Object} ride Ride data.
   * @param {Object} carAt Car's position.
   * @param {Object} to New destination.
   * @return {Promise<Object>} {total, fare, basis, travelledKm, newLegKm,
   *     newKm, extraKm}
   */
  async function priceChange(ride, carAt, to) {
    const stops = Array.isArray(ride.stops) ? ride.stops : [];
    const done = Math.min(stops.length,
        Math.max(0, Math.floor(Number(ride.stopsCompleted) || 0)));
    const [travelled, ahead] = await Promise.all([
      leg(ride.pickupLocation, carAt, stops.slice(0, done), true),
      leg(carAt, to, stops.slice(done), true),
    ]);
    const basis = {
      distanceKm: travelled.distanceKm + ahead.distanceKm,
      durationMinutes: travelled.durationMinutes + ahead.durationMinutes,
      stops: stops.length,
    };
    const raw = await pricingConfig(ride);
    const current = r2(ride.fare && ride.fare.total);
    const whole = priced(raw, basis, ride);
    let total = whole.total;
    if (isAgreed(ride.fare)) {
      const booked = ride.bookedBasis || basisOf(ride);
      const was = priced(raw, booked, ride).total;
      const from = Number(ride.fare.agreedFrom !== undefined ?
        ride.fare.agreedFrom : current) || 0;
      total = from + Math.max(0, whole.total - was);
    }
    total = Math.max(r2(total), current);
    const before = basisOf(ride);
    return {
      total,
      fare: fareAfter(ride, whole.normal, total),
      basis: {distanceKm: r2(basis.distanceKm),
        durationMinutes: r2(basis.durationMinutes), stops: stops.length},
      travelledKm: r2(travelled.distanceKm),
      newLegKm: r2(ahead.distanceKm),
      newKm: r2(basis.distanceKm),
      extraKm: r2(basis.distanceKm - before.distanceKm),
    };
  }

  /**
   * The price of a trip that went on past the drop-off to endPoint.
   * @param {Object} ride Ride data.
   * @param {Object} endPoint Where it was completed.
   * @return {Promise<Object>} {total, fare, basis, extraKm, source}
   */
  async function priceExtension(ride, endPoint) {
    const extra = await leg(ride.dropoffLocation, endPoint, [], false);
    const basis = basisOf(ride);
    const longer = {
      distanceKm: basis.distanceKm + extra.distanceKm,
      durationMinutes: basis.durationMinutes + extra.durationMinutes,
      stops: basis.stops,
    };
    const raw = await pricingConfig(ride);
    const current = r2(ride.fare && ride.fare.total);
    const whole = priced(raw, longer, ride);
    let total;
    if (!isAgreed(ride.fare) && !ride.fareBasis) {
      // As booked: the whole journey is one trip at the class rates.
      total = whole.total;
    } else {
      // Already re-priced or agreed: the extra miles on top.
      total = current + Math.max(0, whole.total - priced(raw, basis,
          ride).total);
    }
    total = Math.max(r2(total), current);
    return {
      total,
      fare: fareAfter(ride, whole.normal, total),
      basis: {distanceKm: r2(longer.distanceKm),
        durationMinutes: r2(longer.durationMinutes), stops: longer.stops},
      extraKm: r2(extra.distanceKm),
      source: extra.source,
    };
  }

  /* ------------------------------ card hold -------------------------- */

  /**
   * Makes sure the card holds cover a new total on a card ride. Raises the
   * first hold when Stripe says it can be raised, otherwise places a
   * second hold for the difference. Never throws: a refusal comes back as
   * cash to collect.
   * @param {string} rideId Ride id.
   * @param {Object} ride Ride data (with the new fare).
   * @param {number} total New total.
   * @param {string} tag Idempotency tag for this raise.
   * @return {Promise<Object>} {how: "none" | "covered" | "increment" |
   *     "extra_hold" | "cash", hold?: {id, amount}, cashExtraDue?, error?}
   */
  async function raiseHold(rideId, ride, total, tag) {
    if (ride.paymentMethod !== "card" || ride.source === "phone" ||
        !ride.paymentIntentId || ride.paymentStatus !== "authorized") {
      return {how: "none"};
    }
    const want = Math.round(total * 100);
    const holds = Array.isArray(ride.extraHolds) ? ride.extraHolds : [];
    const extra = holds.reduce((s, h) => s + (Number(h.amount) || 0), 0);
    let pi;
    try {
      pi = await stripe.paymentIntents.retrieve(ride.paymentIntentId,
          {expand: ["latest_charge"]});
    } catch (error) {
      console.error("Hold raise: could not read the hold", rideId,
          error.message);
      const p = await db.collection("payments").doc(ride.paymentIntentId)
          .get().catch(() => null);
      const base = p && p.exists ? Number(p.data().amount) || 0 : 0;
      const need = want - base - extra;
      return need > 0 ? {how: "cash", cashExtraDue: r2(need / 100),
        error: error.message} : {how: "covered"};
    }
    const need = want - (Number(pi.amount) || 0) - extra;
    if (need <= 0) return {how: "covered"};

    const charge = pi.latest_charge && typeof pi.latest_charge === "object" ?
      pi.latest_charge : null;
    const card = charge && charge.payment_method_details &&
      charge.payment_method_details.card;
    const inc = card && card.incremental_authorization;
    if (inc && inc.status === "available") {
      try {
        await stripe.paymentIntents.incrementAuthorization(pi.id,
            {amount: Number(pi.amount) + need},
            {idempotencyKey: `hold_inc_${rideId}_${tag}`});
        await db.collection("payments").doc(pi.id).update({
          amount: Number(pi.amount) + need, updatedAt: FieldValue
              .serverTimestamp()}).catch(() => null);
        return {how: "increment", amount: need};
      } catch (error) {
        console.error("Hold raise: increment refused", rideId, error.message);
      }
    }

    const pm = pi.payment_method && pi.payment_method.id ?
      pi.payment_method.id : pi.payment_method;
    let hold = null;
    try {
      hold = await stripe.paymentIntents.create({
        amount: need,
        currency: rideCurrency(ride),
        customer: pi.customer,
        payment_method: pm,
        capture_method: "manual",
        confirm: true,
        off_session: true,
        metadata: {rideId, type: "extra_hold", for: tag},
      }, {idempotencyKey: `hold_extra_${rideId}_${tag}`});
      if (hold.status !== "requires_capture") {
        throw new Error(`Second hold not authorised (${hold.status}).`);
      }
    } catch (error) {
      console.error("Hold raise: second hold refused, cash", rideId,
          error.message);
      if (hold && hold.id) {
        await stripe.paymentIntents.cancel(hold.id).catch(() => null);
      }
      return {how: "cash", cashExtraDue: r2(need / 100),
        error: String(error.message || error).slice(0, 200)};
    }
    await db.collection("payments").doc(hold.id).set({
      rideId, riderId: ride.riderId || null, driverId: ride.driverId || null,
      stripePaymentIntentId: hold.id, amount: need,
      currency: rideCurrency(ride), status: "authorized", type: "extra_hold",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }).catch(() => null);
    return {how: "extra_hold", hold: {id: hold.id, amount: need}};
  }

  /**
   * Saves what raiseHold did on the ride, and tells the driver about cash.
   * @param {string} rideId Ride id.
   * @param {Object} ride Ride data.
   * @param {Object} res From raiseHold.
   * @param {Object} extraFields More fields for the same update.
   * @return {Promise<Object>} {cashExtraDue, extraHolds}
   */
  async function saveHold(rideId, ride, res, extraFields = {}) {
    const fields = Object.assign({}, extraFields);
    let holds = Array.isArray(ride.extraHolds) ? ride.extraHolds : [];
    let cash = 0;
    if (res.how === "extra_hold") {
      fields.extraHolds = FieldValue.arrayUnion(res.hold);
      holds = holds.concat(res.hold);
      fields.cashExtraDue = FieldValue.delete();
    } else if (res.how === "cash") {
      fields.cashExtraDue = res.cashExtraDue;
      cash = res.cashExtraDue;
    } else if (res.how !== "none") {
      fields.cashExtraDue = FieldValue.delete();
    }
    if (res.how !== "none") {
      fields.holdRaise = {how: res.how, at: Timestamp.now(),
        cashExtraDue: cash, error: res.error || null};
    }
    if (Object.keys(fields).length) {
      await db.collection("rides").doc(rideId).update(fields);
    }
    if (cash > 0 && ride.driverId) {
      await sendPush([ride.driverId], {
        channelId: "trip-updates",
        data: {type: "trip", rideId},
        title: "Collect the extra in cash",
        body: `The passenger's card didn't cover the new price. Collect ` +
          `${emailMoney(cash, rideCurrency(ride))} extra in cash.`,
      }).catch(() => null);
    }
    if (res.how === "cash") {
      await paymentAlerts.raise("hold_raise_failed", rideId, {
        title: "Card hold not raised: extra to be paid in cash",
        detail: String(res.error || "").slice(0, 300),
        amount: cash, currency: rideCurrency(ride).toUpperCase(),
        rideId, driverId: ride.driverId || null,
        fleetId: ride.fleetId || null,
        paymentIntentId: ride.paymentIntentId || null,
      }).catch(() => null);
    }
    return {cashExtraDue: cash, extraHolds: holds};
  }

  /* ------------------------------ requests --------------------------- */

  /**
   * Why the passenger cannot ask for a change now, or null.
   * @param {?Object} ride Ride data.
   * @param {string} uid Caller.
   * @param {number} now Time.
   * @return {?string} Reason for the passenger.
   */
  function requestRefusal(ride, uid, now) {
    if (!ride || ride.riderId !== uid) return "This is not your trip.";
    if (ride.source === "phone") {
      return "Please ask the taxi office to change this trip.";
    }
    if (ride.status !== "ongoing" || !ride.driverId) {
      return "You can change the destination once you are on your way.";
    }
    const dc = ride.destinationChange || {};
    if (dc.state === "pending" &&
        (toMillis(dc.expiresAt) || 0) + GRACE_MS > now) {
      return "Your driver is still answering your last change.";
    }
    if ((Number(dc.n) || 0) >= MAX_REQUESTS) {
      return `You can change the destination up to ${MAX_REQUESTS} times ` +
        "on one trip.";
    }
    return null;
  }

  /**
   * One history entry for a request that has been answered.
   * @param {Object} dc The request.
   * @param {string} outcome accepted, declined or expired.
   * @return {Object} Entry.
   */
  function historyEntry(dc, outcome) {
    return {
      n: dc.n, outcome, from: dc.from || null, to: dc.to || null,
      oldTotal: dc.oldTotal, newTotal: dc.newTotal,
      travelledKm: dc.travelledKm, newLegKm: dc.newLegKm, newKm: dc.newKm,
      extraKm: dc.extraKm, carAt: dc.carAt || null,
      requestedAt: dc.requestedAt || null, answeredAt: Timestamp.now(),
    };
  }

  /**
   * The passenger asks to go somewhere else. {rideId, destination,
   * confirm, quotedTotal}. Without confirm it only prices it ({quote}).
   * With confirm and the price shown (quotedTotal) it asks the driver; if
   * the price has moved by more than QUOTE_SLACK since, it returns the new
   * quote with priceChanged instead.
   */
  out.requestDestinationChange = functions.https.onCall(
      async (data, context) => {
        if (!context.auth) {
          throw new HttpsError("unauthenticated", "Please sign in.");
        }
        const uid = context.auth.uid;
        const rideId = data && typeof data.rideId === "string" ?
          data.rideId : "";
        const to = place(data && data.destination);
        if (!rideId) throw new HttpsError("invalid-argument", "Missing trip.");
        if (!to) {
          throw new HttpsError("invalid-argument",
              "Choose the new destination from the list.");
        }
        const ref = db.collection("rides").doc(rideId);
        const snap = await ref.get();
        const ride = snap.exists ? snap.data() : null;
        const why = requestRefusal(ride, uid, Date.now());
        if (why) throw new HttpsError("failed-precondition", why);
        if (distanceKm(to, ride.dropoffLocation) <= SAME_PLACE_KM) {
          throw new HttpsError("failed-precondition",
              "That is where you are going already.");
        }
        const car = await carPosition(ride.driverId);
        if (!car || car.ageMs > POSITION_FRESH_MS) {
          throw new HttpsError("failed-precondition",
              "We can't see where your car is right now. Please try " +
              "again in a minute.");
        }
        let price;
        try {
          price = await priceChange(ride, car.point, to);
        } catch (error) {
          console.error("Destination change price", rideId, error.message);
          throw new HttpsError("failed-precondition",
              "We couldn't work out the new price. Please try again.");
        }
        const currency = rideCurrency(ride).toUpperCase();
        const current = r2(ride.fare && ride.fare.total);
        const quote = {total: price.total, was: current, currency,
          to: to.address, extraKm: price.extraKm, newKm: price.newKm};
        if (data.confirm !== true) return {quote};

        const shown = Number(data.quotedTotal);
        if (!Number.isFinite(shown) ||
            Math.abs(price.total - shown) > QUOTE_SLACK) {
          return {priceChanged: true, quote};
        }
        // The passenger pays the price they were shown, never below the
        // fare already agreed.
        const total = Math.max(current, r2(shown));
        const fare = total === price.total ? price.fare :
          fareAfter(ride, Object.assign({}, price.fare), total);
        const cfg = await loadAppConfig();
        const seconds = cfg.destinationChange.acceptSeconds;

        const placed = await db.runTransaction(async (tx) => {
          const fresh = await tx.get(ref);
          const r = fresh.exists ? fresh.data() : null;
          const again = requestRefusal(r, uid, Date.now());
          if (again) return {why: again};
          const prev = r.destinationChange || {};
          const update = {
            destinationChange: {
              n: (Number(prev.n) || 0) + 1,
              state: "pending",
              from: place(r.dropoffLocation),
              to,
              oldTotal: current,
              newTotal: total,
              currency,
              fare,
              basis: price.basis,
              travelledKm: price.travelledKm,
              newLegKm: price.newLegKm,
              newKm: price.newKm,
              extraKm: price.extraKm,
              carAt: car.point,
              seconds,
              requestedAt: FieldValue.serverTimestamp(),
              expiresAt: Timestamp.fromMillis(Date.now() + seconds * 1000),
            },
          };
          // A request the timer never closed: kept in the history.
          if (prev.state === "pending") {
            update.destinationChanges =
              FieldValue.arrayUnion(historyEntry(prev, "expired"));
          }
          tx.update(ref, update);
          return {n: update.destinationChange.n};
        });
        if (placed.why) {
          throw new HttpsError("failed-precondition", placed.why);
        }

        const short = to.address.split(",")[0];
        await sendPush([ride.driverId], {
          channelId: "job-ring",
          sound: "job_ring.wav",
          ttlSeconds: Math.max(10, seconds),
          data: {type: "trip", rideId},
          title: "Change of destination",
          body: `Passenger wants to go to ${short} instead. New price ` +
            `${emailMoney(total, currency)} (was ` +
            `${emailMoney(current, currency)}). Open TakeARoute to answer.`,
        }).catch(() => null);
        console.log("Destination change asked", rideId, placed.n, current,
            "->", total);
        return {requested: true, n: placed.n, seconds, quote:
          Object.assign({}, quote, {total})};
      });

  /**
   * Tells the passenger how a request ended.
   * @param {Object} ride Ride data.
   * @param {string} rideId Ride id.
   * @param {string} outcome accepted, declined or expired.
   * @param {Object} dc The request.
   * @return {Promise<void>}
   */
  async function tellPassenger(ride, rideId, outcome, dc) {
    if (!ride.riderId) return;
    const currency = dc.currency || rideCurrency(ride).toUpperCase();
    const from = dc.from && dc.from.address ?
      dc.from.address.split(",")[0] : "your destination";
    const to = dc.to && dc.to.address ? dc.to.address.split(",")[0] :
      "your new destination";
    await sendPush([ride.riderId], {
      channelId: "trip-updates",
      data: {type: "trip", rideId},
      title: outcome === "accepted" ? "Destination changed" :
        "Destination not changed",
      body: outcome === "accepted" ?
        `Your driver accepted. You're now going to ${to}. New price ` +
        `${emailMoney(dc.newTotal, currency)}.` :
        `Your driver couldn't take the change. Your trip continues to ` +
        `${from}.`,
    }).catch(() => null);
  }

  /**
   * The driver answers. {rideId, n, accept}. Only the trip's driver, only
   * the request still open, and only within its time.
   */
  out.answerDestinationChange = functions.runWith({secrets: STRIPE_SECRETS})
      .https.onCall(async (data, context) => {
        if (!context.auth) {
          throw new HttpsError("unauthenticated", "Please sign in.");
        }
        const uid = context.auth.uid;
        const rideId = data && typeof data.rideId === "string" ?
          data.rideId : "";
        const n = Number(data && data.n);
        const accept = data && data.accept === true;
        if (!rideId || !Number.isFinite(n)) {
          throw new HttpsError("invalid-argument", "Missing trip.");
        }
        const ref = db.collection("rides").doc(rideId);
        const done = await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          const ride = snap.exists ? snap.data() : null;
          if (!ride || ride.driverId !== uid) {
            return {why: "This is not your trip.", code: "permission-denied"};
          }
          const dc = ride.destinationChange || {};
          if (dc.n !== n || dc.state !== "pending") {
            return {why: "This request has already ended."};
          }
          if (ride.status !== "ongoing") {
            return {why: "This trip has ended."};
          }
          if (Date.now() > (toMillis(dc.expiresAt) || 0) + GRACE_MS) {
            return {why: "Too late: the time to answer ran out."};
          }
          if (!accept) {
            tx.update(ref, {
              "destinationChange.state": "declined",
              "destinationChange.answeredAt": FieldValue.serverTimestamp(),
              "destinationChanges":
                FieldValue.arrayUnion(historyEntry(dc, "declined")),
            });
            return {ride, dc, outcome: "declined"};
          }
          const update = {
            "dropoffLocation": dc.to,
            "fare": dc.fare,
            "fareEstimate": dc.newTotal,
            "route": Object.assign({}, ride.route || {}, {
              distanceKm: dc.basis.distanceKm,
              distanceMiles: dc.fare.distanceInMiles,
              durationMinutes: dc.basis.durationMinutes,
              status: "calculated",
            }),
            "fareBasis": dc.basis,
            // Being at the old drop-off says nothing about the new one.
            "reachedDropoffAt": FieldValue.delete(),
            "reachedDropoffPoint": FieldValue.delete(),
            "destinationChange.state": "accepted",
            "destinationChange.answeredAt": FieldValue.serverTimestamp(),
            "destinationChanges":
              FieldValue.arrayUnion(historyEntry(dc, "accepted")),
          };
          if (!ride.originalDropoffLocation) {
            update.originalDropoffLocation = ride.dropoffLocation || null;
          }
          if (isAgreed(ride.fare) && !ride.bookedBasis) {
            update.bookedBasis = basisOf(ride);
          }
          tx.update(ref, update);
          return {ride, dc, outcome: "accepted"};
        });
        if (done.why) {
          throw new HttpsError(done.code || "failed-precondition", done.why);
        }
        const {ride, dc, outcome} = done;
        console.log("Destination change", outcome, rideId, n);
        let cash = 0;
        if (outcome === "accepted") {
          const now = Object.assign({}, ride, {fare: dc.fare});
          const res = await raiseHold(rideId, now, dc.newTotal, `dc${n}`);
          const saved = await saveHold(rideId, now, res,
              res.how === "none" ? {} : {"destinationChange.hold":
                {how: res.how, cashExtraDue: res.cashExtraDue || 0}});
          cash = saved.cashExtraDue;
        }
        await tellPassenger(ride, rideId, outcome, dc);
        return {outcome, newTotal: dc.newTotal, cashExtraDue: cash,
          to: dc.to};
      });

  /**
   * Closes a request nobody answered in time. Never throws.
   * @param {string} rideId Ride id.
   * @param {number} n The request it was set for.
   * @return {Promise<boolean>} Closed now.
   */
  async function expire(rideId, n) {
    try {
      const ref = db.collection("rides").doc(rideId);
      const done = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const ride = snap.exists ? snap.data() : null;
        const dc = ride ? ride.destinationChange || {} : {};
        if (dc.n !== n || dc.state !== "pending") return null;
        if ((toMillis(dc.expiresAt) || 0) > Date.now()) return null;
        tx.update(ref, {
          "destinationChange.state": "expired",
          "destinationChange.answeredAt": FieldValue.serverTimestamp(),
          "destinationChanges":
            FieldValue.arrayUnion(historyEntry(dc, "expired")),
        });
        return {ride, dc};
      });
      if (!done) return false;
      console.log("Destination change not answered", rideId, n);
      if (done.ride.status === "ongoing") {
        await tellPassenger(done.ride, rideId, "expired", done.dc);
      }
      return true;
    } catch (error) {
      console.error("Destination change expiry", rideId, error.message);
      return false;
    }
  }
  out.expire = expire;

  /**
   * Closes any request the timer missed (a trigger that never ran, or
   * stopped). Run every 2 minutes by expireSearchingRides; one query, which
   * finds nothing almost always. Never throws.
   * @return {Promise<number>} Requests closed.
   */
  async function sweep() {
    try {
      const snap = await db.collection("rides")
          .where("destinationChange.state", "==", "pending").limit(100).get();
      let closed = 0;
      for (const d of snap.docs) {
        const dc = d.data().destinationChange || {};
        if ((toMillis(dc.expiresAt) || 0) + GRACE_MS < Date.now() &&
            await expire(d.id, dc.n)) {
          closed += 1;
        }
      }
      return closed;
    } catch (error) {
      console.error("Destination change sweep", error.message);
      return 0;
    }
  }
  out.sweep = sweep;

  /* ------------------------------ the car's position ------------------ */

  /**
   * On every position the driver's phone saves (the drivers/{id} update
   * trigger that already runs for each save, so no extra function runs),
   * notes when the car on a trip under way reaches its drop-off. Costs one
   * read of the ride per save during a trip (shared with the route trail,
   * routeTrail.js), and a write once. The phone cannot set this itself
   * (firestore.rules).
   * @param {string} driverId Driver.
   * @param {Object} before Driver record before.
   * @param {Object} after Driver record after.
   * @param {?Object=} rideSnap The ride, already read by the trigger
   *     (null: nothing to read); read here when left out.
   * @return {Promise<void>}
   */
  async function notePosition(driverId, before, after, rideSnap) {
    if (!after || after.isOnRide !== true || !after.currentRideId) return;
    const loc = coords(after.location);
    if (!loc) return;
    const prev = coords(before && before.location);
    if (prev && prev.latitude === loc.latitude &&
        prev.longitude === loc.longitude) {
      return;
    }
    const ref = db.collection("rides").doc(after.currentRideId);
    const snap = rideSnap !== undefined ? rideSnap : await ref.get();
    const ride = snap && snap.exists ? snap.data() : null;
    const near = (r) => Boolean(r) && r.status === "ongoing" &&
      r.driverId === driverId && !r.reachedDropoffAt &&
      distanceKm(loc, r.dropoffLocation) <= REACHED_KM;
    if (!near(ride)) return;
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(ref);
      if (!near(fresh.exists ? fresh.data() : null)) return;
      tx.update(ref, {reachedDropoffAt: FieldValue.serverTimestamp(),
        reachedDropoffPoint: loc});
    });
  }
  out.notePosition = notePosition;

  /* ------------------------------ extended trips --------------------- */

  /**
   * A trip completed well past the drop-off: works out the extra miles and
   * records them on the ride as waiting for the passenger's approval
   * (extendedTrips.js charges them once approved). The fare itself does not
   * change here, so the booked fare is charged as usual. The driver chooses
   * where to press Complete, so the extra is never taken without the
   * passenger (or the office) agreeing (Sarfaraz, 19 Nov 2026). Called by
   * chargeOnRideCompletion before anything is charged.
   * @param {string} rideId Ride id.
   * @param {Object} ride Ride data (completed).
   * @return {Promise<?Object>} {fare} when the trip is (now or already)
   *     extended, so it is not also treated as ended early; null when it
   *     isn't one.
   */
  async function settleExtendedTrip(rideId, ride) {
    if (ride.extendedTrip) return {fare: ride.fare};
    if (!ride.reachedDropoffAt || ride.endedEarlyBy ||
        (ride.fare && ride.fare.fullTotal !== undefined) ||
        (ride.source === "phone" && ride.collectBy === "online")) {
      return null;
    }
    const cfg = await loadAppConfig();
    if (cfg.extendedTrips.enabled !== 1) return null;
    const car = await carPosition(ride.driverId);
    if (!car) return null;
    const pastKm = distanceKm(car.point, ride.dropoffLocation);
    if (!(pastKm > EXTENDED_KM)) return null;

    const price = await priceExtension(ride, car.point);
    const ref = db.collection("rides").doc(rideId);
    const hours = cfg.extendedTrips.approveHours;
    const applied = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const fresh = snap.exists ? snap.data() : null;
      if (!fresh || fresh.status !== "completed") return null;
      if (fresh.extendedTrip) return {fresh, already: true};
      if (fresh.endedEarlyBy ||
          (fresh.fare && fresh.fare.fullTotal !== undefined)) {
        return null;
      }
      const previous = r2(fresh.fare && fresh.fare.total);
      const extra = r2(price.total - previous);
      if (!(extra > 0)) return null;
      // A passenger with the app is asked; a taxi firm's phone customer
      // can't be, so the office decides.
      const asks = Boolean(fresh.riderId);
      const decideBy = Timestamp.fromMillis(Date.now() + hours * 3600 * 1000);
      const extendedTrip = {
        state: asks ? "pending" : "office",
        extra,
        extraKm: price.extraKm,
        pastDropoffKm: r2(pastKm),
        previousFare: previous,
        newFare: price.total,
        endPoint: car.point,
        positionAgeSeconds: Number.isFinite(car.ageMs) ?
          Math.round(car.ageMs / 1000) : null,
        routeSource: price.source,
        reachedDropoffAt: fresh.reachedDropoffAt || null,
        flagged: true,
        at: FieldValue.serverTimestamp(),
      };
      if (asks) {
        extendedTrip.decideBy = decideBy;
        // The sweep (extendedTrips.js) looks at the ride again then.
        extendedTrip.dueAt = decideBy;
      }
      const update = {extendedTrip, endedAtLocation: car.point};
      // A change still waiting for the driver ends with the trip.
      const dc = fresh.destinationChange || {};
      if (dc.state === "pending") {
        update["destinationChange.state"] = "expired";
        update["destinationChange.answeredAt"] = FieldValue.serverTimestamp();
        update.destinationChanges =
          FieldValue.arrayUnion(historyEntry(dc, "expired"));
      }
      tx.update(ref, update);
      return {fresh, previous, extra, asks};
    });
    if (!applied) return null;
    if (applied.already) return {fare: applied.fresh.fare};
    console.log("Extended trip, awaiting approval", rideId, applied.previous,
        "+", applied.extra, `${price.extraKm} km`);

    const currency = rideCurrency(ride);
    const extra = emailMoney(applied.extra, currency);
    const miles = (Math.round(price.extraKm * 0.621371 * 10) / 10).toFixed(1);
    const card = ride.paymentMethod === "card";
    if (ride.driverId) {
      await sendPush([ride.driverId], {
        channelId: "trip-updates",
        data: {type: "trip", rideId},
        title: "Extended trip: waiting for approval",
        body: !applied.asks ?
          `The trip went ${miles} mi past the drop-off. The office checks ` +
          `the extra ${extra} before it is added.` :
          card ?
          `The trip went ${miles} mi past the drop-off. The passenger is ` +
          `asked to approve the extra ${extra}; it is added to your ` +
          "earnings once paid." :
          `The trip went ${miles} mi past the drop-off. Take the booked ` +
          `fare. Collect the extra ${extra} only if the passenger approves ` +
          "it in their app.",
      }).catch(() => null);
    }
    if (applied.asks) {
      // Its own type, so the app opens the trip's Approve / Dispute card
      // (RiderRideCompleted) rather than the home map, which shows nothing
      // for a finished trip (audit 19 Nov 2026). Older apps treat an unknown
      // type as a trip update and open Home, as before.
      await sendPush([ride.riderId], {
        channelId: "trip-updates",
        data: {type: "extended_trip", rideId},
        title: "Your trip went past your drop-off",
        body: `It ended ${miles} mi past your drop-off: ${extra} extra. ` +
          "Open TakeARoute to approve or dispute it." + (card ?
            ` If you don't answer within ${hours} hours, it is charged.` :
            ""),
      }).catch(() => null);
    } else if (paymentAlerts) {
      await paymentAlerts.raise("extended_trip_review", rideId, {
        title: "Extended trip to check (no passenger app to ask)",
        detail: `${miles} mi past the drop-off, ${extra} extra. Decide ` +
          "whether it is owed.",
        amount: applied.extra, currency: currency.toUpperCase(),
        rideId, driverId: ride.driverId || null,
        fleetId: ride.fleetId || null,
      });
    }
    return {fare: applied.fresh.fare};
  }
  out.settleExtendedTrip = settleExtendedTrip;

  /**
   * Takes the part of the fare above the first hold from the second holds,
   * in order, and releases what is not needed. Never throws.
   * @param {string} rideId Ride id.
   * @param {Array} holds rides/{id}.extraHolds.
   * @param {number} amount Pence still to take.
   * @return {Promise<number>} Pence taken.
   */
  async function captureExtraHolds(rideId, holds, amount) {
    let left = Math.max(0, Math.round(amount));
    let taken = 0;
    for (const h of Array.isArray(holds) ? holds : []) {
      const take = Math.min(left, Number(h.amount) || 0);
      try {
        if (take > 0) {
          await stripe.paymentIntents.capture(h.id, {amount_to_capture: take},
              {idempotencyKey: `capture_extra_${h.id}`});
          taken += take;
          left -= take;
        } else {
          await stripe.paymentIntents.cancel(h.id);
        }
        await db.collection("payments").doc(h.id).update({
          status: take > 0 ? "captured" : "canceled",
          amount: take > 0 ? take : Number(h.amount) || 0,
          updatedAt: FieldValue.serverTimestamp()}).catch(() => null);
      } catch (error) {
        console.error("Second hold", h.id, rideId, error.message);
      }
    }
    return taken;
  }
  out.captureExtraHolds = captureExtraHolds;

  /**
   * Releases every second hold (the trip was cancelled). Never throws.
   * @param {string} rideId Ride id.
   * @param {Array} holds rides/{id}.extraHolds.
   * @return {Promise<void>}
   */
  async function releaseExtraHolds(rideId, holds) {
    await captureExtraHolds(rideId, holds, 0);
  }
  out.releaseExtraHolds = releaseExtraHolds;

  out.functions = {
    /* Each request is timed here: wait until it runs out, then, if it is
       still the same request and still unanswered, close it and tell the
       passenger. An answer meanwhile makes the wake-up do nothing. */
    timeDestinationChanges: functions.runWith({timeoutSeconds: 300}).firestore
        .document("rides/{rideId}")
        .onUpdate(async (change, context) => {
          const before = change.before.data().destinationChange || {};
          const after = change.after.data().destinationChange || {};
          if (after.state !== "pending" || after.n === before.n) return null;
          const left = (toMillis(after.expiresAt) || 0) - Date.now();
          if (left > MAX_WAIT_MS) return null;
          await waitThen(left + GRACE_MS, () =>
            expire(context.params.rideId, after.n));
          return null;
        }),
  };

  return out;
};
