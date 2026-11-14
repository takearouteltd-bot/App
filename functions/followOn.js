"use strict";

/* Follow-on jobs (FOJ).

   A driver with a passenger on board who will drop off close to where a new
   booking starts is offered that booking as their next job, before the
   current trip ends. One driver at a time: the one who would reach the
   pickup soonest. They have OFFER_SECONDS to answer on the trip screen; a
   no, or no answer, offers it to the next one. Free drivers are alerted as
   usual meanwhile and whoever accepts first gets the job.

   Accepting puts the job on the driver (status "accepted", followOn set)
   while they finish the trip; when that trip ends (completed or
   cancelled), switchAfter() makes it their current job and they head to
   the pickup.

   Offered only when it gets the passenger a car sooner: the busy driver's
   time to finish and drive over must be within dispatch.followOnMinutes
   (0 turns follow-on jobs off), the drop-off within dispatch.followOnKm of
   the pickup, and quicker than the nearest free driver. A phone job the
   office sent to one driver is offered as a follow-on to that driver only,
   whatever the distance.

   Only drivers whose app has follow-on jobs and has them switched on
   (drivers.followOnJobs == true) are offered one; older apps never set it.

   Data, all written here:
     followOnOffers/{driverId}  the one offer waiting for that driver
     rides/{id}.followOnTried   drivers already offered this job as a FOJ
     rides/{id}.followOn        {afterRideId, etaMinutes, acceptedAt,
                                 startedAt} once accepted
     drivers/{id}.nextRideId    the follow-on job they accepted */

const OFFER_SECONDS = 45;
// Straight line to roads, and a town driving speed: a rough time, used only
// to compare drivers and to tell the passenger "about N minutes".
const ROAD_FACTOR = 1.4;
const TOWN_KMH = 30;
// A minute to drop the passenger and set off.
const DROP_OFF_MINUTES = 1;
// New bookings get this long with free drivers before the sweep offers them
// as a follow-on regardless of who is free.
const FREE_FIRST_MS = 30 * 1000;

module.exports = (deps) => {
  const {functions, db, sendPush, loadAppConfig, distanceKm, canServe,
    wantsJobType, hasExpiredDocument, membershipSuspended, positionStale,
    toMillis} = deps;
  const {HttpsError} = functions.https;
  const {FieldValue, Timestamp} = require("firebase-admin/firestore");
  const out = {};

  /**
   * Rough driving minutes for a straight-line distance.
   * @param {number} km Kilometres.
   * @return {number} Minutes.
   */
  function minutesFor(km) {
    return (km * ROAD_FACTOR / TOWN_KMH) * 60;
  }

  /**
   * Whether a job is still waiting for a driver, and so can be offered.
   * @param {Object} ride Ride data.
   * @return {boolean} Waiting.
   */
  function waiting(ride) {
    if (!ride || ride.driverId || !ride.pickupLocation) return false;
    if (ride.source === "phone") {
      const d = ride.dispatch || {};
      if (ride.status !== "dispatching" || typeof ride.fleetId !== "string") {
        return false;
      }
      // Held for the office, or a queue still working through its line.
      if (d.mode === "office") return false;
      if (d.mode === "queue" && !(d.queueDone === true && !d.driverId)) {
        return false;
      }
      return true;
    }
    return ride.status === "searching" && ride.pricing === "checked";
  }

  /**
   * Whether this busy driver could be given the job next, leaving aside
   * where they are.
   * @param {string} id Driver id.
   * @param {Object} d Driver data.
   * @param {Object} ride Ride data.
   * @return {boolean} Eligible.
   */
  function canTake(id, d, ride) {
    if (d.followOnJobs !== true || d.isOnRide !== true || !d.currentRideId ||
        d.nextRideId || d.currentRideId === ride.id) {
      return false;
    }
    if (d.approved !== true || d.blocked === true || hasExpiredDocument(d) ||
        membershipSuspended(d) || d.restDue === true || positionStale(d) ||
        (toMillis(d.cancelBlockedUntil) || 0) > Date.now()) {
      return false;
    }
    const skip = [].concat(ride.declinedBy || [], ride.blockedDriverIds || [],
        ride.followOnTried || []);
    if (skip.includes(id)) return false;
    if (!canServe(d.vehicleType, ride.rideType)) return false;
    if (ride.femaleDriverOnly === true && d.femaleVerified !== true) {
      return false;
    }
    if (ride.source === "phone") {
      if (d.fleetId !== ride.fleetId) return false;
      const target = ride.dispatch && ride.dispatch.driverId;
      // Sent to one driver by the office: theirs alone, as on the job list.
      if (target) return target === id;
      const cashInHand = !["account", "card", "online"].includes(
          ride.collectBy);
      return !(d.cashJobs === false && cashInHand) &&
        wantsJobType(d.jobTypes, ride.rideType);
    }
    if (!wantsJobType(d.jobTypes, ride.rideType)) return false;
    if (d.workingCityId && d.workingCityId !== ride.cityId) return false;
    return !(d.cashJobs === false && ride.paymentMethod === "cash");
  }

  /**
   * How long until this driver could be at the new pickup: the rest of
   * their trip (through any stops left), the drop-off, then the drive over.
   * @param {Object} d Driver data.
   * @param {Object} current Their current ride.
   * @param {Object} ride The waiting job.
   * @return {?{minutes: number, gapKm: number}} Null when it can't be said.
   */
  function arrival(d, current, ride) {
    const drop = current.dropoffLocation;
    if (!d.location || !drop || !ride.pickupLocation) return null;
    const left = (current.stops || []).slice(current.stopsCompleted || 0);
    let km = 0;
    let from = d.location;
    for (const p of left.concat([drop])) {
      const leg = distanceKm(from, p);
      if (!Number.isFinite(leg)) return null;
      km += leg;
      from = p;
    }
    const gapKm = distanceKm(drop, ride.pickupLocation);
    if (!Number.isFinite(gapKm)) return null;
    return {minutes: Math.max(1,
        Math.round(minutesFor(km + gapKm) + DROP_OFF_MINUTES)), gapKm};
  }

  /**
   * The offer as the driver's app shows it: no customer phone number.
   * @param {string} rideId Ride id.
   * @param {Object} ride Ride data.
   * @param {Object} best {driverId, afterRideId, minutes, gapKm}.
   * @return {Object} followOnOffers document.
   */
  function offerDoc(rideId, ride, best) {
    const place = (p) => p ? {address: p.address || "",
      latitude: p.latitude, longitude: p.longitude} : null;
    return {
      rideId,
      driverId: best.driverId,
      afterRideId: best.afterRideId,
      source: ride.source === "phone" ? "phone" : "app",
      fleetId: ride.fleetId || null,
      fleetName: ride.fleetName || null,
      forMe: Boolean(ride.dispatch && ride.dispatch.driverId),
      rideType: ride.rideType || "RouteMini",
      pickupLocation: place(ride.pickupLocation),
      dropoffLocation: place(ride.dropoffLocation),
      stopCount: (ride.stops || []).length,
      fare: Number((ride.fare && ride.fare.total) || ride.offeredFare ||
        ride.fareEstimate || 0),
      currency: ride.currency || "GBP",
      paymentMethod: ride.paymentMethod || "cash",
      collectBy: ride.collectBy || null,
      pickupAt: ride.pickupAt || null,
      etaMinutes: best.minutes,
      gapKm: Number(best.gapKm.toFixed(2)),
      offeredAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + OFFER_SECONDS * 1000),
    };
  }

  /**
   * Busy drivers who could take a follow-on job at all.
   * @return {Promise<Array<{id: string, d: Object}>>} Drivers.
   */
  async function busyDrivers() {
    const snap = await db.collection("drivers")
        .where("isOnRide", "==", true).get();
    return snap.docs
        .filter((s) => s.data().followOnJobs === true && !s.data().nextRideId)
        .map((s) => ({id: s.id, d: s.data()}));
  }

  /**
   * Offers a waiting job to the busy driver who would reach it first, if
   * that beats the nearest free driver. Never throws.
   * @param {string} rideId Ride id.
   * @param {Object} given Ride data (read again here).
   * @param {Object} opts {freeKm: nearest free driver alerted, or null when
   *   it no longer matters; drivers: busy drivers already loaded; cfg}.
   * @return {Promise<?string>} Driver offered, if any.
   */
  async function offerFor(rideId, given, opts = {}) {
    try {
      const cfg = opts.cfg || await loadAppConfig();
      const maxMinutes = cfg.dispatch.followOnMinutes;
      if (!(maxMinutes > 0)) return null;
      // As it is now: a trigger's copy can be from before the price check.
      const fresh = await db.collection("rides").doc(rideId).get();
      const ride = fresh.exists ? fresh.data() : given;
      if (!waiting(ride)) return null;
      const job = Object.assign({id: rideId}, ride);
      const busy = (opts.drivers || await busyDrivers())
          .filter(({id, d}) => canTake(id, d, job));
      if (!busy.length) return null;
      const target = ride.source === "phone" && ride.dispatch &&
        ride.dispatch.driverId;
      const currents = await db.getAll(...busy.map(({d}) =>
        db.collection("rides").doc(d.currentRideId)));
      let best = null;
      busy.forEach(({id, d}, i) => {
        const cur = currents[i].exists ? currents[i].data() : null;
        // Only with the passenger on board and heading to the drop-off.
        if (!cur || cur.status !== "ongoing" || cur.driverId !== id ||
            cur.followOn && !cur.followOn.startedAt) {
          return;
        }
        const a = arrival(d, cur, ride);
        if (!a) return;
        if (!target && (a.gapKm > cfg.dispatch.followOnKm ||
            a.minutes > maxMinutes)) {
          return;
        }
        if (!best || a.minutes < best.minutes) {
          best = {driverId: id, afterRideId: currents[i].id,
            minutes: a.minutes, gapKm: a.gapKm};
        }
      });
      if (!best) return null;
      // A free driver who would get there as quickly takes priority.
      if (!target && Number.isFinite(opts.freeKm) &&
          minutesFor(opts.freeKm) <= best.minutes) {
        return null;
      }
      const offerRef = db.collection("followOnOffers").doc(best.driverId);
      const placed = await db.runTransaction(async (tx) => {
        const [mine, live, now] = await Promise.all([
          tx.get(offerRef),
          tx.get(db.collection("followOnOffers").where("rideId", "==", rideId)),
          tx.get(db.collection("rides").doc(rideId)),
        ]);
        const open = (s) => (toMillis(s.data().expiresAt) || 0) > Date.now();
        if (mine.exists && open(mine)) return false;
        if (live.docs.some(open)) return false;
        if (!now.exists || !waiting(now.data())) return false;
        tx.set(offerRef, offerDoc(rideId, now.data(), best));
        return true;
      });
      if (!placed) return null;
      const pickup = ((ride.pickupLocation || {}).address || "a pickup")
          .split(",")[0];
      await sendPush([best.driverId], {
        title: target ? `Your next job from ${ride.fleetName || "the office"}` :
          "Follow-on job",
        body: `Pickup at ${pickup}, about ${best.minutes} min from here. ` +
          "Tap to accept.",
        // Rings and pops up like any new job, even over Google Maps.
        channelId: "job-ring",
        sound: "job_ring.wav",
        ttlSeconds: OFFER_SECONDS,
        data: {type: "follow_on_offer", rideId},
      }).catch(() => null);
      console.log(`Follow-on ${rideId} offered to ${best.driverId} ` +
        `(${best.minutes} min)`);
      return best.driverId;
    } catch (error) {
      console.error("Follow-on offer failed:", rideId, error.message);
      return null;
    }
  }

  /**
   * After a driver's trip ends: the follow-on job they accepted becomes
   * their current job. Never throws.
   * @param {string} driverId Driver.
   * @param {string} endedRideId The trip that just ended.
   * @return {Promise<?string>} The job they now head to, if any.
   */
  async function switchAfter(driverId, endedRideId) {
    try {
      const next = await db.collection("rides")
          .where("driverId", "==", driverId)
          .where("followOn.afterRideId", "==", endedRideId)
          .limit(5).get();
      const doc = next.docs.find((s) => s.data().status === "accepted" &&
        !s.data().followOn.startedAt);
      // None: a follow-on that went before this trip ended was already
      // cleared off the driver by forget().
      if (!doc) return null;
      const driverRef = db.collection("drivers").doc(driverId);
      const moved = await db.runTransaction(async (tx) => {
        const [ride, driver] = await Promise.all([tx.get(doc.ref),
          tx.get(driverRef)]);
        const r = ride.exists ? ride.data() : null;
        if (!r || r.status !== "accepted" || r.driverId !== driverId ||
            !driver.exists) {
          return false;
        }
        const d = driver.data();
        // Already on another live trip (the app moved them first): just
        // stamp the start.
        const elsewhere = d.isOnRide === true && d.currentRideId &&
          d.currentRideId !== endedRideId && d.currentRideId !== doc.id;
        tx.update(doc.ref,
            {"followOn.startedAt": FieldValue.serverTimestamp()});
        tx.update(driverRef, elsewhere ? {nextRideId: FieldValue.delete()} : {
          isOnRide: true,
          currentRideId: doc.id,
          status: "on_ride",
          nextRideId: FieldValue.delete(),
        });
        return true;
      });
      if (!moved) return null;
      const r = doc.data();
      const pickup = ((r.pickupLocation || {}).address || "the pickup")
          .split(",")[0];
      await sendPush([driverId], {
        title: "Next job: head to the pickup",
        body: `Your follow-on job starts now. Pickup at ${pickup}.`,
        channelId: "trip-updates",
        data: {type: "trip", rideId: doc.id},
      }).catch(() => null);
      if (r.riderId) {
        await sendPush([r.riderId], {
          title: "Driver on the way",
          body: "Your driver has finished their last trip and is heading " +
            "to your pickup.",
          channelId: "trip-updates",
          data: {type: "trip", rideId: doc.id},
        }).catch(() => null);
      }
      return doc.id;
    } catch (error) {
      console.error("Follow-on switch failed:", driverId, error.message);
      return null;
    }
  }

  /**
   * A follow-on job that ended or went back before its driver started it:
   * clear it off the driver. Never throws.
   * @param {Object} before Ride before.
   * @param {Object} after Ride after.
   * @param {string} rideId Ride id.
   * @return {Promise<void>}
   */
  async function forget(before, after, rideId) {
    const fo = before && before.followOn;
    if (!fo || fo.startedAt || !before.driverId) return;
    if (after.status === "accepted" && after.driverId === before.driverId) {
      return;
    }
    const driverRef = db.collection("drivers").doc(before.driverId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(driverRef);
      if (snap.exists && snap.data().nextRideId === rideId) {
        tx.update(driverRef, {nextRideId: FieldValue.delete()});
      }
    }).catch(() => null);
    // Back to finding a driver: it is an ordinary job again (checked as it
    // is now, since another driver may have taken it since).
    if (["searching", "dispatching"].includes(after.status)) {
      const rideRef = db.collection("rides").doc(rideId);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(rideRef);
        const cur = snap.exists ? snap.data() : null;
        if (cur && cur.followOn && !cur.driverId &&
            ["searching", "dispatching"].includes(cur.status)) {
          tx.update(rideRef, {followOn: FieldValue.delete()});
        }
      }).catch(() => null);
    }
  }

  /* The driver answers a follow-on offer on the trip screen ("accept" or
     "decline"), or gives back one they accepted before starting it
     ("drop"). */
  out.answerFollowOnJob = functions.https.onCall(async (data, context) => {
    const uid = context.auth && context.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in.");
    const rideId = String((data && data.rideId) || "").slice(0, 128);
    const answer = data && data.answer;
    if (!rideId || !["accept", "decline", "drop"].includes(answer)) {
      throw new HttpsError("invalid-argument", "Missing job or answer.");
    }
    const rideRef = db.collection("rides").doc(rideId);
    const driverRef = db.collection("drivers").doc(uid);
    const offerRef = db.collection("followOnOffers").doc(uid);

    if (answer === "drop") {
      await db.runTransaction(async (tx) => {
        const [ride, driver] = await Promise.all([tx.get(rideRef),
          tx.get(driverRef)]);
        const r = ride.exists ? ride.data() : null;
        if (!r || r.driverId !== uid || r.status !== "accepted" ||
            !r.followOn || r.followOn.startedAt) {
          throw new HttpsError("failed-precondition",
              "This job has already started or is no longer yours.");
        }
        // The same as giving any job back (firestore.rules driverGivesBack),
        // so the office, the passenger and any penalty follow the usual way.
        tx.update(rideRef, {
          status: r.source === "phone" ? "dispatching" : "searching",
          driverId: null,
          acceptedAt: null,
          declinedBy: FieldValue.arrayUnion(uid),
          lastDriverCancelAt: FieldValue.serverTimestamp(),
          followOn: FieldValue.delete(),
        });
        if (driver.exists && driver.data().nextRideId === rideId) {
          tx.update(driverRef, {nextRideId: FieldValue.delete()});
        }
      });
      return {ok: true};
    }

    if (answer === "decline") {
      const offer = await offerRef.get();
      if (offer.exists && offer.data().rideId === rideId) {
        await offerRef.delete();
      }
      const snap = await rideRef.get();
      if (!snap.exists) return {ok: true};
      const r = snap.data();
      const toMe = r.source === "phone" && r.dispatch &&
        r.dispatch.driverId === uid && r.status === "dispatching";
      // A job the office sent to this driver: a no is a no to the job, and
      // it goes back to the office (functions/fleet.js dispatchFleetJob).
      await rideRef.update(toMe ? {
        followOnTried: FieldValue.arrayUnion(uid),
        declinedBy: FieldValue.arrayUnion(uid),
      } : {followOnTried: FieldValue.arrayUnion(uid)}).catch(() => null);
      if (!toMe) {
        const fresh = await rideRef.get();
        if (fresh.exists) await offerFor(rideId, fresh.data(), {freeKm: null});
      }
      return {ok: true};
    }

    // Accept.
    const result = await db.runTransaction(async (tx) => {
      const [offer, ride, driver] = await Promise.all([tx.get(offerRef),
        tx.get(rideRef), tx.get(driverRef)]);
      const o = offer.exists ? offer.data() : null;
      // A few seconds' grace for a slow connection.
      if (!o || o.rideId !== rideId ||
          (toMillis(o.expiresAt) || 0) + 10 * 1000 < Date.now()) {
        throw new HttpsError("failed-precondition",
            "This offer has run out.");
      }
      const r = ride.exists ? ride.data() : null;
      if (!r || !waiting(r)) {
        tx.delete(offerRef);
        return {gone: r && r.status === "cancelled" ?
          "This booking was cancelled." : "Another driver took this job."};
      }
      const d = driver.exists ? driver.data() : null;
      // Their offer stands even if the sweep tried them; check the rest.
      const job = Object.assign({id: rideId}, r, {followOnTried: []});
      if (!d || !canTake(uid, d, job) || d.currentRideId !== o.afterRideId) {
        throw new HttpsError("failed-precondition",
            "You can't take this job right now.");
      }
      const cur = await tx.get(db.collection("rides").doc(d.currentRideId));
      if (!cur.exists || cur.data().status !== "ongoing" ||
          cur.data().driverId !== uid) {
        throw new HttpsError("failed-precondition",
            "Follow-on jobs are taken while a passenger is on board.");
      }
      tx.update(rideRef, {
        status: "accepted",
        driverId: uid,
        walletProcessed: false,
        acceptedAt: FieldValue.serverTimestamp(),
        followOn: {
          afterRideId: d.currentRideId,
          etaMinutes: o.etaMinutes,
          acceptedAt: FieldValue.serverTimestamp(),
          startedAt: null,
        },
      });
      tx.update(driverRef, {nextRideId: rideId});
      tx.delete(offerRef);
      return {ok: true, rideId};
    });
    if (result.gone) {
      throw new HttpsError("failed-precondition", result.gone);
    }
    return result;
  });

  /* Every minute: offers nobody answered move on, and jobs still waiting
     are offered to drivers who have since come close to finishing. */
  out.sweepFollowOnJobs = functions.pubsub
      .schedule("every 1 minutes")
      .onRun(async () => {
        const now = Date.now();
        const stale = await db.collection("followOnOffers")
            .where("expiresAt", "<=", Timestamp.fromMillis(now)).get();
        for (const s of stale.docs) {
          await s.ref.delete().catch(() => null);
          await db.collection("rides").doc(s.data().rideId).update({
            followOnTried: FieldValue.arrayUnion(s.id),
          }).catch(() => null);
        }
        const cfg = await loadAppConfig();
        if (!(cfg.dispatch.followOnMinutes > 0)) return null;
        let drivers = await busyDrivers();
        if (!drivers.length) return null;
        const live = await db.collection("followOnOffers").get();
        const offered = new Set(live.docs.map((s) => s.id));
        const offeredRides = new Set(live.docs.map((s) => s.data().rideId));
        drivers = drivers.filter(({id}) => !offered.has(id));
        if (!drivers.length) return null;
        const [app, phone] = await Promise.all([
          db.collection("rides").where("status", "==", "searching")
              .limit(200).get(),
          db.collection("rides").where("status", "==", "dispatching")
              .where("source", "==", "phone").limit(200).get(),
        ]);
        const jobs = app.docs.concat(phone.docs)
            .filter((s) => !offeredRides.has(s.id) && waiting(s.data()))
            .filter((s) => {
              const r = s.data();
              const since = toMillis(r.dispatchAt) ||
                toMillis(r.createdAt) || toMillis(r.timestamp) ||
                toMillis((r.timestamps || {}).createdAt) ||
                s.createTime.toMillis();
              return now - since >= FREE_FIRST_MS;
            })
            .sort((a, b) => a.createTime.toMillis() - b.createTime.toMillis());
        let count = 0;
        for (const s of jobs) {
          if (!drivers.length) break;
          const who = await offerFor(s.id, s.data(),
              {cfg, drivers, freeKm: null});
          if (who) {
            count++;
            drivers = drivers.filter(({id}) => id !== who);
          }
        }
        if (count) console.log(`Follow-on: ${count} job(s) offered`);
        return null;
      });

  return {offerFor, switchAfter, forget, minutesFor, functions: out};
};
