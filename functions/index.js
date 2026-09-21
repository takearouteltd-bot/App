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
  subscription: {monthlyPrice: 99.99},
  drivers: {minimumPayout: 10},
  dispatch: {searchRadiusKm: 50, requestTimeoutSeconds: 20},
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
    },
    drivers: {
      minimumPayout: numSetting(data.drivers, "minimumPayout",
          d.drivers.minimumPayout),
    },
    dispatch: {
      searchRadiusKm: numSetting(data.dispatch, "searchRadiusKm",
          d.dispatch.searchRadiusKm),
      requestTimeoutSeconds: numSetting(data.dispatch,
          "requestTimeoutSeconds", d.dispatch.requestTimeoutSeconds),
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
        const userDoc = await db.collection("riders").doc(uid).get();

        if (!userDoc.exists) {
          throw new functions.https.HttpsError("not-found", "User not found");
        }

        const stripeCustomerId = userDoc.data().stripeCustomerId;

        if (!stripeCustomerId) {
          throw new functions.https.HttpsError(
              "failed-precondition",
              "Stripe customer missing",
          );
        }

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

      try {
        const riderDoc = await db.collection("riders").doc(riderId).get();
        if (!riderDoc.exists) return null;

        const {stripeCustomerId, defaultPaymentMethodId} = riderDoc.data();

        if (!stripeCustomerId || !defaultPaymentMethodId) {
          console.log("❌ Missing Stripe setup");
          return null;
        }

        const estimatedAmount = Math.round((after.fareEstimate || 0) * 100);

        if (estimatedAmount <= 0) return null;

        // =========================
        // CREATE PAYMENT INTENT
        // =========================
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
              idempotencyKey: `auth_${rideId}`,
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
        });

        console.log("✅ PAYMENT AUTHORIZED:", rideId);
        return null;
      } catch (error) {
        console.error("❌ AUTH FAILED:", error);

        await db.collection("rides").doc(rideId).update({
          status: "payment_failed",
          paymentStatus: "failed",
        });

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

      const paymentIntentId = after.paymentIntentId;

      if (!paymentIntentId) {
        console.log("❌ Missing paymentIntentId");
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
        );

        let capturedIntent;

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

          await stripe.paymentIntents.capture(paymentIntentId, {
            amount_to_capture: paymentIntent.amount,
          });

          const extraAmount = finalAmount - paymentIntent.amount;

          capturedIntent = await stripe.paymentIntents.create(
              {
                amount: extraAmount,
                currency: rideCurrency(after),
                customer: paymentIntent.customer,
                payment_method: paymentIntent.payment_method,
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
        }

        // =========================
        // UPDATE PAYMENT SUCCESS
        // =========================
        await db.collection("payments").doc(paymentIntentId).update({
          status: "captured",
          amount: finalAmount,
          transactionId: capturedIntent.id,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // =========================
        // UPDATE RIDE (UI ONLY)
        // =========================
        await db.collection("rides").doc(rideId).update({
          "paymentStatus": "captured",
          "fare.waitingCharge": waitingFee,
          "fare.finalTotal": finalTotal,
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

            await db.collection("rides").doc(rideId).update({
              "payment.status": "paid",
              "payment.transactionId": object.id,
              "walletProcessed": true,
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
          await walletRef.create({
            availableBalance: 0,
            pendingBalance: 0,
            currency: "GBP",
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
          const walletSnap = await transaction.get(walletRef);

          if (!walletSnap.exists) {
            transaction.set(walletRef, {
              availableBalance: driverEarning,
              totalEarned: driverEarning,
              pendingBalance: 0,
              currency: "GBP",
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

  // Minimum set on the dashboard (Settings, Drivers).
  const MIN_PAYOUT = (await loadAppConfig()).drivers.minimumPayout;
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
        currency: "GBP",
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
  if (!adminDoc.exists || adminDoc.data().isActive === false) {
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

      try {
        // Verify this payment method belongs to the user
        const pm = await stripe.paymentMethods.retrieve(paymentMethodId);

        if (!pm || !pm.customer) {
          throw new functions.https.HttpsError("not-found",
              "Payment method not found");
        }

        // Optional: check pm.customer matches the user's Stripe customer ID

        await stripe.paymentMethods.detach(paymentMethodId);

        return {success: true};
      } catch (error) {
        console.error("Stripe detach error:", error);
        throw new functions.https.HttpsError("internal", error.message);
      }
    });


exports.autoDeductSubscription = functions
    .region("europe-west2")
    .firestore.document("driverWallets/{driverId}")
    .onUpdate(async (change, context) => {
      const before = change.before.data();
      const after = change.after.data();
      const driverId = context.params.driverId;

      // Only trigger if availableBalance increased
      const prevBalance = before.availableBalance || 0;
      const newBalance = after.availableBalance || 0;

      if (newBalance <= prevBalance) return null;

      const driverRef = db.collection("drivers").doc(driverId);
      const driverSnap = await driverRef.get();

      if (!driverSnap.exists) return null;

      const driverData = driverSnap.data();
      const sub = driverData.subscription || {};

      // Price set on the dashboard (Settings, Subscription).
      const MONTHLY_PRICE = (await loadAppConfig()).subscription.monthlyPrice;

      if (sub.status !== "active" || sub.paymentMethod !== "wallet_deduction") {
        return null;
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      const nowDate = new Date();
      const transactionRef = db
          .collection("driverWallets")
          .doc(driverId)
          .collection("transactions")
          .doc();

      // Case 1: Has debt (first payment or missed payment)
      if (sub.debtAmount && sub.debtAmount > 0) {
        if (newBalance >= sub.debtAmount) {
          const debtAmount = sub.debtAmount;

          // Deduct from wallet
          await change.after.ref.update({
            availableBalance: newBalance - debtAmount,
            totalWithdrawn: (after.totalWithdrawn || 0) + debtAmount,
            updatedAt: now,
          });

          // Log transaction
          await transactionRef.set({
            amount: -debtAmount,
            description: "Monthly subscription payment (debt cleared)",
            type: "subscription_deduction",
            status: "completed",
            createdAt: now,
            updatedAt: now,
          });

          const nextBilling = new Date();
          nextBilling.setMonth(nextBilling.getMonth() + 1);

          await driverRef.update({
            "subscription.debtAmount": 0,
            "subscription.lastPaidAt": now,
            "subscription.nextBillingDate": admin.firestore
                .Timestamp.fromDate(nextBilling),
          });

          console.log("Deducted debt £" +
            debtAmount + " from driver " + driverId);
        }
        return null;
      }

      // Case 2: Monthly renewal due
      const nextBilling = sub.nextBillingDate ?
      sub.nextBillingDate.toDate() : null;
      if (!nextBilling || nextBilling > nowDate) return null;

      if (newBalance >= MONTHLY_PRICE) {
      // Deduct from wallet
        await change.after.ref.update({
          availableBalance: newBalance - MONTHLY_PRICE,
          totalWithdrawn: (after.totalWithdrawn || 0) + MONTHLY_PRICE,
          updatedAt: now,
        });

        // Log transaction
        const billingLabel = nextBilling.toLocaleDateString("en-GB", {
          month: "long",
          year: "numeric",
        });

        await transactionRef.set({
          amount: -MONTHLY_PRICE,
          description: "Monthly subscription — " + billingLabel,
          type: "subscription_deduction",
          status: "completed",
          createdAt: now,
          updatedAt: now,
        });

        const newNextBilling = new Date();
        newNextBilling.setMonth(newNextBilling.getMonth() + 1);

        await driverRef.update({
          "subscription.lastPaidAt": now,
          "subscription.nextBillingDate": admin.firestore.
              Timestamp.fromDate(newNextBilling),
        });

        console.log("Monthly sub £" + MONTHLY_PRICE +
          " deducted from driver " + driverId);
      } else {
      // Insufficient balance — suspend
        await driverRef.update({
          "subscription.status": "suspended",
        });

        console.log("Driver " + driverId + " suspended — insufficient balance");
      }

      return null;
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

exports.notifyRideUpdates = functions.firestore
    .document("rides/{rideId}")
    .onUpdate(async (change, context) => {
      const before = change.before.data();
      const after = change.after.data();
      const rideId = context.params.rideId;
      if (before.status === after.status) return null;

      const cancelled = ["cancelled", "canceled"];
      const trip = {channelId: "trip-updates", data: {type: "trip", rideId}};

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
      if (cancelled.includes(after.status)) {
        if (after.cancelledBy === "driver") {
          return sendPush([after.riderId], {...trip,
            title: "Ride cancelled",
            body: "Your driver cancelled this ride. " +
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
    .onUpdate(async (change) => {
      const before = change.before.data();
      const after = change.after.data();
      if (before.status === after.status || after.status === "pending") {
        return null;
      }
      const ok = after.status === "approved";
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
   Optional sender override: RECEIPT_FROM (default receipts@takearoute.ltd).
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
<html><body style="margin:0;background:#F5F7FA;
  font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="background:#17375E;border-radius:18px;padding:24px;">
      <div style="color:#C9D6EA;font-size:14px;">TakeARoute receipt</div>
      <div style="color:#fff;font-size:34px;font-weight:800;margin-top:6px;">
        ${escapeHtml(emailMoney(total, currency))}</div>
      <div style="color:#C9D6EA;font-size:13px;margin-top:4px;">
        ${escapeHtml(date)}, ${escapeHtml(time)}</div>
    </div>

    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:18px;
      padding:20px;margin-top:14px;">
      <div style="font-size:15px;color:#1F2937;font-weight:600;">
        ${escapeHtml(pickup)}</div>
      <div style="color:#9CA3AF;font-size:12px;margin:6px 0;">to</div>
      <div style="font-size:15px;color:#1F2937;font-weight:600;">
        ${escapeHtml(dropoff)}</div>
      <div style="color:#6B7280;font-size:13px;margin-top:12px;">
        ${escapeHtml([distance, duration].filter(Boolean).join(", "))}</div>
    </div>

    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:18px;
      padding:20px;margin-top:14px;">
      <table style="width:100%;border-collapse:collapse;">${rowsHtml}
        <tr><td colspan="2" style="border-top:1px solid #E5E7EB;
          padding-top:10px;"></td></tr>
        <tr>
          <td style="color:#17375E;font-size:16px;font-weight:700;">
            Total paid</td>
          <td style="text-align:right;color:#17375E;font-size:16px;
            font-weight:800;">${escapeHtml(emailMoney(total, currency))}</td>
        </tr>
      </table>
      <div style="color:#6B7280;font-size:13px;margin-top:12px;">
        Paid by card ending ${escapeHtml(ride.cardLast4 || "on file")}.
      </div>
    </div>

    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:18px;
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
  const snap = await db.collection("riders").doc(ride.riderId).get();
  if (snap.exists && snap.data().email) return snap.data().email;
  try {
    const user = await admin.auth().getUser(ride.riderId);
    return user.email || null;
  } catch (error) {
    return null;
  }
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
        "TakeARoute <receipts@takearoute.ltd>",
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
        after.paymentStatus === "paid";
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
      const sid = process.env.TWILIO_SID;
      const token = process.env.TWILIO_TOKEN;
      const from = process.env.TWILIO_NUMBER;
      if (!sid || !token || !from) {
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

      const result = await response.json();
      if (!response.ok) {
        console.error("Twilio call failed:", JSON.stringify(result));
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

