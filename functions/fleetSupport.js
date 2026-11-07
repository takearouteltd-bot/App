/* ======================================
   FLEET TICKETS AND LOST & FOUND
   The app's "Report an issue" (reports/{id}, with a reply thread in
   reports/{id}/messages) went only to TakeARoute. A report about a fleet's
   job, or from one of its drivers, now also goes to that fleet: the office
   sees it in Tickets (or Lost & Found, category "lost_found"), replies and
   sets its status. TakeARoute admins still see every report.

   The office can also log a ticket or a lost item itself, for a phone
   customer (reporterType "office").

   reports/{id}.fleetId, fleetName   set by routeReportToFleet
   reports/{id}.lostItem             {item, where, status, returnedAt}
     status: reported, found, returned, not_found
   Office replies are written with senderRole "admin" so the app (which
   shows anything not "admin" as the reporter's own) shows them as replies;
   fromFleet and senderName say which office sent it.
   ====================================== */

module.exports = (deps) => {
  const {functions, db, FieldValue, text, toE164, assertFleetManager,
    sendPush} = deps;
  const {HttpsError} = functions.https;
  const out = {};

  const STATUSES = ["open", "in_review", "resolved"];
  const ITEM_STATUSES = ["reported", "found", "returned", "not_found"];

  /**
   * The fleet a report belongs to: the job's fleet, else the reporting
   * driver's.
   * @param {Object} r Report data.
   * @return {Promise<?Object>} {id, name}
   */
  async function fleetOfReport(r) {
    let fleetId = null;
    if (r.rideId) {
      const ride = await db.collection("rides").doc(String(r.rideId)).get()
          .catch(() => null);
      fleetId = ride && ride.exists ? ride.data().fleetId || null : null;
    }
    if (!fleetId && r.reporterType === "driver" && r.reporterId) {
      const d = await db.collection("drivers").doc(String(r.reporterId))
          .get().catch(() => null);
      fleetId = d && d.exists ? d.data().fleetId || null : null;
    }
    if (!fleetId) return null;
    const f = await db.collection("fleets").doc(fleetId).get();
    return f.exists ? {id: fleetId, name: f.data().name || ""} : null;
  }

  out.routeReportToFleet = functions.firestore.document("reports/{reportId}")
      .onCreate(async (snap) => {
        const r = snap.data() || {};
        if (r.fleetId) return null;
        const fleet = await fleetOfReport(r);
        if (!fleet) return null;
        return snap.ref.update({fleetId: fleet.id, fleetName: fleet.name,
          lostItem: r.category === "lost_found" ? {item: "",
            where: "", status: "reported"} : FieldValue.delete()});
      });

  /**
   * One of the caller's fleet's reports, or throws.
   * @param {Object} me assertFleetManager result.
   * @param {*} reportId Report.
   * @return {Promise<Object>} Snapshot.
   */
  async function myReport(me, reportId) {
    const id = text(reportId, 128);
    const snap = id ? await db.collection("reports").doc(id).get() : null;
    if (!snap || !snap.exists || snap.data().fleetId !== me.fleetId) {
      throw new HttpsError("not-found", "Not one of your tickets.");
    }
    return snap;
  }
  const staffName = (me) => me.manager.name || me.manager.email || "Staff";

  /* The office replies to the person who reported it. */
  out.replyFleetReport = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, false);
    const snap = await myReport(me, data && data.reportId);
    const body = text(data && data.text, 2000);
    if (!body) throw new HttpsError("invalid-argument", "Write a reply.");
    const r = snap.data();
    await snap.ref.collection("messages").add({
      text: body, senderRole: "admin", fromFleet: true,
      senderName: me.fleet.name || "Your taxi firm",
      staffName: staffName(me), staffUid: me.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    await snap.ref.update({lastReplyAt: FieldValue.serverTimestamp(),
      lastReplyBy: "fleet", updatedAt: FieldValue.serverTimestamp(),
      status: r.status === "open" ? "in_review" : r.status});
    return {ok: true};
  });

  /* Status, outcome and (for lost property) the item's details. */
  out.updateFleetReport = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, false);
    const snap = await myReport(me, data && data.reportId);
    const d = data || {};
    const r = snap.data();
    const update = {updatedAt: FieldValue.serverTimestamp(),
      updatedByFleet: staffName(me)};
    if (d.status !== undefined) {
      if (!STATUSES.includes(d.status)) {
        throw new HttpsError("invalid-argument", "Unknown status.");
      }
      update.status = d.status;
      update.resolvedAt = d.status === "resolved" ?
        FieldValue.serverTimestamp() : null;
    }
    if (d.outcome !== undefined) update.outcome = text(d.outcome, 1000);
    if (d.lostItem && r.category === "lost_found") {
      const li = Object.assign({}, r.lostItem || {});
      if (d.lostItem.item !== undefined) li.item = text(d.lostItem.item, 200);
      if (d.lostItem.where !== undefined) {
        li.where = text(d.lostItem.where, 200);
      }
      if (d.lostItem.status !== undefined) {
        if (!ITEM_STATUSES.includes(d.lostItem.status)) {
          throw new HttpsError("invalid-argument", "Unknown item status.");
        }
        li.status = d.lostItem.status;
        li.returnedAt = d.lostItem.status === "returned" ?
          new Date().toISOString() : null;
        if (["returned", "not_found"].includes(li.status) &&
            d.status === undefined) {
          update.status = "resolved";
          update.resolvedAt = FieldValue.serverTimestamp();
        }
      }
      update.lostItem = li;
    }
    await snap.ref.update(update);
    return {ok: true};
  });

  /* The office logs a ticket or a lost item for a phone customer (or a
     driver who rang in). */
  out.createFleetReport = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, false);
    const d = data || {};
    const lost = d.kind === "lost_found";
    const description = text(d.description, 2000);
    if (!description) {
      throw new HttpsError("invalid-argument", "Describe what happened.");
    }
    let rideId = text(d.rideId, 128) || null;
    let trip = null;
    if (rideId) {
      const ride = await db.collection("rides").doc(rideId).get();
      if (!ride.exists || ride.data().fleetId !== me.fleetId) {
        rideId = null;
      } else {
        const x = ride.data();
        trip = {pickup: (x.pickupLocation || {}).address || "",
          dropoff: (x.dropoffLocation || {}).address || "",
          fare: (x.fare || {}).total || 0, driverId: x.driverId || null};
      }
    }
    const phone = toE164(d.customerPhone) || "";
    const ref = await db.collection("reports").add({
      reporterId: `office_${me.fleetId}`, reporterType: "office",
      reporterEmail: "", fleetId: me.fleetId, fleetName: me.fleet.name || "",
      customer: {name: text(d.customerName, 80), phone},
      rideId, otherPartyId: trip ? trip.driverId : null,
      category: lost ? "lost_found" : "office",
      subCategory: lost ? "lost_item" : "office_ticket",
      categoryLabel: lost ? "Lost & Found" : "Office ticket",
      subCategoryLabel: lost ? "Item left behind" :
        (text(d.subject, 80) || "Office ticket"),
      description, severity: null, status: "open",
      priority: d.urgent ? "urgent" : "normal",
      lostItem: lost ? {item: text(d.item, 200), where: text(d.where, 200),
        status: ITEM_STATUSES.includes(d.itemStatus) ? d.itemStatus :
          "reported"} : null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(), resolvedAt: null,
      assignedTo: null, adminNotes: "",
      createdByFleet: staffName(me),
      tripSnapshot: trip ? {pickup: trip.pickup, dropoff: trip.dropoff,
        fare: trip.fare, completedAt: null} : null,
    });
    // Tell the driver about lost property found in their car, so they
    // check (and keep it safe).
    if (lost && trip && trip.driverId) {
      await sendPush([trip.driverId], {
        title: `${me.fleet.name || "The office"}: lost property`,
        body: `${text(d.item, 80) || "An item"} may have been left in your ` +
          "car. Please check and call the office.",
        channelId: "messages",
        data: {type: "fleet_message"},
      }).catch(() => null);
    }
    return {ok: true, reportId: ref.id};
  });

  return out;
};
