/* ======================================
   BID JOBS
   A second chance for a job nobody is taking. When a job runs out of
   drivers it is opened as a "BID JOB": every available driver within
   bidJobs.radiusKm (or the normal search radius, whichever is bigger) who
   has not turned it down is rung again, and the app shows it highlighted,
   with how far away it is. Drivers who only let the alert run out count as
   available; a driver who pressed Decline is never asked again.

   The first offer of a job is always the normal one (M&S, 16 Nov 2026:
   "this job should come as normal"), even when nobody is online when it is
   booked. It becomes a BID JOB the second time round:
   - app jobs (status "searching"):
       a driver declined it and no other available driver is in range;
       nobody took it for bidJobs.afterSeconds (openBidJobs, every minute),
       which also covers nobody being online when it was booked;
       a driver who had accepted it gave it back (straight away, "given_back").
   - phone jobs sent to the whole fleet, by queue or to the nearest
     (status "dispatching", fleet.js): the queue or nearest steps ran out,
     a decline left nobody, the whole-fleet ring went unanswered for
     bidJobs.afterSeconds, or a driver who had accepted it gave it back.
     Phone jobs stay at the office's fixed price (no counter-offers), and
     only that fleet's drivers are asked. A job sent to one driver by name
     never becomes a BID JOB: it goes back to the office as before.
   A BID JOB is rung again every bidJobs.afterSeconds until someone takes it
   (up to MAX_BID_RINGS times for app jobs; it stays on drivers' screens
   meanwhile). The first driver to accept gets it.

   Counter-offers on a BID JOB (bidJobs.allowCounter, app jobs only): the
   driver can ask up to maxCounterPercent above the fare, in
   rides/{id}/offers/{driverId} as with bidding, and the passenger picks.
   firestore.rules refuses a counter above the cap.

   rides/{id}.bidJob (written here only; firestore.rules keeps it from
   clients):
     radiusKm             how far from the pickup drivers are asked
     at                   when it was opened
     reason               "declined" | "unanswered" | "given_back"
     rings, rungAt        re-rings so far, and the last one (app jobs)
     allowCounter         counter-offers allowed (never on phone jobs)
     maxCounterPercent    the cap on a counter-offer
   ====================================== */

module.exports = (deps) => {
  const {functions, db, loadAppConfig, toMillis} = deps;
  const {FieldValue} = require("firebase-admin/firestore");
  const out = {};
  const KM_PER_MILE = 1.609344;
  // Re-rings of an app BID JOB nobody takes, one every afterSeconds.
  const MAX_BID_RINGS = 10;

  /**
   * This feature's settings, from loadAppConfig().
   * @param {Object} cfg App config.
   * @return {Object} {enabled, radiusKm, afterSeconds, allowCounter,
   *   maxCounterPercent, ringKm}.
   */
  function settings(cfg) {
    const s = cfg.bidJobs;
    return Object.assign({}, s, {
      // Asked out to the bigger of the two circles.
      ringKm: Math.max(Number(cfg.dispatch.searchRadiusKm) || 0,
          Number(s.radiusKm) || 0),
    });
  }
  out.settings = settings;

  /**
   * Miles, to one decimal, for a push.
   * @param {number} km Kilometres.
   * @return {string} "2.4 mi".
   */
  function milesText(km) {
    return `${(Math.round((km / KM_PER_MILE) * 10) / 10).toFixed(1)} mi`;
  }
  out.milesText = milesText;

  /**
   * Opens a job as a BID JOB, once. Phone jobs also get their drivers who
   * only missed it (queue timeouts) back, and a fresh offeredAt, which makes
   * dispatchFleetJob ring the fleet again (offerFleetJob rings out to
   * bidJob.radiusKm while it is set). App jobs are rung by the caller.
   * @param {Object} ref Ride ref.
   * @param {string} reason "declined", "unanswered" or "given_back".
   * @param {Object} opts {again: open afresh even if it was a BID JOB
   *   before, as when a driver who took it gives it back}.
   * @return {Promise<?Object>} The ride as now stored, or null when it was
   *   not opened (switched off, already open, or no longer waiting).
   */
  async function open(ref, reason, opts = {}) {
    const cfg = await loadAppConfig();
    const s = settings(cfg);
    if (s.enabled !== 1) return null;
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const ride = snap.data();
      const phone = ride.source === "phone";
      const d = ride.dispatch || {};
      const waiting = phone ?
        ride.status === "dispatching" && !ride.riderId &&
          ["all", "queue"].includes(d.mode) &&
          (d.mode === "all" || (d.queueDone === true && !d.driverId)) :
        ride.status === "searching";
      if (!waiting) return null;
      // Once: again only if the circle has been made bigger since.
      if (!opts.again && ride.bidJob &&
          Number(ride.bidJob.radiusKm) >= s.ringKm) {
        return null;
      }
      const bidJob = {
        radiusKm: s.ringKm,
        at: FieldValue.serverTimestamp(),
        reason,
        allowCounter: !phone && s.allowCounter === 1,
        maxCounterPercent: s.maxCounterPercent,
      };
      const update = {bidJob};
      if (phone) {
        // A queue timeout is not a no: those drivers may take it now.
        const missed = new Set(d.missed || []);
        update.declinedBy = (ride.declinedBy || [])
            .filter((id) => !missed.has(id));
        update["dispatch.offeredAt"] = FieldValue.serverTimestamp();
        update["dispatch.reRings"] = 0;
      }
      tx.update(ref, update);
      return Object.assign({}, ride, update, {bidJob: Object.assign({},
          bidJob, {at: null})});
    }).catch((error) => {
      console.error("Could not open BID JOB:", ref.id, error.message);
      return null;
    });
  }
  out.open = open;

  /**
   * Opens an app job and rings it. offerRideToDrivers sees bidJob and asks
   * out to its radius.
   * @param {string} rideId Ride id.
   * @param {string} reason Why.
   * @param {Object} opts As for open().
   * @return {Promise<boolean>} Opened.
   */
  async function openApp(rideId, reason, opts = {}) {
    const ride = await open(db.collection("rides").doc(rideId), reason,
        opts);
    if (!ride) return false;
    console.log(`BID JOB ${rideId} opened (${reason})`);
    await deps.offerRideToDrivers(rideId, ride, {bidRing: true});
    return true;
  }
  out.openApp = openApp;

  /**
   * A driver declined an app job: if nobody available is left within the
   * normal radius, open it as a BID JOB.
   * @param {string} rideId Ride id.
   * @param {Object} before Ride before.
   * @param {Object} after Ride after.
   * @return {Promise<null>} Nothing.
   */
  out.afterDecline = async (rideId, before, after) => {
    // A driver who had accepted it and gave it back is dealt with by
    // notifyRideUpdates (straight to a BID JOB), not here.
    if (after.status !== "searching" || before.status !== "searching" ||
        after.source === "phone" || after.bidJob) {
      return null;
    }
    const was = new Set(before.declinedBy || []);
    const grew = (after.declinedBy || []).some((id) => !was.has(id));
    if (!grew) return null;
    const cfg = await loadAppConfig();
    if (settings(cfg).enabled !== 1) return null;
    const pool = await deps.appDriverPool(after);
    if (pool.some((p) => p.km <= cfg.dispatch.searchRadiusKm)) return null;
    await openApp(rideId, "declined");
    return null;
  };

  /* Every minute: app jobs nobody has taken for bidJobs.afterSeconds are
     opened as BID JOBs (timed like expireSearchingRides, from the latest
     restart of the search), and open BID JOBs nobody has taken are rung
     again every afterSeconds. Phone jobs are done in runFleetQueues. */
  out.functions = {
    openBidJobs: functions.pubsub.schedule("every 1 minutes")
        .onRun(async () => {
          const cfg = await loadAppConfig();
          const s = settings(cfg);
          if (s.enabled !== 1) return null;
          const waiting = await db.collection("rides")
              .where("status", "==", "searching").limit(300).get();
          let opened = 0;
          for (const doc of waiting.docs) {
            const r = doc.data();
            if (r.pricing !== "checked" || r.source === "phone") continue;
            if (r.bidJob) {
              // Still nobody: ring it again, to drivers who have not
              // declined it (offerRideToDrivers leaves those out).
              const last = Math.max(toMillis(r.bidJob.rungAt) || 0,
                  toMillis(r.bidJob.at) || 0);
              if ((r.bidJob.rings || 0) >= MAX_BID_RINGS || !last ||
                  Date.now() - last < s.afterSeconds * 1000) {
                continue;
              }
              await doc.ref.update({
                "bidJob.rings": FieldValue.increment(1),
                "bidJob.rungAt": FieldValue.serverTimestamp(),
              }).catch(() => null);
              await deps.offerRideToDrivers(doc.id, r, {bidRing: true});
              continue;
            }
            const since = Math.max(
                toMillis(r.timestamps && r.timestamps.createdAt) || 0,
                toMillis(r.lastDriverCancelAt) || 0,
                toMillis(r.paymentFailure && r.paymentFailure.at) || 0);
            if (!since || Date.now() - since < s.afterSeconds * 1000) continue;
            if (await openApp(doc.id, "unanswered")) opened++;
          }
          if (opened) console.log(`Opened ${opened} BID JOB(s)`);
          return null;
        }),
  };

  return out;
};
