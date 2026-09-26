const functions = require("firebase-functions");
const admin = require("firebase-admin");
const express = require("express");
const app = express();

// IMPORTANT for Stripe webhooks
app.use(express.raw({type: "application/json"}));

require("dotenv").config();

admin.initializeApp();
const db = admin.firestore();

/* ======================================
   STRIPE INIT
====================================== */
// Stripe's key lives in Google Secret Manager, like the Resend and Twilio
// ones. Every function that touches Stripe declares it below.
const STRIPE_SECRETS = ["STRIPE_SECRET_KEY"];

// The Stripe client is created on first use, not at load time, so the file
// can be analysed and deployed even when the key is only present at run time.
// The key comes from the STRIPE_SECRET_KEY secret, declared by each function
// that needs it.
let stripeClient = null;

/**
 * Returns the Stripe client, creating it on first use.
 * @return {Object} Stripe client.
 */
function getStripe() {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new functions.https.HttpsError("failed-precondition",
          "Payments are not configured. STRIPE_SECRET_KEY is missing.");
    }
    stripeClient = require("stripe")(key);
  }
  return stripeClient;
}

// Existing code calls stripe.xxx directly; this forwards each call lazily.
const stripe = new Proxy({}, {
  get: (target, prop) => getStripe()[prop],
});

/* ======================================
   ADMIN SETTINGS (config/app)
   Edited on the dashboard Settings page. Every value falls back to the
   number used before settings existed.
====================================== */
const CONFIG_DEFAULTS = {
  currency: "GBP",
  waiting: {freeMinutes: 5, ratePerMinute: 0.25, maxCharge: 10},
  subscription: {monthlyPrice: 99.99, graceDays: 3},
  drivers: {minimumPayout: 10},
  dispatch: {
    searchRadiusKm: 50, requestTimeoutSeconds: 20, searchTimeoutMinutes: 15,
  },
  cancellation: {fee: 0, freeMinutes: 2, driverSharePercent: 100},
};

/**
 * Reads one numeric setting with a fallback.
 * @param {Object} section The stored section, may be missing.
 * @param {string} key Field name.
 * @param {number} fallback Default value.
 * @return {number} The setting.
 */
function numSetting(section, key, fallback) {
  const value = section ? Number(section[key]) : NaN;
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Loads config/app with defaults filled in.
 * @return {Promise<Object>} Settings.
 */
async function loadAppConfig() {
  let data = {};
  try {
    const snap = await db.collection("config").doc("app").get();
    if (snap.exists) data = snap.data() || {};
  } catch (error) {
    console.error("Could not read config/app:", error);
  }
  const d = CONFIG_DEFAULTS;
  return {
    currency: typeof data.currency === "string" && data.currency ?
      data.currency.toUpperCase() : d.currency,
    waiting: {
      freeMinutes: numSetting(data.waiting, "freeMinutes",
          d.waiting.freeMinutes),
      ratePerMinute: numSetting(data.waiting, "ratePerMinute",
          d.waiting.ratePerMinute),
      maxCharge: numSetting(data.waiting, "maxCharge", d.waiting.maxCharge),
    },
    subscription: {
      monthlyPrice: numSetting(data.subscription, "monthlyPrice",
          d.subscription.monthlyPrice),
      graceDays: numSetting(data.subscription, "graceDays",
          d.subscription.graceDays),
    },
    drivers: {
      minimumPayout: numSetting(data.drivers, "minimumPayout",
          d.drivers.minimumPayout),
    },
    cancellation: {
      fee: numSetting(data.cancellation, "fee", d.cancellation.fee),
      freeMinutes: numSetting(data.cancellation, "freeMinutes",
          d.cancellation.freeMinutes),
      driverSharePercent: Math.min(100, numSetting(data.cancellation,
          "driverSharePercent", d.cancellation.driverSharePercent)),
    },
    dispatch: {
      searchRadiusKm: numSetting(data.dispatch, "searchRadiusKm",
          d.dispatch.searchRadiusKm),
      requestTimeoutSeconds: numSetting(data.dispatch,
          "requestTimeoutSeconds", d.dispatch.requestTimeoutSeconds),
      // How long a booking may keep looking for a driver before it is
      // cancelled for the passenger (expireSearchingRides).
      searchTimeoutMinutes: numSetting(data.dispatch,
          "searchTimeoutMinutes", d.dispatch.searchTimeoutMinutes),
    },
  };
}

/**
 * Stripe currency for a ride: the one it was booked in, else GBP.
 * @param {Object} ride Ride document.
 * @return {string} Lowercase ISO code.
 */
function rideCurrency(ride) {
  const fareCurrency = ride && ride.fare ? ride.fare.currency : null;
  const code = (ride && ride.currency) || fareCurrency || "gbp";
  return String(code).toLowerCase();
}

/**
 * Waiting charge between the driver arriving and the ride starting.
 * Same maths as waitingCharge() in the app's utils/appConfig.js.
 * @param {Object} ride Ride document with arrivedAt and startedAt.
 * @param {Object} fallback Waiting settings used if the ride has none.
 * @return {number} Charge in major units, e.g. 1.25.
 */
function computeWaitingCharge(ride, fallback) {
  if (!ride || !ride.arrivedAt || !ride.startedAt) return 0;
  const arrived = ride.arrivedAt.toMillis ?
    ride.arrivedAt.toMillis() : Number(ride.arrivedAt);
  const started = ride.startedAt.toMillis ?
    ride.startedAt.toMillis() : Number(ride.startedAt);
  if (!Number.isFinite(arrived) || !Number.isFinite(started)) return 0;

  const p = ride.waitingPolicy || {};
  const free = numSetting(p, "freeMinutes", fallback.freeMinutes);
  const rate = numSetting(p, "ratePerMinute", fallback.ratePerMinute);
  const max = numSetting(p, "maxCharge", fallback.maxCharge);

  const minutes = Math.max(0, started - arrived) / 60000;
  const chargeable = Math.max(0, Math.ceil(minutes - free));
  const charge = Math.min(chargeable * rate, max);
  return Math.round(charge * 100) / 100;
}
/**
 * Reads a Firestore timestamp or number as milliseconds.
 * @param {*} ts Timestamp, Date, number or nothing.
 * @return {?number} Milliseconds, or null.
 */
function toMillis(ts) {
  if (!ts) return null;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (ts instanceof Date) return ts.getTime();
  const n = Number(ts);
  return Number.isFinite(n) ? n : null;
}

/**
 * One calendar month on, clamped to the last day of the month, so
 * 31 January becomes 28 (or 29) February rather than 3 March.
 * @param {Date} date Start date.
 * @return {Date} A new Date one month later.
 */
function addOneMonth(date) {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d;
}

/**
 * The fee for a passenger cancelling this ride, in major units, or 0.
 * Same rule as utils/cancellation.js in the app, which warns the passenger
 * before they confirm: card rides only, cancelled by the passenger before
 * pickup, more than the free minutes after a driver accepted. The terms are
 * the ride's own (cancellationPolicy, saved at booking).
 * @param {Object} before Ride before the cancel.
 * @param {Object} after Ride after the cancel.
 * @return {number} Fee.
 */
function cancellationFee(before, after) {
  if (after.cancelledBy !== "rider" || after.endedEarly) return 0;
  if (after.paymentMethod === "cash") return 0;
  if (!["accepted", "arrived"].includes(before.status)) return 0;

  const policy = after.cancellationPolicy || {};
  const fee = numSetting(policy, "fee", 0);
  if (!(fee > 0)) return 0;

  const accepted = toMillis(after.acceptedAt);
  if (!accepted) return 0;
  const cancelled = toMillis(after.cancelledAt) || Date.now();
  const freeMs = numSetting(policy, "freeMinutes", 2) * 60000;
  return cancelled - accepted > freeMs ? Math.round(fee * 100) / 100 : 0;
}

/* ======================================
   CREATE STRIPE CUSTOMER
====================================== */
exports.createStripeCustomer = functions
    .runWith({secrets: STRIPE_SECRETS}).https.onCall(async (data, context) => {
      if (!context.auth) {
        throw new functions.https.HttpsError(
            "unauthenticated",
            "User not logged in",
        );
      }


      const uid = context.auth.uid;
      const email = data.email;

      if (!email) {
        throw new functions.https.HttpsError(
            "invalid-argument",
            "Missing email",
        );
      }

      try {
        const customer = await stripe.customers.create({
          email,
          metadata: {uid},
        });

        await db.collection("riders").doc(uid).set(
            {stripeCustomerId: customer.id},
            {merge: true},
        );

        return {success: true, customerId: customer.id};
      } catch (error) {
        console.error("createStripeCustomer error:", error);
        throw new functions.https.HttpsError("internal", error.message);
      }
    });

/* ======================================
   EXCHANGE PHONE AUTH -> CUSTOM TOKEN
   The phone OTP is sent/confirmed on the client via the NATIVE
   @react-native-firebase SDK (reCAPTCHA-free). But the rest of the
   app runs on the JS SDK. This verifies the native ID token and mints
   a JS-SDK custom token for the SAME uid so the two stay in sync.
====================================== */
exports.exchangePhoneAuthToken = functions.https.onCall(
    async (data, context) => {
      const idToken = data && data.idToken;

      if (!idToken) {
        throw new functions.https.HttpsError(
            "invalid-argument",
            "Missing idToken",
        );
      }

      try {
        const decoded = await admin.auth().verifyIdToken(idToken);

        // Only allow this bridge for genuine phone sign-ins.
        const isPhoneUser =
        (decoded.phone_number) ||
        (decoded.firebase &&
          decoded.firebase.sign_in_provider === "phone");

        if (!isPhoneUser) {
          throw new functions.https.HttpsError(
              "permission-denied",
              "Not a phone authentication token",
          );
        }

        const customToken = await admin.auth().createCustomToken(decoded.uid);

        return {token: customToken};
      } catch (error) {
        console.error("exchangePhoneAuthToken error:", error);

        if (error instanceof functions.https.HttpsError) {
          throw error;
        }

        throw new functions.https.HttpsError(
            "unauthenticated",
            "Invalid or expired token",
        );
      }
    },
);

/* ======================================
   CREATE SETUP INTENT
====================================== */
exports.createSetupIntent = functions
    .runWith({secrets: STRIPE_SECRETS}).https.onCall(async (data, context) => {
      if (!context.auth) {
        throw new functions.https.HttpsError(
            "unauthenticated",
            "User not logged in",
        );
      }

      const uid = context.auth.uid;

      try {
        // A driver-only account has no Stripe customer yet; make one the
        // first time they add a card (for their membership).
        const stripeCustomerId = await ensureStripeCustomer(uid);

        const setupIntent = await stripe.setupIntents.create({
          customer: stripeCustomerId,
          payment_method_types: ["card"],
        });

        return {clientSecret: setupIntent.client_secret};
      } catch (error) {
        console.error("createSetupIntent error:", error);
        throw new functions.https.HttpsError("internal", error.message);
      }
    });

/* ======================================
   SAVE CARD
====================================== */
exports.saveCard = functions
    .runWith({secrets: STRIPE_SECRETS}).https.onCall(async (data, context) => {
      if (!context.auth) {
        throw new functions.https.HttpsError(
            "unauthenticated",
            "User not logged in",
        );
      }

      const uid = context.auth.uid;
      const {paymentMethodId, cardholderName} = data;

      if (!paymentMethodId) {
        throw new functions.https.HttpsError(
            "invalid-argument",
            "Missing paymentMethodId",
        );
      }

      try {
        const riderRef = db.collection("riders").doc(uid);
        const riderDoc = await riderRef.get();

        if (!riderDoc.exists) {
          throw new functions.https.HttpsError("not-found", "Rider not found");
        }

        const stripeCustomerId = riderDoc.data().stripeCustomerId;

        if (!stripeCustomerId) {
          throw new functions.https.HttpsError(
              "failed-precondition",
              "Stripe customer missing",
          );
        }

        // =================================================
        // 1. Retrieve + attach payment method
        // =================================================
        const paymentMethod =
          await stripe.paymentMethods.retrieve(paymentMethodId);

        await stripe.paymentMethods.attach(paymentMethodId, {
          customer: stripeCustomerId,
        });

        // =================================================
        // 2. Set default payment method
        // =================================================
        await stripe.customers.update(stripeCustomerId, {
          invoice_settings: {
            default_payment_method: paymentMethodId,
          },
        });

        // =================================================
        // 3. STORE CARD IN FIRESTORE
        // =================================================
        await riderRef
            .collection("cards")
            .doc(paymentMethodId)
            .set({
              paymentMethodId,
              brand: paymentMethod.card.brand,
              last4: paymentMethod.card.last4,
              exp_month: paymentMethod.card.exp_month,
              exp_year: paymentMethod.card.exp_year,

              // 👇 IMPORTANT FIX
              cardholderName:
         cardholderName ||
(paymentMethod.billing_details &&
  paymentMethod.billing_details.name) ||
null,
            });

        // =================================================
        // 4. STORE DEFAULT CARD
        // =================================================
        await riderRef.set(
            {
              defaultPaymentMethodId: paymentMethodId,
            },
            {merge: true},
        );

        return {success: true};
      } catch (error) {
        console.error("saveCard error:", error);

        throw new functions.https.HttpsError(
            "internal",
            error.message || "Failed to save card",
        );
      }
    });

/* ======================================
   HOLD ON RIDE ACCEPTANCE
====================================== */

exports.authorizePaymentOnRideAccept = functions
    .runWith({secrets: STRIPE_SECRETS}).firestore
    .document("rides/{rideId}")
    .onUpdate(async (change, context) => {
      const before = change.before.data();
      const after = change.after.data();
      const rideId = context.params.rideId;

      // Trigger only when status changes to "accepted"
      if (before.status === "accepted" || after.status !== "accepted") {
        return null;
      }

      const riderId = after.riderId;
      const driverId = after.driverId;

      if (!riderId) return null;

      // Cash rides are paid to the driver in person: no card hold.
      if (after.paymentMethod === "cash") return null;

      // Re-dispatch: a driver gave the job back and another accepted it.
      // The card hold from the first accept is still valid, so reuse it
      // instead of placing a second hold on the passenger's card.
      if (after.paymentIntentId && after.paymentStatus === "authorized") {
        try {
          await db.collection("payments").doc(after.paymentIntentId).update({
            driverId: driverId || null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch (error) {
          console.error("Could not update payment driver:", error);
        }
        return null;
      }

      // A hold that fails must not leave the ride "accepted": the driver
      // would drive to a pickup that will never pay. The ride goes back to
      // searching without this driver, both sides are told, and the
      // passenger can add a card to keep searching.
      const attempt = Number(after.paymentAttempts) || 0;
      const failHold = async (reason) => {
        const rideRef = db.collection("rides").doc(rideId);
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(rideRef);
          if (!snap.exists) return;
          const ride = snap.data();
          // Only undo the accept this run was authorising.
          if (ride.status !== "accepted" || ride.driverId !== driverId) {
            return;
          }
          tx.update(rideRef, {
            status: "searching",
            driverId: null,
            acceptedAt: null,
            paymentStatus: "auth_failed",
            paymentFailure: {
              reason,
              at: admin.firestore.FieldValue.serverTimestamp(),
            },
            paymentAttempts: attempt + 1,
            declinedBy: driverId ?
              admin.firestore.FieldValue.arrayUnion(driverId) :
              ride.declinedBy || [],
            lastDriverCancelAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          if (driverId) {
            // Same release as when a driver gives a job back.
            tx.update(db.collection("drivers").doc(driverId), {
              isOnRide: false,
              currentRideId: null,
              status: "online",
            });
          }
        });
        await sendPush([riderId], {
          title: "Card declined",
          body: "Your card was declined. Add a card to keep searching.",
          channelId: "trip-updates",
          data: {type: "trip", rideId},
        }).catch(() => null);
        if (driverId) {
          await sendPush([driverId], {
            title: "Job cancelled",
            body: "Job cancelled: the passenger's payment failed.",
            channelId: "trip-updates",
            data: {type: "trip", rideId},
          }).catch(() => null);
        }
      };

      let stripeCustomerId = null;
      let defaultPaymentMethodId = null;
      try {
        const riderDoc = await db.collection("riders").doc(riderId).get();
        const rider = riderDoc.exists ? riderDoc.data() : {};
        stripeCustomerId = rider.stripeCustomerId || null;
        defaultPaymentMethodId = rider.defaultPaymentMethodId || null;
      } catch (error) {
        console.error("❌ Could not read rider for hold:", error);
        return null;
      }

      if (!stripeCustomerId || !defaultPaymentMethodId) {
        console.log("❌ Missing Stripe setup, undoing accept:", rideId);
        await failHold("no_card");
        return null;
      }

      const estimatedAmount = Math.round((after.fareEstimate || 0) * 100);
      if (estimatedAmount <= 0) return null;

      try {
        // =========================
        // CREATE PAYMENT INTENT
        // =========================
        // The key changes per attempt: Stripe replays a declined result
        // for a reused key, which would make a new card fail too.
        const paymentIntent = await stripe.paymentIntents.create(
            {
              amount: estimatedAmount,
              currency: rideCurrency(after),
              customer: stripeCustomerId,
              payment_method: defaultPaymentMethodId,
              capture_method: "manual",
              confirm: true,
              off_session: true,
              metadata: {
                rideId,
                riderId,
                driverId: driverId || "",
              },
            },
            {
              idempotencyKey: attempt ?
                `auth_${rideId}_${attempt}` : `auth_${rideId}`,
            },
        );

        const paymentIntentId = paymentIntent.id;

        // =========================
        // CREATE PAYMENT RECORD
        // =========================
        await db.collection("payments").doc(paymentIntentId).set({
          rideId,
          riderId,
          driverId: driverId || null,

          stripePaymentIntentId: paymentIntentId,

          amount: estimatedAmount,
          currency: rideCurrency(after),

          status: "authorized",

          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // =========================
        // UPDATE RIDE (MINIMAL)
        // =========================
        await db.collection("rides").doc(rideId).update({
          paymentIntentId,
          paymentStatus: "authorized",
          paymentFailure: admin.firestore.FieldValue.delete(),
        });

        console.log("✅ PAYMENT AUTHORIZED:", rideId);
        return null;
      } catch (error) {
        console.error("❌ AUTH FAILED:", rideId, error.message);
        await failHold(error.code || error.message || "declined");
        return null;
      }
    });

/* ======================================
   CHARGE ON RIDE COMPLETION
====================================== */

exports.chargeOnRideCompletion = functions
    .runWith({secrets: STRIPE_SECRETS}).firestore
    .document("rides/{rideId}")
    .onUpdate(async (change, context) => {
      const before = change.before.data();
      const after = change.after.data();
      const rideId = context.params.rideId;

      // Trigger only when completed
      if (before.status === "completed" || after.status !== "completed") {
        return null;
      }

      // Cash: nothing to charge. Record the final amount, waiting included,
      // so the receipt and the passenger's screen show what was paid.
      if (after.paymentMethod === "cash") {
        const cfg = await loadAppConfig();
        const waiting = computeWaitingCharge(after, cfg.waiting);
        const base = after.fare && after.fare.total ?
          Number(after.fare.total) : 0;
        await db.collection("rides").doc(rideId).update({
          "paymentStatus": "cash",
          "fare.waitingCharge": waiting,
          "fare.finalTotal": Math.round((base + waiting) * 100) / 100,
        });
        return null;
      }

      const paymentIntentId = after.paymentIntentId;

      if (!paymentIntentId) {
        // No card hold was ever placed (no card on file, or authorisation
        // did not run). Say so on the ride instead of leaving it "pending"
        // for ever, so the passenger and support can see it.
        console.log("❌ Missing paymentIntentId");
        await db.collection("rides").doc(rideId).update({
          paymentStatus: "failed",
          paymentError: "no_card_hold",
        });
        return null;
      }

      try {
      // =========================
      // MARK PROCESSING
      // =========================
        await db.collection("payments").doc(paymentIntentId).update({
          status: "processing",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        let finalAmount = 0;
        const baseTotal = after.fare && after.fare.total ?
          Number(after.fare.total) : 0;

        // Waiting time at pickup, charged per the ride's booking terms.
        const appConfig = await loadAppConfig();
        const waitingFee = computeWaitingCharge(after, appConfig.waiting);
        const finalTotal = Math.round((baseTotal + waitingFee) * 100) / 100;

        if (baseTotal > 0) {
          finalAmount = Math.round(finalTotal * 100);
        }

        if (finalAmount <= 0) {
          console.log("❌ Invalid final amount");
          return null;
        }

        const paymentIntent = await stripe.paymentIntents.retrieve(
            paymentIntentId,
            {expand: ["payment_method"]},
        );

        // The card actually charged, so the app and the emailed receipt can
        // both name it instead of guessing at the rider's current default.
        const chargedCard = paymentIntent.payment_method &&
          paymentIntent.payment_method.card ?
          paymentIntent.payment_method.card : null;
        const cardLast4 = chargedCard ? chargedCard.last4 : null;
        const cardBrand = chargedCard ? chargedCard.brand : null;

        let capturedIntent;
        let extraChargeFailed = false;
        let extraChargeError = null;

        // =========================
        // NORMAL CAPTURE
        // =========================
        if (finalAmount <= paymentIntent.amount) {
          capturedIntent = await stripe.paymentIntents.capture(
              paymentIntentId,
              {
                amount_to_capture: finalAmount,
              },
              {
                idempotencyKey: `capture_${rideId}`,
              },
          );
        } else {
        // =========================
        // OVERAGE HANDLING
        // =========================
          console.log("⚠️ Extra charge required");

          // Idempotent, so a retried run cannot capture twice.
          capturedIntent = await stripe.paymentIntents.capture(
              paymentIntentId,
              {amount_to_capture: paymentIntent.amount},
              {idempotencyKey: `capture_base_${rideId}`},
          );

          const extraAmount = finalAmount - paymentIntent.amount;
          const pm = paymentIntent.payment_method &&
            paymentIntent.payment_method.id ?
            paymentIntent.payment_method.id : paymentIntent.payment_method;

          try {
            const extra = await stripe.paymentIntents.create(
                {
                  amount: extraAmount,
                  currency: rideCurrency(after),
                  customer: paymentIntent.customer,
                  payment_method: pm,
                  confirm: true,
                  off_session: true,
                  metadata: {
                    rideId,
                    type: "extra_charge",
                  },
                },
                {
                  idempotencyKey: `extra_${rideId}`,
                },
            );
            capturedIntent = extra;
          } catch (extraError) {
            // The hold amount was taken; only the waiting charge failed.
            // Never mark a ride the passenger paid for as failed.
            console.error("⚠️ Extra charge failed:", rideId,
                extraError.message);
            extraChargeFailed = true;
            extraChargeError = extraError.message || "declined";
            finalAmount = paymentIntent.amount;
          }
        }

        // =========================
        // UPDATE PAYMENT SUCCESS
        // =========================
        await db.collection("payments").doc(paymentIntentId).update({
          status: "captured",
          amount: finalAmount,
          transactionId: capturedIntent.id,
          extraChargeFailed,
          extraChargeError,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // =========================
        // UPDATE RIDE (UI ONLY)
        // =========================
        // If the extra charge failed, the total actually taken is the
        // hold amount, and the waiting charge is recorded as unpaid.
        await db.collection("rides").doc(rideId).update({
          "paymentStatus": "captured",
          "fare.waitingCharge": waitingFee,
          "fare.finalTotal": extraChargeFailed ?
            Math.round(finalAmount) / 100 : finalTotal,
          "extraChargeFailed": extraChargeFailed,
          "extraChargeError": extraChargeError,
          "cardLast4": cardLast4,
          "cardBrand": cardBrand,
        });

        console.log("✅ PAYMENT CAPTURED:", rideId);
        return null;
      } catch (error) {
        console.error("❌ PAYMENT FAILED:", error);

        await db.collection("payments").doc(paymentIntentId).update({
          status: "failed",
          error: error.message,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        await db.collection("rides").doc(rideId).update({
          paymentStatus: "failed",
        });

        return null;
      }
    });


exports.stripeWebhook = functions
    .runWith({secrets: STRIPE_SECRETS.concat(["STRIPE_WEBHOOK_SECRET"])})
    .https.onRequest(async (req, res) => {
      const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

      let event;

      try {
        const sig = req.headers["stripe-signature"];

        event = stripe.webhooks.constructEvent(
            req.rawBody,
            sig,
            endpointSecret,
        );
      } catch (err) {
        console.log("❌ Signature verification failed:", err.message);
        return res.status(400).send("Webhook Error");
      }

      try {
        const type = event.type;
        const data = event.data;
        const object = data.object;

        // Safely extract rideId WITHOUT optional chaining
        let rideId = null;

        if (object.metadata && object.metadata.rideId) {
          rideId = object.metadata.rideId;
        }

        switch (type) {
          // ===========================
          // PAYMENT SUCCESS
          // ===========================
          case "payment_intent.succeeded": {
            if (!rideId) break;

            // Deliberately does NOT touch walletProcessed. That field is the
            // guard creditDriverWalletOnRideCompletion uses to decide whether
            // the driver has already been paid for this ride. Stripe fires
            // this webhook off the same capture that sets paymentStatus, so
            // whichever landed first won: if the webhook won, the credit
            // function saw walletProcessed already true and skipped, and the
            // driver was never paid for a ride the passenger was charged for.
            await db.collection("rides").doc(rideId).update({
              "payment.status": "paid",
              "payment.transactionId": object.id,
            });

            console.log("✅ Payment succeeded:", rideId);
            break;
          }

          // ===========================
          // PAYMENT FAILED
          // ===========================
          case "payment_intent.payment_failed": {
            if (!rideId) break;

            let errorMessage = "Payment failed";

            if (
              object.last_payment_error &&
          object.last_payment_error.message
            ) {
              errorMessage = object.last_payment_error.message;
            }

            await db.collection("rides").doc(rideId).update({
              "payment.status": "failed",
              "payment.error": errorMessage,
            });

            console.log("❌ Payment failed:", rideId);
            break;
          }

          // ===========================
          // PAYMENT CANCELED
          // ===========================
          case "payment_intent.canceled": {
            if (!rideId) break;

            await db.collection("rides").doc(rideId).update({
              "payment.status": "canceled",
            });

            console.log("🧯 Payment canceled:", rideId);
            break;
          }

          // ===========================
          // CAPTURABLE UPDATED
          // ===========================
          case "payment_intent.amount_capturable_updated": {
            console.log("📌 Capturable updated:", object.id);
            break;
          }

          default:
            console.log("Unhandled event:", type);
        }

        return res.json({received: true});
      } catch (error) {
        console.error("❌ Webhook error:", error);
        return res.status(500).send("Webhook failed");
      }
    });


exports.cancelRidePayment = functions
    .runWith({secrets: STRIPE_SECRETS}).firestore
    .document("rides/{rideId}")
    .onUpdate(async (change, context) => {
      const before = change.before.data();
      const after = change.after.data();
      const rideId = context.params.rideId;

      // The app writes "cancelled", Stripe uses "canceled". Accept both.
      const cancelWords = ["canceled", "cancelled"];
      if (cancelWords.includes(before.status) ||
          !cancelWords.includes(after.status)) {
        return null;
      }

      const paymentIntentId = after.paymentIntentId;
      if (!paymentIntentId) return null;

      // A late cancel by the passenger: capture the fee from the hold and
      // release the rest, then pay the driver their share.
      const fee = cancellationFee(before, after);
      if (fee > 0) {
        try {
          const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
          const feeMinor = Math.min(Math.round(fee * 100), intent.amount);
          await stripe.paymentIntents.capture(paymentIntentId,
              {amount_to_capture: feeMinor},
              {idempotencyKey: `cancel_fee_${rideId}`});

          const charged = feeMinor / 100;
          const policy = after.cancellationPolicy || {};
          const sharePct = Math.min(100,
              numSetting(policy, "driverSharePercent", 100));
          const driverShare = Math.round(charged * sharePct) / 100;

          await db.collection("payments").doc(paymentIntentId).update({
            status: "captured",
            amount: feeMinor,
            type: "cancellation_fee",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          await db.collection("rides").doc(rideId).update({
            paymentStatus: "cancellation_fee",
            cancellationFee: charged,
            cancellationFeeDriverShare: driverShare,
          });

          const driverId = after.driverId;
          if (driverId && driverShare > 0) {
            const walletRef = db.collection("driverWallets").doc(driverId);
            await db.runTransaction(async (tx) => {
              const rideRef = db.collection("rides").doc(rideId);
              const rideSnap = await tx.get(rideRef);
              const paid = rideSnap.exists &&
                rideSnap.data().cancellationFeePaid;
              if (paid) return;
              const walletSnap = await tx.get(walletRef);
              if (walletSnap.exists) {
                tx.update(walletRef, {
                  availableBalance:
                    admin.firestore.FieldValue.increment(driverShare),
                  totalEarned:
                    admin.firestore.FieldValue.increment(driverShare),
                  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
              } else {
                tx.set(walletRef, {
                  availableBalance: driverShare,
                  totalEarned: driverShare,
                  pendingBalance: 0,
                  currency: rideCurrency(after).toUpperCase(),
                  walletStatus: "active",
                  createdAt: admin.firestore.FieldValue.serverTimestamp(),
                  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
              }
              tx.set(walletRef.collection("transactions").doc(), {
                type: "cancellation_fee",
                amount: driverShare,
                rideId,
                paymentIntentId,
                status: "cleared",
                description: "Cancellation fee for ride " + rideId,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
              });
              tx.update(db.collection("rides").doc(rideId),
                  {cancellationFeePaid: true});
            });
          }
          console.log("💷 Cancellation fee taken:", rideId, charged);
          return null;
        } catch (error) {
          // Fall through and release the hold: better no fee than a stuck one.
          console.error("❌ Cancellation fee failed, releasing hold:", error);
        }
      }

      try {
      // 1. Cancel Stripe hold
        await stripe.paymentIntents.cancel(paymentIntentId);

        // 2. Update payments collection
        await db.collection("payments").doc(paymentIntentId).update({
          status: "canceled",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log("🧯 Payment canceled:", rideId);
        return null;
      } catch (error) {
        console.error("❌ Cancel failed:", error);
        return null;
      }
    });

exports.createStripeAccountLink = functions
    .runWith({secrets: STRIPE_SECRETS}).https.onRequest(
        async (req, res) => {
          try {
            res.set("Content-Type", "application/json");

            // -----------------------------
            // AUTH CHECK
            // -----------------------------
            const authHeader = req.headers.authorization;

            if (!authHeader) {
              return res.status(401).json({
                error: "Missing Authorization header",
              });
            }

            const idToken = authHeader.split("Bearer ")[1];

            const decoded = await admin.auth().verifyIdToken(idToken);
            const uid = decoded.uid;

            // -----------------------------
            // GET DRIVER DATA
            // -----------------------------
            const driverRef = admin.firestore().collection("drivers").doc(uid);
            const driverSnap = await driverRef.get();

            const data = driverSnap.data() || {};
            let stripeAccountId = data.stripeAccountId || null;

            // -----------------------------
            // CREATE STRIPE ACCOUNT (FIXED FOR 400 ERROR)
            // -----------------------------
            if (!stripeAccountId) {
              console.log("Creating Stripe account...");

              const account = await stripe.accounts.create({
                type: "express",
                country: "GB", // REQUIRED for Stripe Connect
                email: decoded.email || undefined,
                capabilities: {
                  transfers: {requested: true},
                },
              });

              stripeAccountId = account.id;

              await driverRef.set(
                  {
                    stripeAccountId,
                  },
                  {merge: true},
              );

              console.log("Stripe account created:", stripeAccountId);
            }

            // -----------------------------
            // VALIDATE ACCOUNT ID
            // -----------------------------
            if (!stripeAccountId || typeof stripeAccountId !== "string") {
              throw new Error("Invalid Stripe account ID");
            }

            // -----------------------------
            // CREATE ONBOARDING LINK
            // -----------------------------
            const accountLink = await stripe.accountLinks.create({
              account: stripeAccountId,
              refresh_url: "https://takearoute-719df.web.app/stripe/refresh.html",
              return_url: "https://takearoute-719df.web.app/stripe/success.html",
              type: "account_onboarding",
            });

            if (!accountLink || !accountLink.url) {
              throw new Error("Stripe did not return onboarding URL");
            }

            // -----------------------------
            // SUCCESS RESPONSE
            // -----------------------------
            return res.status(200).json({
              url: accountLink.url,
            });
          } catch (error) {
            console.error("Stripe onboarding error:", error);

            return res.status(500).json({
              error: error.message || "Internal Server Error",
            });
          }
        },
    );

exports.createWalletOnOnboardingComplete = functions.firestore
    .document("drivers/{driverId}")
    .onUpdate(async (change, context) => {
      const before = change.before.data();
      const after = change.after.data();

      const driverId = context.params.driverId;

      if (
        before.onboardingComplete !== true &&
      after.onboardingComplete === true
      ) {
        const walletRef = admin.firestore()
            .collection("driverWallets")
            .doc(driverId);

        try {
          const currency = (await loadAppConfig()).currency;
          await walletRef.create({
            availableBalance: 0,
            pendingBalance: 0,
            currency,
            walletStatus: "active",
            totalEarned: 0,
            totalPaidOut: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch (error) {
        // already exists → ignore safely
          console.log("Wallet already exists for driver:", driverId);
        }
      }
    });


exports.creditDriverWalletOnRideCompletion = functions.firestore
    .document("rides/{rideId}")
    .onUpdate(async (change, context) => {
      const before = change.before.data();
      const after = change.after.data();
      const rideId = context.params.rideId;

      console.log("🔄 Checking ride:", rideId);

      const beforePaymentStatus = before && before.paymentStatus ?
      before.paymentStatus : null;
      const afterPaymentStatus = after && after.paymentStatus ?
      after.paymentStatus : null;

      const paymentJustCaptured =
      beforePaymentStatus !== "captured" &&
      afterPaymentStatus === "captured";

      const rideIsCompleted = after && after.status === "completed";
      const notProcessed = !(after && after.walletProcessed);

      console.log({
        beforePaymentStatus,
        afterPaymentStatus,
        paymentJustCaptured,
        rideIsCompleted,
        notProcessed,
      });

      if (!(paymentJustCaptured && rideIsCompleted && notProcessed)) {
        console.log("⛔ Conditions not met, skipping");
        return null;
      }

      const driverId = after && after.driverId ? after.driverId : null;
      if (!driverId) {
        console.error("❌ No driverId found on ride:", rideId);
        return null;
      }

      // Final total includes any waiting charge; older rides only have total.
      const driverEarning = after && after.fare ?
        Number(after.fare.finalTotal || after.fare.total || 0) : 0;
      if (driverEarning <= 0) {
        console.error("❌ Invalid fare amount:", driverEarning);
        return null;
      }

      const db = admin.firestore();
      const walletRef = db.collection("driverWallets").doc(driverId);
      const rideRef = db.collection("rides").doc(rideId);

      try {
        await db.runTransaction(async (transaction) => {
          // Re-read the ride inside the transaction. The walletProcessed check
          // above is on the trigger's snapshot, which is a point-in-time copy;
          // Cloud Functions delivers at least once, so two deliveries of the
          // same event can both see it false and both credit the driver. This
          // is the check that actually makes the credit happen once.
          const rideSnap = await transaction.get(rideRef);
          if (!rideSnap.exists || rideSnap.data().walletProcessed === true) {
            console.log("Wallet already credited for", rideId, "— skipping");
            return;
          }

          const walletSnap = await transaction.get(walletRef);

          if (!walletSnap.exists) {
            transaction.set(walletRef, {
              availableBalance: driverEarning,
              totalEarned: driverEarning,
              pendingBalance: 0,
              currency: rideCurrency(rideSnap.data()).toUpperCase(),
              walletStatus: "active",
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          } else {
            transaction.update(walletRef, {
              availableBalance: admin.firestore.FieldValue.
                  increment(driverEarning),
              totalEarned: admin.firestore.FieldValue.increment(driverEarning),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          }

          const walletTxRef = walletRef.collection("transactions").doc();
          transaction.set(walletTxRef, {
            type: "ride_earning",
            amount: driverEarning,
            rideId: rideId,
            paymentIntentId: after &&
            after.paymentIntentId ? after.paymentIntentId : null,
            status: "cleared",
            description: "Earnings from ride " + rideId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          transaction.update(rideRef, {
            "walletProcessed": true,
            "earnings.driverEarning": driverEarning,
            "earnings.creditedAt": admin.firestore.FieldValue.serverTimestamp(),
          });
        });

        console.log("✅ Wallet credited successfully:",
            rideId, "Amount:", driverEarning);
        return null;
      } catch (error) {
        console.error("❌ Wallet credit failed:", error);

        try {
          await db.collection("failedWalletCredits").add({
            rideId: rideId,
            driverId: driverId,
            amount: driverEarning,
            error: error.message,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch (logError) {
          console.error("❌ Failed to log failure:", logError);
        }

        return null;
      }
    });


exports.requestDriverPayout = functions.https.onCall(async (data, context) => {
  const {amount} = data;
  const driverId = context.auth ? context.auth.uid : null;

  // Must be authenticated
  if (!driverId) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }

  const requestedAmount = Number(amount);

  if (!requestedAmount || requestedAmount <= 0) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid amount");
  }

  // Minimum and currency set on the dashboard (Settings, Drivers / Currency).
  const appConfig = await loadAppConfig();
  const MIN_PAYOUT = appConfig.drivers.minimumPayout;
  if (requestedAmount < MIN_PAYOUT) {
    throw new functions.https.HttpsError("failed-precondition",
        "Minimum payout is " + MIN_PAYOUT.toFixed(2));
  }

  const walletRef = db.collection("driverWallets").doc(driverId);
  const driverRef = db.collection("drivers").doc(driverId);

  try {
    const result = await db.runTransaction(async (transaction) => {
      const walletSnap = await transaction.get(walletRef);
      const driverSnap = await transaction.get(driverRef);

      if (!walletSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Wallet not found");
      }

      if (!driverSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Driver not found");
      }

      const wallet = walletSnap.data();
      const driver = driverSnap.data();

      // Check sufficient balance
      if (wallet.availableBalance < requestedAmount) {
        throw new functions.https.HttpsError("failed-precondition",
            "Insufficient balance");
      }

      // Check bank details exist
      const accountDetails = driver.accountDetails || {};
      if (!accountDetails.sortCode || !accountDetails.accountNumber) {
        throw new functions.https.HttpsError("failed-precondition",
            "Bank details not provided");
      }

      const payoutId = db.collection("driverPayouts").doc().id;
      const payoutRef = db.collection("driverPayouts").doc(payoutId);
      const now = admin.firestore.FieldValue.serverTimestamp();

      // Deduct from available balance
      transaction.update(walletRef, {
        availableBalance: admin.firestore.FieldValue.
            increment(-requestedAmount),
        updatedAt: now,
      });

      // Create payout record
      transaction.set(payoutRef, {
        driverId: driverId,
        amount: requestedAmount,
        currency: appConfig.currency,
        status: "pending_admin",
        method: "bank_transfer",
        bankDetails: {
          accountHolder: accountDetails.accountHolder || "",
          accountNumber: accountDetails.accountNumber || "",
          sortCode: accountDetails.sortCode || "",
        },
        requestedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      // Add transaction record to wallet
      const walletTxRef = walletRef.collection("transactions").doc();
      transaction.set(walletTxRef, {
        type: "payout_request",
        amount: -requestedAmount,
        payoutId: payoutId,
        status: "pending",
        description: "Payout request #" + payoutId,
        createdAt: now,
      });

      return {payoutId: payoutId, amount:
        requestedAmount, status: "pending_admin"};
    });

    // Log for admin notification (replace with actual notification later)
    console.log("New payout request:", result.payoutId,
        "Driver:", driverId, "Amount:", requestedAmount);

    return result;
  } catch (error) {
    console.error("Payout request failed:", error);
    throw error;
  }
});

/* ======================================
   ADMIN GUARD
   Caller must have an active admins/{uid} document.
====================================== */
/**
 * Throws unless the caller is a signed-in, active admin.
 * @param {object} context Callable function context.
 * @return {Promise<string>} The admin uid.
 */
async function assertAdmin(context) {
  const uid = context.auth ? context.auth.uid : null;
  if (!uid) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }
  const adminDoc = await db.collection("admins").doc(uid).get();
  if (!adminDoc.exists || adminDoc.data().isActive !== true) {
    throw new functions.https.HttpsError("permission-denied", "Admin only");
  }
  return uid;
}

exports.completeDriverPayout = functions.https.onCall(async (data, context) => {
  const {payoutId, transactionReference, adminNotes} = data;
  const adminId = await assertAdmin(context);

  if (!transactionReference) {
    throw new functions.https.HttpsError("invalid-argument",
        "Transaction reference required");
  }

  const payoutRef = db.collection("driverPayouts").doc(payoutId);

  try {
    await db.runTransaction(async (transaction) => {
      const payoutSnap = await transaction.get(payoutRef);

      if (!payoutSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Payout not found");
      }

      const payout = payoutSnap.data();

      if (payout.status !== "pending_admin") {
        throw new functions.https.HttpsError("failed-precondition",
            "Payout not in pending status");
      }

      const now = admin.firestore.FieldValue.serverTimestamp();

      transaction.update(payoutRef, {
        status: "completed",
        processedBy: adminId,
        processedAt: now,
        transactionReference: transactionReference,
        adminNotes: adminNotes || "",
        completedAt: now,
        updatedAt: now,
      });

      // Update wallet transaction to completed
      const walletTxQuery = await db
          .collection("driverWallets")
          .doc(payout.driverId)
          .collection("transactions")
          .where("payoutId", "==", payoutId)
          .limit(1)
          .get();

      if (!walletTxQuery.empty) {
        transaction.update(walletTxQuery.docs[0].ref, {
          status: "completed",
          updatedAt: now,
        });
      }

      // Update driver wallet totals
      const walletRef = db.collection("driverWallets").doc(payout.driverId);
      transaction.update(walletRef, {
        totalWithdrawn: admin.firestore.FieldValue.increment(payout.amount),
        lastPayoutAt: now,
        updatedAt: now,
      });
    });

    return {success: true, payoutId: payoutId};
  } catch (error) {
    console.error("Complete payout failed:", error);
    throw error;
  }
});

exports.rejectDriverPayout = functions.https.onCall(async (data, context) => {
  const {payoutId, reason} = data;
  const adminId = await assertAdmin(context);

  if (!reason) {
    throw new functions.https.HttpsError("invalid-argument",
        "Rejection reason required");
  }

  const payoutRef = db.collection("driverPayouts").doc(payoutId);

  try {
    await db.runTransaction(async (transaction) => {
      const payoutSnap = await transaction.get(payoutRef);

      if (!payoutSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Payout not found");
      }

      const payout = payoutSnap.data();

      if (payout.status !== "pending_admin") {
        throw new functions.https.HttpsError("failed-precondition",
            "Payout not in pending status");
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      const walletRef = db.collection("driverWallets").doc(payout.driverId);

      transaction.update(payoutRef, {
        status: "rejected",
        processedBy: adminId,
        processedAt: now,
        rejectionReason: reason,
        rejectedAt: now,
        updatedAt: now,
      });

      transaction.update(walletRef, {
        availableBalance: admin.firestore.FieldValue.increment(payout.amount),
        updatedAt: now,
      });

      const walletTxQuery = await db
          .collection("driverWallets")
          .doc(payout.driverId)
          .collection("transactions")
          .where("payoutId", "==", payoutId)
          .limit(1)
          .get();

      if (!walletTxQuery.empty) {
        transaction.update(walletTxQuery.docs[0].ref, {
          status: "rejected",
          rejectionReason: reason,
          updatedAt: now,
        });
      }
    });

    return {success: true, payoutId: payoutId};
  } catch (error) {
    console.error("Reject payout failed:", error);
    throw error;
  }
});


exports.detachPaymentMethod = functions
    .runWith({secrets: STRIPE_SECRETS}).https.onCall(async (data, context) => {
      const {paymentMethodId} = data;

      // Verify auth
      if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated",
            "Login required");
      }

      if (!paymentMethodId) {
        throw new functions.https.HttpsError("invalid-argument",
            "Missing paymentMethodId");
      }

      const uid = context.auth.uid;

      try {
        const riderSnap = await db.collection("riders").doc(uid).get();
        const stripeCustomerId = riderSnap.exists ?
          riderSnap.data().stripeCustomerId : null;

        if (!stripeCustomerId) {
          throw new functions.https.HttpsError("failed-precondition",
              "No payment profile for this account.");
        }

        const pm = await stripe.paymentMethods.retrieve(paymentMethodId);

        if (!pm || !pm.customer) {
          throw new functions.https.HttpsError("not-found",
              "Payment method not found");
        }

        // The card must belong to the caller. Without this, any signed-in
        // user who knew or guessed a pm_... id could detach somebody else's
        // card, and the owner's next booking would fail at the hold with no
        // explanation. Stripe expands `customer` to an object in some API
        // versions, so compare against either shape.
        const owner = typeof pm.customer === "string" ?
          pm.customer : pm.customer.id;

        if (owner !== stripeCustomerId) {
          console.warn(
              `Refused detach of ${paymentMethodId} by ${uid}: card belongs ` +
              "to another customer",
          );
          // Deliberately the same error as a card that does not exist, so
          // this cannot be used to test whether a given id is real.
          throw new functions.https.HttpsError("not-found",
              "Payment method not found");
        }

        await stripe.paymentMethods.detach(paymentMethodId);

        // If this was the card rides are charged to, stop pointing at it.
        // The app reassigns the default, but if that half fails the record
        // would otherwise reference a detached card and every booking would
        // fail when the hold is attempted.
        if (riderSnap.data().defaultPaymentMethodId === paymentMethodId) {
          await db.collection("riders").doc(uid).set(
              {defaultPaymentMethodId: null},
              {merge: true},
          ).catch(() => null);
        }

        return {success: true};
      } catch (error) {
        if (error instanceof functions.https.HttpsError) throw error;
        console.error("Stripe detach error:", error);
        throw new functions.https.HttpsError("internal", error.message);
      }
    });


exports.autoDeductSubscription = functions
    .region("europe-west2")
    .runWith({secrets: STRIPE_SECRETS})
    .firestore.document("driverWallets/{driverId}")
    .onUpdate(async (change, context) => {
      const before = change.before.data();
      const after = change.after.data();
      const driverId = context.params.driverId;

      // Only when money has landed in the wallet.
      const prevBalance = before.availableBalance || 0;
      const newBalance = after.availableBalance || 0;
      if (newBalance <= prevBalance) return null;

      const driverSnap = await db.collection("drivers").doc(driverId).get();
      if (!driverSnap.exists) return null;
      const sub = driverSnap.data().subscription || {};
      if (!["active", "past_due", "suspended"].includes(sub.status) ||
        sub.paymentMethod !== "wallet_deduction") {
        return null;
      }

      // collectMembership decides inside its own transaction whether
      // anything is due, and takes it with an increment, so a ride credit
      // or payout landing at the same moment is never overwritten.
      const result = await collectMembership(driverId);
      if (result.paid) {
        console.log("Membership taken from wallet:", driverId, result.amount);
      }
      return null;
    });


/* ======================================
   DRIVER MEMBERSHIP: RENEWAL, CARD PAYMENT, GRACE
   The membership is paid from the driver's wallet. A driver who works
   mostly in cash may not have enough there, so a due renewal falls back to
   the card saved on the account, then to a grace period (days set on the
   dashboard) with a notification, and only then to suspension. Renewals
   are checked daily, not only when money lands in the wallet.
====================================== */

/**
 * Stripe customer for an account, created if it does not exist yet.
 * Cards live on riders/{uid} whichever side of the app added them.
 * @param {string} uid Account id.
 * @return {Promise<string>} Stripe customer id.
 */
async function ensureStripeCustomer(uid) {
  const ref = db.collection("riders").doc(uid);
  const snap = await ref.get();
  const existing = snap.exists ? snap.data().stripeCustomerId : null;
  if (existing) return existing;
  const customer = await stripe.customers.create({metadata: {uid}},
      {idempotencyKey: `customer_${uid}`});
  await ref.set({stripeCustomerId: customer.id}, {merge: true});
  return customer.id;
}

/**
 * Whether a membership has anything to collect right now.
 * @param {Object} sub The driver's subscription object.
 * @param {number} now Milliseconds.
 * @return {boolean} True when money is owed.
 */
function membershipDue(sub, now) {
  const debt = Number(sub.debtAmount) || 0;
  if (debt > 0) return true;
  if (sub.status && sub.status !== "active") return true;
  const next = toMillis(sub.nextBillingDate);
  return !!next && next <= now;
}

/**
 * Takes one membership payment for a driver: wallet first, then card.
 * The wallet leg runs in a transaction that re-reads the driver, so two
 * runs (the daily job and the wallet trigger) cannot both take a month.
 * @param {string} driverId Driver id.
 * @param {Object} opts {cardOnly: pay by card even if the wallet could}.
 * @return {Promise<Object>} {paid, method, amount, reason}.
 */
async function collectMembership(driverId, opts = {}) {
  const cfg = await loadAppConfig();
  const price = cfg.subscription.monthlyPrice;
  const driverRef = db.collection("drivers").doc(driverId);
  const walletRef = db.collection("driverWallets").doc(driverId);
  const now = admin.firestore.FieldValue.serverTimestamp();

  /**
   * What is owed and the fields that mark it paid, from a fresh read.
   * @param {Object} sub Subscription object.
   * @return {?Object} {amount, paidFields} or null when nothing is due.
   */
  const plan = (sub) => {
    const nowMs = Date.now();
    if (!membershipDue(sub, nowMs)) return null;
    const debt = Number(sub.debtAmount) || 0;
    const amount = Math.round((debt > 0 ? debt : price) * 100) / 100;
    if (!(amount > 0)) return null;
    // Keep a billing date that is still ahead; only advance one that
    // has passed, so paying late never gifts an extra month.
    const next = toMillis(sub.nextBillingDate);
    const nextDate = next && next > nowMs ?
      new Date(next) : addOneMonth(new Date(nowMs));
    return {
      amount,
      paidFields: {
        "subscription.status": "active",
        "subscription.debtAmount": 0,
        "subscription.lastPaidAt": now,
        "subscription.graceUntil": null,
        "subscription.nextBillingDate":
          admin.firestore.Timestamp.fromDate(nextDate),
      },
    };
  };

  // 1. Wallet, in a transaction: re-read the driver, then the wallet.
  let owed = null;
  if (!opts.cardOnly) {
    const outcome = await db.runTransaction(async (tx) => {
      const d = await tx.get(driverRef);
      if (!d.exists) return {reason: "no_driver"};
      const p = plan(d.data().subscription || {});
      if (!p) return {reason: "nothing_due"};
      const w = await tx.get(walletRef);
      const balance = w.exists ? Number(w.data().availableBalance) || 0 : 0;
      if (balance < p.amount) return {owed: p};
      tx.update(walletRef, {
        availableBalance: admin.firestore.FieldValue.increment(-p.amount),
        totalFees: admin.firestore.FieldValue.increment(p.amount),
        updatedAt: now,
      });
      tx.set(walletRef.collection("transactions").doc(), {
        amount: -p.amount,
        description: "Monthly membership",
        type: "subscription_deduction",
        status: "completed",
        createdAt: now,
        updatedAt: now,
      });
      tx.update(driverRef, p.paidFields);
      return {paid: true, amount: p.amount};
    });
    if (outcome.paid) {
      return {paid: true, method: "wallet", amount: outcome.amount};
    }
    if (outcome.reason) return {paid: false, reason: outcome.reason};
    owed = outcome.owed;
  } else {
    const d = await driverRef.get();
    if (!d.exists) return {paid: false, reason: "no_driver"};
    owed = plan(d.data().subscription || {});
    if (!owed) return {paid: false, reason: "nothing_due"};
  }
  const amount = owed.amount;

  // 2. The card saved on the account.
  const riderSnap = await db.collection("riders").doc(driverId).get();
  const r = riderSnap.exists ? riderSnap.data() : {};
  if (!r.stripeCustomerId || !r.defaultPaymentMethodId) {
    return {paid: false, reason: "no_card", amount};
  }
  try {
    const period = new Date().toISOString().slice(0, 7);
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: cfg.currency.toLowerCase(),
      customer: r.stripeCustomerId,
      payment_method: r.defaultPaymentMethodId,
      confirm: true,
      off_session: true,
      metadata: {driverId, type: "membership"},
    }, {idempotencyKey: `membership_${driverId}_${period}_${amount}`});
    await driverRef.update(owed.paidFields);
    await walletRef.collection("transactions").doc().set({
      amount: 0,
      cardAmount: amount,
      description: "Monthly membership, paid by card",
      type: "subscription_card_payment",
      paymentIntentId: intent.id,
      status: "completed",
      createdAt: now,
      updatedAt: now,
    });
    return {paid: true, method: "card", amount};
  } catch (error) {
    console.error("Membership card charge failed:", driverId, error.message);
    return {paid: false, reason: "card_declined", amount};
  }
}

/**
 * A billing date has come round: add this month's price to what is owed
 * and move the date on, once, so an unpaid month is never forgiven and
 * the daily job never adds it twice.
 * @param {FirebaseFirestore.DocumentReference} driverRef Driver.
 * @param {number} price Monthly price.
 * @return {Promise<void>}
 */
async function rollMembershipMonth(driverRef, price) {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(driverRef);
    if (!snap.exists) return;
    const sub = snap.data().subscription || {};
    const next = toMillis(sub.nextBillingDate);
    if (!next || next > Date.now()) return;
    const debt = Number(sub.debtAmount) || 0;
    tx.update(driverRef, {
      "subscription.debtAmount": Math.round((debt + price) * 100) / 100,
      "subscription.nextBillingDate":
        admin.firestore.Timestamp.fromDate(addOneMonth(new Date(next))),
    });
  });
}

/* Daily: renew due memberships, and suspend when a grace period has run
   out. Runs whether or not the wallet has moved. */
exports.renewDriverMemberships = functions
    .runWith({secrets: STRIPE_SECRETS})
    .pubsub.schedule("every day 06:00").timeZone("Europe/London")
    .onRun(async () => {
      const cfg = await loadAppConfig();
      const price = cfg.subscription.monthlyPrice;
      const graceMs = cfg.subscription.graceDays * 24 * 3600 * 1000;
      const now = Date.now();

      // 1. Memberships whose month has come round.
      const due = await db.collection("drivers")
          .where("subscription.nextBillingDate", "<=",
              admin.firestore.Timestamp.fromMillis(now))
          .get();

      for (const doc of due.docs) {
        const sub = doc.data().subscription || {};
        if (!["active", "past_due"].includes(sub.status)) continue;
        if (sub.paymentMethod && sub.paymentMethod !== "wallet_deduction") {
          continue;
        }

        await rollMembershipMonth(doc.ref, price);
        const result = await collectMembership(doc.id);
        if (result.paid) {
          await sendPush([doc.id], {
            title: "Membership renewed",
            body: result.method === "card" ?
              "Your wallet was short, so we charged your card." :
              "Taken from your wallet. You're all set for another month.",
            channelId: "general",
          }).catch(() => null);
          continue;
        }

        if (sub.status === "active" || !toMillis(sub.graceUntil)) {
          await doc.ref.update({
            "subscription.status": "past_due",
            "subscription.graceUntil":
              admin.firestore.Timestamp.fromMillis(now + graceMs),
          });
          await sendPush([doc.id], {
            title: "Membership payment due",
            body: "Add a card, or complete card rides, within " +
              `${cfg.subscription.graceDays} days to keep driving.`,
            channelId: "general",
          }).catch(() => null);
        }
      }

      // 2. Grace periods that have run out. Queried separately, because
      // rolling the month moves the billing date past today.
      const overdue = await db.collection("drivers")
          .where("subscription.status", "==", "past_due")
          .get();
      for (const doc of overdue.docs) {
        const sub = doc.data().subscription || {};
        const graceUntil = toMillis(sub.graceUntil);
        if (!graceUntil || graceUntil > now) continue;
        await doc.ref.update({"subscription.status": "suspended"});
        await sendPush([doc.id], {
          title: "Account paused",
          body: "Your membership is unpaid. Pay from the Membership " +
            "screen to go online again.",
          channelId: "general",
        }).catch(() => null);
      }
      return null;
    });

/* First activation, from the Membership screen. This used to be done by
   the app writing the driver's own wallet balance and subscription, which
   the phone should never be trusted to do. Now the server sets the
   membership up and takes the first month the same way as a renewal:
   wallet, then saved card. If neither covers it, the membership starts with
   the month owed, taken as soon as the wallet can pay it (as before). */
exports.activateDriverMembership = functions
    .runWith({secrets: STRIPE_SECRETS})
    .https.onCall(async (data, context) => {
      if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated",
            "Please sign in.");
      }
      const uid = context.auth.uid;
      const driverRef = db.collection("drivers").doc(uid);
      const snap = await driverRef.get();
      if (!snap.exists) {
        throw new functions.https.HttpsError("not-found",
            "Driver profile not found.");
      }
      const current = (snap.data().subscription || {}).status;
      if (["active", "past_due"].includes(current)) {
        return {alreadyActive: true};
      }

      const cfg = await loadAppConfig();
      const price = cfg.subscription.monthlyPrice;
      const next = addOneMonth(new Date());
      await driverRef.set({
        subscription: {
          status: "active",
          tier: "monthly",
          amount: price,
          paymentMethod: "wallet_deduction",
          debtAmount: price,
          lastPaidAt: null,
          graceUntil: null,
          nextBillingDate: admin.firestore.Timestamp.fromDate(next),
          activatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        onboardingComplete: true,
      }, {merge: true});

      const result = await collectMembership(uid);
      return {paid: result.paid, method: result.method || null, amount: price};
    });

/* The driver pays now, by card, from the Membership screen. */
exports.payDriverMembership = functions
    .runWith({secrets: STRIPE_SECRETS})
    .https.onCall(async (data, context) => {
      if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated",
            "Please sign in.");
      }
      const result = await collectMembership(context.auth.uid,
          {cardOnly: data && data.cardOnly === true});
      if (result.paid) return result;
      const message = {
        no_card: "Add a card first, then try again.",
        card_declined: "Your card was declined. Try another card.",
        nothing_due: "Nothing is due right now.",
      }[result.reason] || "Payment did not go through. Please try again.";
      throw new functions.https.HttpsError("failed-precondition", message);
    });

/* ======================================
   PUSH NOTIFICATIONS
   Phones save their FCM token to pushTokens/{uid} (see the app's
   utils/notifications.js). Android channels decide sound and importance:
   job-alerts, trip-updates, messages, general.
====================================== */

/**
 * Sends one notification to every saved phone for the given users and
 * removes tokens Firebase says are no longer valid.
 * @param {Array<string>} uids User ids.
 * @param {Object} msg {title, body, channelId, data, ttlSeconds}.
 * @return {Promise<number>} Number of phones reached.
 */
async function sendPush(uids, msg) {
  const unique = [...new Set((uids || []).filter(Boolean))];
  if (!unique.length) return 0;

  const tokenOwners = [];
  const snaps = await Promise.all(
      unique.map((uid) => db.collection("pushTokens").doc(uid).get()),
  );
  snaps.forEach((snap, i) => {
    const tokens = snap.exists ? snap.data().tokens || [] : [];
    tokens.forEach((token) => tokenOwners.push({uid: unique[i], token}));
  });
  if (!tokenOwners.length) return 0;

  const data = {};
  Object.entries(msg.data || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) data[k] = String(v);
  });

  let reached = 0;
  for (let i = 0; i < tokenOwners.length; i += 500) {
    const batch = tokenOwners.slice(i, i + 500);
    const res = await admin.messaging().sendEachForMulticast({
      tokens: batch.map((t) => t.token),
      notification: {title: msg.title, body: msg.body},
      data,
      android: {
        priority: "high",
        ttl: (msg.ttlSeconds || 3600) * 1000,
        notification: {channelId: msg.channelId || "general"},
      },
      apns: {payload: {aps: {sound: "default"}}},
    });
    reached += res.successCount;

    const dead = [];
    res.responses.forEach((r, j) => {
      const code = r.error && r.error.code;
      if (code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-registration-token" ||
          code === "messaging/invalid-argument") {
        dead.push(batch[j]);
      }
    });
    await Promise.all(dead.map((d) =>
      db.collection("pushTokens").doc(d.uid).update({
        tokens: admin.firestore.FieldValue.arrayRemove(d.token),
      }).catch(() => null),
    ));
  }
  return reached;
}

/**
 * Straight-line distance in km.
 * @param {Object} a {latitude, longitude}.
 * @param {Object} b {latitude, longitude}.
 * @return {number} Kilometres, or Infinity if a point is missing.
 */
function distanceKm(a, b) {
  if (!a || !b || typeof a.latitude !== "number" ||
      typeof b.latitude !== "number") {
    return Infinity;
  }
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) *
    Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/* ======================================
   VEHICLE CLASSES
   A passenger who books and pays for Executive must not be sent a Mini. The
   ride carries the class they paid for as rideType, the driver carries the
   class their vehicle was approved as as vehicleType, and both use the same
   ids. Keep this table in step with the app's constants/vehicleClasses.js.
====================================== */
// A vehicle may take its own class and anything it comfortably exceeds, never
// anything above it. Only an XL has six seats, so only an XL is sent XL work.
const SERVES = {
  RouteMini: ["RouteMini"],
  RoutePlus: ["RoutePlus", "RouteMini"],
  RouteXL: ["RouteXL", "RoutePlus", "RouteMini"],
  RouteEco: ["RouteEco", "RouteMini"],
  RouteExecutive: ["RouteExecutive", "RoutePlus", "RouteMini"],
};
const DEFAULT_CLASS = "RouteMini";

/**
 * Whether a vehicle of this class may be offered this ride.
 * Drivers approved before classes were matched have no vehicleType and are
 * treated as the entry class, so they keep getting ordinary work but stop
 * being sent Executive and XL jobs.
 * @param {string} vehicleType Driver's approved class.
 * @param {string} rideType Class the passenger paid for.
 * @return {boolean} True when the vehicle qualifies.
 */
function canServe(vehicleType, rideType) {
  const vehicle = SERVES[vehicleType] ? vehicleType : DEFAULT_CLASS;
  const ride = SERVES[rideType] ? rideType : DEFAULT_CLASS;
  return SERVES[vehicle].includes(ride);
}

/**
 * Rings every eligible online driver near the pickup.
 * @param {string} rideId Ride id.
 * @param {Object} ride Ride document.
 * @return {Promise<null>} Nothing.
 */
async function offerRideToDrivers(rideId, ride) {
  const cfg = await loadAppConfig();
  const skip = new Set([
    ...(ride.declinedBy || []),
    ...(ride.blockedDriverIds || []),
  ]);
  const online = await db.collection("drivers")
      .where("status", "==", "online").get();

  const nearby = [];
  online.forEach((snap) => {
    const d = snap.data();
    if (skip.has(snap.id) || d.blocked === true || d.approved !== true ||
        d.isOnRide === true) {
      return;
    }
    if (!canServe(d.vehicleType, ride.rideType)) return;
    // A driver who chose a working city only gets that city's jobs.
    // Same rule as servesCity() in the app's utils/cities.js.
    if (d.workingCityId && d.workingCityId !== ride.cityId) return;
    // Passenger asked for a female driver: verified female drivers only.
    if (ride.femaleDriverOnly === true && d.femaleVerified !== true) return;
    const km = distanceKm(d.location, ride.pickupLocation);
    if (km <= cfg.dispatch.searchRadiusKm) nearby.push(snap.id);
  });

  const pickup = ride.pickupLocation && ride.pickupLocation.address ?
    ride.pickupLocation.address : "a nearby pickup";
  await sendPush(nearby, {
    title: "New job offer",
    body: `Pickup at ${pickup}. Open TakeARoute to accept.`,
    channelId: "job-alerts",
    ttlSeconds: Math.max(10, cfg.dispatch.requestTimeoutSeconds || 20),
    data: {type: "job_offer", rideId},
  });
  console.log(`Job ${rideId} offered to ${nearby.length} driver(s)`);
  return null;
}

exports.notifyDriversOfNewRide = functions.firestore
    .document("rides/{rideId}")
    .onCreate(async (snap, context) => {
      const ride = snap.data();
      if (ride.status !== "searching") return null;
      return offerRideToDrivers(context.params.rideId, ride);
    });

/* Bidding: a driver countered the passenger's offer. Tell the passenger,
   since they may have put the phone down while waiting. */
exports.notifyRiderOfCounterOffer = functions.firestore
    .document("rides/{rideId}/offers/{driverId}")
    .onWrite(async (change, context) => {
      const offer = change.after.exists ? change.after.data() : null;
      if (!offer || offer.status !== "pending") return null;
      const before = change.before.exists ? change.before.data() : null;
      if (before && before.price === offer.price) return null;

      const rideSnap = await db.collection("rides")
          .doc(context.params.rideId).get();
      const ride = rideSnap.exists ? rideSnap.data() : null;
      if (!ride || ride.status !== "searching" || !ride.riderId) return null;

      await sendPush([ride.riderId], {
        title: `${offer.driverName || "A driver"} offered ` +
          emailMoney(offer.price, rideCurrency(ride).toUpperCase()),
        body: "Open TakeARoute to accept or wait for more offers.",
        channelId: "trip-updates",
        data: {type: "counter_offer", rideId: context.params.rideId},
      });
      return null;
    });

/* The passenger gave up on a female driver: offer the job to everyone who
   was held back the first time. */
exports.reofferWhenPreferenceDropped = functions.firestore
    .document("rides/{rideId}")
    .onUpdate(async (change, context) => {
      const before = change.before.data();
      const after = change.after.data();
      if (after.status !== "searching") return null;
      const dropped = before.femaleDriverOnly === true &&
        after.femaleDriverOnly !== true;
      if (!dropped) return null;
      return offerRideToDrivers(context.params.rideId, after);
    });

exports.notifyRideUpdates = functions.firestore
    .document("rides/{rideId}")
    .onUpdate(async (change, context) => {
      const before = change.before.data();
      const after = change.after.data();
      const rideId = context.params.rideId;
      if (before.status === after.status) return null;

      const cancelled = ["cancelled", "canceled"];
      const trip = {channelId: "trip-updates", data: {type: "trip", rideId}};

      // Back to searching because the card hold failed: the passenger and
      // driver were told by authorizePaymentOnRideAccept, and there is no
      // point offering it again until a card is added.
      if (after.status === "searching" &&
          after.paymentStatus === "auth_failed" &&
          before.paymentStatus !== "auth_failed") {
        return null;
      }

      // Driver gave the job back: offer it again.
      if (after.status === "searching" && before.status !== "searching") {
        await sendPush([after.riderId], {...trip,
          title: "Finding you another driver",
          body: "Your driver had to cancel. We are looking for a new one."});
        return offerRideToDrivers(rideId, after);
      }
      if (after.status === "accepted") {
        return sendPush([after.riderId], {...trip,
          title: "Driver on the way",
          body: "Your driver has accepted and is heading to your pickup."});
      }
      if (after.status === "arrived") {
        return sendPush([after.riderId], {...trip,
          title: "Your driver has arrived",
          body: "Please meet your driver at the pickup point."});
      }
      if (after.status === "ongoing") {
        return sendPush([after.riderId], {...trip,
          title: "Your trip has started",
          body: "Sit back. You can follow the route in the app."});
      }
      if (after.status === "completed") {
        return sendPush([after.riderId], {...trip,
          title: "Trip complete",
          body: after.paymentMethod === "cash" ?
            "Trip complete. Thanks for riding with TakeARoute." :
            "Trip complete. Your receipt is on its way."});
      }
      if (cancelled.includes(after.status)) {
        // Timed out with no driver: expireSearchingRides already told them.
        if (after.cancelledBy === "timeout") return null;
        if (after.cancelledBy === "driver") {
          const noShow = after.cancelReason === "passenger_no_show";
          return sendPush([after.riderId], {...trip,
            title: noShow ? "Ride ended: no-show" : "Ride cancelled",
            body: noShow ?
              "The driver reported a no-show at the pickup and ended " +
              "the ride." :
              "Your driver cancelled this ride. " +
              "You have not been charged."});
        }
        if (before.driverId || after.driverId) {
          return sendPush([after.driverId || before.driverId], {...trip,
            title: "Job cancelled",
            body: "The passenger cancelled this job. " +
              "You are free for the next one."});
        }
      }
      return null;
    });

/* Every two minutes: a booking still looking for a driver after the
   dashboard's limit is cancelled, so it does not sit in every driver's
   queue for hours and get accepted once the passenger has given up. Any
   card hold is released by cancelRidePayment, as for any cancellation. */
exports.expireSearchingRides = functions
    .pubsub.schedule("every 2 minutes")
    .onRun(async () => {
      const cfg = await loadAppConfig();
      const limitMs = cfg.dispatch.searchTimeoutMinutes * 60 * 1000;
      const cutoff = admin.firestore.Timestamp
          .fromMillis(Date.now() - limitMs);
      const stale = await db.collection("rides")
          .where("status", "==", "searching")
          .where("timestamps.createdAt", "<=", cutoff)
          .get();

      for (const doc of stale.docs) {
        const ride = doc.data();
        const rideRef = doc.ref;
        const done = await db.runTransaction(async (tx) => {
          const snap = await tx.get(rideRef);
          if (!snap.exists || snap.data().status !== "searching") {
            return false;
          }
          tx.update(rideRef, {
            status: "cancelled",
            cancelledBy: "timeout",
            cancelReason: "no_driver_found",
            cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          if (ride.riderId) {
            const riderRef = db.collection("riders").doc(ride.riderId);
            const rider = await tx.get(riderRef);
            if (rider.exists && rider.data().currentRideId === doc.id) {
              tx.update(riderRef, {currentRideId: null});
            }
          }
          return true;
        }).catch((error) => {
          console.error("Could not expire ride:", doc.id, error.message);
          return false;
        });
        if (!done) continue;
        await sendPush([ride.riderId], {
          title: "No drivers found",
          body: "No drivers were found. Please try again.",
          channelId: "trip-updates",
          data: {type: "trip", rideId: doc.id},
        }).catch(() => null);
        console.log("⌛ Search timed out:", doc.id);
      }
      return null;
    });

exports.notifyChatMessage = functions.firestore
    .document("rides/{rideId}/messages/{messageId}")
    .onCreate(async (snap, context) => {
      const msg = snap.data();
      const rideSnap = await db.collection("rides")
          .doc(context.params.rideId).get();
      if (!rideSnap.exists) return null;
      const ride = rideSnap.data();
      const toDriver = msg.senderType !== "driver";
      const to = toDriver ? ride.driverId : ride.riderId;
      const text = String(msg.text || "");
      return sendPush([to], {
        title: toDriver ? "Message from your passenger" :
          "Message from your driver",
        body: text.length > 120 ? text.slice(0, 117) + "..." : text,
        channelId: "messages",
        data: {type: "chat", rideId: context.params.rideId},
      });
    });

exports.notifySupportReply = functions.firestore
    .document("reports/{reportId}/messages/{messageId}")
    .onCreate(async (snap, context) => {
      if (snap.data().senderRole !== "admin") return null;
      const reportSnap = await db.collection("reports")
          .doc(context.params.reportId).get();
      if (!reportSnap.exists) return null;
      return sendPush([reportSnap.data().reporterId], {
        title: "Reply from TakeARoute support",
        body: "Open My reports to read it.",
        channelId: "messages",
        data: {type: "report", reportId: context.params.reportId},
      });
    });

exports.notifyAnnouncement = functions.firestore
    .document("announcements/{id}")
    .onCreate(async (snap) => {
      const a = snap.data();
      let uids = [];
      if (a.audience === "user") {
        uids = [a.userId];
      } else {
        const wantDrivers = a.audience === "drivers" || a.audience === "all";
        const wantRiders = a.audience === "riders" || a.audience === "all";
        const all = await db.collection("pushTokens").get();
        const users = await Promise.all(all.docs.map((d) =>
          db.collection("users").doc(d.id).get()));
        users.forEach((u, i) => {
          const role = u.exists ? u.data().role : null;
          if ((role === "driver" && wantDrivers) ||
              (role === "rider" && wantRiders)) {
            uids.push(all.docs[i].id);
          }
        });
      }
      return sendPush(uids, {
        title: a.title || "TakeARoute",
        body: a.body || "",
        channelId: "general",
        data: {type: "announcement"},
      });
    });

exports.notifyChangeRequestDecision = functions.firestore
    .document("changeRequests/{id}")
    .onUpdate(async (change, context) => {
      const before = change.before.data();
      const after = change.after.data();
      if (before.status === after.status || after.status === "pending") {
        return null;
      }
      const ok = after.status === "approved";
      if (ok && after.kind === "detail" && after.requestedValue) {
        // The dashboard already updated the driver document; keep the Auth
        // account (what sign-in checks) in step for contact details.
        const value = String(after.requestedValue).trim();
        const authPatch = after.field === "email" ? {email: value} :
          after.field === "phoneNumber" && value.startsWith("+") ?
            {phoneNumber: value} : null;
        if (authPatch) {
          try {
            await admin.auth().updateUser(after.driverId, authPatch);
          } catch (error) {
            console.error("Auth update failed for change request",
                context.params.id, error);
          }
        }
      }
      return sendPush([after.driverId], {
        title: ok ? "Change approved" : "Change not approved",
        body: ok ?
          `Your ${String(after.fieldLabel || "details").toLowerCase()} ` +
            "has been updated." :
          (after.adminNote || "Open Personal details to see why."),
        channelId: "general",
        data: {type: "change_request"},
      });
    });


/* ======================================
   RIDE RECEIPTS BY EMAIL
   Sent through Resend once payment is captured, and on request from the app.
   Set the key first:  firebase functions:secrets:set RESEND_API_KEY
   Optional sender override: RECEIPT_FROM (default
   receipts@invoice.takearoute.ltd, the domain verified in Resend).
====================================== */
const RECEIPT_SECRETS = ["RESEND_API_KEY"];

/**
 * Money for emails, e.g. 12.5 -> "£12.50".
 * @param {number} amount Amount in major units.
 * @param {string} code Currency code.
 * @return {string} Formatted amount.
 */
function emailMoney(amount, code) {
  const symbols = {
    GBP: "£", EUR: "€", USD: "$", CAD: "CA$", AUD: "A$",
    AED: "AED ", PKR: "Rs ", SAR: "SAR ",
  };
  const c = String(code || "GBP").toUpperCase();
  const n = Number(amount);
  return (symbols[c] || `${c} `) + (Number.isFinite(n) ? n.toFixed(2) : "0.00");
}

/**
 * Escapes text placed into the email HTML.
 * @param {string} value Raw text.
 * @return {string} Safe text.
 */
function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
}

/**
 * Builds the receipt email.
 * @param {Object} ride Ride document.
 * @param {string} rideId Ride id.
 * @param {Object} extra {driverName, vehicle, riderName}.
 * @return {Object} {subject, html, text}.
 */
function buildReceipt(ride, rideId, extra) {
  const currency = ride.currency ||
    (ride.fare && ride.fare.currency) || "GBP";
  const fare = ride.fare || {};
  const total = Number(fare.finalTotal || fare.total || ride.fareEstimate || 0);
  const when = ride.completedAt && ride.completedAt.toDate ?
    ride.completedAt.toDate() : new Date();
  const date = when.toLocaleDateString("en-GB",
      {weekday: "long", day: "numeric", month: "long", year: "numeric"});
  const time = when.toLocaleTimeString("en-GB",
      {hour: "2-digit", minute: "2-digit"});

  const lines = [];
  const add = (label, value, opts) => {
    if (value === null || value === undefined) return;
    lines.push({label, value, muted: opts && opts.muted});
  };
  add("Base fare", emailMoney(fare.baseFare, currency));
  add("Distance", fare.distanceFare !== undefined ?
    emailMoney(fare.distanceFare, currency) : null);
  add("Time", fare.timeFare !== undefined ?
    emailMoney(fare.timeFare, currency) : null);
  if (Number(fare.discountAmount) > 0) {
    add("Promo discount", "-" + emailMoney(fare.discountAmount, currency));
  }
  if (fare.vat !== undefined) {
    add(`VAT (${fare.vatPercent || 20}%)`, emailMoney(fare.vat, currency));
  }
  if (Number(fare.waitingCharge) > 0) {
    add("Waiting time", emailMoney(fare.waitingCharge, currency));
  }

  const rowsHtml = lines.map((l) => `
      <tr>
        <td style="padding:6px 0;color:#4B5563;font-size:14px;">
          ${escapeHtml(l.label)}</td>
        <td style="padding:6px 0;text-align:right;color:#1F2937;
          font-size:14px;">${escapeHtml(l.value)}</td>
      </tr>`).join("");

  const pickup = (ride.pickupLocation && ride.pickupLocation.address) || "";
  const dropoff = (ride.dropoffLocation && ride.dropoffLocation.address) || "";
  const distance = ride.route && ride.route.distanceKm ?
    `${ride.route.distanceKm} km` : "";
  const duration = ride.route && ride.route.durationMinutes ?
    `${Math.ceil(ride.route.durationMinutes)} min` : "";

  const html = `<!doctype html>
<html><body style="margin:0;background:#F3F4F6;
  font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="background:#0B0F1A;border-radius:24px;padding:24px;">
      <div style="color:#AEB5C4;font-size:14px;">TakeARoute receipt</div>
      <div style="color:#B8F03A;font-size:34px;font-weight:800;margin-top:6px;">
        ${escapeHtml(emailMoney(total, currency))}</div>
      <div style="color:#AEB5C4;font-size:13px;margin-top:4px;">
        ${escapeHtml(date)}, ${escapeHtml(time)}</div>
    </div>

    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:24px;
      padding:20px;margin-top:14px;">
      <div style="font-size:15px;color:#1F2937;font-weight:600;">
        ${escapeHtml(pickup)}</div>
      <div style="color:#9CA3AF;font-size:12px;margin:6px 0;">to</div>
      <div style="font-size:15px;color:#1F2937;font-weight:600;">
        ${escapeHtml(dropoff)}</div>
      <div style="color:#6B7280;font-size:13px;margin-top:12px;">
        ${escapeHtml([distance, duration].filter(Boolean).join(", "))}</div>
    </div>

    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:24px;
      padding:20px;margin-top:14px;">
      <table style="width:100%;border-collapse:collapse;">${rowsHtml}
        <tr><td colspan="2" style="border-top:1px solid #E5E7EB;
          padding-top:10px;"></td></tr>
        <tr>
          <td style="color:#0B0F1A;font-size:16px;font-weight:700;">
            Total paid</td>
          <td style="text-align:right;color:#0B0F1A;font-size:16px;
            font-weight:800;">${escapeHtml(emailMoney(total, currency))}</td>
        </tr>
      </table>
      <div style="color:#6B7280;font-size:13px;margin-top:12px;">
        ${ride.paymentMethod === "cash" ? "Paid in cash to your driver." :
    `Paid by card ending ${escapeHtml(ride.cardLast4 || "on file")}.`}
      </div>
    </div>

    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:24px;
      padding:20px;margin-top:14px;">
      <div style="color:#6B7280;font-size:12px;font-weight:700;
        text-transform:uppercase;">Your driver</div>
      <div style="font-size:15px;color:#1F2937;margin-top:6px;">
        ${escapeHtml(extra.driverName || "TakeARoute driver")}
        ${extra.vehicle ? ", " + escapeHtml(extra.vehicle) : ""}</div>
    </div>

    <div style="color:#6B7280;font-size:12px;line-height:18px;
      margin:18px 4px 0;">
      Trip reference ${escapeHtml(String(rideId).slice(0, 8).toUpperCase())}.
      Something wrong with this trip? Report it in the app under My reports and
      support will reply.
    </div>
  </div>
</body></html>`;

  const text = [
    `TakeARoute receipt, ${date} ${time}`,
    `${pickup} to ${dropoff}`,
    ...lines.map((l) => `${l.label}: ${l.value}`),
    `Total paid: ${emailMoney(total, currency)}`,
    `Driver: ${extra.driverName || "TakeARoute driver"}`,
    `Trip reference ${String(rideId).slice(0, 8).toUpperCase()}`,
  ].join("\n");

  return {
    subject: `Your TakeARoute receipt, ${emailMoney(total, currency)}`,
    html,
    text,
  };
}

/**
 * Finds the passenger's email: the ride, their record, then their login.
 * @param {Object} ride Ride document.
 * @return {Promise<string|null>} Email address.
 */
async function riderEmail(ride) {
  if (ride.riderEmail) return ride.riderEmail;
  if (!ride.riderId) return null;
  // The login email is the one they proved they own (an email change in
  // the app only lands there once the link is clicked), so it comes first.
  try {
    const user = await admin.auth().getUser(ride.riderId);
    if (user.email) return user.email;
  } catch (error) {
    // Fall through to the stored one.
  }
  const snap = await db.collection("riders").doc(ride.riderId).get();
  return snap.exists && snap.data().email ? snap.data().email : null;
}

/**
 * Sends the receipt for one ride.
 * @param {string} rideId Ride id.
 * @param {Object} ride Ride document.
 * @param {string} to Optional address to send to instead.
 * @return {Promise<Object>} {sent: boolean, reason?: string}.
 */
async function emailRideReceipt(rideId, ride, to) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log("No RESEND_API_KEY set, skipping receipt");
    return {sent: false, reason: "not_configured"};
  }
  const address = to || await riderEmail(ride);
  if (!address) return {sent: false, reason: "no_email"};

  const [driverSnap, riderSnap] = await Promise.all([
    ride.driverId ?
      db.collection("drivers").doc(ride.driverId).get() : null,
    ride.riderId ? db.collection("riders").doc(ride.riderId).get() : null,
  ]);
  const driver = driverSnap && driverSnap.exists ? driverSnap.data() : {};
  const rider = riderSnap && riderSnap.exists ? riderSnap.data() : {};
  const vehicle = [driver.makeModel, driver.registrationNumber]
      .filter(Boolean).join(", ");

  const mail = buildReceipt(ride, rideId, {
    driverName: driver.fullName ||
      [driver.firstName, driver.lastName].filter(Boolean).join(" "),
    vehicle,
    riderName: rider.fullName || "",
  });

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RECEIPT_FROM ||
        "TakeARoute <receipts@invoice.takearoute.ltd>",
      to: [address],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error(`Receipt send failed (${response.status}): ${detail}`);
    return {sent: false, reason: "send_failed"};
  }

  await db.collection("rides").doc(rideId).update({
    receiptSentAt: admin.firestore.FieldValue.serverTimestamp(),
    receiptSentTo: address,
  }).catch(() => null);
  return {sent: true, to: address};
}

/* Sends the receipt once the payment has been captured. */
exports.sendReceiptOnPaymentCaptured = functions
    .runWith({secrets: RECEIPT_SECRETS})
    .firestore.document("rides/{rideId}")
    .onUpdate(async (change, context) => {
      const before = change.before.data();
      const after = change.after.data();
      const captured = after.paymentStatus === "captured" ||
        after.paymentStatus === "paid" || after.paymentStatus === "cash";
      if (!captured || before.paymentStatus === after.paymentStatus) {
        return null;
      }
      if (after.receiptSentAt) return null;
      const result = await emailRideReceipt(context.params.rideId, after);
      console.log(`Receipt for ${context.params.rideId}:`,
          JSON.stringify(result));
      return null;
    });

/* Passenger taps "Email receipt", optionally to a different address. */
exports.resendRideReceipt = functions
    .runWith({secrets: RECEIPT_SECRETS})
    .https.onCall(async (data, context) => {
      if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated",
            "Please sign in.");
      }
      const rideId = data && data.rideId;
      if (!rideId) {
        throw new functions.https.HttpsError("invalid-argument",
            "Missing rideId");
      }
      const snap = await db.collection("rides").doc(rideId).get();
      if (!snap.exists) {
        throw new functions.https.HttpsError("not-found", "Ride not found");
      }
      const ride = snap.data();
      if (ride.riderId !== context.auth.uid) {
        throw new functions.https.HttpsError("permission-denied",
            "This is not your trip.");
      }

      let to = null;
      if (data.email) {
        to = String(data.email).trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
          throw new functions.https.HttpsError("invalid-argument",
              "That email address does not look right.");
        }
      }

      const result = await emailRideReceipt(rideId, ride, to);
      if (!result.sent) {
        const messages = {
          not_configured: "Receipts are not switched on yet.",
          no_email: "We do not have an email address for you. " +
            "Enter one and try again.",
          send_failed: "The receipt could not be sent. Please try again.",
        };
        throw new functions.https.HttpsError("failed-precondition",
            messages[result.reason] || "The receipt could not be sent.");
      }
      return result;
    });


/* ======================================
   MASKED CALLING (Twilio)
   Neither side sees the other's number. Twilio rings the person who tapped
   Call, then rings the other party and bridges them. Only works while a trip
   is live (accepted, arrived or ongoing).
   Secrets: TWILIO_SID (Account SID), TWILIO_TOKEN (Auth Token),
   TWILIO_NUMBER (the purchased UK number, e.g. +447700900123).
====================================== */
const TWILIO_SECRETS = ["TWILIO_SID", "TWILIO_TOKEN", "TWILIO_NUMBER"];
const CALLABLE_RIDE_STATUSES = ["accepted", "arrived", "ongoing"];

/**
 * Puts a number into international form. UK numbers default to +44.
 * @param {string} raw Number as stored.
 * @return {string|null} E.164 number, or null if it cannot be read.
 */
function toE164(raw) {
  if (!raw) return null;
  let value = String(raw).replace(/[^\d+]/g, "");
  if (value.startsWith("+")) return value.length >= 8 ? value : null;
  if (value.startsWith("00")) value = "+" + value.slice(2);
  else if (value.startsWith("0")) value = "+44" + value.slice(1);
  else if (value.startsWith("44")) value = "+" + value;
  else return null;
  return value.length >= 8 ? value : null;
}

/**
 * Phone number held for a driver or passenger.
 * @param {string} collection "drivers" or "riders".
 * @param {string} uid User id.
 * @return {Promise<string|null>} E.164 number.
 */
async function phoneFor(collection, uid) {
  if (!uid) return null;
  const snap = await db.collection(collection).doc(uid).get();
  const data = snap.exists ? snap.data() : {};
  const stored = data.phoneNumber || data.phone;
  if (stored) return toE164(stored);
  try {
    const user = await admin.auth().getUser(uid);
    return toE164(user.phoneNumber);
  } catch (error) {
    return null;
  }
}

/* Passenger or driver taps Call during a live trip. */
exports.startMaskedCall = functions
    .runWith({secrets: TWILIO_SECRETS})
    .https.onCall(async (data, context) => {
      if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated",
            "Please sign in.");
      }
      // "placeholder" is what the launch guide stores before the real
      // Twilio details exist; treat it, and anything that is not a real
      // account SID, as not configured rather than ringing Twilio.
      const sid = process.env.TWILIO_SID;
      const token = process.env.TWILIO_TOKEN;
      const from = process.env.TWILIO_NUMBER;
      const unset = (v) => !v || /^placeholder$/i.test(String(v).trim());
      if (unset(sid) || unset(token) || unset(from) ||
          !/^AC[0-9a-f]{32}$/i.test(String(sid).trim())) {
        throw new functions.https.HttpsError("failed-precondition",
            "Calling is not switched on yet.");
      }

      const rideId = data && data.rideId;
      if (!rideId) {
        throw new functions.https.HttpsError("invalid-argument",
            "Missing rideId");
      }

      const snap = await db.collection("rides").doc(rideId).get();
      if (!snap.exists) {
        throw new functions.https.HttpsError("not-found", "Ride not found");
      }
      const ride = snap.data();
      const uid = context.auth.uid;
      const isDriver = ride.driverId === uid;
      const isRider = ride.riderId === uid;
      if (!isDriver && !isRider) {
        throw new functions.https.HttpsError("permission-denied",
            "This is not your trip.");
      }
      if (!CALLABLE_RIDE_STATUSES.includes(ride.status)) {
        throw new functions.https.HttpsError("failed-precondition",
            "Calling is only available during a trip. " +
            "Use My reports if you need help after a trip.");
      }

      const callerNumber = isDriver ?
        await phoneFor("drivers", ride.driverId) :
        await phoneFor("riders", ride.riderId);
      const otherNumber = isDriver ?
        await phoneFor("riders", ride.riderId) :
        await phoneFor("drivers", ride.driverId);

      if (!callerNumber) {
        throw new functions.https.HttpsError("failed-precondition",
            "We do not have your phone number. Add it in your profile.");
      }
      if (!otherNumber) {
        throw new functions.https.HttpsError("failed-precondition",
            isDriver ?
              "The passenger has no phone number on file." :
              "Your driver has no phone number on file.");
      }

      // Ring the caller first, then bridge to the other party. The caller ID
      // on both legs is the TakeARoute number, so neither sees the other.
      const twiml = "<Response><Say voice=\"alice\">" +
        "Connecting you to your TakeARoute trip. Please hold." +
        "</Say><Dial callerId=\"" + from + "\" timeout=\"30\">" +
        otherNumber + "</Dial></Response>";

      const body = new URLSearchParams({
        To: callerNumber,
        From: from,
        Twiml: twiml,
        TimeLimit: "900",
      });

      const response = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`,
          {
            method: "POST",
            headers: {
              "Authorization": "Basic " +
                Buffer.from(`${sid}:${token}`).toString("base64"),
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
          },
      );

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.error("Twilio call failed:", response.status,
            result && result.message ? result.message : "no message");
        throw new functions.https.HttpsError("internal",
            "The call could not be connected. Please try again.");
      }

      // Logged for disputes. Numbers are not stored.
      await db.collection("rides").doc(rideId).collection("calls").add({
        callSid: result.sid || null,
        startedBy: isDriver ? "driver" : "rider",
        startedById: uid,
        rideStatus: ride.status,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }).catch(() => null);

      return {connecting: true, callSid: result.sid || null};
    });


/* ======================================
   RATINGS
   The app writes driverRating / riderRating onto the ride. This keeps a
   running average on the person being rated.
====================================== */
exports.updateAverageRating = functions.firestore
    .document("rides/{rideId}")
    .onUpdate(async (change) => {
      const before = change.before.data();
      const after = change.after.data();
      const jobs = [];

      const apply = (collection, uid, ratingObj) => {
        if (!uid || !ratingObj || !(ratingObj.stars >= 1)) return;
        const ref = db.collection(collection).doc(uid);
        jobs.push(db.runTransaction(async (t) => {
          const snap = await t.get(ref);
          if (!snap.exists) return;
          const d = snap.data();
          const count = Number(d.ratingCount) || 0;
          const avg = Number(d.rating) || 0;
          const newCount = count + 1;
          const newAvg = (avg * count + ratingObj.stars) / newCount;
          t.update(ref, {
            rating: Math.round(newAvg * 100) / 100,
            ratingCount: newCount,
          });
        }));
      };

      if (!before.driverRating && after.driverRating) {
        apply("drivers", after.driverId, after.driverRating);
      }
      if (!before.riderRating && after.riderRating) {
        apply("riders", after.riderId, after.riderRating);
      }
      await Promise.all(jobs);
      return null;
    });

