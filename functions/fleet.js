/* ======================================
   FLEETS AND PHONE BOOKINGS
   A fleet is a taxi firm that runs its own drivers on TakeARoute.

   - The TakeARoute admin creates a fleet and its owner login (createFleet).
   - Drivers join with the fleet's join code (requestFleetJoin) and the fleet
     approves them, or the fleet invites a driver by phone number and the
     driver accepts in the app. TakeARoute still checks every driver's
     documents as usual (drivers/{id}.approved).
   - A fleet driver is one of two kinds (drivers/{id}.fleetDriverType),
     chosen by the fleet when it approves or invites them; only a
     TakeARoute admin can change it afterwards (setFleetDriverType):
       "company"  drives the fleet's car, rented or on commission. Card
                  earnings go to the fleet's wallet (fleetWallets/{fleetId}),
                  not their own, and the fleet pays a monthly membership per
                  company driver (billFleets). The fleet can let them go.
                  Members from before the two kinds existed are "company".
       "self"     self-employed, own car. Takes the fleet's jobs but keeps
                  their own wallet and pays their own membership. The fleet
                  can suspend them but not remove them; they leave
                  themselves (leaveFleet) or an admin takes them out.
     Admins pay fleets by bank and record it (recordFleetPayout).
   - Fleet operators take phone bookings on the fleet dashboard
     (quoteFleetBooking, createFleetBooking). A phone job has no passenger
     account: rides/{id}.source "phone", riderId null, customer {name,
     phone}. It is paid in cash. It is sent to one chosen driver or to all
     the fleet's nearby online drivers, now or at a booked time.

   Phone jobs never use the "searching" status, so phones on builds before
   fleets never see them. Their states:
     scheduled    booked for later; dispatchScheduledRides sends it
                  dispatch.leadMinutes before pickupAt
     dispatching  offered to dispatch.driverId, or to the whole fleet when
                  that is null; a driver who declines is added to declinedBy.
                  dispatch.mode says how: "driver" (the operator chose),
                  "all" (whole fleet) or "queue" (the zone queue, below)
     accepted / arrived / ongoing / completed / cancelled   as app jobs

   Collections:
     fleets/{fleetId}                 name, joinCode, status, contact, price
     fleets/{fleetId}/customers/{e164}  phone booking history
     fleetManagers/{uid}              fleetId, role owner|operator, isActive
     fleetWallets/{fleetId}           availableBalance, totalEarned, ...
       /transactions/{id}             ride_earning, membership, payout
     fleetInvites/{e164}              a driver invited by phone number
     fleetQueues/{fleetId}            who is waiting in each zone, in order
     fleets/{fleetId}/calls/{id}      calls the office placed (fleetCall)

   Zone queues: the owner draws zones (circles) in Settings. Free drivers
   inside a zone queue there in the order they arrived or became free
   (runFleetQueues keeps fleetQueues/{fleetId} up to date every minute). A
   job sent "by queue" rings the first driver in its pickup zone; a no, or no
   answer within queueOfferSeconds, sends that driver to the back and rings
   the next. When nobody in the zone is left it goes to the whole fleet.
====================================== */

/* The app's Google Maps key (App/config/maps.js). It ships inside the app,
   so it is not a secret; Google restricts it to the Routes, Places and
   Geocoding services. */
const MAPS_KEY = "AIzaSyD2FkUIMuw3hkXi827QxnI8W1w2XX_KGd8";

/* Fare multipliers per vehicle class, as FareEstimationScreen's
   RIDE_OPTIONS. Change both together. */
const CLASS_MULTIPLIERS = {
  RouteMini: 1.0,
  RoutePlus: 1.2,
  RouteXL: 1.5,
  RouteEco: 0.9,
  RouteExecutive: 2.0,
};

/* Fare defaults, as App/utils/appConfig.js DEFAULT_APP_CONFIG.fares. */
const FARE_DEFAULTS = {
  baseFare: 3.0, ratePerMile: 2.2, ratePerMinute: 0.25, minimumFare: 6,
  vatPercent: 20,
};

const JOIN_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const DEFAULT_LEAD_MINUTES = 20;
const MAX_LEAD_MINUTES = 180;
const MAX_ZONES = 30;
const DEFAULT_QUEUE_OFFER_SECONDS = 45;
/* A driver whose phone has not reported a position for this long is left
   out of the queues (app closed, no signal). */
const QUEUE_STALE_MS = 5 * 60 * 1000;
/* Most calls one fleet's office can place in a day, so a mistake or a
   misused login cannot run up the Twilio bill. */
const MAX_FLEET_CALLS_PER_DAY = 300;

module.exports = (deps) => {
  const {functions, admin, db, sendPush, loadAppConfig, distanceKm, canServe,
    hasExpiredDocument, toE164, toMillis, addOneMonth,
    TWILIO_SECRETS, twilioConfig, bridgeCall, phoneFor} = deps;
  const {HttpsError} = functions.https;
  // From the modular entry point: the functions emulator's stand-in for
  // admin.firestore does not carry FieldValue or Timestamp.
  const {FieldValue, Timestamp} = require("firebase-admin/firestore");
  const out = {};

  /* ------------------------------ helpers ---------------------------- */

  /**
   * Throws unless the caller is an active TakeARoute admin.
   * @param {Object} context Callable context.
   * @return {Promise<void>}
   */
  async function assertAdmin(context) {
    if (!context.auth) throw new HttpsError("unauthenticated", "Sign in.");
    const snap = await db.collection("admins").doc(context.auth.uid).get();
    if (!snap.exists || snap.data().isActive !== true) {
      throw new HttpsError("permission-denied", "Admins only.");
    }
  }

  /**
   * The caller's fleet manager record, or throws.
   * @param {Object} context Callable context.
   * @param {boolean} ownerOnly Only the fleet's owner may do this.
   * @return {Promise<Object>} {uid, fleetId, fleet, manager}
   */
  async function assertFleetManager(context, ownerOnly) {
    if (!context.auth) throw new HttpsError("unauthenticated", "Sign in.");
    const uid = context.auth.uid;
    const snap = await db.collection("fleetManagers").doc(uid).get();
    const manager = snap.exists ? snap.data() : null;
    if (!manager || manager.isActive !== true || !manager.fleetId) {
      throw new HttpsError("permission-denied", "Fleet staff only.");
    }
    if (ownerOnly && manager.role !== "owner") {
      throw new HttpsError("permission-denied",
          "Only the fleet owner can do this.");
    }
    const fleetSnap = await db.collection("fleets").doc(manager.fleetId).get();
    if (!fleetSnap.exists) {
      throw new HttpsError("not-found", "This fleet no longer exists.");
    }
    const fleet = fleetSnap.data();
    if (fleet.status === "suspended") {
      throw new HttpsError("failed-precondition",
          "This fleet is paused. Please contact TakeARoute.");
    }
    return {uid, fleetId: manager.fleetId, fleet, manager};
  }

  /**
   * Trimmed string, or "" for anything else, cut to max characters.
   * @param {*} v Value.
   * @param {number} max Longest allowed.
   * @return {string} Clean text.
   */
  function text(v, max) {
    return typeof v === "string" ? v.trim().slice(0, max || 200) : "";
  }

  /**
   * A point from the dashboard: {latitude, longitude, address}, or null.
   * @param {*} p Raw point.
   * @return {?Object} Clean point.
   */
  function point(p) {
    if (!p) return null;
    const lat = Number(p.latitude);
    const lng = Number(p.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
        Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return null;
    }
    return {latitude: lat, longitude: lng,
      address: text(p.address, 300) || "Pinned location"};
  }

  /**
   * A fresh join code nobody else uses.
   * @return {Promise<string>} Six characters, no lookalikes (0/O, 1/I/L).
   */
  async function newJoinCode() {
    for (let attempt = 0; attempt < 10; attempt++) {
      let code = "";
      for (let i = 0; i < 6; i++) {
        code += JOIN_CODE_CHARS[Math.floor(Math.random() *
          JOIN_CODE_CHARS.length)];
      }
      const clash = await db.collection("fleets")
          .where("joinCode", "==", code).limit(1).get();
      if (clash.empty) return code;
    }
    throw new HttpsError("internal", "Could not make a join code.");
  }

  /**
   * Driving distance (km) and time (min) from Google's Routes API.
   * @param {Object} origin Pickup point.
   * @param {Object} destination Drop-off point.
   * @param {Array} stops Points in between, in order.
   * @return {Promise<Object>} {distanceKm, durationMinutes}
   */
  async function routeFor(origin, destination, stops) {
    const wp = (p) => ({location: {latLng: {
      latitude: p.latitude, longitude: p.longitude}}});
    const res = await fetch(
        "https://routes.googleapis.com/directions/v2:computeRoutes", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": MAPS_KEY,
            "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
          },
          body: JSON.stringify({
            origin: wp(origin),
            destination: wp(destination),
            intermediates: (stops || []).map(wp),
            travelMode: "DRIVE",
            routingPreference: "TRAFFIC_UNAWARE",
            units: "METRIC",
          }),
        });
    const data = await res.json().catch(() => ({}));
    const route = data && data.routes && data.routes[0];
    if (!route) {
      throw new HttpsError("failed-precondition",
          "Google could not find a driving route between those places.");
    }
    return {
      distanceKm: (Number(route.distanceMeters) || 0) / 1000,
      durationMinutes:
        (Number(String(route.duration || "0").replace("s", "")) || 0) / 60,
    };
  }

  /**
   * The fare for a route, worked out exactly as the passenger app does
   * (FareEstimationScreen calculateFareDetails), without a promo.
   * @param {Object} raw config/app document data.
   * @param {Object} route {distanceKm, durationMinutes}
   * @param {string} rideType Vehicle class id.
   * @return {Object} The ride's fare object.
   */
  function fareFor(raw, route, rideType) {
    const f = Object.assign({}, FARE_DEFAULTS);
    Object.keys(FARE_DEFAULTS).forEach((k) => {
      const v = raw && raw.fares ? Number(raw.fares[k]) : NaN;
      if (Number.isFinite(v) && v >= 0) f[k] = v;
    });
    const surgeRaw = raw && raw.surge ? Number(raw.surge.multiplier) : 1;
    const surge = Number.isFinite(surgeRaw) && surgeRaw >= 1 ? surgeRaw : 1;
    const multiplier = CLASS_MULTIPLIERS[rideType] || 1;
    const miles = route.distanceKm * 0.621371;
    const distanceFare = miles * f.ratePerMile;
    const timeFare = route.durationMinutes * f.ratePerMinute;
    const subtotal = (f.baseFare + distanceFare + timeFare) * multiplier *
      surge;
    const beforeVat = Math.max(subtotal, f.minimumFare);
    const vat = beforeVat * f.vatPercent / 100;
    const r2 = (n) => Number(n.toFixed(2));
    return {
      currency: (raw && raw.currency ? String(raw.currency) : "GBP")
          .toUpperCase(),
      vatPercent: f.vatPercent,
      discountAmount: 0,
      baseFare: r2(f.baseFare),
      distanceFare: r2(distanceFare),
      timeFare: r2(timeFare),
      surgeMultiplier: surge,
      rideMultiplier: multiplier,
      vat: r2(vat),
      total: r2(beforeVat + vat),
      distanceInMiles: r2(miles),
      subtotal: r2(beforeVat),
    };
  }

  /**
   * A fare object for a price the operator agreed on the phone. VAT is
   * taken as included, so the breakdown still adds up.
   * @param {Object} base The worked-out fare.
   * @param {number} total Agreed price including VAT.
   * @return {Object} Fare object.
   */
  function fareAtAgreedPrice(base, total) {
    const r2 = (n) => Number(n.toFixed(2));
    const beforeVat = total / (1 + base.vatPercent / 100);
    return Object.assign({}, base, {
      vat: r2(total - beforeVat),
      subtotal: r2(beforeVat),
      total: r2(total),
      agreedPrice: true,
      quotedTotal: base.total,
    });
  }

  /**
   * Reads config/app as stored (the fare fields are not in loadAppConfig).
   * @return {Promise<Object>} Raw settings.
   */
  async function rawConfig() {
    const snap = await db.collection("config").doc("app").get()
        .catch(() => null);
    return snap && snap.exists ? snap.data() || {} : {};
  }

  /**
   * Whether a driver can be sent a fleet job right now.
   * @param {Object} d Driver data.
   * @param {Object} ride Ride data.
   * @return {boolean} Eligible.
   */
  function canTakeFleetJob(d, ride) {
    return d.fleetId === ride.fleetId && canWork(d) &&
      canServe(d.vehicleType, ride.rideType);
  }

  /**
   * The driver's kind in their fleet: "self" (self-employed, own car) or
   * "company" (the fleet's car). Members from before the kinds existed are
   * company drivers, as they were then.
   * @param {Object} d Driver data.
   * @return {string} "self" or "company".
   */
  function fleetTypeOf(d) {
    return d.fleetDriverType === "self" ? "self" : "company";
  }

  /**
   * A driver kind sent by the dashboard, or throws.
   * @param {*} v Value.
   * @return {string} "self" or "company".
   */
  function chosenType(v) {
    if (v === "self" || v === "company") return v;
    throw new HttpsError("invalid-argument",
        "Choose company car or self-employed. If you do not see the choice, " +
        "refresh the page.");
  }

  /**
   * Approved, not blocked, documents in date and not on a forced rest.
   * @param {Object} d Driver data.
   * @return {boolean} May take jobs at all.
   */
  function canWork(d) {
    return d.approved === true && d.blocked !== true &&
      !hasExpiredDocument(d) && d.restDue !== true;
  }

  /**
   * Sends a dispatching phone job: a ring to the chosen driver, or to the
   * fleet's nearby online drivers.
   * @param {string} rideId Ride id.
   * @param {Object} ride Ride data.
   * @return {Promise<number>} Drivers it was sent to.
   */
  async function offerFleetJob(rideId, ride) {
    const cfg = await loadAppConfig();
    const pickup = ride.pickupLocation && ride.pickupLocation.address ?
      ride.pickupLocation.address : "a pickup";
    const target = ride.dispatch && ride.dispatch.driverId;
    let ids = [];
    if (target) {
      ids = [target];
    } else {
      const skip = new Set(ride.declinedBy || []);
      const drivers = await db.collection("drivers")
          .where("fleetId", "==", ride.fleetId).get();
      drivers.forEach((snap) => {
        const d = snap.data();
        if (skip.has(snap.id) || d.status !== "online" ||
            d.isOnRide === true || !canTakeFleetJob(d, ride)) {
          return;
        }
        const km = distanceKm(d.location, ride.pickupLocation);
        if (km <= cfg.dispatch.searchRadiusKm) ids.push(snap.id);
      });
    }
    await sendPush(ids, {
      title: target ? `Job from ${ride.fleetName || "your fleet"}` :
        "New fleet job",
      body: `Pickup at ${pickup}. Open TakeARoute to accept.`,
      channelId: "job-ring",
      sound: "job_ring.wav",
      ttlSeconds: 60,
      data: {type: "job_offer", rideId},
    });
    console.log(`Fleet job ${rideId} offered to ${ids.length} driver(s)`);
    return ids.length;
  }

  /**
   * Tells someone their account was suspended, or that it is back on.
   * @param {string} uid User.
   * @param {boolean} suspended Suspended (true) or lifted (false).
   * @param {string} reason Reason given, if any.
   * @param {string} by Who did it, as the person should read it.
   * @return {Promise<void>}
   */
  async function tellSuspension(uid, suspended, reason, by) {
    await sendPush([uid], suspended ? {
      title: "Your account has been suspended",
      body: `${by} suspended your account for breaking the terms and ` +
        `conditions.${reason ? ` Reason: ${reason}.` : ""} You cannot ` +
        "take jobs until it is lifted.",
      channelId: "general",
    } : {
      title: "Your account is active again",
      body: `${by} lifted your suspension. You can go online again.`,
      channelId: "general",
    }).catch(() => null);
  }

  /**
   * Offers waiting for this driver go back to the fleet's office.
   * @param {string} fleetId Fleet.
   * @param {string} driverId Driver.
   * @param {Array} docs Open rides of the fleet (snapshots).
   * @return {Promise<void>}
   */
  async function returnOffers(fleetId, driverId, docs) {
    for (const d of docs) {
      const r = d.data();
      if (!r.dispatch || r.dispatch.driverId !== driverId) continue;
      await d.ref.update(r.status === "dispatching" ? {
        "dispatch.driverId": null,
        "dispatch.returnedBy": driverId,
        "dispatch.returnedAt": FieldValue.serverTimestamp(),
        "dispatch.offeredAt": null,
      } : {"dispatch.driverId": null}).catch(() => null);
    }
  }

  /**
   * The fleet's open rides, and the one this driver is doing, if any.
   * @param {string} fleetId Fleet.
   * @param {string} driverId Driver.
   * @return {Promise<Object>} {docs, onJob}
   */
  async function openFleetRides(fleetId, driverId) {
    const open = await db.collection("rides")
        .where("fleetId", "==", fleetId)
        .where("status", "in", ["scheduled", "dispatching", "accepted",
          "arrived", "ongoing"])
        .get();
    const onJob = open.docs.find((d) => d.data().driverId === driverId &&
      ["accepted", "arrived", "ongoing"].includes(d.data().status));
    return {docs: open.docs, onJob};
  }

  /**
   * Every zone a point is in, smallest first.
   * @param {Array} zones Fleet zones [{id, name, center, radiusKm}].
   * @param {Object} p {latitude, longitude}.
   * @return {Array} Zones containing the point.
   */
  function zonesAt(zones, p) {
    if (!p || !Array.isArray(zones)) return [];
    return zones
        .filter((z) => z && z.center && distanceKm(p, z.center) <= z.radiusKm)
        .sort((a, b) => a.radiusKm - b.radiusKm);
  }

  /**
   * The zone a point belongs to: the smallest circle that contains it, so a
   * station zone inside a town zone wins.
   * @param {Array} zones Fleet zones [{id, name, center, radiusKm}].
   * @param {Object} p {latitude, longitude}.
   * @return {?Object} Zone, or null.
   */
  function zoneFor(zones, p) {
    return zonesAt(zones, p)[0] || null;
  }

  /**
   * Rebuilds a fleet's zone queues from where its free drivers are now.
   * A driver keeps their place while they stay free in the same zone; one
   * who has just arrived, or just become free, joins at the back.
   * @param {string} fleetId Fleet.
   * @param {Array} zones The fleet's zones.
   * @return {Promise<Object>} {zoneId: [{driverId, name, vehicleType,
   *   since}]}, each in queue order (since in ms).
   */
  async function refreshQueue(fleetId, zones) {
    const ref = db.collection("fleetQueues").doc(fleetId);
    const [queueSnap, drivers] = await Promise.all([ref.get(),
      db.collection("drivers").where("fleetId", "==", fleetId).get()]);
    const old = queueSnap.exists ? queueSnap.data().zones || {} : {};
    const placed = {};
    Object.keys(old).forEach((zoneId) => (old[zoneId] || []).forEach((e) => {
      placed[e.driverId] = {zoneId, since: toMillis(e.since)};
    }));
    const now = Date.now();
    const queues = {};
    (zones || []).forEach((z) => (queues[z.id] = []));
    drivers.forEach((snap) => {
      const d = snap.data();
      if (d.status !== "online" || d.isOnRide === true || !canWork(d)) return;
      const seen = toMillis(d.lastUpdated);
      if (!seen || now - seen > QUEUE_STALE_MS) return;
      const zone = zoneFor(zones, d.location);
      if (!zone) return;
      const was = placed[snap.id];
      queues[zone.id].push({
        driverId: snap.id,
        name: [d.firstName, d.lastName].filter(Boolean).join(" ") ||
          d.name || d.fullName || "Driver",
        vehicleType: d.vehicleType || "RouteMini",
        since: was && was.zoneId === zone.id && was.since ? was.since : now,
      });
    });
    const stored = {};
    Object.keys(queues).forEach((zoneId) => {
      queues[zoneId].sort((a, b) => a.since - b.since);
      stored[zoneId] = queues[zoneId].map((e) =>
        Object.assign({}, e, {since: Timestamp.fromMillis(e.since)}));
    });
    const zoneNames = {};
    (zones || []).forEach((z) => (zoneNames[z.id] = z.name));
    await ref.set({zones: stored, zoneNames,
      updatedAt: FieldValue.serverTimestamp()});
    return queues;
  }

  /**
   * Moves a driver to the back of their zone queue (they said no, or did
   * not answer).
   * @param {string} fleetId Fleet.
   * @param {string} driverId Driver.
   * @return {Promise<void>}
   */
  async function sendToBack(fleetId, driverId) {
    const ref = db.collection("fleetQueues").doc(fleetId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const zones = snap.data().zones || {};
      let changed = false;
      Object.keys(zones).forEach((zoneId) => {
        const list = zones[zoneId] || [];
        const i = list.findIndex((e) => e.driverId === driverId);
        if (i < 0) return;
        const [entry] = list.splice(i, 1);
        list.push(Object.assign({}, entry, {since: Timestamp.now()}));
        changed = true;
      });
      if (changed) tx.update(ref, {zones});
    });
  }

  /**
   * Rings the next driver for a queued job: first in its pickup zone, then
   * in each larger zone that also contains the pickup, and hands it to the
   * whole fleet when all of them have nobody left.
   * @param {Object} rideRef Ride document.
   * @param {Object} ride Ride data as the trigger saw it.
   * @return {Promise<void>}
   */
  async function offerNextInQueue(rideRef, ride) {
    const current = ride.dispatch && ride.dispatch.driverId;
    if (current) {
      await sendToBack(ride.fleetId, current).catch((error) => {
        console.error("Queue: could not move driver back:", error.message);
      });
    }
    const fleetSnap = await db.collection("fleets").doc(ride.fleetId).get();
    const zones = fleetSnap.exists ? fleetSnap.data().zones || [] : [];
    const tried = zonesAt(zones, ride.pickupLocation);
    let zone = tried[0] || null;
    let next = null;
    if (tried.length) {
      const queues = await refreshQueue(ride.fleetId, zones);
      const skip = new Set(ride.declinedBy || []);
      for (const z of tried) {
        next = (queues[z.id] || []).find((e) => !skip.has(e.driverId) &&
          canServe(e.vehicleType, ride.rideType)) || null;
        if (next) {
          zone = z;
          break;
        }
      }
    }
    // Nobody anywhere: name every zone tried, for the office.
    const zoneName = next ? zone.name :
      tried.map((z) => z.name).join(", ") || null;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(rideRef);
      const now = snap.exists ? snap.data() : null;
      // Someone took it, the office changed it, or another run got here.
      if (!now || now.status !== "dispatching" ||
          !now.dispatch || now.dispatch.mode !== "queue" ||
          (now.dispatch.driverId || null) !== (current || null)) {
        return;
      }
      tx.update(rideRef, {
        "dispatch.driverId": next ? next.driverId : null,
        "dispatch.zoneId": zone ? zone.id : null,
        "dispatch.zoneName": zoneName,
        "dispatch.queueDone": !next,
        "dispatch.offeredAt": FieldValue.serverTimestamp(),
        "dispatch.queueOffers": FieldValue.increment(next ? 1 : 0),
      });
    });
    console.log(`Queue job ${rideRef.id}: ` + (next ?
      `offered to ${next.driverId} in ${zone.name}` :
      `${zoneName ? zoneName + " empty" : "pickup in no zone"}, ` +
      "sent to fleet"));
  }

  /**
   * Upserts a phone customer and remembers the addresses they used.
   * @param {string} fleetId Fleet.
   * @param {Object} customer {name, phone}
   * @param {Array} places Points used on this booking.
   * @param {Object} journey {from, to, rideType} of this booking.
   * @return {Promise<void>}
   */
  async function rememberCustomer(fleetId, customer, places, journey) {
    const ref = db.collection("fleets").doc(fleetId)
        .collection("customers").doc(customer.phone);
    const clean = (p) => ({latitude: p.latitude, longitude: p.longitude,
      address: p.address});
    const key = (p) => String(p.address).toLowerCase();
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const old = snap.exists ? snap.data() : {};
      const seen = new Set();
      const addresses = places.concat(old.addresses || [])
          .filter((p) => {
            if (seen.has(key(p))) return false;
            seen.add(key(p));
            return true;
          })
          .slice(0, 10)
          .map(clean);
      // Journeys they have booked, newest first, one entry per route, so
      // the contact card can rebook (or reverse) one in a tap.
      const route = (j) => `${key(j.from)}|${key(j.to)}`;
      const journeys = [{from: clean(journey.from), to: clean(journey.to),
        rideType: journey.rideType, at: Timestamp.now()}]
          .concat((old.journeys || [])
              .filter((j) => route(j) !== route(journey)))
          .slice(0, 10);
      tx.set(ref, {
        phone: customer.phone,
        name: customer.name || old.name || "",
        notes: old.notes || "",
        places: old.places || [],
        addresses,
        journeys,
        bookings: FieldValue.increment(1),
        lastBookedAt: FieldValue.serverTimestamp(),
        createdAt: old.createdAt || FieldValue.serverTimestamp(),
      }, {merge: true});
    });
  }

  /* --------------------------- admin: fleets ------------------------- */

  /* Creates a fleet, its wallet and its owner's dashboard login. Returns a
     link the owner opens to set their password. */
  out.createFleet = functions.https.onCall(async (data, context) => {
    await assertAdmin(context);
    const name = text(data && data.name, 80);
    const email = text(data && data.email, 120).toLowerCase();
    const ownerName = text(data && data.ownerName, 80);
    const phone = toE164(data && data.phone) || "";
    if (name.length < 2) {
      throw new HttpsError("invalid-argument", "Enter the fleet's name.");
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new HttpsError("invalid-argument",
          "Enter the owner's email address.");
    }
    const price = data && data.perDriverMonthly !== undefined &&
      data.perDriverMonthly !== null && data.perDriverMonthly !== "" ?
      Number(data.perDriverMonthly) : null;
    if (price !== null && !(price >= 0)) {
      throw new HttpsError("invalid-argument",
          "The monthly price per driver must be a number.");
    }

    let user;
    try {
      user = await admin.auth().getUserByEmail(email);
    } catch (error) {
      user = await admin.auth().createUser({email, displayName: ownerName});
    }
    const existing = await db.collection("fleetManagers").doc(user.uid).get();
    if (existing.exists && existing.data().isActive === true) {
      throw new HttpsError("already-exists",
          "That email already runs a fleet.");
    }
    const isAdmin = await db.collection("admins").doc(user.uid).get();
    if (isAdmin.exists) {
      throw new HttpsError("already-exists",
          "That email is a TakeARoute admin. Use another email for the fleet.");
    }

    const cfg = await loadAppConfig();
    const fleetRef = db.collection("fleets").doc();
    const joinCode = await newJoinCode();
    const now = FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.set(fleetRef, {
      name, joinCode, status: "active",
      ownerName, ownerEmail: email, ownerUid: user.uid, phone,
      perDriverMonthly: price,
      currency: cfg.currency,
      dispatchLeadMinutes: DEFAULT_LEAD_MINUTES,
      nextBillingDate: Timestamp.fromDate(addOneMonth(new Date())),
      createdAt: now, createdBy: context.auth.uid,
    });
    batch.set(db.collection("fleetManagers").doc(user.uid), {
      fleetId: fleetRef.id, fleetName: name, role: "owner",
      name: ownerName, email, isActive: true, createdAt: now,
    });
    batch.set(db.collection("fleetWallets").doc(fleetRef.id), {
      availableBalance: 0, totalEarned: 0, totalPaidOut: 0, totalCharged: 0,
      currency: cfg.currency, createdAt: now, updatedAt: now,
    });
    await batch.commit();

    const link = await admin.auth().generatePasswordResetLink(email)
        .catch(() => null);
    return {fleetId: fleetRef.id, joinCode, passwordLink: link};
  });

  /* Admin pays a fleet by bank transfer and records it here. */
  out.recordFleetPayout = functions.https.onCall(async (data, context) => {
    await assertAdmin(context);
    const fleetId = text(data && data.fleetId, 60);
    const amount = Math.round(Number(data && data.amount) * 100) / 100;
    const reference = text(data && data.reference, 120);
    if (!fleetId || !(amount > 0)) {
      throw new HttpsError("invalid-argument", "Enter the amount paid.");
    }
    const walletRef = db.collection("fleetWallets").doc(fleetId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(walletRef);
      if (!snap.exists) throw new HttpsError("not-found", "No fleet wallet.");
      tx.update(walletRef, {
        availableBalance: FieldValue.increment(-amount),
        totalPaidOut: FieldValue.increment(amount),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(walletRef.collection("transactions").doc(), {
        type: "payout", amount: -amount, reference,
        description: reference ? `Bank payment (${reference})` :
          "Bank payment",
        recordedBy: context.auth.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
    return {ok: true};
  });

  /* ------------------------ fleet staff logins ----------------------- */

  /* The owner adds an operator (call taker) who can book and dispatch. */
  out.addFleetOperator = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, true);
    const email = text(data && data.email, 120).toLowerCase();
    const name = text(data && data.name, 80);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new HttpsError("invalid-argument", "Enter their email address.");
    }
    let user;
    try {
      user = await admin.auth().getUserByEmail(email);
    } catch (error) {
      user = await admin.auth().createUser({email, displayName: name});
    }
    const [mgr, adm] = await Promise.all([
      db.collection("fleetManagers").doc(user.uid).get(),
      db.collection("admins").doc(user.uid).get(),
    ]);
    if (adm.exists || (mgr.exists && mgr.data().isActive === true &&
        mgr.data().fleetId !== me.fleetId)) {
      throw new HttpsError("already-exists",
          "That email is already used elsewhere on TakeARoute.");
    }
    await db.collection("fleetManagers").doc(user.uid).set({
      fleetId: me.fleetId, fleetName: me.fleet.name, role: "operator",
      name, email, isActive: true,
      createdAt: FieldValue.serverTimestamp(), createdBy: me.uid,
    });
    const link = await admin.auth().generatePasswordResetLink(email)
        .catch(() => null);
    return {uid: user.uid, passwordLink: link};
  });

  out.removeFleetOperator = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, true);
    const uid = text(data && data.uid, 128);
    if (!uid || uid === me.uid) {
      throw new HttpsError("invalid-argument", "You cannot remove yourself.");
    }
    const ref = db.collection("fleetManagers").doc(uid);
    const snap = await ref.get();
    if (!snap.exists || snap.data().fleetId !== me.fleetId) {
      throw new HttpsError("not-found", "Not one of your staff.");
    }
    await ref.update({isActive: false, removedAt: FieldValue.serverTimestamp(),
      removedBy: me.uid});
    return {ok: true};
  });

  /* ---------------------------- drivers ------------------------------ */

  /**
   * The membership fields for a driver becoming a company driver: the
   * fleet pays, and their own membership is kept to give back if they go.
   * @param {Object} driver Driver data.
   * @param {string} fleetId Fleet id.
   * @param {string} fleetName Fleet name.
   * @return {Object} Fields to write.
   */
  function fleetPaysFields(driver, fleetId, fleetName) {
    const sub = driver.subscription || null;
    return {
      // Kept as "active" so every build of the app lets the driver go
      // online; renewals skip anything that is not wallet_deduction.
      subscriptionBeforeFleet: sub && sub.paymentMethod !== "fleet" ?
        sub : (driver.subscriptionBeforeFleet || null),
      subscription: {status: "active", paymentMethod: "fleet", fleetId,
        fleetName},
    };
  }

  /**
   * The membership fields for a company driver going back to paying their
   * own: the one they had before comes back as it was (renewals pick it up
   * from its billing date); with none, they activate one like any new
   * driver, which every build of the app asks for before going online.
   * @param {Object} driver Driver data.
   * @return {Object} {fields, restored}
   */
  function ownMembershipFields(driver) {
    const sub = driver.subscription || null;
    if (!sub || sub.paymentMethod !== "fleet") {
      return {fields: {subscriptionBeforeFleet: FieldValue.delete()},
        restored: Boolean(sub)};
    }
    const before = driver.subscriptionBeforeFleet;
    const restored = Boolean(before && before.paymentMethod !== "fleet" &&
      ["active", "past_due", "suspended"].includes(before.status));
    return {restored, fields: {
      subscription: restored ? before : FieldValue.delete(),
      subscriptionBeforeFleet: FieldValue.delete(),
    }};
  }

  /**
   * Puts a driver into a fleet. A company driver's earnings and membership
   * move to the fleet; a self-employed driver keeps their own.
   * @param {Object} tx Transaction.
   * @param {Object} driverRef Driver document.
   * @param {Object} driver Driver data.
   * @param {string} fleetId Fleet id.
   * @param {Object} fleet Fleet data.
   * @param {string} type "company" or "self".
   */
  function joinInTx(tx, driverRef, driver, fleetId, fleet, type) {
    tx.update(driverRef, Object.assign({
      fleetId,
      fleetName: fleet.name,
      fleetDriverType: type,
      fleetJoinedAt: FieldValue.serverTimestamp(),
      fleetRequest: FieldValue.delete(),
      fleetInvite: FieldValue.delete(),
    }, type === "company" ? fleetPaysFields(driver, fleetId, fleet.name) : {}));
  }

  /**
   * What the driver is told on joining.
   * @param {string} type "company" or "self".
   * @return {string} Message.
   */
  function joinedText(type) {
    return type === "company" ?
      "As a company driver, your fleet receives your card earnings and " +
        "pays your membership." :
      "You can now take their jobs. As a self-employed driver, card fares " +
        "still go to your wallet and you keep your own membership.";
  }

  /* A driver asks to join a fleet with its join code. */
  out.requestFleetJoin = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new HttpsError("unauthenticated", "Sign in.");
    const code = text(data && data.code, 12).toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
    if (code.length < 4) {
      throw new HttpsError("invalid-argument", "Enter the fleet's code.");
    }
    const found = await db.collection("fleets")
        .where("joinCode", "==", code).limit(1).get();
    if (found.empty || found.docs[0].data().status === "suspended") {
      throw new HttpsError("not-found", "No fleet has that code.");
    }
    const fleetDoc = found.docs[0];
    const driverRef = db.collection("drivers").doc(context.auth.uid);
    const driverSnap = await driverRef.get();
    if (!driverSnap.exists) {
      throw new HttpsError("failed-precondition",
          "Finish your driver sign-up first.");
    }
    const driver = driverSnap.data();
    if (driver.fleetId === fleetDoc.id) {
      throw new HttpsError("already-exists", "You are already in this fleet.");
    }
    if (driver.fleetId) {
      throw new HttpsError("failed-precondition",
          `You drive for ${driver.fleetName || "another fleet"}. ` +
          "Leave that fleet first.");
    }
    await driverRef.update({fleetRequest: {
      fleetId: fleetDoc.id, fleetName: fleetDoc.data().name,
      requestedAt: FieldValue.serverTimestamp(),
    }});
    return {fleetName: fleetDoc.data().name};
  });

  out.cancelFleetRequest = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new HttpsError("unauthenticated", "Sign in.");
    await db.collection("drivers").doc(context.auth.uid)
        .update({fleetRequest: FieldValue.delete()});
    return {ok: true};
  });

  /* The driver answers a fleet's invitation (sent by phone number). */
  out.answerFleetInvite = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new HttpsError("unauthenticated", "Sign in.");
    const accept = data && data.accept === true;
    const driverRef = db.collection("drivers").doc(context.auth.uid);
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(driverRef);
      const driver = snap.exists ? snap.data() : null;
      const invite = driver && driver.fleetInvite;
      if (!invite || !invite.fleetId) {
        throw new HttpsError("not-found", "This invitation has gone.");
      }
      const fleetRef = db.collection("fleets").doc(invite.fleetId);
      const fleetSnap = await tx.get(fleetRef);
      const phone = toE164(driver.phoneNumber || driver.phone);
      const inviteRef = phone ? db.collection("fleetInvites").doc(phone) : null;
      if (!accept || !fleetSnap.exists ||
          fleetSnap.data().status === "suspended") {
        tx.update(driverRef, {fleetInvite: FieldValue.delete()});
        if (inviteRef) tx.delete(inviteRef);
        return {joined: false};
      }
      if (driver.fleetId) {
        throw new HttpsError("failed-precondition",
            `You drive for ${driver.fleetName || "another fleet"}.`);
      }
      // Invitations from before the kinds existed made company drivers.
      const type = invite.driverType === "self" ? "self" : "company";
      joinInTx(tx, driverRef, driver, invite.fleetId, fleetSnap.data(), type);
      if (inviteRef) tx.delete(inviteRef);
      return {joined: true, fleetName: fleetSnap.data().name,
        driverType: type};
    });
    return result;
  });

  /* The fleet approves or turns down a driver who asked to join. */
  out.decideFleetDriver = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, false);
    const driverId = text(data && data.driverId, 128);
    const approve = data && data.approve === true;
    const type = approve ? chosenType(data.driverType) : null;
    const driverRef = db.collection("drivers").doc(driverId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(driverRef);
      const driver = snap.exists ? snap.data() : null;
      if (!driver || !driver.fleetRequest ||
          driver.fleetRequest.fleetId !== me.fleetId) {
        throw new HttpsError("not-found", "No request from this driver.");
      }
      if (!approve) {
        tx.update(driverRef, {fleetRequest: FieldValue.delete()});
        return;
      }
      if (driver.fleetId) {
        throw new HttpsError("failed-precondition",
            "This driver has joined another fleet.");
      }
      joinInTx(tx, driverRef, driver, me.fleetId, me.fleet, type);
    });
    await sendPush([driverId], {
      title: approve ? `You joined ${me.fleet.name}` : "Fleet request declined",
      body: approve ? joinedText(type) :
        `${me.fleet.name} did not accept your request.`,
      channelId: "general",
    }).catch(() => null);
    return {ok: true};
  });

  /* The fleet invites a driver by phone number. A driver who already has an
     account sees it in the app at once; anyone else when they sign up. */
  out.inviteFleetDriver = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, false);
    const phone = toE164(data && data.phone);
    if (!phone) {
      throw new HttpsError("invalid-argument",
          "Enter the driver's mobile number.");
    }
    const invite = {fleetId: me.fleetId, fleetName: me.fleet.name,
      driverType: chosenType(data.driverType),
      invitedAt: Timestamp.now(), invitedBy: me.uid};
    await db.collection("fleetInvites").doc(phone).set(
        Object.assign({phone}, invite));
    const matches = await findDriversByPhone(phone);
    let notified = 0;
    for (const doc of matches) {
      const d = doc.data();
      if (d.fleetId === me.fleetId) continue;
      await doc.ref.update({fleetInvite: invite});
      notified += await sendPush([doc.id], {
        title: `${me.fleet.name} invited you`,
        body: "Open TakeARoute to join their fleet.",
        channelId: "general",
      }).catch(() => 0);
    }
    return {existingAccount: matches.length > 0, notified};
  });

  /**
   * Driver accounts with this phone number, however it was typed.
   * @param {string} e164 Number in +44... form.
   * @return {Promise<Array>} Driver snapshots.
   */
  async function findDriversByPhone(e164) {
    const national = e164.startsWith("+44") ? "0" + e164.slice(3) : null;
    const forms = [e164, national, e164.replace("+", "")].filter(Boolean);
    const seen = new Map();
    // Phone sign-ins carry the number on the login itself.
    try {
      const user = await admin.auth().getUserByPhoneNumber(e164);
      const snap = await db.collection("drivers").doc(user.uid).get();
      if (snap.exists) seen.set(snap.id, snap);
    } catch (error) {
      // No login with that number.
    }
    for (const field of ["phoneNumber", "phone"]) {
      const snap = await db.collection("drivers")
          .where(field, "in", forms).get();
      snap.docs.forEach((d) => seen.set(d.id, d));
    }
    return [...seen.values()];
  }

  /* A new driver account picks up an invitation waiting for its number. */
  out.applyFleetInviteOnSignup = functions.firestore
      .document("drivers/{driverId}")
      .onWrite(async (change) => {
        if (!change.after.exists) return null;
        const after = change.after.data();
        const before = change.before.exists ? change.before.data() : {};
        const phone = toE164(after.phoneNumber || after.phone);
        const beforePhone = toE164(before.phoneNumber || before.phone);
        if (!phone || phone === beforePhone || after.fleetId ||
            after.fleetInvite) {
          return null;
        }
        const invite = await db.collection("fleetInvites").doc(phone).get();
        if (!invite.exists) return null;
        const i = invite.data();
        await change.after.ref.update({fleetInvite: {fleetId: i.fleetId,
          fleetName: i.fleetName, driverType: i.driverType || "company",
          invitedAt: i.invitedAt, invitedBy: i.invitedBy || null}});
        return null;
      });

  /**
   * Takes a driver out of their fleet; they drive independently from then
   * on. Not while they are on one of the fleet's jobs: it would be left
   * with a driver who no longer works for them.
   * @param {string} driverId Driver.
   * @param {Function} check Throws if the caller may not, given the
   *     driver's data.
   * @param {string} by Who did it, kept on the driver.
   * @return {Promise<Object>} {fleetId, fleetName, type, restored}
   */
  async function takeOutOfFleet(driverId, check, by) {
    const driverRef = db.collection("drivers").doc(driverId);
    const first = await driverRef.get();
    const fleetId = first.exists ? first.data().fleetId : null;
    if (!fleetId) throw new HttpsError("not-found", "Not in a fleet.");
    check(first.data());
    const {docs, onJob} = await openFleetRides(fleetId, driverId);
    if (onJob) {
      throw new HttpsError("failed-precondition",
          "This driver is on one of the fleet's jobs. Try again once it " +
          "has ended, or cancel or resend the job first.");
    }

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(driverRef);
      const driver = snap.exists ? snap.data() : null;
      if (!driver || driver.fleetId !== fleetId) {
        throw new HttpsError("aborted", "Their fleet changed. Try again.");
      }
      check(driver);
      const type = fleetTypeOf(driver);
      const own = ownMembershipFields(driver);
      // A suspension the fleet made ends with its say over the driver; one
      // by TakeARoute stays.
      const liftOwn = driver.blocked === true &&
        driver.blockedByFleet === fleetId;
      tx.update(driverRef, Object.assign(liftOwn ? {
        blocked: false, blockedReason: "", blockedByFleet: null,
        unblockedAt: new Date().toISOString(),
        unblockedBy: `${driver.fleetName || "Fleet"} (left the fleet)`,
      } : {}, own.fields, {
        fleetId: null,
        fleetName: null,
        fleetDriverType: FieldValue.delete(),
        fleetLeftAt: FieldValue.serverTimestamp(),
        fleetLeftBy: by,
        lastFleetId: fleetId,
      }));
      return {fleetId, fleetName: driver.fleetName || "your fleet", type,
        restored: own.restored};
    });

    // Offers that were waiting for this driver go back to the office.
    await returnOffers(fleetId, driverId, docs);

    await sendPush([driverId], {
      title: `You left ${result.fleetName}`,
      body: result.type === "self" ?
        "You now drive independently. Nothing changes with your " +
          "membership or your wallet." :
        result.restored ?
          "You now drive independently. Your own membership is back on, " +
            "and card fares go to your wallet again." :
          "You now drive independently. Activate your membership in the " +
            "app to keep going online; card fares go to your wallet again.",
      channelId: "general",
    }).catch(() => null);
    return result;
  }

  /* The fleet lets one of its company drivers go. Self-employed drivers
     are TakeARoute's: the fleet can suspend them, not remove them. */
  out.removeFleetDriver = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, false);
    const driverId = text(data && data.driverId, 128);
    const by = `${me.manager.name || me.manager.email || "Staff"}, ` +
      `${me.fleet.name} (fleet)`;
    const result = await takeOutOfFleet(driverId, (driver) => {
      if (driver.fleetId !== me.fleetId) {
        throw new HttpsError("not-found", "Not one of your drivers.");
      }
      if (fleetTypeOf(driver) === "self") {
        throw new HttpsError("permission-denied",
            "Self-employed drivers can only be removed by TakeARoute. You " +
            "can suspend them, or ask TakeARoute to remove them.");
      }
    }, by);
    return {ok: true, membershipRestored: result.restored};
  });

  /* A self-employed driver leaves their fleet. Company drivers ask their
     fleet, who let them go. */
  out.leaveFleet = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new HttpsError("unauthenticated", "Sign in.");
    const result = await takeOutOfFleet(context.auth.uid, (driver) => {
      if (fleetTypeOf(driver) !== "self") {
        throw new HttpsError("permission-denied",
            "You drive one of your fleet's cars. Ask your fleet to let " +
            "you go.");
      }
    }, "the driver");
    return {ok: true, membershipRestored: result.restored};
  });

  /* A TakeARoute admin takes any driver out of their fleet. */
  out.adminRemoveFleetDriver = functions.https.onCall(async (data, context) => {
    await assertAdmin(context);
    const driverId = text(data && data.driverId, 128);
    const result = await takeOutOfFleet(driverId, () => null,
        `${context.auth.token.email || "an admin"} (TakeARoute)`);
    return {ok: true, membershipRestored: result.restored};
  });

  /* A TakeARoute admin changes a fleet driver between company car and
     self-employed; membership and earnings follow from the next trip. */
  out.setFleetDriverType = functions.https.onCall(async (data, context) => {
    await assertAdmin(context);
    const driverId = text(data && data.driverId, 128);
    const type = chosenType(data && data.driverType);
    const driverRef = db.collection("drivers").doc(driverId);
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(driverRef);
      const driver = snap.exists ? snap.data() : null;
      if (!driver || !driver.fleetId) {
        throw new HttpsError("not-found", "Not in a fleet.");
      }
      if (fleetTypeOf(driver) === type && driver.fleetDriverType === type) {
        return {changed: false, fleetName: driver.fleetName};
      }
      const fields = type === "company" ?
        fleetPaysFields(driver, driver.fleetId, driver.fleetName) :
        ownMembershipFields(driver).fields;
      tx.update(driverRef, Object.assign(fields, {fleetDriverType: type}));
      return {changed: fleetTypeOf(driver) !== type,
        fleetName: driver.fleetName};
    });
    if (result.changed) {
      await sendPush([driverId], {
        title: type === "company" ? "You are now a company driver" :
          "You are now self-employed in your fleet",
        body: type === "company" ?
          `${result.fleetName || "Your fleet"} now receives your card ` +
            "earnings and pays your membership." :
          "Card fares now go to your wallet, and you pay your own " +
            "membership.",
        channelId: "general",
      }).catch(() => null);
    }
    return {ok: true, changed: result.changed};
  });

  /* A fleet's owner or operator suspends one of their drivers (or lifts
     it). It is the same block TakeARoute admins use (drivers/{id}.blocked),
     so the app shows "Account suspended" and no job reaches them; it is
     marked as the fleet's, and the fleet can only lift its own. What is
     owed between the fleet and the driver is for them to settle. */
  out.suspendFleetDriver = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, false);
    const driverId = text(data && data.driverId, 128);
    const suspend = !(data && data.suspend === false);
    const reason = text(data && data.reason, 200);
    const driverRef = db.collection("drivers").doc(driverId);

    const {docs, onJob} = await openFleetRides(me.fleetId, driverId);
    if (suspend && onJob) {
      throw new HttpsError("failed-precondition",
          "This driver is on one of your jobs. Suspend them once it has " +
          "ended, or cancel or resend the job first.");
    }
    const by = `${me.manager.name || me.manager.email || "Staff"}, ` +
      `${me.fleet.name} (fleet)`;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(driverRef);
      const driver = snap.exists ? snap.data() : null;
      if (!driver || driver.fleetId !== me.fleetId) {
        throw new HttpsError("not-found", "Not one of your drivers.");
      }
      if (suspend) {
        if (driver.blocked === true) {
          throw new HttpsError("already-exists", "Already suspended.");
        }
        tx.update(driverRef, {
          blocked: true, blockedReason: reason,
          blockedAt: new Date().toISOString(),
          blockedBy: by,
          blockedByFleet: me.fleetId, status: "offline",
        });
      } else {
        if (driver.blocked !== true) {
          throw new HttpsError("failed-precondition", "Not suspended.");
        }
        if (driver.blockedByFleet !== me.fleetId) {
          throw new HttpsError("permission-denied",
              "TakeARoute suspended this driver. Please contact TakeARoute.");
        }
        tx.update(driverRef, {
          blocked: false, blockedReason: "", blockedByFleet: null,
          unblockedAt: new Date().toISOString(),
          unblockedBy: by,
        });
      }
    });
    if (suspend) await returnOffers(me.fleetId, driverId, docs);
    await tellSuspension(driverId, suspend, reason, me.fleet.name);
    return {ok: true, suspended: suspend};
  });

  /* A TakeARoute admin suspends an account (driver and passenger records
     alike) or lifts it, and the person is told. */
  out.setAccountSuspension = functions.https.onCall(async (data, context) => {
    await assertAdmin(context);
    const uid = text(data && data.uid, 128);
    const suspend = !(data && data.suspend === false);
    const reason = text(data && data.reason, 200);
    const adminSnap = await db.collection("admins").doc(context.auth.uid)
        .get();
    const who = (adminSnap.data() || {}).email || context.auth.token.email ||
      "an admin";
    let found = 0;
    for (const coll of ["drivers", "riders"]) {
      const ref = db.collection(coll).doc(uid);
      const snap = await ref.get();
      if (!snap.exists) continue;
      found++;
      await ref.update(suspend ? Object.assign({
        blocked: true, blockedReason: reason,
        blockedAt: new Date().toISOString(), blockedBy: who,
        blockedByFleet: null,
      }, coll === "drivers" ? {status: "offline"} : {}) : {
        blocked: false, blockedReason: "", blockedByFleet: null,
        unblockedAt: new Date().toISOString(), unblockedBy: who,
      });
    }
    if (!found) throw new HttpsError("not-found", "No such account.");
    await tellSuspension(uid, suspend, reason, "TakeARoute");
    return {ok: true, suspended: suspend};
  });

  /* --------------------------- phone bookings ------------------------ */

  /* ---------------------- callers who also use the app ---------------------
     The phone number is the key. A caller whose number is on a passenger
     account is linked on their contact card (riderId, appUser). The card
     then shows it, phone bookings for them carry customer.riderId, and
     they get their phone booking's progress in the app (notifyAppCaller).
     Their passenger account is never changed. */

  /**
   * The passenger account with this phone number, if any.
   * @param {string} e164 Number in +44... form.
   * @return {Promise<?Object>} {uid, name, currentRideId}
   */
  async function findRiderByPhone(e164) {
    let uid = null;
    try {
      uid = (await admin.auth().getUserByPhoneNumber(e164)).uid;
    } catch (error) {
      // No phone sign-in with that number; try the number on file.
    }
    let snap = uid ? await db.collection("riders").doc(uid).get() : null;
    if (!snap || !snap.exists) {
      const national = e164.startsWith("+44") ? "0" + e164.slice(3) : null;
      const forms = [e164, national].filter(Boolean);
      for (const field of ["phoneNumber", "phone"]) {
        const found = await db.collection("riders")
            .where(field, "in", forms).limit(1).get();
        if (!found.empty) {
          snap = found.docs[0];
          break;
        }
      }
    }
    if (!snap || !snap.exists) return null;
    const r = snap.data();
    return {uid: snap.id, name: r.fullName || r.name || "",
      currentRideId: r.currentRideId || null};
  }

  /* The booking form asks this once a number is typed: is the caller an
     app passenger, and are they on an app trip right now? Links the card. */
  out.fleetLookupCaller = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, false);
    const phone = toE164(data && data.phone);
    if (!phone) return {appUser: false};
    const rider = await findRiderByPhone(phone);
    const cardRef = db.collection("fleets").doc(me.fleetId)
        .collection("customers").doc(phone);
    if (!rider) {
      await cardRef.set({appUser: false}, {merge: true}).catch(() => {});
      return {appUser: false};
    }
    const card = await cardRef.get();
    await cardRef.set(Object.assign({appUser: true, riderId: rider.uid},
        card.exists && card.data().name ? {} : {name: rider.name}),
    {merge: true});
    let activeRide = null;
    if (rider.currentRideId) {
      const r = await db.collection("rides").doc(rider.currentRideId).get();
      const live = ["searching", "accepted", "arrived", "ongoing"];
      if (r.exists && live.includes(r.data().status)) {
        activeRide = {status: r.data().status,
          pickup: (r.data().pickupLocation || {}).address || "",
          withFleet: r.data().fleetId === me.fleetId};
      }
    }
    return {appUser: true, name: rider.name, activeRide};
  });

  /* A phone booking for a caller who has the app: tell them in the app as
     it goes, since they have no tracking screen for it. */
  out.notifyAppCaller = functions.firestore
      .document("rides/{rideId}")
      .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();
        const uid = after.customer && after.customer.riderId;
        if (after.source !== "phone" || !uid ||
            before.status === after.status) {
          return null;
        }
        const fleet = after.fleetName || "Your taxi firm";
        let driver = null;
        if (after.driverId) {
          const snap = await db.collection("drivers").doc(after.driverId).get();
          driver = snap.exists ? snap.data() : null;
        }
        const who = driver ?
          (driver.firstName || String(driver.fullName || "").split(" ")[0] ||
            "Your driver") : "Your driver";
        const car = driver ? [driver.vehicleColor, driver.makeModel,
          driver.registrationNumber ?
            String(driver.registrationNumber).toUpperCase() : null]
            .filter(Boolean).join(" ") : "";
        const total = after.fare ?
          Number(after.fare.finalTotal || after.fare.total || 0).toFixed(2) :
          null;
        const msg = {
          accepted: {title: `${fleet}: driver on the way`,
            body: `${who} is coming to pick you up` +
              `${car ? ` in a ${car}` : ""}.`},
          arrived: {title: `${fleet}: your driver is here`,
            body: `${who} is waiting at the pickup${car ? ` (${car})` : ""}.`},
          completed: {title: `${fleet}: trip complete`,
            body: total ? `Please pay £${total} ` +
              `${after.collectBy === "card" ? "by card" : "in cash"} ` +
              "to your driver." :
              "Thanks for travelling with us."},
          cancelled: {title: `${fleet}: booking cancelled`,
            body: after.cancelledBy === "operator" ?
              "Your booking was cancelled. Call us if this is a mistake." :
              "Your booking was cancelled. Please call us to rebook."},
        }[after.status];
        if (!msg) return null;
        await sendPush([uid], Object.assign(msg, {channelId: "trip-updates",
          data: {type: "fleet_booking", rideId: context.params.rideId}}))
            .catch(() => null);
        return null;
      });

  /* Address search for the booking form, through Google Places (New), so
     the dashboard needs no Maps key of its own. UK addresses first. */
  out.fleetPlaceSearch = functions.https.onCall(async (data, context) => {
    await assertFleetManager(context, false);
    const input = text(data && data.input, 120);
    if (input.length < 2) return {results: []};
    const body = {input, includedRegionCodes: ["gb"]};
    const near = point(data && data.near);
    if (near) {
      body.locationBias = {circle: {center: {latitude: near.latitude,
        longitude: near.longitude}, radius: 50000}};
    }
    if (data && typeof data.sessionToken === "string") {
      body.sessionToken = data.sessionToken.slice(0, 64);
    }
    const res = await fetch("https://places.googleapis.com/v1/places:autocomplete",
        {method: "POST", headers: {"Content-Type": "application/json",
          "X-Goog-Api-Key": MAPS_KEY}, body: JSON.stringify(body)});
    const json = await res.json().catch(() => ({}));
    const results = (json.suggestions || [])
        .map((s) => s.placePrediction)
        .filter(Boolean)
        .slice(0, 6)
        .map((p) => ({
          placeId: p.placeId,
          main: p.structuredFormat && p.structuredFormat.mainText ?
            p.structuredFormat.mainText.text : (p.text && p.text.text) || "",
          secondary: p.structuredFormat && p.structuredFormat.secondaryText ?
            p.structuredFormat.secondaryText.text : "",
        }));
    return {results};
  });

  out.fleetPlaceDetails = functions.https.onCall(async (data, context) => {
    await assertFleetManager(context, false);
    const placeId = text(data && data.placeId, 300);
    if (!/^[A-Za-z0-9_-]+$/.test(placeId)) {
      throw new HttpsError("invalid-argument", "Unknown place.");
    }
    const token = data && typeof data.sessionToken === "string" ?
      `?sessionToken=${encodeURIComponent(data.sessionToken.slice(0, 64))}` :
      "";
    const res = await fetch(
        `https://places.googleapis.com/v1/places/${placeId}${token}`,
        {headers: {"X-Goog-Api-Key": MAPS_KEY,
          "X-Goog-FieldMask": "location,formattedAddress,displayName"}});
    const p = await res.json().catch(() => ({}));
    if (!p.location) throw new HttpsError("not-found", "Place not found.");
    const name = p.displayName && p.displayName.text;
    const addr = p.formattedAddress || "";
    return {
      latitude: p.location.latitude,
      longitude: p.location.longitude,
      // "Heathrow Terminal 5, Longford, Hounslow ..." reads better than the
      // street address alone for named places.
      address: name && !addr.startsWith(name) ? `${name}, ${addr}` : addr,
    };
  });

  /* Distance, time and the fare for each vehicle class, for the booking
     form. */
  out.quoteFleetBooking = functions.https.onCall(async (data, context) => {
    await assertFleetManager(context, false);
    const pickup = point(data && data.pickup);
    const dropoff = point(data && data.dropoff);
    const stops = ((data && data.stops) || []).map(point).filter(Boolean)
        .slice(0, 3);
    if (!pickup || !dropoff) {
      throw new HttpsError("invalid-argument",
          "Choose a pickup and a drop-off.");
    }
    const [route, raw] = await Promise.all([
      routeFor(pickup, dropoff, stops), rawConfig()]);
    const fares = {};
    Object.keys(CLASS_MULTIPLIERS).forEach((id) => {
      fares[id] = fareFor(raw, route, id).total;
    });
    return {
      distanceKm: Number(route.distanceKm.toFixed(2)),
      durationMinutes: Math.round(route.durationMinutes),
      currency: (raw.currency || "GBP").toUpperCase(),
      fares,
    };
  });

  /* Books a phone job and sends it to a driver now, or at the booked
     time. */
  out.createFleetBooking = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, false);
    const d = data || {};
    const phone = toE164(d.customer && d.customer.phone);
    const name = text(d.customer && d.customer.name, 80);
    if (!phone) {
      throw new HttpsError("invalid-argument",
          "Enter the customer's phone number.");
    }
    const pickup = point(d.pickup);
    const dropoff = point(d.dropoff);
    const stops = (d.stops || []).map(point).filter(Boolean).slice(0, 3);
    if (!pickup || !dropoff) {
      throw new HttpsError("invalid-argument",
          "Choose a pickup and a drop-off.");
    }
    const rideType = CLASS_MULTIPLIERS[d.rideType] ? d.rideType : "RouteMini";

    // Now, or a booked time at least a few minutes ahead.
    const now = Date.now();
    const pickupAtMs = d.pickupAt ? Number(new Date(d.pickupAt)) : null;
    if (pickupAtMs !== null && !Number.isFinite(pickupAtMs)) {
      throw new HttpsError("invalid-argument",
          "That pickup time is not valid.");
    }
    if (pickupAtMs !== null && pickupAtMs < now - 60 * 1000) {
      throw new HttpsError("invalid-argument",
          "That pickup time has passed.");
    }
    if (pickupAtMs !== null && pickupAtMs > now + 90 * 24 * 3600 * 1000) {
      throw new HttpsError("invalid-argument",
          "Bookings can be made up to 90 days ahead.");
    }
    const leadRaw = Number(d.leadMinutes !== undefined ? d.leadMinutes :
      me.fleet.dispatchLeadMinutes);
    const lead = Number.isFinite(leadRaw) ?
      Math.min(MAX_LEAD_MINUTES, Math.max(0, Math.round(leadRaw))) :
      DEFAULT_LEAD_MINUTES;
    const dispatchAtMs = pickupAtMs === null ? now :
      Math.max(now, pickupAtMs - lead * 60 * 1000);
    const later = dispatchAtMs > now + 30 * 1000;

    // The chosen driver must be in this fleet and able to do the job.
    const driverId = text(d.driverId, 128) || null;
    const mode = driverId ? "driver" : d.dispatchMode === "queue" ?
      "queue" : "all";
    if (mode === "queue" && !(me.fleet.zones || []).length) {
      throw new HttpsError("failed-precondition",
          "Add your zones in Settings before sending jobs by queue.");
    }
    if (driverId) {
      const snap = await db.collection("drivers").doc(driverId).get();
      const drv = snap.exists ? snap.data() : null;
      if (!drv || !canTakeFleetJob(drv,
          {fleetId: me.fleetId, rideType})) {
        throw new HttpsError("failed-precondition",
            "That driver cannot take this job (not in your fleet, not " +
            "approved, documents expired, resting, or the wrong vehicle).");
      }
    }

    const [route, raw, cfg] = await Promise.all([
      routeFor(pickup, dropoff, stops), rawConfig(), loadAppConfig()]);
    let fare = fareFor(raw, route, rideType);
    const agreed = d.agreedPrice !== undefined && d.agreedPrice !== null &&
      d.agreedPrice !== "" ? Number(d.agreedPrice) : null;
    if (agreed !== null) {
      if (!(agreed > 0) || agreed > 10000) {
        throw new HttpsError("invalid-argument",
            "Enter a price above zero, or leave it empty.");
      }
      fare = fareAtAgreedPrice(fare, agreed);
    }

    // The same person may also book in the app: link the booking to their
    // account (notifications only; the booking stays the fleet's, in cash).
    const appRider = await findRiderByPhone(phone).catch(() => null);

    // How the driver takes the money. A label only: TakeARoute never handles
    // it, so paymentMethod stays "cash" and nothing is charged or credited.
    const collectBy = d.collectBy === "card" ? "card" : "cash";
    const notes = text(d.notes, 500);

    const rideRef = db.collection("rides").doc();
    const ts = FieldValue.serverTimestamp();
    await rideRef.set({
      source: "phone",
      fleetId: me.fleetId,
      fleetName: me.fleet.name,
      riderId: null,
      driverId: null,
      customer: {name: name || (appRider ? appRider.name : ""), phone,
        riderId: appRider ? appRider.uid : null},
      // Driver apps up to 1.0.11 only know "CASH JOB", so say it in the notes.
      notes: collectBy === "card" ?
        `CARD PAYMENT: take it on your terminal. ${notes}`.trim() : notes,
      bookedBy: {uid: me.uid, name: me.manager.name || me.manager.email || ""},
      status: later ? "scheduled" : "dispatching",
      rideType,
      pickupLocation: pickup,
      stops,
      stopsCompleted: 0,
      dropoffLocation: dropoff,
      route: {
        distanceKm: Number(route.distanceKm.toFixed(2)),
        distanceMiles: fare.distanceInMiles,
        durationMinutes: Number(route.durationMinutes.toFixed(2)),
        status: "calculated",
      },
      fare,
      fareEstimate: fare.total,
      bidding: false,
      offeredFare: null,
      femaleDriverOnly: false,
      cityId: null,
      cityName: null,
      currency: fare.currency,
      blockedDriverIds: [],
      declinedBy: [],
      waitingPolicy: Object.assign({}, cfg.waiting),
      // Phone jobs are cash, so no cancellation fee is ever charged.
      cancellationPolicy: {fee: 0, freeMinutes: 0, arrivedFee: 0,
        noShowWaitMinutes: cfg.cancellation.noShowWaitMinutes,
        driverSharePercent: 0},
      paymentMethod: "cash",
      collectBy,
      payment: {method: "cash", status: "pending", transactionId: null},
      pickupAt: pickupAtMs === null ? null : Timestamp.fromMillis(pickupAtMs),
      dispatchAt: Timestamp.fromMillis(dispatchAtMs),
      dispatch: {
        mode,
        driverId,
        leadMinutes: lead,
        offeredAt: later ? null : ts,
        rounds: later ? 0 : 1,
      },
      timestamps: {createdAt: ts, acceptedAt: null, startedAt: null,
        completedAt: null},
      cancellation: {by: null, reason: null, at: null},
      rating: {riderToDriver: null, driverToRider: null, feedback: null},
    });

    if (appRider) {
      await db.collection("fleets").doc(me.fleetId).collection("customers")
          .doc(phone).set({appUser: true, riderId: appRider.uid},
              {merge: true}).catch(() => null);
    }
    await rememberCustomer(me.fleetId, {name, phone},
        [pickup].concat(stops, [dropoff]),
        {from: pickup, to: dropoff, rideType}).catch((error) => {
      console.error("Could not save customer:", error.message);
    });
    return {rideId: rideRef.id, status: later ? "scheduled" : "dispatching",
      fare: fare.total};
  });

  /* Sends a phone job again: to another driver, to the whole fleet, or
     straight away instead of at its booked time. */
  out.redispatchFleetBooking = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, false);
    const rideId = text(data && data.rideId, 128);
    const driverId = text(data && data.driverId, 128) || null;
    const mode = driverId ? "driver" : data && data.mode === "queue" ?
      "queue" : "all";
    if (mode === "queue" && !(me.fleet.zones || []).length) {
      throw new HttpsError("failed-precondition",
          "Add your zones in Settings before sending jobs by queue.");
    }
    const rideRef = db.collection("rides").doc(rideId);
    if (driverId) {
      const [snap, rideSnap] = await Promise.all([
        db.collection("drivers").doc(driverId).get(), rideRef.get()]);
      const drv = snap.exists ? snap.data() : null;
      const ride = rideSnap.exists ? rideSnap.data() : null;
      if (!drv || !ride || !canTakeFleetJob(drv, ride)) {
        throw new HttpsError("failed-precondition",
            "That driver cannot take this job right now.");
      }
    }
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(rideRef);
      const ride = snap.exists ? snap.data() : null;
      if (!ride || ride.fleetId !== me.fleetId || ride.source !== "phone") {
        throw new HttpsError("not-found", "Not one of your bookings.");
      }
      if (!["dispatching", "scheduled"].includes(ride.status)) {
        throw new HttpsError("failed-precondition",
            "A driver already has this job, or it has ended.");
      }
      tx.update(rideRef, {
        "status": "dispatching",
        "dispatchAt": Timestamp.now(),
        "dispatch.mode": mode,
        "dispatch.driverId": driverId,
        "dispatch.offeredAt": FieldValue.serverTimestamp(),
        "dispatch.rounds": FieldValue.increment(1),
        "dispatch.returnedBy": FieldValue.delete(),
        "dispatch.queueDone": false,
        "dispatch.missed": [],
        // Sending to the whole fleet or the queue again: anyone who said no
        // before is asked again, since the operator chose to resend.
        "declinedBy": driverId ?
          (ride.declinedBy || []).filter((id) => id !== driverId) : [],
      });
    });
    return {ok: true};
  });

  out.cancelFleetBooking = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, false);
    const rideId = text(data && data.rideId, 128);
    const reason = text(data && data.reason, 200) || "cancelled_by_operator";
    const rideRef = db.collection("rides").doc(rideId);
    let driverId = null;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(rideRef);
      const ride = snap.exists ? snap.data() : null;
      if (!ride || ride.fleetId !== me.fleetId || ride.source !== "phone") {
        throw new HttpsError("not-found", "Not one of your bookings.");
      }
      if (["completed", "cancelled", "ongoing"].includes(ride.status)) {
        throw new HttpsError("failed-precondition", ride.status === "ongoing" ?
          "The trip has started. The driver can end it in the app." :
          "This booking has already ended.");
      }
      driverId = ride.driverId || null;
      tx.update(rideRef, {
        status: "cancelled",
        cancelledBy: "operator",
        cancelReason: reason,
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledByUid: me.uid,
      });
    });
    if (driverId) {
      await sendPush([driverId], {
        title: "Job cancelled",
        body: `${me.fleet.name} cancelled this booking. ` +
          "You are free for the next one.",
        channelId: "trip-updates",
        data: {type: "trip", rideId},
      }).catch(() => null);
    }
    return {ok: true};
  });

  /* The owner saves the fleet's zones (circles) and how long a queued
     driver has to answer. */
  out.saveFleetZones = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, true);
    const raw = Array.isArray(data && data.zones) ? data.zones : [];
    if (raw.length > MAX_ZONES) {
      throw new HttpsError("invalid-argument",
          `A fleet can have up to ${MAX_ZONES} zones.`);
    }
    const used = new Set();
    const zones = raw.map((z, i) => {
      const name = text(z && z.name, 40);
      const center = point(z && z.center);
      const radiusKm = Number(z && z.radiusKm);
      if (!name || !center) {
        throw new HttpsError("invalid-argument",
            `Zone ${i + 1} needs a name and a centre.`);
      }
      if (!(radiusKm >= 0.2 && radiusKm <= 30)) {
        throw new HttpsError("invalid-argument",
            `${name}: the radius must be between 0.2 and 30 km.`);
      }
      let id = text(z.id, 20).replace(/[^A-Za-z0-9]/g, "");
      while (!id || used.has(id)) {
        id = Math.random().toString(36).slice(2, 10);
      }
      used.add(id);
      return {id, name, center, radiusKm: Math.round(radiusKm * 10) / 10};
    });
    const secondsRaw = Number(data && data.queueOfferSeconds);
    const queueOfferSeconds = Number.isFinite(secondsRaw) ?
      Math.min(180, Math.max(20, Math.round(secondsRaw))) :
      me.fleet.queueOfferSeconds || DEFAULT_QUEUE_OFFER_SECONDS;
    await db.collection("fleets").doc(me.fleetId).update({
      zones, zoneCount: zones.length, queueOfferSeconds,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await refreshQueue(me.fleetId, zones).catch(() => null);
    return {zones, queueOfferSeconds};
  });

  /* The office calls a customer or one of its drivers. Twilio rings the
     operator's own phone first, then connects them; both see the
     TakeARoute number, so the operator's number stays private. */
  out.fleetCall = functions
      .runWith({secrets: TWILIO_SECRETS})
      .https.onCall(async (data, context) => {
        const me = await assertFleetManager(context, false);
        const d = data || {};

        const typed = d.myPhone ? toE164(d.myPhone) : null;
        if (d.myPhone && !typed) {
          throw new HttpsError("invalid-argument",
              "Your phone number does not look right.");
        }
        const mine = typed || toE164(me.manager.phone);
        if (!mine) {
          throw new HttpsError("failed-precondition",
              "Add the phone you take calls on first.");
        }
        if (typed && typed !== me.manager.phone) {
          await db.collection("fleetManagers").doc(me.uid)
              .update({phone: typed}).catch(() => null);
        }

        let other = null;
        let label = "";
        let who = null;
        if (d.to === "driver") {
          const driverId = text(d.driverId, 128);
          const snap = driverId ?
            await db.collection("drivers").doc(driverId).get() : null;
          const drv = snap && snap.exists ? snap.data() : null;
          if (!drv || drv.fleetId !== me.fleetId) {
            throw new HttpsError("not-found", "Not one of your drivers.");
          }
          other = await phoneFor("drivers", driverId);
          label = [drv.firstName, drv.lastName].filter(Boolean).join(" ") ||
            drv.name || "your driver";
          who = {driverId};
        } else {
          other = toE164(d.phone);
          if (!other) {
            throw new HttpsError("invalid-argument",
                "Enter the customer's phone number.");
          }
          // Only people the fleet knows: a contact card is made as soon as
          // a number is typed on the booking form.
          const card = await db.collection("fleets").doc(me.fleetId)
              .collection("customers").doc(other).get();
          if (!card.exists) {
            throw new HttpsError("not-found",
                "That number is not one of your customers.");
          }
          label = card.data().name || "your customer";
          who = {customer: other};
        }
        if (!other) {
          throw new HttpsError("failed-precondition",
              "There is no phone number on file for them.");
        }
        if (other === mine) {
          throw new HttpsError("invalid-argument",
              "That is your own number.");
        }

        const twilio = twilioConfig();

        // A daily cap per fleet.
        const day = new Date().toISOString().slice(0, 10);
        const countRef = db.collection("fleets").doc(me.fleetId)
            .collection("callDays").doc(day);
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(countRef);
          const count = snap.exists ? snap.data().count || 0 : 0;
          if (count >= MAX_FLEET_CALLS_PER_DAY) {
            throw new HttpsError("resource-exhausted",
                "Your fleet has reached today's call limit.");
          }
          tx.set(countRef, {count: count + 1}, {merge: true});
        });

        const result = await bridgeCall(twilio, mine, other,
            `Connecting you to ${label}.`);
        await db.collection("fleets").doc(me.fleetId).collection("calls")
            .add(Object.assign({
              callSid: result.sid || null,
              by: me.uid,
              rideId: text(d.rideId, 128) || null,
              createdAt: FieldValue.serverTimestamp(),
            }, who)).catch(() => null);
        return {connecting: true, to: label};
      });

  /* Rings the right drivers whenever a phone job starts dispatching, is
     sent again, or a driver gives it back. */
  out.dispatchFleetJob = functions.firestore
      .document("rides/{rideId}")
      .onWrite(async (change, context) => {
        if (!change.after.exists) return null;
        const after = change.after.data();
        if (after.source !== "phone") return null;
        const before = change.before.exists ? change.before.data() : null;
        const rideId = context.params.rideId;

        // A driver gave the job back (the app sets status dispatching and
        // driverId null). Do not ring the fleet by itself: the operator
        // decides, so mark it for their attention.
        if (before && ["accepted", "arrived"].includes(before.status) &&
            after.status === "dispatching" && !after.driverId &&
            before.driverId) {
          await change.after.ref.update({
            "dispatch.driverId": null,
            "dispatch.returnedBy": before.driverId,
            "dispatch.returnedAt": FieldValue.serverTimestamp(),
            "dispatch.offeredAt": null,
          });
          return null;
        }
        if (after.status !== "dispatching") return null;

        // By queue: pick the first driver in the pickup zone, and the next
        // one each time the current one says no (or runFleetQueues marks
        // them as not answering). offerNextInQueue writes the choice, which
        // brings us back here to ring them.
        const dispatch = after.dispatch || {};
        if (dispatch.mode === "queue" && !dispatch.returnedBy) {
          const current = dispatch.driverId || null;
          const turnedDown = current &&
            (after.declinedBy || []).includes(current);
          if ((!current && !dispatch.queueDone) || turnedDown) {
            await offerNextInQueue(change.after.ref, after);
            return null;
          }
        }

        const offeredNow = !before || before.status !== "dispatching" ||
          toMillis(before.dispatch && before.dispatch.offeredAt) !==
            toMillis(after.dispatch && after.dispatch.offeredAt) ||
          (before.dispatch && before.dispatch.driverId) !==
            (after.dispatch && after.dispatch.driverId);
        if (!offeredNow || !after.dispatch || !after.dispatch.offeredAt) {
          return null;
        }
        await offerFleetJob(rideId, after);
        return null;
      });

  /* Every minute: pre-booked jobs whose time has come are sent out. */
  out.dispatchScheduledRides = functions.pubsub
      .schedule("every 1 minutes")
      .onRun(async () => {
        const due = await db.collection("rides")
            .where("status", "==", "scheduled")
            .where("dispatchAt", "<=", Timestamp.now())
            .limit(100)
            .get();
        for (const doc of due.docs) {
          await db.runTransaction(async (tx) => {
            const snap = await tx.get(doc.ref);
            if (!snap.exists || snap.data().status !== "scheduled") return;
            tx.update(doc.ref, {
              "status": "dispatching",
              "dispatch.offeredAt": FieldValue.serverTimestamp(),
              "dispatch.rounds": FieldValue.increment(1),
            });
          }).catch((error) => {
            console.error("Could not send booking:", doc.id, error.message);
          });
        }
        if (due.size) console.log(`Sent ${due.size} booked job(s)`);
        return null;
      });

  /* Every minute: zone queues follow where free drivers are, and a queued
     job whose driver has not answered moves to the next in line. */
  out.runFleetQueues = functions.pubsub
      .schedule("every 1 minutes")
      .onRun(async () => {
        const fleets = await db.collection("fleets")
            .where("zoneCount", ">", 0).get();
        const offerMs = {};
        for (const f of fleets.docs) {
          const fleet = f.data();
          offerMs[f.id] = 1000 * (fleet.queueOfferSeconds ||
            DEFAULT_QUEUE_OFFER_SECONDS);
          if (fleet.status === "suspended") continue;
          await refreshQueue(f.id, fleet.zones || []).catch((error) => {
            console.error("Queue refresh failed:", f.id, error.message);
          });
        }

        // Equality filters only, so no composite index is needed.
        const queued = await db.collection("rides")
            .where("status", "==", "dispatching")
            .where("dispatch.mode", "==", "queue")
            .limit(200).get();
        let moved = 0;
        for (const doc of queued.docs) {
          const ride = doc.data();
          const current = ride.dispatch && ride.dispatch.driverId;
          const offered = toMillis(ride.dispatch && ride.dispatch.offeredAt);
          const limit = offerMs[ride.fleetId] ||
            DEFAULT_QUEUE_OFFER_SECONDS * 1000;
          if (!current || !offered || Date.now() - offered < limit ||
              (ride.declinedBy || []).includes(current)) {
            continue;
          }
          // No answer counts as a no: dispatchFleetJob rings the next.
          await db.runTransaction(async (tx) => {
            const snap = await tx.get(doc.ref);
            const now = snap.exists ? snap.data() : null;
            if (!now || now.status !== "dispatching" ||
                (now.dispatch && now.dispatch.driverId) !== current) {
              return;
            }
            tx.update(doc.ref, {
              "declinedBy": FieldValue.arrayUnion(current),
              "dispatch.missed": FieldValue.arrayUnion(current),
            });
          }).then(() => moved++).catch((error) => {
            console.error("Queue timeout failed:", doc.id, error.message);
          });
        }
        if (moved) console.log(`Queue: ${moved} unanswered offer(s) moved on`);
        return null;
      });

  /* A fleet driver accepted an ordinary app job: tag it with the fleet, so
     the earnings go to the fleet's wallet and it shows on their
     statement. */
  out.tagFleetRides = functions.firestore
      .document("rides/{rideId}")
      .onUpdate(async (change) => {
        const before = change.before.data();
        const after = change.after.data();
        if (after.source === "phone" || !after.driverId ||
            before.driverId === after.driverId ||
            after.status !== "accepted") {
          return null;
        }
        const snap = await db.collection("drivers").doc(after.driverId).get();
        // Only company drivers' app trips are the fleet's (their fares go
        // to its wallet); a self-employed driver's stay their own.
        const fleetId = snap.exists && fleetTypeOf(snap.data()) === "company" ?
          snap.data().fleetId || null : null;
        if ((after.fleetId || null) === fleetId) return null;
        await change.after.ref.update({
          fleetId,
          fleetName: fleetId ? snap.data().fleetName || null : null,
        });
        return null;
      });

  /* Daily: each fleet's monthly membership, for every company driver in the
     fleet on its billing date (self-employed drivers pay their own), taken
     from the fleet's wallet. The wallet may go below zero; the admin
     settles that with the fleet. */
  out.billFleets = functions.pubsub
      .schedule("every day 06:30").timeZone("Europe/London")
      .onRun(async () => {
        const cfg = await loadAppConfig();
        const due = await db.collection("fleets")
            .where("nextBillingDate", "<=", Timestamp.now()).get();
        for (const doc of due.docs) {
          const fleet = doc.data();
          if (fleet.status === "suspended") continue;
          const price = fleet.perDriverMonthly !== null &&
            fleet.perDriverMonthly !== undefined &&
            Number(fleet.perDriverMonthly) >= 0 ?
            Number(fleet.perDriverMonthly) : cfg.subscription.monthlyPrice;
          const members = await db.collection("drivers")
              .where("fleetId", "==", doc.id).get();
          const drivers = {docs: members.docs.filter((d) =>
            fleetTypeOf(d.data()) === "company")};
          const count = drivers.docs.length;
          const amount = Math.round(count * price * 100) / 100;
          const walletRef = db.collection("fleetWallets").doc(doc.id);
          await db.runTransaction(async (tx) => {
            const fresh = await tx.get(doc.ref);
            const next = toMillis(fresh.data().nextBillingDate);
            if (!next || next > Date.now()) return;
            tx.update(doc.ref, {nextBillingDate: Timestamp.fromDate(
                addOneMonth(new Date(next)))});
            if (!(amount > 0)) return;
            tx.set(walletRef, {
              availableBalance: FieldValue.increment(-amount),
              totalCharged: FieldValue.increment(amount),
              updatedAt: FieldValue.serverTimestamp(),
            }, {merge: true});
            tx.set(walletRef.collection("transactions").doc(), {
              type: "membership", amount: -amount, drivers: count,
              pricePerDriver: price,
              driverIds: drivers.docs.map((d) => d.id),
              description: `Membership: ${count} driver(s) x ${price}`,
              createdAt: FieldValue.serverTimestamp(),
            });
          });
          console.log(`Fleet ${doc.id} billed ${amount} for ${count}`);
        }
        return null;
      });

  return out;
};
