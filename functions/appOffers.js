"use strict";

/* ======================================
   APP JOBS, ONE DRIVER AT A TIME
   The client's rule (M&S, 17 Nov 2026): "if job is declined by driver it
   should go to the next driver; if no one accepts, job should go back as
   BID JOB to all nearby drivers as radius set."

   So an app booking is offered to the nearest available driver within
   dispatch.searchRadiusKm only. They have dispatch.requestTimeoutSeconds
   to answer. A decline, or the time running out, offers it to the next
   nearest driver not yet asked, and so on. When everyone in range has been
   asked it opens as a BID JOB (bidJobs.js) to every available driver within
   the bid radius, those who declined or missed it included. With BID JOBs
   switched off it is rung to everyone in range instead, as jobs were before.

   Nobody to ask when it is booked: it waits as a normal job. openBidJobs
   (bidJobs.js, every minute) asks anyone who has come online since, and
   opens it as a BID JOB after bidJobs.afterSeconds, as before.

   The server keeps time, not the phone: timeAppOffers waits out each offer
   and moves the job on a moment after it ends, and openBidJobs catches any
   it missed. A driver who logs out and back in is shown only what the ride
   says is theirs now.

   Not one at a time: bidding jobs (the passenger chooses between drivers'
   prices, so asking one driver at a time would defeat it), BID JOBs, and
   everything when dispatch.sequentialOffers is 0 (the old way: everyone in
   range is rung at once).

   rides/{id} fields, written here only (firestore.rules keeps them from
   clients):
     offer          {driverId, n, state, at, expiresAt, seconds, km}
                    n counts offers, so a late answer to an old one is
                    ignored. state:
                      "asking"   driverId has until expiresAt to answer
                      "waiting"  nobody to ask yet
                      "open"     everyone in range was asked: a BID JOB, or
                                 open to any driver with BID JOBs off
     askedDrivers   every driver asked, in order
     missedBy       drivers whose offer ran out without an answer
     declinedBy     drivers who pressed Decline (written by the app)
   Only the driver an offer is for can take the job meanwhile
   (firestore.rules driverClaimsRide).
   ====================================== */

// Longest the trigger waits for an offer to run out; a longer one is left
// to the per-minute scheduler. Within the function's timeout below.
const MAX_WAIT_MS = 240 * 1000;
// A moment after the offer ends, so an accept sent at the last second wins.
const GRACE_MS = 700;

module.exports = (deps) => {
  const {functions, db, loadAppConfig, toMillis, appDriverPool, poolNote,
    sendPush, followOn, bidJobs, ringAll} = deps;
  const {FieldValue, Timestamp} = require("firebase-admin/firestore");
  const {waitThen} = require("./offerTimer");
  const out = {};

  /**
   * Whether this job goes to one driver at a time.
   * @param {Object} ride Ride data.
   * @param {Object} cfg App config.
   * @return {boolean} One at a time.
   */
  function sequentialFor(ride, cfg) {
    return cfg.dispatch.sequentialOffers === 1 && Boolean(ride) &&
      ride.source !== "phone" && ride.bidding !== true && !ride.bidJob;
  }
  out.sequentialFor = sequentialFor;

  /**
   * How long a driver has to answer, in seconds. The same floor as the
   * app's countdown (DriverHomeScreen).
   * @param {Object} cfg App config.
   * @return {number} Seconds.
   */
  function offerSeconds(cfg) {
    return Math.max(5, Math.round(cfg.dispatch.requestTimeoutSeconds || 20));
  }

  /**
   * Still looking for a driver, priced, and not waiting for a new card.
   * @param {Object} ride Ride data.
   * @return {boolean} Can be offered.
   */
  function waitingFor(ride) {
    return Boolean(ride) && ride.status === "searching" &&
      ride.pricing === "checked" && !ride.driverId &&
      ride.paymentStatus !== "auth_failed";
  }

  /**
   * Whether the offer on the job is still waiting for its driver's answer.
   * @param {Object} ride Ride data.
   * @param {number} now Time.
   * @return {boolean} Live.
   */
  function liveOffer(ride, now) {
    const o = ride.offer || {};
    return o.state === "asking" && Boolean(o.driverId) &&
      !(ride.declinedBy || []).includes(o.driverId) &&
      (toMillis(o.expiresAt) || 0) > now;
  }

  /**
   * Offers a job to the next nearest driver not yet asked, once the offer
   * before has been answered or has run out. With nobody left it opens as a
   * BID JOB. Never throws.
   * @param {string} rideId Ride id.
   * @param {Object} opts {cfg; expectN: only if the offer count is still
   *   this (a decline or a timer for that offer); restart: forget who was
   *   asked, as when the search starts again; sweep: from openBidJobs}.
   * @return {Promise<?string>} The driver now asked, if any.
   */
  async function offerNext(rideId, opts = {}) {
    try {
      const cfg = opts.cfg || await loadAppConfig();
      const ref = db.collection("rides").doc(rideId);
      const snap = await ref.get();
      const ride = snap.exists ? snap.data() : null;
      if (!sequentialFor(ride, cfg) || !waitingFor(ride)) return null;
      const n = Number((ride.offer || {}).n) || 0;
      if (opts.expectN !== undefined && opts.expectN !== n) return null;
      if (!opts.restart && liveOffer(ride, Date.now())) return null;
      // Back to searching since this offer (the driver took it and gave it
      // back, or the card hold failed): the driver is in declinedBy then,
      // but did not decline. notifyRideUpdates starts it again (a BID JOB,
      // or a new search); the sweep does it if that never happened.
      const restartedAt = Math.max(toMillis(ride.lastDriverCancelAt) || 0,
          toMillis(ride.paymentFailure && ride.paymentFailure.at) || 0);
      const offeredAt = toMillis((ride.offer || {}).at) || 0;
      if (!opts.restart && offeredAt && restartedAt > offeredAt) {
        if (!opts.sweep || Date.now() - restartedAt < 60 * 1000) return null;
        opts = Object.assign({}, opts, {restart: true});
      }

      const asked = opts.restart ? [] : ride.askedDrivers || [];
      const radiusKm = cfg.dispatch.searchRadiusKm;
      const pool = await appDriverPool(ride);
      const next = pool.filter((p) => p.km <= radiusKm && !asked.includes(p.id))
          .sort((a, b) => a.km - b.km)[0] || null;
      const seconds = offerSeconds(cfg);
      const state = next ? "asking" : asked.length ? "open" : "waiting";
      // Still nobody: no write, so a job waiting for drivers to come online
      // is not rewritten every minute.
      if (!next && !opts.restart && (ride.offer || {}).state === state) {
        return null;
      }

      const placed = await db.runTransaction(async (tx) => {
        const now = await tx.get(ref);
        const r = now.exists ? now.data() : null;
        // Taken, cancelled, or another run moved it on first.
        if (!sequentialFor(r, cfg) || !waitingFor(r) ||
            (Number((r.offer || {}).n) || 0) !== n) {
          return false;
        }
        const prev = r.offer || {};
        const update = {
          offer: {
            driverId: next ? next.id : null,
            n: n + 1,
            state,
            at: FieldValue.serverTimestamp(),
            expiresAt: next ?
              Timestamp.fromMillis(Date.now() + seconds * 1000) : null,
            seconds: next ? seconds : null,
            km: next ? Math.round(next.km * 100) / 100 : null,
          },
        };
        if (next) {
          update.askedDrivers = opts.restart ? [next.id] :
            FieldValue.arrayUnion(next.id);
        } else if (opts.restart) {
          update.askedDrivers = [];
        }
        // A new search: drivers who missed it last time may be asked again.
        if (opts.restart) update.missedBy = [];
        // The offer before ran out without an answer: the server records
        // it, so that driver's app never shows it again.
        let missed = null;
        if (!opts.restart && prev.state === "asking" && prev.driverId &&
            !(r.declinedBy || []).includes(prev.driverId) &&
            (toMillis(prev.expiresAt) || 0) <= Date.now()) {
          missed = prev.driverId;
          update.missedBy = FieldValue.arrayUnion(missed);
        }
        tx.update(ref, update);
        return {missed};
      });
      if (!placed) return null;

      console.log(`Job ${rideId} offer ${n + 1}: ` +
        (placed.missed ? `(no answer from ${placed.missed}) ` : "") + (next ?
        `to ${next.id} (${next.km.toFixed(1)} km, ${seconds} s)` :
        state === "open" ? "everyone in range asked" : "nobody to ask yet") +
        `; ${poolNote(pool, radiusKm)}`);
      if (next) {
        const pickup = ride.pickupLocation && ride.pickupLocation.address ?
          ride.pickupLocation.address : "a nearby pickup";
        await sendPush([next.id], {
          // As offerRideToDrivers rings (utils/notifications.js).
          channelId: "job-ring",
          sound: "job_ring.wav",
          ttlSeconds: Math.max(10, seconds),
          data: {type: "job_offer", rideId},
          title: "New job offer",
          body: `Pickup at ${pickup}. Open TakeARoute to accept.`,
        }).catch(() => null);
      }
      // A busy driver about to drop off nearby, if they would be quicker.
      if (n === 0 || opts.restart) {
        await followOn.offerFor(rideId, ride, {cfg,
          freeKm: next ? next.km : null});
      }
      if (!next && asked.length) {
        // Everyone in range was asked: a BID JOB to all, those who said no
        // or missed it included (bidJobs.open puts decliners back).
        const fresh = (await ref.get()).data() || ride;
        const said = (fresh.declinedBy || []).some((id) => asked.includes(id));
        const why = said ? "declined" : "unanswered";
        if (!(await bidJobs.openApp(rideId, why))) {
          // BID JOBs switched off: rung to everyone in range, as before,
          // except those who already said no or let it run out.
          await ringAll(rideId, fresh, {open: true,
            skip: fresh.missedBy || []});
        }
      }
      return next ? next.id : null;
    } catch (error) {
      console.error("Could not offer job:", rideId, error.message);
      return null;
    }
  }
  out.offerNext = offerNext;

  /**
   * A driver declined a job: if it was the one being asked, the next one
   * is asked straight away.
   * @param {string} rideId Ride id.
   * @param {Object} before Ride before.
   * @param {Object} after Ride after.
   * @return {Promise<boolean>} Handled here (one at a time).
   */
  async function afterDecline(rideId, before, after) {
    if (!after.offer || after.bidJob || after.source === "phone") return false;
    // Given back after it was taken (declinedBy grows then too):
    // notifyRideUpdates deals with that, as a BID JOB or a new search.
    if (before.status !== "searching" || after.status !== "searching") {
      return true;
    }
    const cfg = await loadAppConfig();
    if (!sequentialFor(after, cfg)) return false;
    const was = new Set(before.declinedBy || []);
    const o = after.offer;
    if (o.state === "asking" && o.driverId && !was.has(o.driverId) &&
        (after.declinedBy || []).includes(o.driverId)) {
      await offerNext(rideId, {cfg, expectN: o.n});
    }
    return true;
  }
  out.afterDecline = afterDecline;

  /**
   * The per-minute check (openBidJobs): an offer the timer did not move on
   * is moved on now, and a job nobody could be asked about is offered to
   * anyone who has come online since.
   * @param {string} rideId Ride id.
   * @param {Object} ride Ride data.
   * @param {Object} cfg App config.
   * @return {Promise<boolean>} Handled (someone is being asked, or it was
   *   moved on); false leaves it to the BID JOB wait.
   */
  async function sweep(rideId, ride, cfg) {
    if (!sequentialFor(ride, cfg) || !waitingFor(ride)) return false;
    const o = ride.offer || {};
    if (o.state === "asking" && o.driverId) {
      if (!liveOffer(ride, Date.now())) {
        await offerNext(rideId, {cfg, sweep: true,
          expectN: Number(o.n) || 0});
      }
      return true;
    }
    if (o.state === "open") return true;
    return Boolean(await offerNext(rideId, {cfg, sweep: true}));
  }
  out.sweep = sweep;

  out.functions = {
    /* Each offer is timed here: wait until it runs out, then, if it is
       still the same offer, record the miss and ask the next driver. A
       decline or an accept meanwhile makes the wake-up do nothing. */
    timeAppOffers: functions.runWith({timeoutSeconds: 300}).firestore
        .document("rides/{rideId}")
        .onUpdate(async (change, context) => {
          const before = change.before.data().offer || {};
          const after = change.after.data().offer || {};
          if (after.state !== "asking" || !after.driverId ||
              after.n === before.n) {
            return null;
          }
          const left = (toMillis(after.expiresAt) || 0) - Date.now();
          if (left > MAX_WAIT_MS) return null;
          await waitThen(left + GRACE_MS, () =>
            offerNext(context.params.rideId, {expectN: after.n}));
          return null;
        }),
  };

  return out;
};
