/* ======================================
   PAYMENT ALERTS
   Money problems somebody at TakeARoute has to look at: a card that could
   not be charged, a wallet credit that failed, a payout stuck in Stripe.

   paymentAlerts/{kind_key}   server only; the admin Payments page reads and
                              closes them through the two calls below.
     kind, status "open" | "resolved", title, detail, amount, currency,
     rideId, driverId, fleetId, payoutId, paymentIntentId, createdAt,
     resolvedAt, resolvedBy, resolutionNote

   One alert per problem: the document id comes from what went wrong, so a
   function that runs twice does not raise it twice.
====================================== */

module.exports = ({functions, db}) => {
  const {FieldValue} = require("firebase-admin/firestore");
  const {HttpsError} = functions.https;
  const alerts = db.collection("paymentAlerts");

  /**
   * Records a problem for the admins. Never throws: an alert must not stop
   * the work that raised it.
   * @param {string} kind What went wrong, e.g. "card_capture_failed".
   * @param {string} key What it went wrong on, e.g. the ride id.
   * @param {Object} fields title, detail and any of the fields above.
   * @return {Promise<void>}
   */
  async function raise(kind, key, fields) {
    await alerts.doc(`${kind}_${key}`).create(Object.assign({}, fields, {
      kind, status: "open", createdAt: FieldValue.serverTimestamp(),
    })).catch((error) => {
      if (error.code !== 6) console.error("Alert not saved:", kind, key, error);
    });
  }

  /**
   * Throws unless the caller is a signed-in, active admin.
   * @param {Object} context Callable context.
   * @return {Promise<string>} The admin's uid.
   */
  async function assertAdmin(context) {
    if (!context.auth) throw new HttpsError("unauthenticated", "Sign in.");
    const snap = await db.collection("admins").doc(context.auth.uid).get();
    if (!snap.exists || snap.data().isActive !== true) {
      throw new HttpsError("permission-denied", "Admins only.");
    }
    return context.auth.uid;
  }

  const millis = (t) => (t && t.toMillis ? t.toMillis() : null);

  /* The Payments page: newest first, open ones only unless asked. */
  const adminListPaymentAlerts = functions.https.onCall(
      async (data, context) => {
        await assertAdmin(context);
        const all = data && data.includeResolved === true;
        const snap = await alerts.orderBy("createdAt", "desc").limit(200).get();
        return {alerts: snap.docs
            .filter((d) => all || d.data().status === "open")
            .map((d) => Object.assign({}, d.data(), {id: d.id,
              createdAt: millis(d.data().createdAt),
              resolvedAt: millis(d.data().resolvedAt)}))};
      });

  /* An admin has dealt with it. */
  const adminResolvePaymentAlert = functions.https.onCall(
      async (data, context) => {
        const uid = await assertAdmin(context);
        const id = String((data && data.alertId) || "").slice(0, 300);
        const ref = alerts.doc(id || "-");
        if (!(await ref.get()).exists) {
          throw new HttpsError("not-found", "Alert not found.");
        }
        await ref.update({status: "resolved",
          resolvedAt: FieldValue.serverTimestamp(), resolvedBy: uid,
          resolutionNote: String((data && data.note) || "").slice(0, 500)});
        return {ok: true};
      });

  return {raise,
    functions: {adminListPaymentAlerts, adminResolvePaymentAlert}};
};
