/* ======================================
   FLEET BILLING
   What a fleet pays TakeARoute each month, and how it pays.

   - Plan, chosen by the admin when the fleet is created: "per_driver" (each
     driver, company or self-employed, pays their own TakeARoute membership
     and the fleet is billed nothing) or "monthly" (one flat
     fleets.monthlyFee that covers all its drivers).
   - billFleets (fleet.js) takes the bill from the fleet's wallet. If that
     leaves the wallet below zero, the fleet's saved card pays the rest.
   - No card, or the card fails: the fleet is "past due" for the driver grace
     period (config subscription.graceDays), then paused. Paying (card on
     file, or "Pay now" on the dashboard) brings it straight back.
   - Card payments go through Stripe Checkout, so the dashboard needs no
     Stripe code. The dashboard confirms the payment on return, and the
     payment webhook does the same in case the page was closed: whichever
     comes first credits the wallet, keyed by the PaymentIntent id.
====================================== */

module.exports = (deps) => {
  const {functions, db, stripe, loadAppConfig, toMillis} = deps;
  const {HttpsError} = functions.https;
  const {FieldValue, Timestamp} = require("firebase-admin/firestore");

  const DAY_MS = 24 * 3600 * 1000;
  // Where Stripe Checkout may send the owner back to.
  const RETURN_ORIGINS = [
    "https://admin.takearoute.ltd",
    "https://admin-dashboard.takearouteltd.workers.dev",
    "http://127.0.0.1:5199",
    "http://localhost:5199",
  ];

  const fleetRef = (id) => db.collection("fleets").doc(id);
  const walletRef = (id) => db.collection("fleetWallets").doc(id);
  const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

  /**
   * The plan's monthly price for one billing date.
   * @param {Object} fleet Fleet data.
   * @param {number} companyDrivers Company drivers in the fleet now.
   * @param {Object} cfg App config.
   * @return {{amount: number, description: string, price: number}}
   */
  function billFor(fleet, companyDrivers, cfg) {
    if (fleet.billingPlan === "monthly") {
      const fee = round2(Math.max(0, Number(fleet.monthlyFee) || 0));
      return {amount: fee, price: fee,
        description: "Monthly fleet subscription"};
    }
    const price = fleet.perDriverMonthly !== null &&
      fleet.perDriverMonthly !== undefined &&
      Number(fleet.perDriverMonthly) >= 0 ?
      Number(fleet.perDriverMonthly) : cfg.subscription.monthlyPrice;
    return {amount: round2(companyDrivers * price), price,
      description: `Membership: ${companyDrivers} driver(s) x ${price}`};
  }

  /**
   * What the fleet owes now: the amount its wallet is below zero.
   * @param {string} fleetId Fleet.
   * @return {Promise<number>} Owed, in pounds, 0 if none.
   */
  async function owedBy(fleetId) {
    const snap = await walletRef(fleetId).get();
    const balance = snap.exists ? Number(snap.data().availableBalance || 0) : 0;
    return balance < 0 ? round2(-balance) : 0;
  }

  /**
   * Puts the fleet back in good standing once nothing is owed, and lifts a
   * pause that was only for not paying.
   * @param {string} fleetId Fleet.
   * @return {Promise<void>}
   */
  async function settleBillingState(fleetId) {
    if (await owedBy(fleetId) > 0) return;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(fleetRef(fleetId));
      if (!snap.exists) return;
      const fleet = snap.data();
      const update = {};
      if ((fleet.billing || {}).status === "past_due") {
        update["billing.status"] = "ok";
        update["billing.graceUntil"] = null;
        update["billing.owed"] = 0;
      }
      if (fleet.status === "suspended" && fleet.suspendedReason === "unpaid") {
        update.status = "active";
        update.suspendedReason = FieldValue.delete();
        update.resumedAt = FieldValue.serverTimestamp();
      }
      if (Object.keys(update).length) tx.update(snap.ref, update);
    });
  }

  /**
   * Credits a card payment to the fleet's wallet, once per PaymentIntent.
   * @param {string} fleetId Fleet.
   * @param {Object} pi Stripe PaymentIntent (succeeded).
   * @param {string} via "card_on_file", "checkout" or "webhook".
   * @return {Promise<boolean>} True if this call credited it.
   */
  async function applyPayment(fleetId, pi, via) {
    if (!pi || pi.status !== "succeeded") return false;
    const amount = round2((pi.amount_received || pi.amount || 0) / 100);
    if (!(amount > 0)) return false;
    const txRef = walletRef(fleetId).collection("transactions").doc(pi.id);
    let credited = false;
    await db.runTransaction(async (tx) => {
      const seen = await tx.get(txRef);
      if (seen.exists) return;
      tx.set(walletRef(fleetId), {
        availableBalance: FieldValue.increment(amount),
        totalCardPaid: FieldValue.increment(amount),
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      tx.set(txRef, {
        type: "card_payment", amount, via,
        paymentIntentId: pi.id,
        description: "Card payment to TakeARoute",
        createdAt: FieldValue.serverTimestamp(),
      });
      credited = true;
    });
    if (credited) await settleBillingState(fleetId);
    return credited;
  }

  /**
   * Marks the fleet past due (once), starting the grace period.
   * @param {string} fleetId Fleet.
   * @param {number} owed Amount owed.
   * @param {string} reason "no_card" or the card's decline message.
   * @return {Promise<void>}
   */
  async function markPastDue(fleetId, owed, reason) {
    const cfg = await loadAppConfig();
    // 0 is a real setting: no grace at all.
    const setDays = Number(cfg.subscription.graceDays);
    const graceDays = Number.isFinite(setDays) && setDays >= 0 ? setDays : 3;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(fleetRef(fleetId));
      if (!snap.exists) return;
      const billing = snap.data().billing || {};
      const update = {"billing.owed": owed, "billing.lastError": reason};
      if (billing.status !== "past_due") {
        update["billing.status"] = "past_due";
        update["billing.pastDueSince"] = FieldValue.serverTimestamp();
        update["billing.graceUntil"] =
          Timestamp.fromMillis(Date.now() + graceDays * DAY_MS);
      }
      tx.update(snap.ref, update);
    });
  }

  /**
   * Charges the saved card for whatever the wallet is below zero. Marks the
   * fleet past due when there is no card or it is declined.
   * @param {string} fleetId Fleet.
   * @return {Promise<string>} "nothing_owed", "paid", "no_card" or "failed".
   */
  async function chargeShortfall(fleetId) {
    const owed = await owedBy(fleetId);
    if (!(owed > 0)) {
      await settleBillingState(fleetId);
      return "nothing_owed";
    }
    const snap = await fleetRef(fleetId).get();
    const fleet = snap.exists ? snap.data() : {};
    const billing = fleet.billing || {};
    if (!billing.stripeCustomerId || !billing.paymentMethodId) {
      await markPastDue(fleetId, owed, "no_card");
      return "no_card";
    }
    const day = new Date().toISOString().slice(0, 10);
    try {
      const pi = await stripe.paymentIntents.create({
        amount: Math.round(owed * 100),
        currency: String(fleet.currency || "GBP").toLowerCase(),
        customer: billing.stripeCustomerId,
        payment_method: billing.paymentMethodId,
        off_session: true,
        confirm: true,
        description: `TakeARoute subscription, ${fleet.name || fleetId}`,
        metadata: {type: "fleet_billing", fleetId},
        // Per card: Stripe replays a decline for a reused key, so a new card
        // needs its own. The same card is still charged once that day.
      }, {idempotencyKey: `fleet-bill-${fleetId}-${day}-` +
        `${Math.round(owed * 100)}-${billing.paymentMethodId}`});
      if (pi.status === "succeeded") {
        await applyPayment(fleetId, pi, "card_on_file");
        return "paid";
      }
      await markPastDue(fleetId, owed, `Card payment ${pi.status}`);
      return "failed";
    } catch (error) {
      const message = (error && error.message) || "Card declined";
      console.error("Fleet card charge failed:", fleetId, message);
      await markPastDue(fleetId, owed, message.slice(0, 200));
      return "failed";
    }
  }

  /**
   * Pauses fleets whose grace period has run out, and tries their card once
   * more first. Clears fleets that have paid by other means.
   * @return {Promise<Object>} Counts.
   */
  async function enforce() {
    const due = await db.collection("fleets")
        .where("billing.status", "==", "past_due").get();
    let paused = 0;
    let cleared = 0;
    for (const doc of due.docs) {
      const result = await chargeShortfall(doc.id);
      if (result === "paid" || result === "nothing_owed") {
        cleared++;
        continue;
      }
      const fresh = (await doc.ref.get()).data() || {};
      const grace = toMillis((fresh.billing || {}).graceUntil);
      if (grace && grace < Date.now() && fresh.status !== "suspended") {
        await doc.ref.update({
          status: "suspended",
          suspendedReason: "unpaid",
          suspendedAt: FieldValue.serverTimestamp(),
        });
        paused++;
        console.log(`Fleet ${doc.id} paused: subscription unpaid`);
      }
    }
    return {checked: due.size, paused, cleared};
  }

  /**
   * The caller's fleet, for its owner. Unlike the other fleet calls this
   * also works while the fleet is paused, so it can pay to come back.
   * @param {Object} context Callable context.
   * @return {Promise<Object>} {uid, fleetId, fleet}.
   */
  async function assertOwner(context) {
    if (!context.auth) throw new HttpsError("unauthenticated", "Sign in.");
    const m = await db.collection("fleetManagers").doc(context.auth.uid).get();
    const manager = m.exists ? m.data() : null;
    if (!manager || manager.isActive !== true || !manager.fleetId ||
        manager.role !== "owner") {
      throw new HttpsError("permission-denied",
          "Only the fleet owner can manage billing.");
    }
    const f = await fleetRef(manager.fleetId).get();
    if (!f.exists) throw new HttpsError("not-found", "No such fleet.");
    return {uid: context.auth.uid, fleetId: manager.fleetId, fleet: f.data(),
      email: manager.email || f.data().ownerEmail || null};
  }

  /**
   * The fleet's Stripe customer, made on first use.
   * @param {string} fleetId Fleet.
   * @param {Object} fleet Fleet data.
   * @param {?string} email Owner's email.
   * @return {Promise<string>} Customer id.
   */
  async function customerFor(fleetId, fleet, email) {
    const existing = (fleet.billing || {}).stripeCustomerId;
    if (existing) return existing;
    const customer = await stripe.customers.create({
      name: fleet.name || "Fleet",
      email: email || fleet.ownerEmail || undefined,
      metadata: {type: "fleet", fleetId},
    }, {idempotencyKey: `fleet-customer-${fleetId}`});
    await fleetRef(fleetId).update({"billing.stripeCustomerId": customer.id});
    return customer.id;
  }

  /**
   * Saves a card as the fleet's card for monthly bills.
   * @param {string} fleetId Fleet.
   * @param {string} customerId Stripe customer.
   * @param {string} paymentMethodId Card.
   * @return {Promise<void>}
   */
  async function saveCard(fleetId, customerId, paymentMethodId) {
    if (!paymentMethodId) return;
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    await stripe.customers.update(customerId, {
      invoice_settings: {default_payment_method: paymentMethodId},
    }).catch(() => null);
    const card = pm.card || {};
    await fleetRef(fleetId).update({
      "billing.paymentMethodId": paymentMethodId,
      "billing.card": {brand: card.brand || "card", last4: card.last4 || "",
        expMonth: card.exp_month || null, expYear: card.exp_year || null},
      "billing.cardSavedAt": FieldValue.serverTimestamp(),
    });
  }

  const out = {};
  const secrets = deps.STRIPE_SECRETS;

  /* The owner adds or replaces the card, or pays what is owed now. Returns a
     Stripe Checkout link; the dashboard sends the owner there. */
  out.fleetBillingCheckout = functions.runWith({secrets}).https
      .onCall(async (data, context) => {
        const me = await assertOwner(context);
        const kind = data && data.kind === "pay" ? "pay" : "card";
        const back = String((data && data.returnUrl) || "");
        const origin = RETURN_ORIGINS.find((o) => back === o ||
          back.startsWith(o + "/"));
        if (!origin) {
          throw new HttpsError("invalid-argument", "Unknown return address.");
        }
        const base = back.split("?")[0].split("#")[0];
        const customer = await customerFor(me.fleetId, me.fleet, me.email);
        const currency = String(me.fleet.currency || "GBP").toLowerCase();
        const metadata = {type: "fleet_billing", fleetId: me.fleetId, kind};
        const common = {
          customer,
          client_reference_id: me.fleetId,
          metadata,
          success_url: `${base}?billing=done&session={CHECKOUT_SESSION_ID}`,
          cancel_url: `${base}?billing=cancelled`,
        };
        let session;
        if (kind === "pay") {
          const owed = await owedBy(me.fleetId);
          if (!(owed >= 0.3)) {
            throw new HttpsError("failed-precondition",
                "There is nothing to pay right now.");
          }
          session = await stripe.checkout.sessions.create(Object.assign({
            mode: "payment",
            line_items: [{quantity: 1, price_data: {
              currency, unit_amount: Math.round(owed * 100),
              product_data: {name: `TakeARoute subscription, ${me.fleet.name}`},
            }}],
            payment_intent_data: {setup_future_usage: "off_session", metadata},
          }, common));
        } else {
          session = await stripe.checkout.sessions.create(Object.assign({
            mode: "setup",
            currency,
            payment_method_types: ["card"],
            setup_intent_data: {metadata},
          }, common));
        }
        return {url: session.url};
      });

  /* The dashboard calls this when Stripe sends the owner back. */
  out.confirmFleetCheckout = functions.runWith({secrets}).https
      .onCall(async (data, context) => {
        const me = await assertOwner(context);
        const id = String((data && data.sessionId) || "").slice(0, 200);
        if (!id.startsWith("cs_")) {
          throw new HttpsError("invalid-argument", "Unknown checkout.");
        }
        const session = await stripe.checkout.sessions.retrieve(id,
            {expand: ["payment_intent", "setup_intent"]});
        if (!session.metadata || session.metadata.fleetId !== me.fleetId) {
          throw new HttpsError("permission-denied", "Not your checkout.");
        }
        const customer = session.customer;
        let paid = false;
        if (session.mode === "payment" && session.payment_intent) {
          const pi = session.payment_intent;
          paid = pi.status === "succeeded";
          await applyPayment(me.fleetId, pi, "checkout");
          if (pi.payment_method) {
            await saveCard(me.fleetId, customer, pi.payment_method);
          }
        } else if (session.mode === "setup" && session.setup_intent &&
            session.setup_intent.status === "succeeded") {
          await saveCard(me.fleetId, customer,
              session.setup_intent.payment_method);
          // A monthly fleet's first bill waits for its card: take it now.
          if (api.billIfDue) {
            await api.billIfDue(me.fleetId).catch((e) =>
              console.error("billIfDue", me.fleetId, e.message));
          }
          // A new card while money is owed: use it straight away.
          if (await owedBy(me.fleetId) > 0) {
            paid = (await chargeShortfall(me.fleetId)) === "paid";
          }
        }
        const fresh = (await fleetRef(me.fleetId).get()).data() || {};
        return {paid, status: fresh.status,
          billingStatus: (fresh.billing || {}).status || "ok",
          owed: await owedBy(me.fleetId)};
      });

  /* Tells the owner by email when the fleet goes past due or is paused for
     not paying. The dashboard's banner reads billing.status and graceUntil
     itself; this reaches an owner who is not looking at it. */
  out.notifyFleetBillingChange = functions
      .runWith({secrets: ["RESEND_API_KEY"]}).firestore
      .document("fleets/{fleetId}")
      .onUpdate(async (change, context) => {
        const before = change.before.data() || {};
        const after = change.after.data() || {};
        const bill = after.billing || {};
        const pastDue = bill.status === "past_due" &&
          (before.billing || {}).status !== "past_due";
        const paused = after.status === "suspended" &&
          after.suspendedReason === "unpaid" && before.status !== "suspended";
        if ((!pastDue && !paused) || !after.ownerEmail) return null;
        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) return null;
        const name = after.name || "your fleet";
        const owed = `£${Number(bill.owed || 0).toFixed(2)}`;
        const by = bill.graceUntil && bill.graceUntil.toDate ?
          bill.graceUntil.toDate().toLocaleDateString("en-GB", {day: "numeric",
            month: "long", timeZone: "Europe/London"}) : "soon";
        const subject = paused ? `${name} has been paused on TakeARoute` :
          `Payment needed for ${name} on TakeARoute`;
        const text = paused ?
          `Your TakeARoute subscription is unpaid (${owed}), so ${name} has ` +
            "been paused. New bookings are off until it is paid. Sign in " +
            "to your dashboard and choose Pay now: the fleet comes back on " +
            "straight away." :
          `We could not take your TakeARoute subscription payment of ` +
            `${owed} for ${name}. Please pay by ${by}, or ${name} will be ` +
            "paused. You can pay or change your card on your dashboard.";
        const response = await fetch(process.env.RESEND_API_URL ||
          "https://api.resend.com/emails", {
          method: "POST",
          headers: {"Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"},
          body: JSON.stringify({
            from: "TakeARoute <billing@invoice.takearoute.ltd>",
            to: [after.ownerEmail], subject, text,
          }),
        }).catch((error) => {
          console.error("Fleet billing email", context.params.fleetId, error);
          return null;
        });
        if (response && !response.ok) {
          console.error("Fleet billing email failed:", response.status);
        }
        return null;
      });

  /* Daily: last card attempt, then pause fleets past their grace period. */
  out.enforceFleetBilling = functions.runWith({secrets}).pubsub
      .schedule("every day 07:00").timeZone("Europe/London")
      .onRun(async () => {
        const result = await enforce();
        console.log("Fleet billing:", JSON.stringify(result));
        return null;
      });

  const api = {
    functions: out,
    billFor,
    chargeShortfall,
    applyPayment,
    settleBillingState,
    owedBy,
    /**
     * For the payment webhook: credits a fleet payment the dashboard did
     * not confirm (page closed before returning from Stripe).
     * @param {Object} pi PaymentIntent from the event.
     * @return {Promise<boolean>} Whether it was a fleet payment.
     */
    async handleWebhookPayment(pi) {
      const meta = (pi && pi.metadata) || {};
      const fleetId = meta.type === "fleet_billing" ? meta.fleetId : null;
      if (!fleetId) return false;
      await applyPayment(fleetId, pi, "webhook");
      return true;
    },
  };
  return api;
};
