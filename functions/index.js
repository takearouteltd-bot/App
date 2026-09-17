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
// Recommended: set via firebase config or env variable
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
/* ======================================
   CREATE STRIPE CUSTOMER
====================================== */
exports.createStripeCustomer = functions.https.onCall(async (data, context) => {
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
exports.createSetupIntent = functions.https.onCall(async (data, context) => {
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
exports.saveCard = functions.https.onCall(async (data, context) => {
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
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

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

exports.authorizePaymentOnRideAccept = functions.firestore
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
              currency: "gbp",
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
          currency: "gbp",

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

exports.chargeOnRideCompletion = functions.firestore
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

        if (after.fare && after.fare.total) {
          finalAmount = Math.round(after.fare.total * 100);
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
                currency: "gbp",
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
          paymentStatus: "captured",
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


exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
  const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
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


exports.cancelRidePayment = functions.firestore
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

exports.createStripeAccountLink = functions.https.onRequest(
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

      const driverEarning = after && after.fare &&
      after.fare.total ? Number(after.fare.total) : 0;
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

  const MIN_PAYOUT = 0.01; // Set your minimum, e.g., 10.00 for production
  if (requestedAmount < MIN_PAYOUT) {
    throw new functions.https.HttpsError("failed-precondition",
        "Minimum payout is £" + MIN_PAYOUT);
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


exports.detachPaymentMethod = functions.https.onCall(async (data, context) => {
  const {paymentMethodId} = data;

  // Verify auth
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
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


const MONTHLY_PRICE = 99.99;

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
