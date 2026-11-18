"use strict";

/* ======================================
   PAY BY CARD INSTEAD OF CASH
   M&S, 18 Nov 2026: a passenger booked a trip as cash, has none at the end
   and wants to pay by card instead of finding a cashpoint.

   Two ways in, sharing one payment slot per ride (rides/{id}.paymentSwitch):

   1. The passenger, in the app ("Pay by card instead"), from pickup until
      cardSwitch.windowMinutes after the trip. Stripe's payment sheet on
      their own phone: a saved card, Google Pay (Apple Pay once a merchant
      ID is set up for the app) or a new card, with any 3D Secure check done
      there, on-session.
      - During the trip it is a hold (manual capture) for the fare so far:
        the booked fare, any destination change already accepted, and the
        waiting at pickup. Once Stripe has it, the ride becomes a card ride:
        paymentMethod "card", the hold as its paymentIntentId, paymentStatus
        "authorized". From there it is paid exactly as any card ride:
        another destination change raises the hold (destinationChange.js),
        chargeOnRideCompletion captures the final fare the server works out
        (extended trip, ended early, waiting) and charges any rest, the
        driver's wallet is credited as on any card job (no new fee), and a
        cancellation releases the hold. So the driver sees "Paid by card"
        during the trip, and nothing new decides the final amount.
      - After the trip it is a charge for the fare the server settled at
        completion (fare.finalTotal, once paymentStatus is "cash").
   2. The driver ("Customer wants to pay by card"), when the passenger can't
      use the app: once the trip is complete, a Stripe Checkout page for
      fare.finalTotal. The driver's screen shows a QR code for
      admin.takearoute.ltd/p/{token} (the dashboard's PayPage, which sends
      the customer on to Stripe), and the link is texted to the mobile the
      trip was booked for, else the passenger's, else a UK mobile the driver
      types in (three texts a ride at most).

   A payment counts only once the server has seen it at Stripe: through the
   Stripe webhook, or by asking Stripe when the apps check
   (cardSwitchStatus) or the page loads. Never on a phone's word.

   Never paid twice:
   - Starting an attempt first closes the open one (cancels its
     PaymentIntent, expires its Checkout page). If that one had been paid,
     it stands and the new one is refused. Two starts at once: the second
     is told to wait (state "starting").
   - Cash recorded (cashCollected) closes any card attempt, and a card
     payment that still lands afterwards is released or refunded. Once a
     card is held or charged, firestore.rules stops a driver's app, old
     ones included, from recording cash.

   Settings, config/app cardSwitch: enabled (1), windowMinutes (30),
   fleetJobs (0). With fleetJobs 0 taxi firm jobs are refused: phone and
   web bookings, and company drivers' app trips (fleetId), whose money goes
   through the fleet's books. With 1, a company driver's app trip is paid
   into the fleet's wallet like its other card trips, and a phone job (by
   link only: there is no app passenger) is settled like a firm's online
   booking (fleetWeb.js takePayment): the fleet's wallet, less Stripe's fee.

   rides/{id} fields, written here only (firestore.rules):
     paymentSwitch  {n, state: "starting" | "pending" | "held" | "paid" |
                    "failed" | "expired" | "cancelled", method: "app" |
                    "link", from: "cash", amount, hold, intentId, sessionId,
                    linkToken, linkExpiresAt, startedAt, by, at, cardLast4,
                    cardBrand, error, endedBy}
     cardLinkTexts  texts with a payment link sent for this ride
   cardLinks/{token}  {rideId, n, expiresAt}: the page's key (server only)
   ====================================== */

const crypto = require("crypto");
const makeQr = require("qrcode-generator");

const BASE = process.env.WEB_BOOKER_BASE || "https://admin.takearoute.ltd";
// Stripe keeps a Checkout page open for at least 30 minutes.
const LINK_MINUTES = 30;
// A start that died before saving what it made is free again after this.
const STARTING_MS = 20 * 1000;
const MAX_TEXTS = 3;
// Stripe will not take less than about 30p.
const MIN_AMOUNT = 0.3;
const DONE = ["held", "paid"];
const OPEN = ["starting", "pending"];

module.exports = (deps) => {
  const {functions, db, stripe, STRIPE_SECRETS, TWILIO_SECRETS, sendPush,
    loadAppConfig, toMillis, rideCurrency, emailMoney, computeWaitingCharge,
    ensureStripeCustomer, phoneFor, toE164, shared, paymentAlerts} = deps;
  const {HttpsError} = functions.https;
  const {FieldValue, Timestamp} = require("firebase-admin/firestore");
  const out = {};
  const SECRETS = STRIPE_SECRETS.concat(TWILIO_SECRETS || []);

  const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
  const pence = (n) => Math.round(Number(n || 0) * 100);
  const rideRef = (id) => db.collection("rides").doc(id);
  const isUkMobile = (p) => /^\+447\d{9}$/.test(String(p || ""));
  const short = (p) => String((p && p.address) || "").split(",")[0]
      .slice(0, 40);
  const idOf = (v) => (v && typeof v === "object" ? v.id : v) || null;

  /* ------------------------------ rules ------------------------------ */

  /**
   * A job paid through a taxi firm's books: a phone or web booking, or a
   * company driver's app trip.
   * @param {Object} ride Ride data.
   * @return {boolean} Fleet job.
   */
  function fleetJob(ride) {
    return Boolean(ride.fleetId) || ride.source === "phone";
  }

  /**
   * Why this ride can't be paid by card instead now, or null.
   * @param {?Object} ride Ride data.
   * @param {Object} cfg App config.
   * @param {string} method "app" or "link".
   * @return {?Object} {why, retry?} for the person asking.
   */
  function refusal(ride, cfg, method) {
    if (cfg.cardSwitch.enabled !== 1) {
      return {why: "Paying by card instead of cash is switched off at " +
        "the moment."};
    }
    if (!ride) return {why: "Trip not found."};
    if (ride.paymentMethod !== "cash" ||
        ["account", "card", "online"].includes(ride.collectBy)) {
      return {why: "This trip isn't paid in cash."};
    }
    if (fleetJob(ride) && cfg.cardSwitch.fleetJobs !== 1) {
      return {why: "Card payment instead of cash isn't available on taxi " +
        "firm jobs yet."};
    }
    if (method === "app" && ride.source === "phone") {
      return {why: "This trip has no app passenger."};
    }
    if (ride.cashCollected === true) {
      return {why: "The driver has already taken cash for this trip."};
    }
    if (ride.status === "ongoing" && method === "app") return null;
    if (ride.status === "ongoing") {
      return {why: "Complete the trip first, so the final fare is known."};
    }
    if (ride.status !== "completed") {
      return {why: "Card payment instead of cash is for trips under way " +
        "or just finished."};
    }
    const ended = toMillis(ride.completedAt) || 0;
    if (Date.now() - ended > cfg.cardSwitch.windowMinutes * 60000) {
      return {why: "It's too late to pay by card for this trip. Please " +
        "pay the driver in cash."};
    }
    if (ride.paymentStatus === "no_charge") {
      return {why: "There's nothing to pay on this trip."};
    }
    if (ride.paymentStatus !== "cash") {
      return {why: "The final fare is still being worked out. Try again " +
        "in a moment.", retry: true};
    }
    return null;
  }

  /**
   * What the passenger pays by card: during the trip the fare so far, after
   * it the final fare the server settled at completion.
   * @param {Object} ride Ride data.
   * @param {Object} cfg App config.
   * @return {number} Pounds.
   */
  function amountFor(ride, cfg) {
    const fare = ride.fare || {};
    if (ride.status === "completed") return r2(fare.finalTotal);
    return r2(Number(fare.total || 0) +
      computeWaitingCharge(ride, cfg.waiting));
  }

  /**
   * The ride's payment state for the apps and the page.
   * @param {Object} ride Ride data.
   * @param {Object=} extra More to say.
   * @return {Object} {state, method, amount, ...}
   */
  function view(ride, extra = {}) {
    const ps = ride.paymentSwitch || {};
    return Object.assign({
      state: ps.state || null,
      method: ps.method || null,
      amount: ps.amount || null,
      currency: rideCurrency(ride).toUpperCase(),
      cardLast4: ps.cardLast4 || null,
      error: ps.error || null,
      cashCollected: ride.cashCollected === true,
    }, extra);
  }

  /* ------------------------------ Stripe ----------------------------- */

  /**
   * The card a PaymentIntent was paid with, when Stripe sent it.
   * @param {Object} pi PaymentIntent, payment_method expanded or not.
   * @return {Object} {cardLast4, cardBrand}
   */
  function cardOf(pi) {
    const pm = pi && pi.payment_method;
    const card = pm && typeof pm === "object" ? pm.card : null;
    return {cardLast4: card ? card.last4 || null : null,
      cardBrand: card ? card.brand || null : null};
  }

  /**
   * Gives a payment back: releases a hold, refunds a charge. Never throws.
   * @param {string} rideId Ride.
   * @param {Object} pi PaymentIntent.
   * @param {string} reason Why, for the log and the office.
   * @return {Promise<void>}
   */
  async function giveBack(rideId, pi, reason) {
    try {
      if (pi.status === "requires_capture") {
        await stripe.paymentIntents.cancel(pi.id);
      } else if (pi.status === "succeeded") {
        await stripe.refunds.create({payment_intent: pi.id},
            {idempotencyKey: `switch_refund_${pi.id}`});
        await paymentAlerts.raise("card_switch_refunded", rideId, {
          title: "Card payment refunded: the trip was already paid",
          detail: `A card payment instead of cash came in after the trip ` +
            `was paid (${reason}), so it was refunded.`,
          amount: (Number(pi.amount) || 0) / 100,
          currency: String(pi.currency || "gbp").toUpperCase(),
          rideId, paymentIntentId: pi.id,
        }).catch(() => null);
      }
      console.log("Card switch given back", rideId, pi.id, reason);
    } catch (error) {
      console.error("Card switch give back failed", rideId, pi.id,
          error.message);
      await paymentAlerts.raise("card_switch_give_back_failed", rideId, {
        title: "Card payment to give back by hand",
        detail: `${reason}: ${String(error.message).slice(0, 200)}`,
        amount: (Number(pi.amount) || 0) / 100,
        currency: String(pi.currency || "gbp").toUpperCase(),
        rideId, paymentIntentId: pi.id,
      }).catch(() => null);
    }
  }

  /**
   * Where an attempt stands at Stripe.
   * @param {Object} ps paymentSwitch.
   * @return {Promise<Object>} {paid?: PaymentIntent, open?: boolean,
   *     expired?: boolean, declined?: string}
   */
  async function lookUp(ps) {
    if (ps.method === "link" && ps.sessionId) {
      const cs = await stripe.checkout.sessions.retrieve(ps.sessionId,
          {expand: ["payment_intent.payment_method"]});
      const pi = cs.payment_intent && typeof cs.payment_intent === "object" ?
        cs.payment_intent : null;
      if (cs.status === "complete" && cs.payment_status === "paid") {
        return {paid: pi || await stripe.paymentIntents.retrieve(
            idOf(cs.payment_intent), {expand: ["payment_method"]})};
      }
      const err = pi && pi.last_payment_error;
      return {open: cs.status === "open", expired: cs.status === "expired",
        declined: err ? err.message || "Card declined." : null};
    }
    if (ps.intentId) {
      const pi = await stripe.paymentIntents.retrieve(ps.intentId,
          {expand: ["payment_method"]});
      if (["requires_capture", "succeeded"].includes(pi.status)) {
        return {paid: pi};
      }
      const err = pi.last_payment_error;
      return {open: pi.status !== "canceled",
        declined: err ? err.message || "Card declined." : null};
    }
    return {open: false};
  }

  /**
   * Closes an open attempt so it can no longer be paid. If it was paid
   * meanwhile, says so instead.
   * @param {Object} ps paymentSwitch.
   * @return {Promise<?Object>} The PaymentIntent if it was paid, else null.
   */
  async function close(ps) {
    for (let i = 0; i < 2; i++) {
      const now = await lookUp(ps);
      if (now.paid) return now.paid;
      if (!now.open) return null;
      try {
        if (ps.method === "link") {
          await stripe.checkout.sessions.expire(ps.sessionId);
        } else {
          await stripe.paymentIntents.cancel(ps.intentId);
        }
        return null;
      } catch (error) {
        // Paid (or closed) between the look and the cancel: look again.
        console.log("Card switch close", ps.method, error.message);
      }
    }
    return null;
  }

  /* --------------------------- settling ------------------------------ */

  /**
   * Fields that make a finished cash ride paid by card. A phone job is
   * settled like a taxi firm's online booking; an app ride like a card
   * ride, which credits the driver's (or fleet's) wallet through
   * creditDriverWalletOnRideCompletion.
   * @param {Object} ride Ride data.
   * @param {Object} pi PaymentIntent (succeeded).
   * @param {Object} card From cardOf.
   * @return {Object} Update.
   */
  function paidFields(ride, pi, card) {
    const amount = (Number(pi.amount_received || pi.amount) || 0) / 100;
    const common = {
      "paymentMethod": "card",
      "paymentSwitch.state": "paid",
      "paymentSwitch.at": FieldValue.serverTimestamp(),
      "paymentSwitch.intentId": pi.id,
      "paymentSwitch.amount": amount,
      "paymentSwitch.cardLast4": card.cardLast4,
      "paymentSwitch.cardBrand": card.cardBrand,
      "paymentSwitch.error": null,
      "cardLast4": card.cardLast4,
      "cardBrand": card.cardBrand,
    };
    if (ride.source === "phone") {
      // fleetWeb.js shape; the fleet's wallet is credited by creditFleet.
      return Object.assign(common, {
        "collectBy": "online",
        "webPayment": {status: "captured", intentId: pi.id, amount,
          capturedAmount: amount, capturedAt: Timestamp.now(),
          via: "card_switch"},
        "payment.status": "captured",
      });
    }
    return Object.assign(common, {
      "paymentIntentId": pi.id,
      "paymentStatus": "captured",
    });
  }

  /**
   * A phone job paid by card instead: the fare goes to the fleet's wallet
   * less Stripe's fee, as with its online bookings (fleetWeb.js). Once.
   * @param {string} rideId Ride.
   * @param {Object} ride Ride data.
   * @param {Object} pi PaymentIntent (succeeded).
   * @return {Promise<void>}
   */
  async function creditFleet(rideId, ride, pi) {
    let bt = null;
    try {
      const full = await stripe.paymentIntents.retrieve(pi.id,
          {expand: ["latest_charge.balance_transaction"]});
      bt = full.latest_charge && full.latest_charge.balance_transaction;
    } catch (error) {
      console.error("Card switch fee look-up", rideId, error.message);
    }
    const amount = (Number(pi.amount_received || pi.amount) || 0) / 100;
    const feePence = bt && Number.isFinite(Number(bt.fee)) ? Number(bt.fee) :
      Math.round(amount * 100 * 0.015 + 20);
    const fee = Math.round(feePence) / 100;
    const walletRef = db.collection("fleetWallets").doc(ride.fleetId);
    const txRef = walletRef.collection("transactions").doc(`web_${rideId}`);
    const feeRef = walletRef.collection("transactions")
        .doc(`webfee_${rideId}`);
    await db.runTransaction(async (tx) => {
      if ((await tx.get(txRef)).exists) return;
      tx.set(walletRef, {
        availableBalance: FieldValue.increment(r2(amount - fee)),
        totalWebCardFares: FieldValue.increment(amount),
        totalCardFees: FieldValue.increment(fee),
        updatedAt: FieldValue.serverTimestamp()}, {merge: true});
      tx.set(txRef, {type: "web_card_fare", amount, rideId,
        driverId: ride.driverId || null, paymentIntentId: pi.id,
        description: "Cash job paid by card instead",
        createdAt: FieldValue.serverTimestamp()});
      tx.set(feeRef, {type: "card_fee", amount: -fee, rideId,
        paymentIntentId: pi.id, estimated: !bt,
        description: "Card payment fee (Stripe) for that job",
        createdAt: FieldValue.serverTimestamp()});
      tx.update(rideRef(rideId), {"webPayment.cardFee": fee});
    });
  }

  /**
   * Records a card payment Stripe has confirmed, once, whoever reports it
   * first (webhook, an app's check, the page). Safe to call again.
   * @param {string} rideId Ride.
   * @param {Object} pi PaymentIntent, status requires_capture or succeeded.
   * @return {Promise<Object>} view() of the ride afterwards.
   */
  async function settle(rideId, pi) {
    const meta = pi.metadata || {};
    if (meta.type !== "card_switch" || meta.rideId !== rideId ||
        !["requires_capture", "succeeded"].includes(pi.status)) {
      const snap = await rideRef(rideId).get();
      return snap.exists ? view(snap.data()) : {state: null};
    }
    const card = cardOf(pi);
    const n = Number(meta.n) || 0;
    const ref = rideRef(rideId);
    const res = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return {undo: "no ride"};
      const ride = snap.data();
      const ps = ride.paymentSwitch || {};
      const mine = ps.n === n;
      if (DONE.includes(ps.state)) {
        return mine ? {ride} : {ride, undo: "already paid by card"};
      }
      if (ride.cashCollected === true) {
        if (mine) {
          tx.update(ref, {"paymentSwitch.state": "cancelled",
            "paymentSwitch.endedBy": "cash"});
        }
        return {ride, undo: "cash already taken"};
      }
      if (["cancelled", "canceled"].includes(ride.status)) {
        // The passenger ended the trip early: for a moment it reads
        // cancelled, then chargeTripEndedEarly completes it at the fare so
        // far, and this payment is taken then (cardSwitchUpdates).
        if (ride.endedEarly === true && ride.cancelledBy === "rider") {
          return {ride, wait: true};
        }
        return {ride, undo: "trip cancelled"};
      }
      // An older attempt paid after a newer one began: it stands, and the
      // newer one is closed. Either way one payment, never two.
      const closeAlso = !mine && OPEN.includes(ps.state) ? ps : null;
      const base = mine ? {} : {
        "paymentSwitch.n": n, "paymentSwitch.method": meta.method || "app",
        "paymentSwitch.hold": pi.status === "requires_capture",
        "paymentSwitch.from": "cash",
        "paymentSwitch.sessionId": null, "paymentSwitch.linkToken": null,
      };
      if (pi.status === "requires_capture") {
        if (ride.status === "completed") return {ride, captureNow: true};
        if (ride.status !== "ongoing") return {ride, undo: "trip not live"};
        // The ride becomes a card ride: chargeOnRideCompletion takes it.
        tx.update(ref, Object.assign(base, {
          "paymentMethod": "card",
          "paymentIntentId": pi.id,
          "paymentStatus": "authorized",
          "paymentSwitch.state": "held",
          "paymentSwitch.at": FieldValue.serverTimestamp(),
          "paymentSwitch.intentId": pi.id,
          "paymentSwitch.amount": (Number(pi.amount) || 0) / 100,
          "paymentSwitch.cardLast4": card.cardLast4,
          "paymentSwitch.cardBrand": card.cardBrand,
          "paymentSwitch.error": null,
          "cardLast4": card.cardLast4,
          "cardBrand": card.cardBrand,
        }));
        tx.set(db.collection("payments").doc(pi.id), {
          rideId, riderId: ride.riderId || null,
          driverId: ride.driverId || null, stripePaymentIntentId: pi.id,
          amount: Number(pi.amount) || 0, currency: rideCurrency(ride),
          status: "authorized", type: "card_switch",
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        return {ride, state: "held", closeAlso};
      }
      if (ride.status !== "completed") {
        return {ride, undo: "charged before the trip ended"};
      }
      tx.update(ref, Object.assign(base, paidFields(ride, pi, card)));
      tx.set(db.collection("payments").doc(pi.id), {
        rideId, riderId: ride.riderId || null,
        driverId: ride.driverId || null, stripePaymentIntentId: pi.id,
        amount: Number(pi.amount_received || pi.amount) || 0,
        currency: rideCurrency(ride), status: "captured",
        type: "card_switch", transactionId: pi.id,
        capturedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return {ride, state: "paid", closeAlso};
    });

    if (res.wait) {
      return view(res.ride, {state: "pending"});
    } else if (res.undo) {
      await giveBack(rideId, pi, res.undo);
    } else if (res.captureNow) {
      return captureLateHold(rideId, pi);
    } else if (res.state) {
      if (res.closeAlso) await close(res.closeAlso).catch(() => null);
      const ride = res.ride;
      if (res.state === "paid" && ride.source === "phone" && ride.fleetId) {
        await creditFleet(rideId, ride, pi).catch(async (error) => {
          console.error("Card switch fleet credit", rideId, error.message);
          await paymentAlerts.raise("wallet_credit_failed", rideId, {
            title: "Paid by card, but the fleet's wallet was not credited",
            detail: String(error.message).slice(0, 300),
            amount: (Number(pi.amount) || 0) / 100,
            currency: rideCurrency(ride).toUpperCase(),
            rideId, driverId: ride.driverId || null,
            fleetId: ride.fleetId, paymentIntentId: pi.id,
          }).catch(() => null);
        });
      }
      if (ride.driverId) {
        const amount = emailMoney((Number(pi.amount) || 0) / 100,
            rideCurrency(ride));
        await sendPush([ride.driverId], {
          channelId: "trip-updates",
          data: {type: "trip", rideId},
          title: "Paid by card",
          body: res.state === "held" ?
            "The passenger is paying by card instead of cash. Don't take " +
            "cash: the fare is charged to their card when the trip ends." :
            `The passenger paid ${amount} by card. Don't take cash.`,
        }).catch(() => null);
      }
      console.log("Card switch", res.state, rideId, pi.id);
    }
    const snap = await ref.get();
    return view(snap.data());
  }

  /**
   * A hold the passenger confirmed only after the driver had completed the
   * trip: take the final fare from it once the server has settled it, or
   * release it if the final fare is more than it holds (they can try
   * again, for the final fare).
   * @param {string} rideId Ride.
   * @param {Object} pi PaymentIntent (requires_capture).
   * @return {Promise<Object>} view()
   */
  async function captureLateHold(rideId, pi) {
    const snap = await rideRef(rideId).get();
    const ride = snap.data();
    if (ride.paymentStatus !== "cash") {
      // Not settled yet; the paymentStatus change brings it back here
      // (cardSwitchUpdates), as does the next check.
      return view(ride, {state: "pending"});
    }
    const want = pence(ride.fare && ride.fare.finalTotal);
    if (want <= 0 || want > Number(pi.amount)) {
      await stripe.paymentIntents.cancel(pi.id).catch(() => null);
      await rideRef(rideId).update({"paymentSwitch.state": "failed",
        "paymentSwitch.error": "The fare went up at the end of the trip. " +
          "Please try again."});
      return view((await rideRef(rideId).get()).data());
    }
    let captured;
    try {
      captured = await stripe.paymentIntents.capture(pi.id,
          {amount_to_capture: want}, {idempotencyKey: `switch_cap_${pi.id}`});
    } catch (error) {
      console.error("Card switch late capture", rideId, error.message);
      await rideRef(rideId).update({"paymentSwitch.state": "failed",
        "paymentSwitch.error": "Your card payment didn't go through."});
      return view((await rideRef(rideId).get()).data());
    }
    return settle(rideId, Object.assign({}, captured, {
      payment_method: pi.payment_method, amount_received: want,
      amount: want, status: "succeeded"}));
  }

  /**
   * Asks Stripe about the open attempt and settles it if it was paid.
   * @param {string} rideId Ride.
   * @param {Object} ride Ride data.
   * @return {Promise<Object>} view()
   */
  async function check(rideId, ride) {
    const ps = ride.paymentSwitch || {};
    if (ps.state !== "pending") return view(ride);
    const now = await lookUp(ps);
    if (now.paid) return settle(rideId, now.paid);
    if (now.expired) {
      await rideRef(rideId).update({"paymentSwitch.state": "expired"});
      return view((await rideRef(rideId).get()).data());
    }
    return view(ride, {declined: now.declined || null});
  }

  /* --------------------------- starting ------------------------------ */

  /**
   * Takes the ride's payment slot for a new attempt, closing the open one
   * first. Throws a refusal the app can show.
   * @param {string} rideId Ride.
   * @param {string} method "app" or "link".
   * @param {string} uid Caller.
   * @param {Object} cfg App config.
   * @return {Promise<Object>} {ride, n, amount} or {done: view} when it is
   *     already paid by card, or {reuse: paymentSwitch} for an open attempt
   *     of the same kind and amount.
   */
  async function claim(rideId, method, uid, cfg) {
    const ref = rideRef(rideId);
    const first = await ref.get();
    const ride0 = first.exists ? first.data() : null;
    mustBeParty(ride0, uid, method);
    const ps0 = ride0.paymentSwitch || {};
    if (DONE.includes(ps0.state)) return {done: view(ride0)};
    // Refused before anything open is touched: a driver asking too early
    // must not close the passenger's payment.
    const why0 = refusal(ride0, cfg, method);
    if (why0) throw new HttpsError("failed-precondition", why0.why, why0);
    if (ps0.state === "pending") {
      const same = ps0.method === method &&
        ps0.amount === amountFor(ride0, cfg) &&
        ps0.hold === (ride0.status !== "completed");
      const now = await lookUp(ps0);
      if (now.paid) {
        const v = await settle(rideId, now.paid);
        if (DONE.includes(v.state)) return {done: v};
      } else if (same && now.open && !now.expired) {
        return {reuse: ps0, ride: ride0};
      } else if (now.open) {
        const paid = await close(ps0);
        if (paid) {
          const v = await settle(rideId, paid);
          if (DONE.includes(v.state)) return {done: v};
        }
      }
    }
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const ride = snap.data();
      const ps = ride.paymentSwitch || {};
      if (DONE.includes(ps.state)) return {done: view(ride)};
      const why = refusal(ride, cfg, method);
      if (why) throw new HttpsError("failed-precondition", why.why, why);
      const fresh = Date.now() - (toMillis(ps.startedAt) || 0) < STARTING_MS;
      if ((ps.state === "starting" && fresh) ||
          (ps.state === "pending" && ps.n !== ps0.n)) {
        throw new HttpsError("aborted", method === "link" ?
          "The passenger is paying in the app. Wait a moment, then try " +
          "again." : "A card payment for this trip has just started. " +
          "Wait a moment, then try again.", {retry: true});
      }
      const amount = amountFor(ride, cfg);
      if (!(amount >= MIN_AMOUNT)) {
        throw new HttpsError("failed-precondition",
            "There's nothing to pay by card on this trip.");
      }
      const n = (Number(ps.n) || 0) + 1;
      tx.update(ref, {paymentSwitch: {n, state: "starting", method,
        from: "cash", amount, hold: ride.status !== "completed",
        intentId: null, sessionId: null, linkToken: null,
        startedAt: Timestamp.now(), by: uid, error: null}});
      return {ride, n, amount};
    });
  }

  /**
   * Saves what a start made at Stripe, unless the attempt was replaced
   * meanwhile (then it is closed again).
   * @param {string} rideId Ride.
   * @param {number} n Attempt.
   * @param {Object} fields paymentSwitch fields to set.
   * @param {Object} made {method, intentId?, sessionId?} to close if late.
   * @return {Promise<boolean>} Saved.
   */
  async function saveStart(rideId, n, fields, made) {
    const ref = rideRef(rideId);
    const saved = await db.runTransaction(async (tx) => {
      const ps = (await tx.get(ref)).data().paymentSwitch || {};
      if (ps.n !== n || ps.state !== "starting") return false;
      const update = {"paymentSwitch.state": "pending"};
      Object.keys(fields).forEach((k) => {
        update[`paymentSwitch.${k}`] = fields[k];
      });
      tx.update(ref, update);
      return true;
    });
    if (!saved) await close(made).catch(() => null);
    return saved;
  }

  /**
   * Throws unless the caller is this ride's passenger (app) or driver
   * (link, status, cancel).
   * @param {?Object} ride Ride data.
   * @param {string} uid Caller.
   * @param {string} as "app", "link" or "either".
   */
  function mustBeParty(ride, uid, as) {
    const rider = ride && ride.riderId === uid;
    const driver = ride && ride.driverId === uid;
    const ok = as === "app" ? rider : as === "link" ? driver :
      rider || driver;
    if (!ok) throw new HttpsError("permission-denied", "Not your trip.");
  }

  /**
   * The signed-in caller's uid.
   * @param {Object} context Callable context.
   * @return {string} uid.
   */
  function caller(context) {
    if (!context.auth) {
      throw new HttpsError("unauthenticated", "Please sign in.");
    }
    return context.auth.uid;
  }

  const rideIdOf = (data) => {
    const id = data && typeof data.rideId === "string" ? data.rideId : "";
    if (!id || id.length > 128) {
      throw new HttpsError("invalid-argument", "Missing trip.");
    }
    return id;
  };

  /* ---------------------- 1. in the passenger's app ------------------- */

  /* "Pay by card instead": a PaymentIntent for Stripe's payment sheet on
     the passenger's phone. A hold during the trip, a charge after it. */
  out.cardSwitchStart = functions.runWith({secrets: STRIPE_SECRETS}).https
      .onCall(async (data, context) => {
        const uid = caller(context);
        const rideId = rideIdOf(data);
        const cfg = await loadAppConfig();
        const got = await claim(rideId, "app", uid, cfg);
        if (got.done) return got.done;
        const customer = await ensureStripeCustomer(uid);
        const keyVersion = (typeof stripe.getApiField === "function" &&
          stripe.getApiField("version")) || "2026-03-25.dahlia";
        const ephemeralKey = await stripe.ephemeralKeys.create({customer},
            {apiVersion: keyVersion});

        if (got.reuse) {
          const pi = await stripe.paymentIntents.retrieve(got.reuse.intentId);
          return Object.assign(view(got.ride), {state: "pending",
            clientSecret: pi.client_secret, customerId: customer,
            ephemeralKey: ephemeralKey.secret, hold: got.reuse.hold});
        }

        const {ride, n, amount} = got;
        const hold = ride.status !== "completed";
        let pi;
        try {
          pi = await stripe.paymentIntents.create({
            amount: pence(amount),
            currency: rideCurrency(ride),
            customer,
            // Cards only, which takes in Apple Pay and Google Pay: a hold
            // needs a method that can be captured later.
            payment_method_types: ["card"],
            capture_method: hold ? "manual" : "automatic",
            description: `TakeARoute trip ${rideId}, paid by card instead ` +
              "of cash",
            metadata: {type: "card_switch", method: "app", rideId,
              n: String(n), riderId: uid, driverId: ride.driverId || ""},
          }, {idempotencyKey: `switch_${rideId}_${n}`});
        } catch (error) {
          console.error("Card switch start", rideId, error.message);
          await rideRef(rideId).update({"paymentSwitch.state": "failed",
            "paymentSwitch.error": "Card payment isn't working just now."})
              .catch(() => null);
          throw new HttpsError("unavailable", "Card payment isn't working " +
            "just now. Please pay the driver in cash.");
        }
        const saved = await saveStart(rideId, n, {intentId: pi.id},
            {method: "app", intentId: pi.id});
        if (!saved) {
          throw new HttpsError("aborted", "Something changed on this trip. " +
            "Please try again.", {retry: true});
        }
        const fresh = (await rideRef(rideId).get()).data();
        return Object.assign(view(fresh), {clientSecret: pi.client_secret,
          customerId: customer, ephemeralKey: ephemeralKey.secret, hold});
      });

  /* ----------------------- 2. the driver's link ---------------------- */

  /**
   * The mobile the payment link is texted to.
   * @param {string} rideId Ride.
   * @param {Object} ride Ride data.
   * @param {*} typed A number the driver typed, if any.
   * @return {Promise<?string>} UK mobile, E.164.
   */
  async function mobileFor(rideId, ride, typed) {
    if (typed) return toE164(typed);
    if (ride.source === "phone") {
      return toE164(ride.customer && ride.customer.phone);
    }
    const pf = ride.passengerFor;
    if (pf && pf.hasPhone === true) {
      const c = await rideRef(rideId).collection("contact").doc("passenger")
          .get().catch(() => null);
      const phone = c && c.exists ? toE164(c.data().phone) : null;
      if (phone) return phone;
    }
    return ride.riderId ? phoneFor("riders", ride.riderId).catch(() => null) :
      null;
  }

  /**
   * Texts the payment link. At most MAX_TEXTS a ride.
   * @param {string} rideId Ride.
   * @param {Object} ride Ride data.
   * @param {string} phone UK mobile.
   * @param {string} url Link.
   * @param {number} amount Pounds.
   * @return {Promise<boolean>} Sent.
   */
  async function textLink(rideId, ride, phone, url, amount) {
    if (!isUkMobile(phone) || !shared || !shared.sendText) return false;
    const ref = rideRef(rideId);
    const ok = await db.runTransaction(async (tx) => {
      const used = Number((await tx.get(ref)).data().cardLinkTexts) || 0;
      if (used >= MAX_TEXTS) return false;
      tx.update(ref, {cardLinkTexts: used + 1});
      return true;
    });
    if (!ok) return false;
    let from = {name: "TakeARoute"};
    if (ride.source === "phone" && ride.fleetId) {
      const f = await db.collection("fleets").doc(ride.fleetId).get()
          .catch(() => null);
      from = f && f.exists ? f.data() : {name: ride.fleetName || "TakeARoute"};
    }
    const money = emailMoney(amount, rideCurrency(ride));
    return shared.sendText(from, phone, `${from.name || "TakeARoute"}: ` +
      `pay your taxi fare of ${money} by card here: ${url}`)
        .catch(() => false);
  }

  /**
   * The QR code for a link, as rows of 0 and 1 the app draws.
   * @param {string} url Link.
   * @return {Array<string>} Rows.
   */
  function qrRows(url) {
    const qr = makeQr(0, "M");
    qr.addData(url);
    qr.make();
    const size = qr.getModuleCount();
    const rows = [];
    for (let r = 0; r < size; r++) {
      let row = "";
      for (let c = 0; c < size; c++) row += qr.isDark(r, c) ? "1" : "0";
      rows.push(row);
    }
    return rows;
  }

  /* "Customer wants to pay by card": a Stripe Checkout page for the final
     fare, a QR code for the driver's screen and a text to the passenger.
     Again on the same open page: the same link (and a text only when
     asked, resend: true, or to a new number). */
  out.cardLinkStart = functions.runWith({secrets: SECRETS}).https
      .onCall(async (data, context) => {
        const uid = caller(context);
        const rideId = rideIdOf(data);
        const typed = data && data.phone ? String(data.phone).slice(0, 20) :
          null;
        if (typed && !isUkMobile(toE164(typed))) {
          throw new HttpsError("invalid-argument",
              "Enter a UK mobile number, for example 07700 900123.");
        }
        const cfg = await loadAppConfig();
        const got = await claim(rideId, "link", uid, cfg);
        if (got.done) return got.done;

        let ps;
        let ride;
        // A new link is texted straight away; the same one again only when
        // asked, or to a number the driver typed.
        let wantText = (data && data.resend === true) || Boolean(typed);
        if (got.reuse) {
          ps = got.reuse;
          ride = got.ride;
        } else {
          ride = got.ride;
          const {n, amount} = got;
          const token = crypto.randomBytes(16).toString("base64url");
          const expiresAt = Date.now() + LINK_MINUTES * 60000;
          const meta = {type: "card_switch", method: "link", rideId,
            n: String(n), driverId: uid};
          let cs;
          try {
            cs = await stripe.checkout.sessions.create({
              mode: "payment",
              payment_method_types: ["card"],
              line_items: [{quantity: 1, price_data: {
                currency: rideCurrency(ride),
                unit_amount: pence(amount),
                product_data: {name: `Taxi fare${ride.fleetName ?
                  ` with ${ride.fleetName}` : ""}`,
                description: `From ${short(ride.pickupLocation) ||
                  "pickup"} to ${short(ride.dropoffLocation) ||
                  "drop-off"}`},
              }}],
              payment_intent_data: {description: `Taxi trip ${rideId}, ` +
                "paid by card instead of cash", metadata: meta},
              metadata: meta,
              client_reference_id: rideId,
              expires_at: Math.floor(expiresAt / 1000),
              success_url: `${BASE}/p/${token}?paid=1`,
              cancel_url: `${BASE}/p/${token}`,
            }, {idempotencyKey: `switch_link_${rideId}_${n}`});
          } catch (error) {
            console.error("Card link start", rideId, error.message);
            await rideRef(rideId).update({"paymentSwitch.state": "failed",
              "paymentSwitch.error": "Card payment isn't working just now."})
                .catch(() => null);
            throw new HttpsError("unavailable", "Card payment isn't working " +
              "just now. Please take cash.");
          }
          await db.collection("cardLinks").doc(token).set({rideId, n,
            expiresAt, createdAt: Date.now()});
          const fields = {sessionId: cs.id, linkToken: token,
            linkExpiresAt: expiresAt};
          const saved = await saveStart(rideId, n, fields,
              {method: "link", sessionId: cs.id});
          if (!saved) {
            throw new HttpsError("aborted", "Something changed on this " +
              "trip. Please try again.", {retry: true});
          }
          ps = Object.assign({n, amount, method: "link"}, fields);
          wantText = true;
        }

        const url = `${BASE}/p/${ps.linkToken}`;
        let texted = false;
        let textedTo = null;
        if (wantText) {
          const phone = await mobileFor(rideId, ride, typed);
          texted = await textLink(rideId, ride, phone, url, ps.amount);
          textedTo = texted ? phone.slice(-3) : null;
        }
        const fresh = (await rideRef(rideId).get()).data();
        return Object.assign(view(fresh), {url, qr: qrRows(url), texted,
          textedTo, textsLeft: Math.max(0, MAX_TEXTS -
            (Number(fresh.cardLinkTexts) || 0)),
          expiresAt: ps.linkExpiresAt || null});
      });

  /* ---------------------------- checks -------------------------------- */

  /* Where the card payment stands, asked of Stripe: the driver's "Waiting
     for payment…" and the passenger's app after the payment sheet. */
  out.cardSwitchStatus = functions.runWith({secrets: STRIPE_SECRETS}).https
      .onCall(async (data, context) => {
        const uid = caller(context);
        const rideId = rideIdOf(data);
        const snap = await rideRef(rideId).get();
        const ride = snap.exists ? snap.data() : null;
        mustBeParty(ride, uid, "either");
        return check(rideId, ride);
      });

  /* Stop the card payment: the passenger closed it, or the driver takes
     cash instead (cash: true, after the trip; during it the driver records
     cash by completing as usual). A payment already made stands. */
  out.cardSwitchCancel = functions.runWith({secrets: STRIPE_SECRETS}).https
      .onCall(async (data, context) => {
        const uid = caller(context);
        const rideId = rideIdOf(data);
        const cash = data && data.cash === true;
        const ref = rideRef(rideId);
        const ride = (await ref.get()).data() || null;
        mustBeParty(ride, uid, cash ? "link" : "either");
        const ps = ride.paymentSwitch || {};
        if (DONE.includes(ps.state)) return view(ride);
        if (OPEN.includes(ps.state)) {
          const paid = await close(ps);
          if (paid) {
            const v = await settle(rideId, paid);
            if (DONE.includes(v.state)) return v;
          }
        }
        await db.runTransaction(async (tx) => {
          const r = (await tx.get(ref)).data();
          const p = r.paymentSwitch || {};
          if (DONE.includes(p.state)) return;
          const update = {};
          if (p.n && p.n === ps.n && OPEN.includes(p.state)) {
            update["paymentSwitch.state"] = "cancelled";
            update["paymentSwitch.endedBy"] = cash ? "cash" : uid ===
              r.riderId ? "passenger" : "driver";
          }
          if (cash) {
            if (r.status !== "completed" || r.paymentMethod !== "cash") {
              throw new HttpsError("failed-precondition", "Record cash when " +
                "you complete the trip.");
            }
            update.cashCollected = true;
          }
          if (Object.keys(update).length) tx.update(ref, update);
        });
        return view((await ref.get()).data());
      });

  /* ------------------------------ the page --------------------------- */

  /* admin.takearoute.ltd/p/{token}: what to pay and the Stripe page to pay
     on. Asks Stripe each time, so coming back from paying shows it paid. */
  out.cardLinkPage = functions.runWith({secrets: STRIPE_SECRETS}).https
      .onCall(async (data) => {
        const token = data && typeof data.token === "string" ? data.token : "";
        const link = /^[A-Za-z0-9_-]{22}$/.test(token) ?
          await db.collection("cardLinks").doc(token).get() : null;
        if (!link || !link.exists) {
          throw new HttpsError("not-found", "This payment link isn't valid.");
        }
        const {rideId, n} = link.data();
        const snap = await rideRef(rideId).get();
        let ride = snap.exists ? snap.data() : null;
        if (!ride) throw new HttpsError("not-found", "Trip not found.");
        const ps = ride.paymentSwitch || {};
        let state = ps.n === n ? ps.state : "replaced";
        if (state === "pending") {
          state = (await check(rideId, ride)).state;
          ride = (await rideRef(rideId).get()).data();
        }
        let payUrl = null;
        if (state === "pending" && ride.paymentSwitch.sessionId) {
          const cs = await stripe.checkout.sessions.retrieve(
              ride.paymentSwitch.sessionId);
          payUrl = cs.status === "open" ? cs.url : null;
          if (!payUrl) state = "expired";
        }
        // A newer link, or the passenger paid in the app: paid is paid.
        if (state === "replaced" && DONE.includes(ps.state)) state = "paid";
        return {
          state: state === "held" ? "paid" : state,
          amount: ps.n === n || DONE.includes(ps.state) ? ps.amount : null,
          currency: rideCurrency(ride).toUpperCase(),
          name: ride.source === "phone" ? ride.fleetName || "" : "TakeARoute",
          pickup: short(ride.pickupLocation),
          dropoff: short(ride.dropoffLocation),
          cardLast4: DONE.includes(ps.state) ? ps.cardLast4 || null : null,
          payUrl,
        };
      });

  /* ------------------------------ Stripe ----------------------------- */

  /**
   * Card switch events from stripeWebhook (index.js). Never throws.
   * @param {Object} event Verified Stripe event.
   * @return {Promise<boolean>} It was one of ours.
   */
  out.onStripeEvent = async (event) => {
    const obj = (event && event.data && event.data.object) || {};
    const meta = obj.metadata || {};
    if (meta.type !== "card_switch" || !meta.rideId) return false;
    try {
      if (["checkout.session.completed",
        "checkout.session.async_payment_succeeded"].includes(event.type)) {
        if (obj.payment_status === "paid" && obj.payment_intent) {
          const pi = await stripe.paymentIntents.retrieve(
              idOf(obj.payment_intent), {expand: ["payment_method"]});
          await settle(meta.rideId, pi);
        }
      } else if (["payment_intent.succeeded",
        "payment_intent.amount_capturable_updated"].includes(event.type)) {
        // The payment_method on an event is only an id: fetch the card.
        const pi = await stripe.paymentIntents.retrieve(obj.id,
            {expand: ["payment_method"]});
        await settle(meta.rideId, pi);
      } else if (event.type === "checkout.session.expired") {
        await db.runTransaction(async (tx) => {
          const ref = rideRef(meta.rideId);
          const ps = ((await tx.get(ref)).data() || {}).paymentSwitch || {};
          if (ps.state === "pending" && ps.sessionId === obj.id) {
            tx.update(ref, {"paymentSwitch.state": "expired"});
          }
        });
      }
    } catch (error) {
      console.error("Card switch webhook", event.type, meta.rideId,
          error.message);
    }
    return true;
  };

  /* --------------------------- ride changes -------------------------- */

  /* Cash recorded or the trip cancelled: the open card attempt is closed,
     so it can't be paid as well. A hold the passenger confirmed after the
     driver completed is taken once the final fare is settled. */
  out.cardSwitchUpdates = functions.runWith({secrets: STRIPE_SECRETS})
      .firestore.document("rides/{rideId}")
      .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();
        const ps = after.paymentSwitch;
        const rideId = context.params.rideId;
        const cancelled = ["cancelled", "canceled"];
        // Ended early by the passenger reads cancelled for a moment, then
        // is completed at the fare so far: not a cancellation here.
        const endedEarly = before.status === "ongoing" &&
          after.endedEarly === true && after.cancelledBy === "rider";
        // A hold taken during the trip is charged (or released) by the
        // usual card code; the switch record just follows it.
        if (ps && ps.state === "held") {
          const was = before.paymentStatus;
          const update = after.paymentStatus === "captured" &&
            was !== "captured" ? {"paymentSwitch.state": "paid",
              "paymentSwitch.amount": r2(Number(after.fare &&
                after.fare.finalTotal) - Number(after.fare &&
                after.fare.cashExtra || 0)),
              "paymentSwitch.at": FieldValue.serverTimestamp()} :
            after.paymentStatus === "failed" && was !== "failed" ?
            {"paymentSwitch.state": "failed", "paymentSwitch.error":
              "The card payment didn't go through at the end of the trip."} :
            cancelled.includes(after.status) &&
            !cancelled.includes(before.status) && !endedEarly ?
            {"paymentSwitch.state": "cancelled",
              "paymentSwitch.endedBy": "cancelled"} : null;
          if (update) await change.after.ref.update(update).catch(() => null);
          return null;
        }
        if (!ps || !OPEN.includes(ps.state)) return null;
        const cashNow = after.cashCollected === true &&
          before.cashCollected !== true;
        const endedNow = cancelled.includes(after.status) &&
          !cancelled.includes(before.status) && !endedEarly;
        try {
          if (cashNow || endedNow) {
            const paid = ps.state === "pending" ? await close(ps) : null;
            if (paid) {
              await settle(rideId, paid); // gives it back: cash or cancelled
            } else {
              await rideRef(rideId).update({"paymentSwitch.state": "cancelled",
                "paymentSwitch.endedBy": cashNow ? "cash" : "cancelled"});
            }
          } else if (after.paymentStatus === "cash" &&
              before.paymentStatus !== "cash" && ps.state === "pending" &&
              ps.hold) {
            await check(rideId, after);
          }
        } catch (error) {
          console.error("Card switch ride change", rideId, error.message);
        }
        return null;
      });

  out.functions = {
    cardSwitchStart: out.cardSwitchStart,
    cardLinkStart: out.cardLinkStart,
    cardSwitchStatus: out.cardSwitchStatus,
    cardSwitchCancel: out.cardSwitchCancel,
    cardLinkPage: out.cardLinkPage,
    cardSwitchUpdates: out.cardSwitchUpdates,
  };
  out.settle = settle;
  return out;
};
