/* ======================================
   BID JOBS
   A second chance for a job nobody is taking. When a job runs out of
   drivers it is opened as a "BID JOB": every available driver within
   bidJobs.radiusKm (or the normal search radius, whichever is bigger) is
   rung again, and the app shows it highlighted, with how far away it is.
   That includes drivers who declined it or let it run out before (M&S,
   17 Nov 2026: "back as BID JOB to all nearby drivers"); their earlier
   answers move to declinedEarlier. Only a driver who took the job and gave
   it back (gaveBackBy) is left out.

   The first offer of a job is always the normal one (M&S, 16 Nov 2026:
   "this job should come as normal"), even when nobody is online when it is
   booked. It becomes a BID JOB the second time round:
   - app jobs (status "searching"):
       one at a time (appOffers.js, the usual way): everyone in range was
       asked and nobody took it ("declined" if any of them said no,
       "unanswered" if they all let it run out);
       all at once (bidding jobs): a
       driver declined it and no other available driver is in range;
       nobody could be asked for bidJobs.afterSeconds (openBidJobs, every
       minute), which covers nobody being online when it was booked;
       a driver who had accepted it gave it back (straight away, "given_back").
   - phone jobs sent to the whole fleet, by queue or to the nearest
     (status "dispatching", fleet.js): the queue or nearest steps ran out,
     a decline left nobody, the whole-fleet ring went unanswered for
     bidJobs.afterSeconds, or a driver who had accepted it gave it back.
     Phone jobs stay at the office's fixed price (no counter-offers), and
     only that fleet's drivers are asked. A job sent to one driver by name
     never becomes a BID JOB: it goes back to the office as before.
   A BID JOB is rung again every bidJobs.ringEverySeconds (10 at least)
   until someone takes it, to every available driver in the bid radius,
   including those who declined it last time round (M&S, 17 Nov 2026: "BID
   JOB must come back to all drivers including who declined, every few
   seconds, until a driver accepts"). Drivers who have come online since are
   asked too. timeBidJobs waits out each ring on the server; the per-minute
   schedulers (openBidJobs here, runFleetQueues for phone jobs) catch any it
   missed. It stops when someone takes it, when an app job's search times
   out (expireSearchingRides), or for a phone job after
   dispatch.searchTimeoutMinutes, when it is left for the office (it stays
   on drivers' screens meanwhile). The first driver to accept gets it.

   Counter-offers on a BID JOB (bidJobs.allowCounter, app jobs only): the
   driver can ask up to maxCounterPercent above the fare, in
   rides/{id}/offers/{driverId} as with bidding, and the passenger picks.
   firestore.rules refuses a counter above the cap.

   rides/{id}.bidJob, declinedEarlier and gaveBackBy are written here only
   (firestore.rules keeps them from clients). bidJob:
     radiusKm             how far from the pickup drivers are asked
     at                   when it was opened
     reason               "declined" | "unanswered" | "given_back"
     rings, rungAt        re-rings so far, and the last one
     allowCounter         counter-offers allowed (never on phone jobs)
     maxCounterPercent    the cap on a counter-offer
   ====================================== */

module.exports = (deps) => {
  const {functions, db, loadAppConfig, toMillis} = deps;
  const {FieldValue} = require("firebase-admin/firestore");
  const out = {};
  const KM_PER_MILE = 1.609344;
  const {waitThen} = require("./offerTimer");
  // How late a ring may be before the per-minute scheduler does it instead
  // of timeBidJobs (which was stopped, or never ran).
  const RING_SLACK_MS = 15 * 1000;

  /**
   * This feature's settings, from loadAppConfig().
   * @param {Object} cfg App config.
   * @return {Object} {enabled, radiusKm, afterSeconds, ringEverySeconds,
   *   allowCounter, maxCounterPercent, ringKm}.
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
   * Whether a job is still waiting for a driver, as a BID JOB could be.
   * @param {Object} ride Ride data.
   * @return {boolean} Waiting.
   */
  function waitingFor(ride) {
    if (!ride) return false;
    const d = ride.dispatch || {};
    return ride.source === "phone" ?
      ride.status === "dispatching" && !ride.riderId &&
        ["all", "queue"].includes(d.mode) &&
        (d.mode === "all" || (d.queueDone === true && !d.driverId)) :
      // Not while the passenger's card is failing (as appOffers.js): each
      // driver who took it was bounced with "payment failed", and the next
      // ring asked them all again (audit 19 Nov 2026). Adding a card
      // (saveCard) clears auth_failed and offers it again.
      ride.status === "searching" && !ride.driverId &&
        ride.paymentStatus !== "auth_failed";
  }

  /**
   * Which ring of a BID JOB this is: changes when it is opened (again) and
   * every time it is rung again.
   * @param {Object} bidJob ride.bidJob.
   * @return {string} Key.
   */
  function ringOf(bidJob) {
    return `${toMillis(bidJob.at) || 0}:${Number(bidJob.rings) || 0}`;
  }

  /**
   * When a BID JOB was last rung.
   * @param {Object} bidJob ride.bidJob.
   * @return {number} Millis, 0 if not known yet.
   */
  function lastRing(bidJob) {
    return Math.max(toMillis(bidJob.rungAt) || 0, toMillis(bidJob.at) || 0);
  }

  /**
   * Rings an open BID JOB again, to everyone in the bid radius: drivers who
   * declined it are asked again (declinedBy emptied into declinedEarlier),
   * except one who took it and gave it back. Phone jobs get a fresh
   * offeredAt (dispatchFleetJob rings them); app jobs are rung here.
   * @param {Object} ref Ride ref.
   * @param {string} expect ringOf() of the ring this follows; a ring
   *   already done by someone else (or the job reopened) does nothing.
   * @return {Promise<boolean>} Rung.
   */
  async function ringAgain(ref, expect) {
    const cfg = await loadAppConfig();
    if (settings(cfg).enabled !== 1) return false;
    const ride = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const r = snap.exists ? snap.data() : null;
      if (!r || !r.bidJob || !waitingFor(r) || ringOf(r.bidJob) !== expect) {
        return null;
      }
      // A phone job nobody has taken in the search time is left for the
      // office (it is marked unanswered there); an app job is cancelled
      // for the passenger at that point by expireSearchingRides.
      const opened = toMillis(r.bidJob.at) || 0;
      if (r.source === "phone" && opened && Date.now() - opened >
          cfg.dispatch.searchTimeoutMinutes * 60 * 1000) {
        return null;
      }
      const keep = new Set(r.gaveBackBy || []);
      const before = r.declinedBy || [];
      const update = {
        "bidJob.rings": FieldValue.increment(1),
        "bidJob.rungAt": FieldValue.serverTimestamp(),
        "declinedBy": before.filter((id) => keep.has(id)),
      };
      const earlier = before.filter((id) => !keep.has(id));
      if (earlier.length) {
        update.declinedEarlier = FieldValue.arrayUnion(...earlier);
      }
      if (r.source === "phone") {
        update["dispatch.offeredAt"] = FieldValue.serverTimestamp();
      }
      tx.update(ref, update);
      return Object.assign({}, r, {declinedBy: update.declinedBy,
        bidJob: Object.assign({}, r.bidJob,
            {rings: (Number(r.bidJob.rings) || 0) + 1})});
    }).catch((error) => {
      console.error("Could not ring BID JOB again:", ref.id, error.message);
      return null;
    });
    if (!ride) return false;
    console.log(`BID JOB ${ref.id} rung again (${ride.bidJob.rings})`);
    if (ride.source !== "phone") {
      await deps.offerRideToDrivers(ref.id, ride, {bidRing: true});
    }
    return true;
  }
  out.ringAgain = ringAgain;

  /**
   * For the per-minute schedulers: rings a BID JOB whose ring is overdue
   * (timeBidJobs did not do it).
   * @param {Object} doc Ride snapshot.
   * @param {Object} cfg App config.
   * @return {Promise<boolean>} Rung.
   */
  async function ringIfOverdue(doc, cfg) {
    const r = doc.data();
    if (!r.bidJob || !waitingFor(r)) return false;
    const last = lastRing(r.bidJob);
    if (!last || Date.now() - last <
        settings(cfg).ringEverySeconds * 1000 + RING_SLACK_MS) {
      return false;
    }
    return ringAgain(doc.ref, ringOf(r.bidJob));
  }
  out.ringIfOverdue = ringIfOverdue;

  /**
   * Opens a job as a BID JOB, once. Drivers who declined it or let it run
   * out are asked again (declinedBy is emptied, the old answers kept in
   * declinedEarlier); drivers who took it and gave it back are not. Phone
   * jobs also get a fresh offeredAt, which makes dispatchFleetJob ring the
   * fleet again (offerFleetJob rings out to bidJob.radiusKm while it is
   * set). App jobs are rung by the caller.
   * @param {Object} ref Ride ref.
   * @param {string} reason "declined", "unanswered" or "given_back".
   * @param {Object} opts {again: open afresh even if it was a BID JOB
   *   before, as when a driver who took it gives it back; keep: drivers
   *   who just gave it back, left out of it (added to gaveBackBy)}.
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
      if (!waitingFor(ride)) return null;
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
      // Everyone nearby is asked, whatever they said before; only a driver
      // who took the job and gave it back stays out.
      const keep = new Set([...(ride.gaveBackBy || []), ...(opts.keep || [])]);
      const before = ride.declinedBy || [];
      update.declinedBy = before.filter((id) => keep.has(id));
      const earlier = before.filter((id) => !keep.has(id));
      if (earlier.length) {
        update.declinedEarlier = FieldValue.arrayUnion(...earlier);
      }
      if ((opts.keep || []).length) {
        update.gaveBackBy = FieldValue.arrayUnion(...opts.keep);
      }
      if (phone) {
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

  /* Every minute: app jobs asked one driver at a time are checked
     (appOffers.sweep: an offer whose timer was missed moves on, and a job
     nobody could be asked about goes to anyone who has come online since).
     App jobs nobody could be asked about for bidJobs.afterSeconds are
     opened as BID JOBs (timed like expireSearchingRides, from the latest
     restart of the search), and an open BID JOB whose ring timeBidJobs
     missed is rung again. Phone jobs are done in runFleetQueues. */
  out.functions = {
    /* Each ring of a BID JOB is timed here: wait ringEverySeconds from the
       ring, then, if it is still the same ring and nobody has taken it,
       ring it again (which starts the next wait). */
    timeBidJobs: functions.runWith({timeoutSeconds: 180}).firestore
        .document("rides/{rideId}")
        .onUpdate(async (change) => {
          const before = change.before.data();
          const after = change.after.data();
          if (!after.bidJob || !waitingFor(after)) return null;
          const ring = ringOf(after.bidJob);
          // Not opened or rung by this change; serverTimestamp fields are
          // set by now, so lastRing is known.
          if (before.bidJob && ringOf(before.bidJob) === ring) return null;
          const last = lastRing(after.bidJob);
          if (!last) return null;
          const cfg = await loadAppConfig();
          const wait = settings(cfg).ringEverySeconds * 1000 -
            (Date.now() - last);
          await waitThen(wait, () => ringAgain(change.after.ref, ring));
          return null;
        }),

    openBidJobs: functions.pubsub.schedule("every 1 minutes")
        .onRun(async () => {
          const cfg = await loadAppConfig();
          const s = settings(cfg);
          const waiting = await db.collection("rides")
              .where("status", "==", "searching").limit(300).get();
          let opened = 0;
          for (const doc of waiting.docs) {
            const r = doc.data();
            if (r.pricing !== "checked" || r.source === "phone") continue;
            // Someone is being asked, or was just asked, one at a time.
            if (await deps.sweepSequential(doc.id, r, cfg)) continue;
            if (s.enabled !== 1) continue;
            if (r.bidJob) {
              // Still nobody, and timeBidJobs missed its ring.
              await ringIfOverdue(doc, cfg);
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
