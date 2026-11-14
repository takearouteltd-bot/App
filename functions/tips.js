"use strict";

/* Tips: after a trip the passenger is asked whether they want to tip the
   driver (app: utils/tips.js, RiderRideCompletedScreen, trip details).

   - Settings, config/app tips: enabled, three preset amounts (preset1-3),
     maxAmount, and windowHours after the trip in which a tip can be left.
   - tipDriver {rideId, amount} charges the passenger's saved card off
     session, for card and cash trips alike, once per ride. Phone bookings
     have no passenger account, so they never get here.
   - The driver gets all of it, in their own wallet (driverWallets/{id}).
     A company driver's app trip (ride.fleetId, tagFleetRides in fleet.js)
     is the exception: their card fares go to the fleet's wallet and they
     cannot withdraw from the app (the fleet pays them), so their tip goes
     there too, as a "driver_tip" entry naming the driver, for the fleet to
     pass on in full.
   - rides/{id}.tip {status: "pending" | "paid", amount, currency,
     paymentIntentId, at}. Only this file writes it (firestore.rules).
     "pending" holds the ride while the card is charged, so a second tap or
     a second phone cannot tip twice. A pending tip left behind by a crash
     can be tried again after a few minutes; Stripe's idempotency key makes
     that the same charge, not a new one. */

module.exports = (deps) => {
  const {functions, db, stripe, STRIPE_SECRETS, sendPush, loadAppConfig,
    toMillis, rideCurrency, emailMoney} = deps;
  const {HttpsError} = functions.https;
  const {FieldValue} = require("firebase-admin/firestore");
  const out = {};

  const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
  // A pending tip this old was left by a run that died mid-way.
  const STALE_PENDING_MS = 5 * 60 * 1000;
  // Stripe will not take less than about 30p; a tip below 50p is a mistake.
  const MIN_TIP = 0.5;

  /**
   * Why this ride cannot be tipped now, or null when it can.
   * @param {Object} ride Ride data.
   * @param {string} uid Caller.
   * @param {Object} cfg App config.
   * @return {?string} Sentence for the passenger.
   */
  function refusal(ride, uid, cfg) {
    if (!ride || ride.riderId !== uid) return "This is not your trip.";
    if (ride.status !== "completed") {
      return "You can tip once the trip has finished.";
    }
    if (!ride.driverId) return "This trip has no driver to tip.";
    const ended = toMillis(ride.completedAt);
    const windowMs = cfg.tips.windowHours * 3600 * 1000;
    if (ended && Date.now() - ended > windowMs) {
      return "It is too late to tip for this trip.";
    }
    const tip = ride.tip || null;
    if (tip && tip.status === "paid") {
      return "You have already tipped for this trip. Thank you!";
    }
    if (tip && tip.status === "pending" &&
        Date.now() - (toMillis(tip.at) || 0) < STALE_PENDING_MS) {
      return "Your tip is already on its way.";
    }
    return null;
  }

  out.tipDriver = functions
      .runWith({secrets: STRIPE_SECRETS})
      .https.onCall(async (data, context) => {
        if (!context.auth) {
          throw new HttpsError("unauthenticated", "Please sign in.");
        }
        const uid = context.auth.uid;
        const rideId = data && typeof data.rideId === "string" ?
          data.rideId : "";
        const amount = round2(data && data.amount);
        if (!rideId) throw new HttpsError("invalid-argument", "Missing ride.");

        const cfg = await loadAppConfig();
        if (cfg.tips.enabled !== 1) {
          throw new HttpsError("failed-precondition",
              "Tips are switched off at the moment.");
        }
        if (!(amount >= MIN_TIP) || amount > cfg.tips.maxAmount) {
          throw new HttpsError("invalid-argument",
              `A tip can be from ${emailMoney(MIN_TIP, cfg.currency)} to ` +
              `${emailMoney(cfg.tips.maxAmount, cfg.currency)}.`);
        }

        // The passenger's saved card, checked before the ride is held.
        const rider = await db.collection("riders").doc(uid).get();
        const r = rider.exists ? rider.data() : {};
        if (!r.stripeCustomerId || !r.defaultPaymentMethodId) {
          throw new HttpsError("failed-precondition",
              "Add a card to tip your driver.", {reason: "no_card"});
        }

        // Hold the ride: one tip per trip.
        const rideRef = db.collection("rides").doc(rideId);
        const held = await db.runTransaction(async (tx) => {
          const snap = await tx.get(rideRef);
          const ride = snap.exists ? snap.data() : null;
          const why = refusal(ride, uid, cfg);
          if (why) return {why};
          tx.update(rideRef, {tip: {status: "pending", amount,
            currency: rideCurrency(ride).toUpperCase(),
            at: FieldValue.serverTimestamp()}});
          return {ride};
        });
        if (held.why) throw new HttpsError("failed-precondition", held.why);
        const ride = held.ride;
        const currency = rideCurrency(ride);

        let intent;
        try {
          intent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100),
            currency,
            customer: r.stripeCustomerId,
            payment_method: r.defaultPaymentMethodId,
            confirm: true,
            off_session: true,
            description: "Tip for your TakeARoute driver",
            metadata: {rideId, riderId: uid, driverId: ride.driverId,
              type: "tip"},
            // Per ride, amount and card: a retry of the same tip is the same
            // charge, and a declined card does not make a new card fail too.
          }, {idempotencyKey: `tip_${rideId}_${Math.round(amount * 100)}_` +
            r.defaultPaymentMethodId});
        } catch (error) {
          console.error("Tip charge failed:", rideId, error.message);
          await rideRef.update({tip: FieldValue.delete()}).catch(() => null);
          const code = error && (error.code || (error.raw && error.raw.code));
          throw new HttpsError("failed-precondition",
            code === "authentication_required" ?
              "Your bank wants to confirm this payment, which can't be " +
              "done here. Try another card." :
              "Your card was declined. Try another card.");
        }
        if (intent.status !== "succeeded") {
          // Off-session confirm either succeeds or throws; anything else is
          // not money the driver can be given.
          console.error("Tip not succeeded:", rideId, intent.status);
          await rideRef.update({tip: FieldValue.delete()}).catch(() => null);
          throw new HttpsError("failed-precondition",
              "The tip did not go through. Please try again.");
        }

        // All of it to the driver's own wallet, once (the wallet entry's id
        // is the ride's, and the ride must still be pending).
        const driverId = ride.driverId;
        const fleetId = ride.fleetId || null;
        const walletRef = fleetId ?
          db.collection("fleetWallets").doc(fleetId) :
          db.collection("driverWallets").doc(driverId);
        const entryRef = walletRef.collection("transactions")
            .doc(`tip_${rideId}`);
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(rideRef);
          const entry = await tx.get(entryRef);
          const now = FieldValue.serverTimestamp();
          tx.update(rideRef, {tip: {status: "paid", amount,
            currency: currency.toUpperCase(), paymentIntentId: intent.id,
            paidTo: fleetId ? "fleet" : "driver", at: now}});
          if (entry.exists || !snap.exists) return;
          tx.set(walletRef, {
            availableBalance: FieldValue.increment(amount),
            totalEarned: FieldValue.increment(amount),
            totalTips: FieldValue.increment(amount),
            updatedAt: now,
          }, {merge: true});
          tx.set(entryRef, {
            type: fleetId ? "driver_tip" : "tip",
            amount,
            rideId,
            driverId,
            paymentIntentId: intent.id,
            status: "cleared",
            description: fleetId ?
              "Tip for your driver: pass it on in full" :
              "Tip from your passenger",
            createdAt: now,
          });
        });

        await sendPush([driverId], {
          title: `You got a ${emailMoney(amount, currency.toUpperCase())} tip`,
          body: fleetId ?
            `Your passenger tipped you. ${ride.fleetName || "Your fleet"} ` +
            "pays it to you with your fares." :
            "Your passenger tipped you for the trip. It's in your balance.",
          channelId: "general",
          data: {type: "tip", rideId},
        }).catch(() => null);
        console.log(`Tip ${amount} on ${rideId} for ${driverId}`);
        return {paid: true, amount};
      });

  return {functions: out};
};
