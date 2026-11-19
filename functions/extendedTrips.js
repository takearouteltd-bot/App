"use strict";

/* ======================================
   EXTENDED TRIPS: THE EXTRA MILES WAIT FOR APPROVAL
   A trip completed well past the drop-off, after the car had been there,
   is priced for the extra miles by destinationChange.js
   (settleExtendedTrip), but the driver chooses where to press Complete,
   so the extra is never taken on the driver's word (Sarfaraz, 19 Nov
   2026). The booked fare is charged as usual; the extra waits here.

   rides/{id}.extendedTrip.state, written here and in destinationChange.js
   only (firestore.rules keeps it from clients):
     pending        the passenger is asked in the app (decideBy)
     office         no passenger app to ask (a taxi firm's phone customer):
                    the office decides
     disputed       the passenger said no: the office decides
     unanswered     a cash trip nobody answered by decideBy: there is no
                    card to charge, so the office decides
     approved       by the passenger, by the office, or by nobody answering
                    a card trip by decideBy (approvedBy); being settled
     charging       the card is being charged (chargingAt)
     charged        card: paid, and credited to the driver (or the fleet)
     collect        not a card trip: the extra is owed to the driver, who
                    is told to collect it when the passenger approved it
     charge_failed  the card refused it: the office decides
     waived         the office decided it is not owed

   Settling waits until the trip's own payment is settled (fare.finalTotal
   is written by chargeOnRideCompletion), then adds the extra:
   fare.extendedExtra and fare.finalTotal go up by it. A card trip is
   charged off session on the card the trip was paid with, once per
   attempt (Stripe idempotency key extended_{ride}_{attempt}), and the
   extra goes to the same wallet as the fare (wallet entry extended_{ride}).

   extendedTrip.dueAt is when the sweep (expireSearchingRides, every 2
   minutes) should look at the ride again: decideBy while pending, soon
   after while settling. It is removed once nothing is left to do, so the
   sweep's one query finds almost nothing.
====================================== */

// A card charge this old was left by a run that died: try it again (the
// idempotency key makes that the same charge, not a second one).
const STALE_CHARGING_MS = 5 * 60 * 1000;
// Settling waits for the trip's own payment; look again this much later.
const RETRY_MS = 2 * 60 * 1000;
// States the office can decide.
const OFFICE_STATES = ["pending", "office", "disputed", "unanswered",
  "charge_failed"];

module.exports = (deps) => {
  const {functions, db, stripe, STRIPE_SECRETS, sendPush, toMillis,
    rideCurrency, emailMoney, paymentAlerts} = deps;
  const {HttpsError} = functions.https;
  const {FieldValue, Timestamp} = require("firebase-admin/firestore");
  const rides = db.collection("rides");
  const out = {};

  const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
  const at = (ms) => Timestamp.fromMillis(ms);
  const miles = (km) =>
    (Math.round((Number(km) || 0) * 0.621371 * 10) / 10).toFixed(1);

  /**
   * Whether the trip was paid in the app by card, so the extra can go on
   * the same card.
   * @param {Object} ride Ride data.
   * @return {boolean}
   */
  function paidInAppByCard(ride) {
    return ride.paymentMethod === "card" && Boolean(ride.paymentIntentId) &&
      ride.paymentStatus === "captured";
  }

  /**
   * Whether the driver takes the fare in cash from the passenger.
   * @param {Object} ride Ride data.
   * @return {boolean}
   */
  function inCash(ride) {
    const sw = ride.paymentSwitch || {};
    return ride.paymentMethod === "cash" &&
      !["account", "card", "online"].includes(ride.collectBy) &&
      !["held", "paid"].includes(sw.state);
  }

  /**
   * Closes the office alerts about this ride's extra, once decided.
   * @param {string} rideId Ride id.
   * @param {string} by Who decided.
   * @param {string} note What was decided.
   * @return {Promise<void>}
   */
  async function closeAlerts(rideId, by, note) {
    const kinds = ["extended_trip_review", "extended_trip_disputed",
      "extended_trip_unanswered"];
    await Promise.all(kinds.map((k) => db.collection("paymentAlerts")
        .doc(`${k}_${rideId}`).update({status: "resolved",
          resolvedAt: FieldValue.serverTimestamp(), resolvedBy: by,
          resolutionNote: note}).catch(() => null)));
  }

  /**
   * Adds an approved extra to the trip: charges the card, or records it as
   * owed in cash. Waits (dueAt) if the trip's own payment isn't settled
   * yet. Never throws.
   * @param {string} rideId Ride id.
   * @return {Promise<?string>} The state afterwards, or null if nothing was
   *     done.
   */
  async function settle(rideId) {
    const ref = rides.doc(rideId);
    let claim;
    try {
      claim = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const ride = snap.exists ? snap.data() : null;
        const et = ride && ride.extendedTrip;
        if (!et) return null;
        const stale = et.state === "charging" &&
          Date.now() - (toMillis(et.chargingAt) || 0) > STALE_CHARGING_MS;
        if (et.state !== "approved" && !stale) return null;
        const fare = ride.fare || {};
        if (fare.finalTotal === undefined) {
          tx.update(ref, {"extendedTrip.dueAt": at(Date.now() + RETRY_MS)});
          return null;
        }
        if (paidInAppByCard(ride)) {
          tx.update(ref, {
            "extendedTrip.state": "charging",
            "extendedTrip.chargingAt": FieldValue.serverTimestamp(),
            "extendedTrip.dueAt": at(Date.now() + STALE_CHARGING_MS),
          });
          return {ride, et, how: "card"};
        }
        if (ride.paymentMethod === "card") {
          // Booked by card, but the fare itself was not taken: nothing to
          // add the extra to.
          tx.update(ref, {
            "extendedTrip.state": "charge_failed",
            "extendedTrip.error": "The trip's own card payment did not go " +
              "through.",
            "extendedTrip.dueAt": FieldValue.delete(),
          });
          return {ride, et, how: "failed"};
        }
        tx.update(ref, {
          "extendedTrip.state": "collect",
          "extendedTrip.settledAt": FieldValue.serverTimestamp(),
          "extendedTrip.dueAt": FieldValue.delete(),
          "fare.extendedExtra": r2(et.extra),
          "fare.finalTotal": r2(Number(fare.finalTotal) + Number(et.extra)),
        });
        return {ride, et, how: "collect"};
      });
    } catch (error) {
      console.error("Extended trip settle", rideId, error.message);
      return null;
    }
    if (!claim) return null;
    const {ride, et} = claim;
    const currency = rideCurrency(ride);
    const extra = emailMoney(et.extra, currency);

    if (claim.how === "failed") {
      await paymentAlerts.raise("extended_trip_charge_failed",
          `${rideId}_${et.attempt || 1}`, {
            title: "Extended trip extra not charged",
            detail: "The trip's own card payment did not go through, so " +
              `the extra ${extra} could not be added.`,
            amount: et.extra, currency: currency.toUpperCase(), rideId,
            driverId: ride.driverId || null, fleetId: ride.fleetId || null,
          });
      return "charge_failed";
    }

    if (claim.how === "collect") {
      if (ride.driverId && et.approvedBy === "passenger" && inCash(ride)) {
        await sendPush([ride.driverId], {
          channelId: "trip-updates",
          data: {type: "trip", rideId},
          title: `Approved: collect ${extra} extra`,
          body: "The passenger approved the extra miles. Collect " +
            `${extra} in cash on top of the booked fare.`,
        }).catch(() => null);
      } else if (!inCash(ride) && ride.collectBy !== "account") {
        // Paid by card instead, on a card terminal, or online: nobody is
        // there to collect it.
        await paymentAlerts.raise("extended_trip_collect", rideId, {
          title: "Extended trip extra approved, to collect by hand",
          detail: `The extra ${extra} was approved, but this trip was not ` +
            "paid in cash or by card in the app, so it has to be collected " +
            "another way.",
          amount: et.extra, currency: currency.toUpperCase(), rideId,
          driverId: ride.driverId || null, fleetId: ride.fleetId || null,
        });
      }
      console.log("Extended trip extra owed", rideId, et.extra);
      return "collect";
    }

    // Card: the same card the trip was paid with, off session.
    const attempt = Number(et.attempt) || 1;
    const amount = Math.round(Number(et.extra) * 100);
    let intent = null;
    let failure = null;
    try {
      const first = await stripe.paymentIntents.retrieve(ride.paymentIntentId);
      const pm = first.payment_method && first.payment_method.id ?
        first.payment_method.id : first.payment_method;
      intent = await stripe.paymentIntents.create({
        amount,
        currency,
        customer: first.customer,
        payment_method: pm,
        confirm: true,
        off_session: true,
        description: "Extra miles on your TakeARoute trip",
        metadata: {rideId, riderId: ride.riderId || "",
          driverId: ride.driverId || "", type: "extended_trip"},
      }, {idempotencyKey: `extended_${rideId}_${attempt}`});
      if (intent.status !== "succeeded") failure = intent.status;
    } catch (error) {
      const code = error && (error.code || (error.raw && error.raw.code));
      failure = code || error.message || "declined";
    }

    if (failure) {
      console.error("Extended trip charge failed", rideId, failure);
      await ref.update({
        "extendedTrip.state": "charge_failed",
        "extendedTrip.error": String(failure).slice(0, 200),
        "extendedTrip.dueAt": FieldValue.delete(),
      }).catch(() => null);
      await paymentAlerts.raise("extended_trip_charge_failed",
          `${rideId}_${attempt}`, {
            title: "Extended trip extra: card refused",
            detail: `The extra ${extra} for the miles past the drop-off ` +
              `was refused (${String(failure).slice(0, 120)}).`,
            amount: et.extra, currency: currency.toUpperCase(), rideId,
            driverId: ride.driverId || null, fleetId: ride.fleetId || null,
          });
      return "charge_failed";
    }

    // Paid: record it and credit the same wallet as the fare, once.
    const fleetId = ride.fleetId || null;
    const walletRef = fleetId ?
      db.collection("fleetWallets").doc(fleetId) :
      db.collection("driverWallets").doc(ride.driverId);
    const entryRef = walletRef.collection("transactions")
        .doc(`extended_${rideId}`);
    const value = r2(amount / 100);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const entry = await tx.get(entryRef);
      const fresh = snap.exists ? snap.data() : ride;
      const fare = fresh.fare || {};
      const now = FieldValue.serverTimestamp();
      tx.update(ref, {
        "extendedTrip.state": "charged",
        "extendedTrip.paymentIntentId": intent.id,
        "extendedTrip.chargedAt": now,
        "extendedTrip.dueAt": FieldValue.delete(),
        "fare.extendedExtra": value,
        "fare.finalTotal": r2(Number(fare.finalTotal || 0) + value),
        "earnings.extendedExtra": value,
      });
      if (entry.exists || !ride.driverId) return;
      tx.set(walletRef, {
        availableBalance: FieldValue.increment(value),
        totalEarned: FieldValue.increment(value),
        updatedAt: now,
      }, {merge: true});
      tx.set(entryRef, {
        type: "ride_earning",
        amount: value,
        rideId,
        driverId: ride.driverId,
        paymentIntentId: intent.id,
        status: "cleared",
        description: `Extra miles past the drop-off, ride ${rideId}`,
        createdAt: now,
      });
    });
    console.log("Extended trip charged", rideId, value);

    if (ride.riderId) {
      await sendPush([ride.riderId], {
        channelId: "trip-updates",
        data: {type: "extended_trip", rideId},
        title: "Extra miles charged",
        body: `${extra} was charged to your card for the ` +
          `${miles(et.extraKm)} mi past your drop-off.`,
      }).catch(() => null);
    }
    if (ride.driverId) {
      await sendPush([ride.driverId], {
        channelId: "trip-updates",
        data: {type: "trip", rideId},
        title: `${extra} extra paid`,
        body: fleetId ?
          "The passenger paid for the extra miles. Your fleet pays you." :
          "The passenger paid for the extra miles. It's in your balance.",
      }).catch(() => null);
    }
    return "charged";
  }
  out.settle = settle;

  /**
   * The passenger approves or disputes the extra. {rideId, approve}
   */
  out.answerExtendedTrip = functions.runWith({secrets: STRIPE_SECRETS})
      .https.onCall(async (data, context) => {
        if (!context.auth) {
          throw new HttpsError("unauthenticated", "Please sign in.");
        }
        const uid = context.auth.uid;
        const rideId = data && typeof data.rideId === "string" ?
          data.rideId : "";
        if (!rideId) throw new HttpsError("invalid-argument", "Missing ride.");
        const approve = Boolean(data && data.approve === true);
        const ref = rides.doc(rideId);
        const done = await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          const ride = snap.exists ? snap.data() : null;
          if (!ride || ride.riderId !== uid) {
            return {why: "This is not your trip."};
          }
          const et = ride.extendedTrip;
          if (!et || et.state !== "pending") {
            return {why: "This has already been settled."};
          }
          const now = FieldValue.serverTimestamp();
          tx.update(ref, approve ? {
            "extendedTrip.state": "approved",
            "extendedTrip.approvedBy": "passenger",
            "extendedTrip.answeredAt": now,
            "extendedTrip.dueAt": at(Date.now()),
          } : {
            "extendedTrip.state": "disputed",
            "extendedTrip.answeredAt": now,
            "extendedTrip.dueAt": FieldValue.delete(),
          });
          return {ride, et};
        });
        if (done.why) throw new HttpsError("failed-precondition", done.why);

        const {ride, et} = done;
        const currency = rideCurrency(ride);
        const extra = emailMoney(et.extra, currency);
        if (approve) {
          const state = await settle(rideId);
          return {state: state || "approved"};
        }
        await paymentAlerts.raise("extended_trip_disputed", rideId, {
          title: "Passenger disputed extended trip miles",
          detail: `The trip ended ${miles(et.extraKm)} mi past the ` +
            `drop-off; the passenger disputes the extra ${extra}. Decide ` +
            "whether it is owed.",
          amount: et.extra, currency: currency.toUpperCase(), rideId,
          driverId: ride.driverId || null, fleetId: ride.fleetId || null,
        });
        if (ride.driverId) {
          await sendPush([ride.driverId], {
            channelId: "trip-updates",
            data: {type: "trip", rideId},
            title: "Extra miles disputed",
            body: `The passenger disputed the extra ${extra}. The office ` +
              "will look at the trip and decide.",
          }).catch(() => null);
        }
        return {state: "disputed"};
      });

  /**
   * The office decides an extra nobody else can. {rideId, charge, note}
   */
  out.decideExtendedTrip = functions.runWith({secrets: STRIPE_SECRETS})
      .https.onCall(async (data, context) => {
        const uid = await paymentAlerts.assertAdmin(context);
        const rideId = data && typeof data.rideId === "string" ?
          data.rideId : "";
        if (!rideId) throw new HttpsError("invalid-argument", "Missing ride.");
        const charge = Boolean(data && data.charge === true);
        const note = String((data && data.note) || "").slice(0, 500);
        const ref = rides.doc(rideId);
        const why = await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          const et = snap.exists ? snap.data().extendedTrip : null;
          if (!et) return "This trip has no extra miles.";
          if (!OFFICE_STATES.includes(et.state)) {
            return `Already settled (${et.state}).`;
          }
          const now = FieldValue.serverTimestamp();
          tx.update(ref, charge ? {
            "extendedTrip.state": "approved",
            "extendedTrip.approvedBy": "office",
            "extendedTrip.decidedBy": uid,
            "extendedTrip.decidedAt": now,
            "extendedTrip.decisionNote": note,
            // A new try after a refused card is a new charge.
            "extendedTrip.attempt": (Number(et.attempt) || 1) +
              (et.state === "charge_failed" ? 1 : 0),
            "extendedTrip.dueAt": at(Date.now()),
          } : {
            "extendedTrip.state": "waived",
            "extendedTrip.decidedBy": uid,
            "extendedTrip.decidedAt": now,
            "extendedTrip.decisionNote": note,
            "extendedTrip.dueAt": FieldValue.delete(),
          });
          return null;
        });
        if (why) throw new HttpsError("failed-precondition", why);
        await closeAlerts(rideId, uid, charge ? "Extra charged" : "Waived");
        if (!charge) return {state: "waived"};
        const state = await settle(rideId);
        return {state: state || "approved"};
      });

  /**
   * Run every 2 minutes by expireSearchingRides: a card trip's extra nobody
   * answered is charged; a cash trip's goes to the office; one waiting for
   * the trip's payment, or a charge that died, is settled. Never throws.
   * @return {Promise<number>} Rides looked at.
   */
  async function sweep() {
    let snap;
    try {
      snap = await rides.where("extendedTrip.dueAt", "<=", at(Date.now()))
          .limit(50).get();
    } catch (error) {
      console.error("Extended trip sweep", error.message);
      return 0;
    }
    for (const d of snap.docs) {
      try {
        const ride = d.data();
        const et = ride.extendedTrip || {};
        if (et.state === "pending") {
          const card = ride.paymentMethod === "card";
          const moved = await db.runTransaction(async (tx) => {
            const fresh = await tx.get(d.ref);
            const e = fresh.exists ? fresh.data().extendedTrip : null;
            if (!e || e.state !== "pending" ||
                (toMillis(e.decideBy) || 0) > Date.now()) {
              return false;
            }
            tx.update(d.ref, card ? {
              "extendedTrip.state": "approved",
              "extendedTrip.approvedBy": "no_answer",
              "extendedTrip.dueAt": at(Date.now()),
            } : {
              "extendedTrip.state": "unanswered",
              "extendedTrip.dueAt": FieldValue.delete(),
            });
            return true;
          });
          if (!moved) continue;
          if (card) {
            await settle(d.id);
          } else {
            const currency = rideCurrency(ride);
            await paymentAlerts.raise("extended_trip_unanswered", d.id, {
              title: "Extended trip miles not answered (cash trip)",
              detail: `The trip ended ${miles(et.extraKm)} mi past the ` +
                "drop-off and the passenger didn't answer about the extra " +
                `${emailMoney(et.extra, currency)}. Nothing was collected.`,
              amount: et.extra, currency: currency.toUpperCase(),
              rideId: d.id, driverId: ride.driverId || null,
              fleetId: ride.fleetId || null,
            });
          }
        } else if (et.state === "approved" || et.state === "charging") {
          await settle(d.id);
        } else {
          await d.ref.update({"extendedTrip.dueAt": FieldValue.delete()});
        }
      } catch (error) {
        console.error("Extended trip sweep", d.id, error.message);
      }
    }
    return snap.size;
  }
  out.sweep = sweep;

  return {settle, sweep, functions: {
    answerExtendedTrip: out.answerExtendedTrip,
    decideExtendedTrip: out.decideExtendedTrip,
  }};
};
