"use strict";

/* Invite a friend (passengers). Ships switched OFF: config/app referrals
   {enabled: 0}, with the reward amounts set on the dashboard (Settings >
   Invite friends) once the owners have chosen them.

   - Each passenger gets a short code (myReferralCode): referralCodes/{CODE}
     = {uid}, and referralProfiles/{uid}.code. Codes are made here only.
   - A new passenger enters a friend's code once (applyReferralCode), before
     their first completed trip, on an account made in the last
     accountAgeDays days and signed in with a phone number (the number the
     text was sent to, from Firebase Auth, never a typed one). It makes
     referrals/{refereeUid} {referrerId, status: "pending"}: one per
     account, by its id.
   - The reward (rewardReferralOnPaidTrip): the first trip of theirs that is
     completed AND paid by card (paymentStatus "captured") with a fare of at
     least minTripFare. Cash is not counted: nothing proves it was paid.
     Then both get ride credit (riderCredit/{uid}.balanceMinor, in pence),
     once, inside a transaction that only moves a "pending" referral on.
   - Ride credit is spent by chargeOnRideCompletion (index.js): it comes off
     the card part of the next card trip (takeRideCredit), leaving at least
     MIN_CHARGE_MINOR on the card. The driver is still credited the whole
     fare (fare.finalTotal), so TakeARoute pays for the credit, as it does a
     promo code. The ride gets fare.creditApplied and fare.cardTotal.
   - Abuse: one invite per phone number ever (referralPhones/{hash}); not
     the referrer's own code, number or phone (push token); no reward when
     the friend's card is one of the referrer's cards, or a card that
     already earned an invite reward (referralCards/{hash of the Stripe card
     fingerprint}); at most monthlyCap referrer rewards a calendar month
     (UK time); a blocked passenger earns nothing. An admin can void any
     referral (adminVoidReferral); unspent credit from it is taken back.
   - Rules: every referral collection is written by the server only; a
     passenger reads their own profile, credit and referrals (firestore.
     rules). Phone and card registries are closed to every app login. */

module.exports = (deps) => {
  const {functions, admin, db, stripe, STRIPE_SECRETS, loadAppConfig,
    toE164, sendPush, emailMoney, rideCurrency, assertAdmin} = deps;
  const {HttpsError} = functions.https;
  const {FieldValue} = require("firebase-admin/firestore");
  const crypto = require("crypto");
  const out = {};

  // No 0/O or 1/I, so a code read out over the phone is typed right.
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const CODE_LENGTH = 7;
  // Wrong codes a passenger may try before they are stopped.
  const MAX_ATTEMPTS = 10;
  // Stripe will not charge much less than this; ride credit always leaves it.
  const MIN_CHARGE_MINOR = 50;
  const DAY_MS = 24 * 3600 * 1000;

  const codes = db.collection("referralCodes");
  const profiles = db.collection("referralProfiles");
  const referrals = db.collection("referrals");
  const phones = db.collection("referralPhones");
  const cards = db.collection("referralCards");
  const credits = db.collection("riderCredit");

  const OFF = "Invite a friend isn't running at the moment.";
  const CANT_USE = "That invite code can't be used on this account.";

  /**
   * One-way hash for the registries, so no number or card is stored.
   * @param {string} kind "phone" or "card".
   * @param {string} value Number or fingerprint.
   * @return {string} Hex digest.
   */
  function hashOf(kind, value) {
    return crypto.createHash("sha256")
        .update(`takearoute-referral-${kind}:${value}`).digest("hex");
  }

  /**
   * A new random code.
   * @return {string} CODE_LENGTH letters and digits.
   */
  function newCode() {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += ALPHABET[crypto.randomInt(ALPHABET.length)];
    }
    return code;
  }

  /**
   * A code as typed, cleaned up, or "" when it cannot be one.
   * @param {*} raw From the app.
   * @return {string} Upper case, letters and digits only.
   */
  function cleanCode(raw) {
    const code = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return code.length >= 4 && code.length <= 12 ? code : "";
  }

  /**
   * The calendar month in UK time, for the monthly cap.
   * @param {Date} when Moment.
   * @return {string} "2026-11".
   */
  function monthKey(when) {
    return when.toLocaleDateString("en-CA", {timeZone: "Europe/London"})
        .slice(0, 7);
  }

  const toMinor = (pounds) => Math.max(0, Math.round(Number(pounds) * 100));

  /**
   * The signed-in caller, or throws.
   * @param {Object} context Callable context.
   * @return {string} Uid.
   */
  function callerOf(context) {
    if (!context.auth) {
      throw new HttpsError("unauthenticated", "Please sign in.");
    }
    return context.auth.uid;
  }

  /**
   * Every number a passenger account is known by (sign-in and record).
   * @param {string} uid Account.
   * @param {?Object} rider riders/{uid} data.
   * @return {Promise<Array<string>>} E.164 numbers.
   */
  async function numbersOf(uid, rider) {
    const found = [];
    try {
      const user = await admin.auth().getUser(uid);
      found.push(toE164(user.phoneNumber));
    } catch (error) {
      // A deleted login has no number.
    }
    if (rider) found.push(toE164(rider.phoneNumber), toE164(rider.phone));
    return [...new Set(found.filter(Boolean))];
  }

  /**
   * The push tokens a passenger's phones registered: two accounts on one
   * phone share one.
   * @param {string} uid Account.
   * @return {Promise<Array<string>>} Tokens.
   */
  async function tokensOf(uid) {
    const snap = await db.collection("pushTokens").doc(uid).get()
        .catch(() => null);
    const tokens = snap && snap.exists ? snap.data().tokens : null;
    return Array.isArray(tokens) ? tokens.filter(Boolean) : [];
  }

  /* ------------------------------------------------------------- codes */

  out.myReferralCode = functions.https.onCall(async (data, context) => {
    const uid = callerOf(context);
    const cfg = (await loadAppConfig()).referrals;
    if (cfg.enabled !== 1) throw new HttpsError("failed-precondition", OFF);
    const rider = await db.collection("riders").doc(uid).get();
    if (!rider.exists) {
      throw new HttpsError("failed-precondition",
          "Finish setting up your passenger profile first.");
    }
    if (rider.data().blocked === true) {
      throw new HttpsError("permission-denied",
          "Your account can't invite friends at the moment.");
    }
    const profileRef = profiles.doc(uid);
    const existing = await profileRef.get();
    if (existing.exists && existing.data().code) {
      return {code: existing.data().code};
    }
    for (let i = 0; i < 6; i++) {
      const code = newCode();
      const made = await db.runTransaction(async (tx) => {
        const [codeSnap, profSnap] = await Promise.all([
          tx.get(codes.doc(code)), tx.get(profileRef)]);
        if (profSnap.exists && profSnap.data().code) {
          return profSnap.data().code;
        }
        if (codeSnap.exists) return null;
        tx.create(codes.doc(code), {uid,
          createdAt: FieldValue.serverTimestamp()});
        tx.set(profileRef, {code,
          codeCreatedAt: FieldValue.serverTimestamp()}, {merge: true});
        return code;
      });
      if (made) return {code: made};
    }
    throw new HttpsError("internal", "Couldn't make your code. Try again.");
  });

  out.applyReferralCode = functions.https.onCall(async (data, context) => {
    const uid = callerOf(context);
    const cfg = (await loadAppConfig()).referrals;
    if (cfg.enabled !== 1) throw new HttpsError("failed-precondition", OFF);
    const code = cleanCode(data && data.code);
    if (!code) {
      throw new HttpsError("invalid-argument",
          "Enter the invite code your friend sent you.");
    }
    const profileRef = profiles.doc(uid);
    const refRef = referrals.doc(uid);
    const [profSnap, refSnap, riderSnap] = await Promise.all([
      profileRef.get(), refRef.get(), db.collection("riders").doc(uid).get()]);
    const profile = profSnap.exists ? profSnap.data() : {};
    if ((Number(profile.codeAttempts) || 0) >= MAX_ATTEMPTS) {
      throw new HttpsError("resource-exhausted",
          "Too many tries. Contact support if your code isn't working.");
    }
    const refuse = async (message, reason) => {
      await profileRef.set({codeAttempts: FieldValue.increment(1)},
          {merge: true}).catch(() => null);
      throw new HttpsError("failed-precondition", message, {reason});
    };
    if (refSnap.exists) {
      throw new HttpsError("already-exists",
          "You've already used an invite code.", {reason: "used"});
    }
    if (!riderSnap.exists) {
      throw new HttpsError("failed-precondition",
          "Finish setting up your passenger profile first.");
    }
    const rider = riderSnap.data();
    if (rider.blocked === true) await refuse(CANT_USE, "blocked");

    // The number the sign-in text went to: a typed number proves nothing.
    let user;
    try {
      user = await admin.auth().getUser(uid);
    } catch (error) {
      throw new HttpsError("unauthenticated", "Please sign in again.");
    }
    const phone = toE164(user.phoneNumber);
    if (!phone) {
      throw new HttpsError("failed-precondition",
          "Invite codes need an account you sign in to with your phone " +
          "number.", {reason: "no_phone"});
    }
    const created = Date.parse(user.metadata && user.metadata.creationTime);
    if (!Number.isFinite(created) ||
        Date.now() - created > cfg.accountAgeDays * DAY_MS) {
      await refuse("Invite codes are for new accounts, within " +
          `${cfg.accountAgeDays} days of joining.`, "too_old");
    }
    const done = await db.collection("rides").where("riderId", "==", uid)
        .where("status", "==", "completed").limit(1).get();
    if (!done.empty) {
      await refuse("Invite codes are for your first trip, and you've " +
          "already taken one.", "has_trips");
    }

    const codeSnap = await codes.doc(code).get();
    if (!codeSnap.exists) {
      await refuse("That invite code isn't right. Check it and try again.",
          "unknown");
    }
    const referrerId = codeSnap.data().uid;
    if (referrerId === uid) {
      await refuse("That's your own code. Share it with friends instead.",
          "own");
    }
    const referrerSnap = await db.collection("riders").doc(referrerId).get();
    if (!referrerSnap.exists || referrerSnap.data().blocked === true) {
      await refuse("That invite code can't be used any more.", "referrer");
    }
    // The same person on a second account: same number or same phone.
    const [theirNumbers, myNumbers, theirTokens, myTokens] = await Promise.all([
      numbersOf(referrerId, referrerSnap.data()), numbersOf(uid, rider),
      tokensOf(referrerId), tokensOf(uid)]);
    if (myNumbers.some((n) => theirNumbers.includes(n)) ||
        myTokens.some((t) => theirTokens.includes(t))) {
      await refuse(CANT_USE, "same_person");
    }

    const phoneRef = phones.doc(hashOf("phone", phone));
    const outcome = await db.runTransaction(async (tx) => {
      const [again, phoneSnap] = await Promise.all([tx.get(refRef),
        tx.get(phoneRef)]);
      if (again.exists) return "used";
      if (phoneSnap.exists) return "phone";
      tx.create(refRef, {
        referrerId, refereeId: uid, code, status: "pending",
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(phoneRef, {refereeId: uid, referrerId,
        at: FieldValue.serverTimestamp()});
      tx.set(profileRef, {referredBy: {code,
        at: FieldValue.serverTimestamp()}}, {merge: true});
      tx.set(profiles.doc(referrerId), {invited: FieldValue.increment(1)},
          {merge: true});
      return "ok";
    });
    if (outcome === "used") {
      throw new HttpsError("already-exists",
          "You've already used an invite code.", {reason: "used"});
    }
    if (outcome === "phone") {
      await refuse("This phone number has already been used with an " +
          "invite code.", "phone_used");
    }
    return {ok: true, reward: cfg.newRiderReward,
      minTripFare: cfg.minTripFare};
  });

  /* ------------------------------------------------------------ reward */

  /**
   * The Stripe card fingerprint of the card a ride was charged to.
   * @param {Object} ride Ride data.
   * @return {Promise<?string>} Fingerprint.
   */
  async function chargedFingerprint(ride) {
    if (!ride.paymentIntentId) return null;
    const pi = await stripe.paymentIntents.retrieve(
        String(ride.paymentIntentId), {expand: ["payment_method"]});
    const pm = pi && pi.payment_method;
    return pm && pm.card && pm.card.fingerprint ? pm.card.fingerprint : null;
  }

  /**
   * Whether a card is one the referrer saved with Stripe.
   * @param {?Object} referrer riders/{id} data.
   * @param {string} fingerprint Card fingerprint.
   * @return {Promise<boolean>} True when it is theirs.
   */
  async function referrerHasCard(referrer, fingerprint) {
    if (!referrer || !referrer.stripeCustomerId) return false;
    const list = await stripe.paymentMethods.list({
      customer: String(referrer.stripeCustomerId), type: "card", limit: 100});
    return (list.data || []).some((pm) =>
      pm.card && pm.card.fingerprint === fingerprint);
  }

  /**
   * Adds credit and its ledger line inside a transaction (no read needed:
   * the balance is an increment).
   * @param {Object} tx Transaction.
   * @param {string} uid Passenger.
   * @param {number} minor Pence.
   * @param {string} currency Code.
   * @param {string} entryId Ledger id (deterministic, so never twice).
   * @param {Object} entry Ledger fields.
   */
  function addCredit(tx, uid, minor, currency, entryId, entry) {
    const ref = credits.doc(uid);
    tx.set(ref, {balanceMinor: FieldValue.increment(minor), currency,
      updatedAt: FieldValue.serverTimestamp()}, {merge: true});
    tx.set(ref.collection("entries").doc(entryId), Object.assign({
      amountMinor: minor, currency,
      createdAt: FieldValue.serverTimestamp()}, entry));
  }

  out.rewardReferralOnPaidTrip = functions
      .runWith({secrets: STRIPE_SECRETS}).firestore
      .document("rides/{rideId}")
      .onUpdate(async (change, context) => {
        const before = change.before.data() || {};
        const after = change.after.data() || {};
        const rideId = context.params.rideId;
        if (before.paymentStatus === "captured" ||
            after.paymentStatus !== "captured" ||
            after.status !== "completed") {
          return null;
        }
        const riderId = after.riderId;
        if (!riderId || riderId === after.driverId ||
            (after.source || "app") !== "app") {
          return null;
        }
        const refRef = referrals.doc(riderId);
        const refSnap = await refRef.get();
        if (!refSnap.exists || refSnap.data().status !== "pending") return null;

        const app = await loadAppConfig();
        const cfg = app.referrals;
        const newMinor = toMinor(cfg.newRiderReward);
        const referrerMinor = toMinor(cfg.referrerReward);
        // Off, or no amounts chosen: it stays pending for a later trip.
        if (cfg.enabled !== 1 || !(newMinor > 0 || referrerMinor > 0)) {
          return null;
        }
        const currency = rideCurrency(after).toUpperCase();
        if (currency !== app.currency) return null;
        const fare = after.fare || {};
        const price = Number(fare.finalTotal || fare.total || 0);
        const onCard = fare.cardTotal != null ? Number(fare.cardTotal) :
          price - (Number(fare.creditApplied) || 0);
        if (price < cfg.minTripFare || !(onCard > 0)) return null;

        const referral = refSnap.data();
        const referrerId = referral.referrerId;
        let fingerprint = null;
        let sameCard = false;
        let referrer = null;
        try {
          const referrerSnap = await db.collection("riders").doc(referrerId)
              .get();
          referrer = referrerSnap.exists ? referrerSnap.data() : null;
          fingerprint = await chargedFingerprint(after);
          if (fingerprint) {
            sameCard = await referrerHasCard(referrer, fingerprint);
          }
        } catch (error) {
          // Can't check the card now: a later paid trip tries again.
          console.error("Referral card check failed:", rideId, error.message);
          return null;
        }
        if (!fingerprint) return null;
        const referrerOk = Boolean(referrer) && referrer.blocked !== true;
        const month = monthKey(new Date());
        const cardRef = cards.doc(hashOf("card", fingerprint));
        const referrerProfile = profiles.doc(referrerId);

        const result = await db.runTransaction(async (tx) => {
          const [r, cardSnap, prof, me] = await Promise.all([tx.get(refRef),
            tx.get(cardRef), tx.get(referrerProfile),
            tx.get(db.collection("riders").doc(riderId))]);
          if (!r.exists || r.data().status !== "pending") return null;
          const decided = {rideId, decidedAt: FieldValue.serverTimestamp()};
          const reason = sameCard ? "same_card_as_referrer" :
            cardSnap.exists && cardSnap.data().refereeId !== riderId ?
              "card_already_used" :
              me.exists && me.data().blocked === true ? "blocked" : null;
          if (reason) {
            tx.update(refRef, Object.assign({status: "blocked", reason},
                decided));
            return {blocked: reason};
          }
          const p = prof.exists ? prof.data() : {};
          const used = Number(p.monthly && p.monthly[month]) || 0;
          const referrerGets = referrerOk && used < cfg.monthlyCap ?
            referrerMinor : 0;
          const referrerNote = !referrerOk ? "referrer_unavailable" :
            referrerMinor > 0 && used >= cfg.monthlyCap ? "monthly_cap" : null;
          if (newMinor > 0) {
            addCredit(tx, riderId, newMinor, currency,
                `referral_${riderId}_welcome`,
                {type: "referral_welcome", referralId: riderId, rideId});
          }
          if (referrerGets > 0) {
            addCredit(tx, referrerId, referrerGets, currency,
                `referral_${riderId}_referrer`,
                {type: "referral_reward", referralId: riderId, rideId});
          }
          tx.update(refRef, Object.assign({
            status: "rewarded", rewardedAt: FieldValue.serverTimestamp(),
            refereeRewardMinor: newMinor, referrerRewardMinor: referrerGets,
            referrerNote, currency, month,
          }, decided));
          tx.set(cardRef, {refereeId: riderId,
            at: FieldValue.serverTimestamp()});
          tx.set(referrerProfile, {
            rewarded: FieldValue.increment(1),
            earnedMinor: FieldValue.increment(referrerGets),
            monthly: {[month]: FieldValue.increment(referrerGets > 0 ? 1 : 0)},
          }, {merge: true});
          tx.set(profiles.doc(riderId), {welcomeMinor: newMinor},
              {merge: true});
          return {newMinor, referrerGets};
        });
        if (!result) return null;
        if (result.blocked) {
          console.log("Referral blocked:", riderId, result.blocked);
          return null;
        }
        console.log("Referral rewarded:", riderId, referrerId, result);
        const push = (uid, minor, body) => minor > 0 ? sendPush([uid], {
          title: `${emailMoney(minor / 100, currency)} ride credit`,
          body, channelId: "trip-updates", data: {type: "referral"},
        }).catch(() => null) : null;
        await Promise.all([
          push(riderId, result.newMinor, "Thanks for riding with " +
            "TakeARoute. It comes off your next card trip."),
          push(referrerId, result.referrerGets, "Your friend took their " +
            "first trip. It comes off your next card trip."),
        ]);
        return null;
      });

  /* -------------------------------------------------- spending credit */

  /**
   * Takes ride credit off a card trip's charge, once per ride (the ledger
   * line ride_{rideId} is the guard, so a retried run gets the same
   * answer). Always leaves MIN_CHARGE_MINOR on the card.
   * @param {string} rideId Ride.
   * @param {Object} ride Ride data.
   * @param {number} dueMinor What the card would be charged, in pence.
   * @param {string} currency Ride currency.
   * @return {Promise<number>} Pence taken off.
   */
  async function takeRideCredit(rideId, ride, dueMinor, currency) {
    const uid = ride && ride.riderId;
    if (!uid || uid === ride.driverId || (ride.source || "app") !== "app" ||
        !(dueMinor > MIN_CHARGE_MINOR)) {
      return 0;
    }
    const creditRef = credits.doc(uid);
    const entryRef = creditRef.collection("entries").doc(`ride_${rideId}`);
    return db.runTransaction(async (tx) => {
      const [c, e] = await Promise.all([tx.get(creditRef), tx.get(entryRef)]);
      if (e.exists) {
        return e.data().restored ? 0 : -Number(e.data().amountMinor) || 0;
      }
      if (!c.exists) return 0;
      const balance = Math.floor(Number(c.data().balanceMinor) || 0);
      if (String(c.data().currency || "").toUpperCase() !==
          String(currency).toUpperCase()) {
        return 0;
      }
      const take = Math.min(balance, dueMinor - MIN_CHARGE_MINOR);
      if (!(take > 0)) return 0;
      tx.update(creditRef, {balanceMinor: FieldValue.increment(-take),
        updatedAt: FieldValue.serverTimestamp()});
      tx.set(entryRef, {type: "ride", amountMinor: -take, rideId,
        currency: String(currency).toUpperCase(),
        createdAt: FieldValue.serverTimestamp()});
      return take;
    });
  }

  /**
   * Gives back credit taken for a ride whose card was not charged.
   * @param {string} rideId Ride.
   * @param {string} uid Passenger.
   * @return {Promise<void>}
   */
  async function restoreRideCredit(rideId, uid) {
    if (!uid) return;
    const creditRef = credits.doc(uid);
    const entryRef = creditRef.collection("entries").doc(`ride_${rideId}`);
    await db.runTransaction(async (tx) => {
      const e = await tx.get(entryRef);
      if (!e.exists || e.data().restored) return;
      const minor = -Number(e.data().amountMinor) || 0;
      tx.update(creditRef, {balanceMinor: FieldValue.increment(minor),
        updatedAt: FieldValue.serverTimestamp()});
      tx.update(entryRef, {restored: true,
        restoredAt: FieldValue.serverTimestamp()});
    });
  }

  /* -------------------------------------------------------------- admin */

  out.adminVoidReferral = functions.https.onCall(async (data, context) => {
    const adminUid = await assertAdmin(context);
    const refereeId = data && typeof data.refereeId === "string" ?
      data.refereeId : "";
    const why = String((data && data.reason) || "").trim().slice(0, 300);
    if (!refereeId) throw new HttpsError("invalid-argument", "Missing id.");
    if (!why) throw new HttpsError("invalid-argument", "Give a reason.");
    const refRef = referrals.doc(refereeId);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(refRef);
      if (!snap.exists) throw new HttpsError("not-found", "No such referral.");
      const r = snap.data();
      if (r.status === "void") return {ok: true, already: true};
      const back = {referee: 0, referrer: 0};
      if (r.status === "rewarded") {
        // Unspent credit only: a balance never goes below nothing.
        const [mine, theirs] = await Promise.all([
          tx.get(credits.doc(refereeId)), tx.get(credits.doc(r.referrerId))]);
        const takeBack = (snapC, owed) => Math.max(0, Math.min(owed,
            Math.floor(Number(snapC.exists && snapC.data().balanceMinor) ||
              0)));
        back.referee = takeBack(mine, Number(r.refereeRewardMinor) || 0);
        back.referrer = takeBack(theirs, Number(r.referrerRewardMinor) || 0);
        const currency = r.currency || "GBP";
        if (back.referee > 0) {
          addCredit(tx, refereeId, -back.referee, currency,
              `referral_${refereeId}_void`,
              {type: "referral_void", referralId: refereeId});
        }
        if (back.referrer > 0) {
          addCredit(tx, r.referrerId, -back.referrer, currency,
              `referral_${refereeId}_void`,
              {type: "referral_void", referralId: refereeId});
        }
        tx.set(profiles.doc(r.referrerId), {
          rewarded: FieldValue.increment(-1),
          earnedMinor: FieldValue.increment(
              -(Number(r.referrerRewardMinor) || 0)),
        }, {merge: true});
      }
      tx.update(refRef, {
        status: "void", previousStatus: r.status || null,
        voidedAt: FieldValue.serverTimestamp(), voidedBy: adminUid,
        voidReason: why, takenBackMinor: back,
      });
      return {ok: true, takenBackMinor: back};
    });
  });

  /**
   * Removes a deleted account's code, profile and credit. The referral
   * records and the phone and card registries stay (ids and hashes only),
   * so a new account on the same number cannot claim again.
   * @param {string} uid Account.
   * @return {Promise<void>}
   */
  async function forgetAccount(uid) {
    const prof = await profiles.doc(uid).get();
    const code = prof.exists ? prof.data().code : null;
    if (code) await codes.doc(String(code)).delete();
    await db.recursiveDelete(profiles.doc(uid));
    await db.recursiveDelete(credits.doc(uid));
  }

  return {functions: out, takeRideCredit, restoreRideCredit, forgetAccount,
    MIN_CHARGE_MINOR};
};
