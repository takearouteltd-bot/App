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
                  not their own. The fleet can let them go. Members from
                  before the two kinds existed are "company".
       "self"     self-employed, own car. Takes the fleet's jobs but keeps
                  their own wallet. The fleet can suspend them but not
                  remove them; they leave themselves (leaveFleet) or an
                  admin takes them out.
     Who pays the membership goes by the fleet's plan, not the kind of
     driver (fleetCovers): on a flat monthly plan the fleet pays for all its
     drivers; on a per-driver plan each driver pays their own.
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
     fleets/{fleetId}/accounts/{id}   account clients: company, address,
                                      telephone, email (kept by staff)
     fleets/{fleetId}/driverAccounts/{driverId}  commissionPercent, owedPence
     fleets/{fleetId}/driverPayments/{id}  money recorded between fleet, driver
     fleets/{fleetId}/invoices/{id}   invoices the fleet sends its clients

   Account jobs and driver balances: a phone job can be charged to an account
   client (collectBy "account"). The fleet bills the client and pays the driver
   itself; TakeARoute only keeps the record. When a fleet job finishes,
   settleFleetJob locks the driver's commission rate onto rides/{id}.settlement
   and moves the driver's balance (owedPence, what the fleet owes them; below
   zero, they owe the fleet):
     account job, app card fare, cancellation fee share
                    + amount less commission (the fleet holds the money)
     cash or their own card terminal
                    - commission (the driver already holds the money)
   Fleet jobs are phone jobs, and company drivers' app trips (tagFleetRides).
   A self-employed driver's app trips are their own and stay out.

   Zone queues: the owner draws zones (circles) in Settings. Free drivers
   inside a zone queue there in the order they arrived or became free
   (runFleetQueues keeps fleetQueues/{fleetId} up to date every minute). A
   job sent "by queue" rings the first driver in its pickup zone; a no, or no
   answer within queueOfferSeconds, sends that driver to the back and rings
   the next. When nobody in the zone is left it goes to the whole fleet.
   dispatch.nearest uses the same steps without zones: it rings the closest
   free driver, then the next closest, then the whole fleet.
====================================== */

/* The app's Google Maps key (App/config/maps.js). It ships inside the app,
   so it is not a secret; Google restricts it to the Routes, Places and
   Geocoding services. */
const MAPS_KEY = "AIzaSyD2FkUIMuw3hkXi827QxnI8W1w2XX_KGd8";
// Tests point these at a fake.
const PLACES_API = process.env.PLACES_API_BASE ||
  "https://places.googleapis.com";
const ROUTES_API = process.env.ROUTES_API_BASE ||
  "https://routes.googleapis.com";

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
// An unanswered whole-fleet offer rings again every 2 minutes, 3 times.
const RE_RING_MS = 2 * 60 * 1000;
const MAX_RE_RINGS = 3;
// A job nobody has taken after this long is flagged to the office.
const JOB_UNANSWERED_MS = 15 * 60 * 1000;
/* A driver whose phone has not reported a position for this long is left
   out of the queues (app closed, no signal). */
const QUEUE_STALE_MS = 5 * 60 * 1000;
/* Most calls one fleet's office can place in a day, so a mistake or a
   misused login cannot run up the Twilio bill. */
const MAX_FLEET_CALLS_PER_DAY = 300;
const EMAIL_SECRETS = ["RESEND_API_KEY"];
const MAX_INVOICE_LINES = 200;

module.exports = (deps) => {
  const {functions, admin, db, sendPush, loadAppConfig, distanceKm, canServe,
    hasExpiredDocument, toE164, toMillis, addOneMonth,
    TWILIO_SECRETS, twilioConfig, bridgeCall, phoneFor, STRIPE_SECRETS,
    fleetBilling, privacy, membershipSuspended, positionStale} = deps;
  const paymentAlerts = require("./paymentAlerts")({functions, db});
  const {HttpsError} = functions.https;
  // From the modular entry point: the functions emulator's stand-in for
  // admin.firestore does not carry FieldValue or Timestamp.
  const {FieldValue, Timestamp} = require("firebase-admin/firestore");
  const {invoiceEmail, balanceEmail} = require("./fleetInvoiceEmail");
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
        `${ROUTES_API}/directions/v2:computeRoutes`, {
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
   * The fare a passenger app booking should cost, worked out here from
   * Google's route and the current settings (checkNewRide in index.js
   * compares it with what the app wrote). When Google cannot be reached the
   * straight-line distance is used, which can only under-price, so it never
   * refuses an honest booking.
   * @param {Object} ride Ride data.
   * @return {Promise<Object>} {fare, raw, distanceKm, durationMinutes,
   *     source}
   */
  async function priceAppRide(ride) {
    const stops = Array.isArray(ride.stops) ? ride.stops : [];
    const raw = await rawConfig();
    let route;
    let source = "routes";
    try {
      route = await routeFor(ride.pickupLocation, ride.dropoffLocation, stops);
    } catch (error) {
      const points = [ride.pickupLocation].concat(stops, ride.dropoffLocation);
      let km = 0;
      for (let i = 1; i < points.length; i++) {
        const leg = distanceKm(points[i - 1], points[i]);
        km += Number.isFinite(leg) ? leg : 0;
      }
      route = {distanceKm: km, durationMinutes: 0};
      source = "straight_line";
    }
    return {fare: fareFor(raw, route, ride.rideType), raw,
      distanceKm: route.distanceKm, durationMinutes: route.durationMinutes,
      source};
  }
  if (deps.shared) {
    deps.shared.priceAppRide = priceAppRide;
    deps.shared.CLASS_MULTIPLIERS = CLASS_MULTIPLIERS;
  }

  /**
   * Whether the driver is paid in cash on this job (not an account job,
   * a card on the terminal or paid online).
   * @param {Object} ride Ride data.
   * @return {boolean} Cash in hand.
   */
  function cashInHand(ride) {
    return !["account", "card", "online"].includes(ride.collectBy);
  }

  /**
   * Whether automatic dispatch (nearest, all drivers, zone queue) may offer
   * this job to the driver: a driver who switched cash jobs off in the app
   * isn't offered them. The office can still pick them by name.
   * @param {Object} d Driver data.
   * @param {Object} ride Ride data.
   * @return {boolean} Offer it.
   */
  function wantsJob(d, ride) {
    return !(d.cashJobs === false && cashInHand(ride));
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
   * Approved, not blocked, documents in date, membership not suspended, not
   * on a forced rest and not serving a time penalty for cancelling.
   * @param {Object} d Driver data.
   * @return {boolean} May take jobs at all.
   */
  function canWork(d) {
    return d.approved === true && d.blocked !== true &&
      !hasExpiredDocument(d) && d.restDue !== true &&
      !membershipSuspended(d) &&
      (toMillis(d.cancelBlockedUntil) || 0) <= Date.now();
  }

  /**
   * How a phone job should be sent, from the dashboard's choice.
   * @param {*} raw "queue", "nearest" or anything else for the whole fleet.
   * @param {?string} driverId A driver chosen by name, if any.
   * @param {Object} fleet Fleet data.
   * @return {{mode: string, nearest: boolean}} dispatch.mode and whether the
   *   queue steps through the closest drivers rather than a zone's line.
   */
  function dispatchChoice(raw, driverId, fleet) {
    if (driverId) return {mode: "driver", nearest: false};
    if (raw === "nearest") return {mode: "queue", nearest: true};
    if (raw !== "queue") return {mode: "all", nearest: false};
    if (!(fleet.zones || []).length) {
      throw new HttpsError("failed-precondition",
          "Add your zones in Settings before sending jobs by queue.");
    }
    return {mode: "queue", nearest: false};
  }

  /**
   * The closest free driver of the fleet who has not yet turned this job
   * down, within the search radius.
   * @param {Object} ride Ride data.
   * @return {Promise<?Object>} {driverId}, or null when nobody is left.
   */
  async function nearestFreeDriver(ride) {
    const cfg = await loadAppConfig();
    const skip = new Set(ride.declinedBy || []);
    const drivers = await db.collection("drivers")
        .where("fleetId", "==", ride.fleetId).get();
    let best = null;
    drivers.forEach((snap) => {
      const d = snap.data();
      if (skip.has(snap.id) || d.status !== "online" || positionStale(d) ||
          d.isOnRide === true || !canTakeFleetJob(d, ride) ||
          !wantsJob(d, ride)) {
        return;
      }
      const km = distanceKm(d.location, ride.pickupLocation);
      if (km <= cfg.dispatch.searchRadiusKm && (!best || km < best.km)) {
        best = {driverId: snap.id, km};
      }
    });
    return best;
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
        if (skip.has(snap.id) || d.status !== "online" || positionStale(d) ||
            d.isOnRide === true || !canTakeFleetJob(d, ride) ||
            !wantsJob(d, ride)) {
          return;
        }
        const km = distanceKm(d.location, ride.pickupLocation);
        if (km <= cfg.dispatch.searchRadiusKm) ids.push(snap.id);
      });
    }
    await sendPush(ids, {
      title: target ? `Job from ${ride.fleetName || "your fleet"}` :
        "New fleet job",
      body: `${ride.collectBy === "account" ?
        `Account job, ${(ride.account || {}).company || "client"}` :
        ride.collectBy === "card" ? "Card job" : "Cash job"}. ` +
        `Pickup at ${pickup}. Open TakeARoute to accept.`,
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
        noCash: d.cashJobs === false,
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
    const nearest = ride.dispatch && ride.dispatch.nearest === true;
    if (current && !nearest) {
      await sendToBack(ride.fleetId, current).catch((error) => {
        console.error("Queue: could not move driver back:", error.message);
      });
    }
    const fleetSnap = await db.collection("fleets").doc(ride.fleetId).get();
    const zones = fleetSnap.exists ? fleetSnap.data().zones || [] : [];
    const tried = nearest ? [] : zonesAt(zones, ride.pickupLocation);
    let zone = tried[0] || null;
    let next = nearest ? await nearestFreeDriver(ride) : null;
    if (tried.length) {
      const queues = await refreshQueue(ride.fleetId, zones);
      const skip = new Set(ride.declinedBy || []);
      for (const z of tried) {
        next = (queues[z.id] || []).find((e) => !skip.has(e.driverId) &&
          canServe(e.vehicleType, ride.rideType) &&
          !(e.noCash === true && cashInHand(ride))) || null;
        if (next) {
          zone = z;
          break;
        }
      }
    }
    // Nobody anywhere: name every zone tried, for the office.
    const zoneName = next && zone ? zone.name :
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
      `offered to ${next.driverId}${zone ? ` in ${zone.name}` : " (nearest)"}` :
      `${zoneName ? zoneName + " empty" : "nobody in reach"}, sent to fleet`));
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
    // How the fleet is billed: per company driver, or one flat amount.
    const billingPlan = data && data.billingPlan === "monthly" ?
      "monthly" : "per_driver";
    const monthlyFee = billingPlan === "monthly" ?
      Number(data && data.monthlyFee) : null;
    if (billingPlan === "monthly" && !(monthlyFee >= 0)) {
      throw new HttpsError("invalid-argument",
          "Enter the fleet's monthly price.");
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
      billingPlan,
      monthlyFee: monthlyFee === null ? null :
        Math.round(monthlyFee * 100) / 100,
      billing: {status: "ok"},
      currency: cfg.currency,
      dispatchLeadMinutes: DEFAULT_LEAD_MINUTES,
      // A flat monthly plan is paid at the start of each month (first bill
      // now, taken when the owner adds a card or at the next daily run).
      nextBillingDate: billingPlan === "monthly" ? Timestamp.now() :
        Timestamp.fromDate(addOneMonth(new Date())),
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
      // Paying out more than it holds would push the wallet below zero,
      // and the daily billing would then charge that to the fleet's card.
      const balance = Number(snap.data().availableBalance) || 0;
      if (amount > balance + 0.001) {
        throw new HttpsError("failed-precondition",
            `The fleet's wallet only has ${balance.toFixed(2)}.`);
      }
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
    }, fleetCovers(type, fleet) ?
      fleetPaysFields(driver, fleetId, fleet.name) : {}));
  }

  /**
   * Whether the fleet pays this driver's membership. A fleet on a flat
   * monthly plan pays one price for all its drivers, company and
   * self-employed. On a per-driver plan every driver pays their own
   * TakeARoute membership (wallet, then saved card) and the fleet pays
   * nothing (Sarfaraz, 2026-11-08).
   * @param {string} type "company" or "self" (no longer decides it).
   * @param {?Object} fleet Fleet data.
   * @return {boolean} True when the fleet pays.
   */
  function fleetCovers(type, fleet) {
    return Boolean(fleet && fleet.billingPlan === "monthly");
  }

  /**
   * A company driver removed from a fleet stays tied to it (see
   * takeOutOfFleet): no other fleet with this account.
   * @param {Object} driver Driver data.
   */
  function refuseIfRemoved(driver) {
    if (driver && driver.blockedKind === "fleet_removed" && driver.blocked) {
      throw new HttpsError("failed-precondition",
          `${driver.removedFromFleetName || "Your fleet"} removed you and ` +
          "only they can reinstate this account. To drive with your own " +
          "car for another fleet, delete this account and register again.");
    }
  }

  /**
   * The fields that record a fleet approving a driver's application. The
   * fleet has checked the documents and is answerable for it under its
   * contract with TakeARoute; TakeARoute can still overturn it.
   * @param {Object} driver Driver data.
   * @param {Object} me assertFleetManager result.
   * @return {Object} Fields to write, or {} when already approved.
   */
  function fleetApprovalFields(driver, me) {
    if (driver.approved === true) return {};
    if (!driver.onboardingComplete) {
      throw new HttpsError("failed-precondition",
          "This driver has not finished signing up yet.");
    }
    if (driver.onboardingStatus === "rejected") {
      throw new HttpsError("failed-precondition",
          "TakeARoute turned this application down. Please contact " +
          "TakeARoute.");
    }
    if (hasExpiredDocument(driver)) {
      throw new HttpsError("failed-precondition",
          "One of this driver's documents has expired. They need to " +
          "upload a new one first.");
    }
    return {
      approved: true,
      onboardingStatus: "approved",
      rejectionReason: null,
      decidedAt: new Date().toISOString(),
      approvedByFleet: {
        fleetId: me.fleetId,
        fleetName: me.fleet.name || "",
        by: me.manager.name || me.manager.email || "Staff",
        byUid: me.uid,
        at: new Date().toISOString(),
      },
    };
  }

  /**
   * What the driver is told on joining.
   * @param {string} type "company" or "self".
   * @param {Object} fleet Fleet data (its plan decides who pays).
   * @return {string} Message.
   */
  function joinedText(type, fleet) {
    const membership = fleetCovers(type, fleet) ?
      "Your fleet pays your membership." : "You pay your own membership.";
    return (type === "company" ?
      "As a company driver, your fleet receives your card earnings. " :
      "You can now take their jobs. As a self-employed driver, card fares " +
        "still go to your wallet. ") + membership;
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
    refuseIfRemoved(driver);
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
      const secretSnap = await tx.get(privacy.privateRef(context.auth.uid));
      const contact = secretSnap.exists ? secretSnap.data() : {};
      const phone = toE164(contact.phoneNumber || contact.phone ||
        driver.phoneNumber || driver.phone);
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
      refuseIfRemoved(driver);
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
    let newlyApproved = false;
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
      refuseIfRemoved(driver);
      const approval = fleetApprovalFields(driver, me);
      joinInTx(tx, driverRef, driver, me.fleetId, me.fleet, type);
      if (approval.approved) {
        tx.update(driverRef, approval);
        newlyApproved = true;
      }
    });
    await sendPush([driverId], {
      title: !approve ? "Fleet request declined" : newlyApproved ?
        `${me.fleet.name} approved you` : `You joined ${me.fleet.name}`,
      body: !approve ? `${me.fleet.name} did not accept your request.` :
        (newlyApproved ? "You can now go online. " : "") +
          joinedText(type, me.fleet),
      channelId: "general",
    }).catch(() => null);
    return {ok: true, approved: newlyApproved};
  });

  /* The fleet approves the application of a driver already in it (one who
     accepted the fleet's invitation before TakeARoute or the fleet had
     checked their documents). */
  out.approveFleetDriver = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, false);
    const driverId = text(data && data.driverId, 128);
    const driverRef = db.collection("drivers").doc(driverId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(driverRef);
      const driver = snap.exists ? snap.data() : null;
      if (!driver || driver.fleetId !== me.fleetId) {
        throw new HttpsError("not-found", "Not one of your drivers.");
      }
      if (driver.approved === true) {
        throw new HttpsError("already-exists", "Already approved.");
      }
      tx.update(driverRef, fleetApprovalFields(driver, me));
    });
    await sendPush([driverId], {
      title: `${me.fleet.name} approved you`,
      body: "You can now go online and take jobs.",
      channelId: "general",
    }).catch(() => null);
    return {ok: true};
  });

  /* The fleet takes back a company driver it removed: they rejoin as a
     company driver and the suspension ends. */
  out.reinstateFleetDriver = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, false);
    const driverId = text(data && data.driverId, 128);
    const driverRef = db.collection("drivers").doc(driverId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(driverRef);
      const driver = snap.exists ? snap.data() : null;
      if (!driver || driver.blockedKind !== "fleet_removed" ||
          driver.removedFromFleetId !== me.fleetId || !driver.blocked) {
        throw new HttpsError("not-found",
            "This driver is not waiting to be reinstated by you.");
      }
      if (driver.fleetId) {
        throw new HttpsError("failed-precondition",
            "This driver is in a fleet already.");
      }
      joinInTx(tx, driverRef, driver, me.fleetId, me.fleet, "company");
      tx.update(driverRef, {
        blocked: false, blockedReason: "", blockedByFleet: null,
        blockedKind: FieldValue.delete(),
        removedFromFleetId: FieldValue.delete(),
        removedFromFleetName: FieldValue.delete(),
        unblockedAt: new Date().toISOString(),
        unblockedBy: `${me.manager.name || me.manager.email || "Staff"}, ` +
          `${me.fleet.name} (reinstated)`,
      });
    });
    await sendPush([driverId], {
      title: `${me.fleet.name} reinstated you`,
      body: "Your driver account is active again. " +
        joinedText("company", me.fleet),
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

  /* The fleet takes back an invitation nobody has answered yet. */
  out.withdrawFleetInvite = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, false);
    const phone = toE164(data && data.phone);
    const ref = phone ? db.collection("fleetInvites").doc(phone) : null;
    const snap = ref ? await ref.get() : null;
    if (!snap || !snap.exists || snap.data().fleetId !== me.fleetId) {
      throw new HttpsError("not-found", "No invitation from you to that " +
        "number.");
    }
    await ref.delete();
    const matches = await findDriversByPhone(phone);
    await Promise.all(matches
        .filter((d) => (d.data().fleetInvite || {}).fleetId === me.fleetId)
        .map((d) => d.ref.update({fleetInvite: FieldValue.delete()})));
    return {ok: true};
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
      // Numbers now live on the private record.
      const held = await db.collection("driverPrivate")
          .where(field, "in", forms).get();
      for (const d of held.docs) {
        const driver = await db.collection("drivers").doc(d.id).get();
        if (driver.exists) seen.set(driver.id, driver);
      }
    }
    return [...seen.values()];
  }

  /* A new driver account picks up an invitation waiting for its number. */
  const applyInviteForNumber = async (change, driverId) => {
    if (!change.after.exists) return null;
    const after = change.after.data();
    const before = change.before.exists ? change.before.data() : {};
    const phone = toE164(after.phoneNumber || after.phone);
    const beforePhone = toE164(before.phoneNumber || before.phone);
    if (!phone || phone === beforePhone) return null;
    const driverRef = db.collection("drivers").doc(driverId);
    const driverSnap = await driverRef.get();
    if (!driverSnap.exists || driverSnap.data().fleetId ||
        driverSnap.data().fleetInvite) {
      return null;
    }
    const invite = await db.collection("fleetInvites").doc(phone).get();
    if (!invite.exists) return null;
    const i = invite.data();
    await driverRef.update({fleetInvite: {fleetId: i.fleetId,
      fleetName: i.fleetName, driverType: i.driverType || "company",
      invitedAt: i.invitedAt, invitedBy: i.invitedBy || null}});
    return null;
  };
  out.applyFleetInviteOnSignup = functions.firestore
      .document("drivers/{driverId}")
      .onWrite((change, context) =>
        applyInviteForNumber(change, context.params.driverId));
  out.applyFleetInviteOnPrivateNumber = functions.firestore
      .document("driverPrivate/{driverId}")
      .onWrite((change, context) =>
        applyInviteForNumber(change, context.params.driverId));

  /**
   * Takes a driver out of their fleet; they drive independently from then
   * on. Not while they are on one of the fleet's jobs: it would be left
   * with a driver who no longer works for them.
   * @param {string} driverId Driver.
   * @param {Function} check Throws if the caller may not, given the
   *     driver's data.
   * @param {string} by Who did it, kept on the driver.
   * @param {Object=} opts {closing: true} when the whole fleet is closing.
   * @return {Promise<Object>} {fleetId, fleetName, type, restored}
   */
  async function takeOutOfFleet(driverId, check, by, opts = {}) {
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
      // A company driver drove the fleet's car, so leaving it does not make
      // them an independent driver: their driver account is suspended, and
      // the suspension is the fleet's. Only that fleet can reinstate them
      // (reinstateFleetDriver), with a TakeARoute admin as a backup
      // (setAccountSuspension). With this account they cannot join another
      // fleet; to drive elsewhere with their own car they delete it and
      // register again. Only self-employed drivers go on independently.
      // Their passenger account is untouched.
      const suspendNow = type === "company";
      const fleetName = driver.fleetName || "the fleet";
      const blockFields = suspendNow ? {
        blocked: true,
        blockedReason: opts.closing ? `${fleetName} has closed` :
          `Removed from ${fleetName}`,
        blockedKind: "fleet_removed",
        blockedAt: new Date().toISOString(),
        blockedBy: by,
        blockedByFleet: fleetId,
        removedFromFleetId: fleetId,
        removedFromFleetName: fleetName,
        status: "offline",
      } : liftOwn ? {
        blocked: false, blockedReason: "", blockedByFleet: null,
        blockedKind: FieldValue.delete(),
        unblockedAt: new Date().toISOString(),
        unblockedBy: `${driver.fleetName || "Fleet"} (left the fleet)`,
      } : {};
      tx.update(driverRef, Object.assign(blockFields, own.fields, {
        fleetId: null,
        fleetName: null,
        fleetDriverType: FieldValue.delete(),
        fleetLeftAt: FieldValue.serverTimestamp(),
        fleetLeftBy: by,
        lastFleetId: fleetId,
      }));
      return {fleetId, fleetName: driver.fleetName || "your fleet", type,
        restored: own.restored, suspended: suspendNow,
        coveredBefore: Boolean(driver.subscription &&
          driver.subscription.paymentMethod === "fleet")};
    });

    // Offers that were waiting for this driver go back to the office.
    await returnOffers(fleetId, driverId, docs);

    await sendPush([driverId], result.suspended ? {
      title: opts.closing ? `${result.fleetName} has closed` :
        `You were removed from ${result.fleetName}`,
      body: opts.closing ?
        "Your driver account is suspended. Please contact TakeARoute." :
        "Your driver account is suspended. Only " +
          `${result.fleetName} can reinstate it.`,
      channelId: "general",
    } : {
      title: `You left ${result.fleetName}`,
      body: result.type === "self" && !result.coveredBefore ?
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
    return {ok: true, membershipRestored: result.restored,
      suspended: result.suspended};
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
    return {ok: true, membershipRestored: result.restored,
      suspended: result.suspended};
  });

  /* ------------------------- deleting an account ----------------------
     The person deletes their own TakeARoute account in the app (Account >
     Delete my account; Google Play requires it). One account can be both
     a passenger and a driver, so both go. Removed: the sign-in, the
     passenger and driver records and what is under them (cards, saved
     places, documents), push tokens, location, wallet (only when empty),
     photos and uploaded documents, bank details on past payout records.
     Kept, as the business's books need them: rides, payments, payout
     amounts, and a fleet's own records (statements, contact cards). A
     fleet's invite to the number stays, so the person can sign up again
     with the same number and accept it.
     Refused while they are on a trip or have a trip booked, while money
     is in their wallet or a withdrawal is pending, and for fleet staff
     and admins, whose logins are managed elsewhere. Owing TakeARoute money
     (a negative wallet, unpaid membership) does not stop it: the stores and
     UK data law expect deletion to work regardless. What was owed is left
     for an admin in paymentAlerts. The Stripe customer and payout account
     go too; Stripe keeps its own payment records. */
  const callsWithStripe = functions.runWith({secrets: STRIPE_SECRETS}).https;
  out.deleteMyAccount = callsWithStripe.onCall(async (data, context) => {
    if (!context.auth) throw new HttpsError("unauthenticated", "Sign in.");
    const uid = context.auth.uid;
    const refs = {
      driver: db.collection("drivers").doc(uid),
      rider: db.collection("riders").doc(uid),
      wallet: db.collection("driverWallets").doc(uid),
    };
    const [driverSnap, walletSnap, managerSnap, adminSnap, asRider,
      asDriver, payouts] = await Promise.all([
      refs.driver.get(), refs.wallet.get(),
      db.collection("fleetManagers").doc(uid).get(),
      db.collection("admins").doc(uid).get(),
      db.collection("rides").where("riderId", "==", uid).get(),
      db.collection("rides").where("driverId", "==", uid).get(),
      db.collection("driverPayouts").where("driverId", "==", uid).get(),
    ]);
    if (managerSnap.exists || adminSnap.exists) {
      throw new HttpsError("failed-precondition",
          "This number is also a fleet or TakeARoute staff login, so it " +
          "can't be deleted from the app. Please contact TakeARoute.");
    }
    const openTrip = (snap, statuses) => snap.docs.some((d) =>
      statuses.includes(d.data().status));
    if (openTrip(asRider, ["searching", "scheduled", "dispatching",
      "accepted", "arrived", "ongoing"]) ||
        openTrip(asDriver, ["accepted", "arrived", "ongoing"])) {
      throw new HttpsError("failed-precondition",
          "You have a trip booked or in progress. Finish or cancel it, " +
          "then delete your account.");
    }
    const balance = walletSnap.exists ?
      Number(walletSnap.data().availableBalance) || 0 : 0;
    if (balance > 0) {
      throw new HttpsError("failed-precondition",
          `You still have ${balance.toFixed(2)} in your wallet. Withdraw ` +
          "it first, or contact TakeARoute.");
    }
    const done = ["completed", "rejected", "failed", "cancelled",
      "canceled", "paid"];
    if (payouts.docs.some((d) => !done.includes(d.data().status))) {
      throw new HttpsError("failed-precondition",
          "A withdrawal is still being paid. Delete your account once it " +
          "has arrived.");
    }

    // A fleet driver's waiting offers go back to the office first.
    const driver = driverSnap.exists ? driverSnap.data() : null;
    if (driver && driver.fleetId) {
      const {docs} = await openFleetRides(driver.fleetId, uid);
      await returnOffers(driver.fleetId, uid, docs);
    }

    for (const d of payouts.docs) {
      if (d.data().bankDetails) {
        await d.ref.update({bankDetails: FieldValue.delete(),
          driverDeleted: true});
      }
    }
    const riderSnap = await refs.rider.get();
    const debt = Number(driver && driver.subscription &&
      driver.subscription.debtAmount) || 0;
    if (balance < 0 || debt > 0) {
      await paymentAlerts.raise("account_deleted_owing", uid, {
        title: "Account deleted while owing money",
        detail: `Negative wallet ${Math.max(0, -balance).toFixed(2)}, ` +
          `unpaid membership ${debt.toFixed(2)}.`,
        amount: Math.round((Math.max(0, -balance) + debt) * 100) / 100,
        driverId: uid, fleetId: (driver && driver.fleetId) || null,
      });
    }
    const stripeIds = {
      customer: riderSnap.exists ? riderSnap.data().stripeCustomerId : null,
      accounts: [...new Set([driver && driver.payoutAccountId,
        driver && driver.stripeAccountId].filter(Boolean))],
    };

    for (const ref of [refs.driver, refs.rider,
      db.collection("users").doc(uid),
      db.collection("pushTokens").doc(uid),
      db.collection("driverLocations").doc(uid),
      privacy.privateRef(uid), privacy.filesRef(uid),
      db.collection("riderPublic").doc(uid)]) {
      await db.recursiveDelete(ref);
    }
    if (walletSnap.exists) await db.recursiveDelete(refs.wallet);
    try {
      const bucket = admin.storage().bucket();
      await Promise.all(["drivers", "riders"].map((p) =>
        bucket.deleteFiles({prefix: `${p}/${uid}/`})));
    } catch (e) {
      console.error("deleteMyAccount storage", uid, e.message);
    }
    try {
      const {customer, accounts} = stripeIds;
      if (customer) await deps.stripe.customers.del(customer);
      for (const id of accounts) await deps.stripe.accounts.del(id);
    } catch (e) {
      console.error("deleteMyAccount stripe", uid, e.message);
      await paymentAlerts.raise("stripe_cleanup_failed", uid, {
        title: "Deleted account left behind in Stripe",
        detail: `${stripeIds.customer || "no customer"}, ` +
          `${stripeIds.accounts.join(", ") || "no accounts"}: ` +
          String(e.message).slice(0, 200),
        driverId: uid,
      });
    }
    await admin.auth().deleteUser(uid).catch((e) => {
      if (e.code !== "auth/user-not-found") throw e;
    });
    console.log("deleteMyAccount", uid, driver ? "driver" : "",
        driver && driver.fleetId ? `fleet ${driver.fleetId}` : "");
    return {ok: true};
  });

  /* A fleet's plan changes (the admin dashboard writes fleets/{id}
     directly): self-employed drivers' memberships follow it. Onto a flat
     monthly plan the fleet takes them over; back to per driver, each gets
     their own membership back (or activates one). Company drivers follow
     it the same way (fleetCovers). */
  out.syncFleetPlanMemberships = functions.firestore
      .document("fleets/{fleetId}")
      .onUpdate(async (change, context) => {
        const before = change.before.data() || {};
        const after = change.after.data() || {};
        const wasMonthly = before.billingPlan === "monthly";
        const isMonthly = after.billingPlan === "monthly";
        if (wasMonthly === isMonthly) return null;
        const fleetId = context.params.fleetId;
        // Onto the monthly plan: paid at the start, so due now (the daily
        // billing run takes it).
        if (isMonthly) {
          await change.after.ref.update({nextBillingDate: Timestamp.now()})
              .catch(() => null);
        }
        const snap = await db.collection("drivers")
            .where("fleetId", "==", fleetId).get();
        const told = [];
        for (const d of snap.docs) {
          const changed = await db.runTransaction(async (tx) => {
            const fresh = await tx.get(d.ref);
            const driver = fresh.data();
            if (!driver || driver.fleetId !== fleetId) return false;
            const paidByFleet = Boolean(driver.subscription &&
              driver.subscription.paymentMethod === "fleet");
            if (isMonthly === paidByFleet) return false;
            tx.update(d.ref, isMonthly ?
              fleetPaysFields(driver, fleetId, after.name) :
              ownMembershipFields(driver).fields);
            return true;
          });
          if (changed) told.push(d.id);
        }
        if (told.length) {
          await sendPush(told, isMonthly ? {
            title: `${after.name || "Your fleet"} now pays your membership`,
            body: "You no longer pay it yourself.",
            channelId: "general",
          } : {
            title: "Your membership is your own again",
            body: `${after.name || "Your fleet"} no longer pays it. Check ` +
              "Membership in the app.",
            channelId: "general",
          }).catch(() => null);
        }
        console.log("syncFleetPlanMemberships", fleetId,
            isMonthly ? "monthly" : "per_driver", told.length);
        return null;
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
      const fleetSnap = await tx.get(db.collection("fleets")
          .doc(driver.fleetId));
      const covered = fleetCovers(type, fleetSnap.data());
      const fields = covered ?
        fleetPaysFields(driver, driver.fleetId, driver.fleetName) :
        ownMembershipFields(driver).fields;
      tx.update(driverRef, Object.assign(fields, {fleetDriverType: type}));
      return {changed: fleetTypeOf(driver) !== type,
        fleetName: driver.fleetName, covered};
    });
    if (result.changed) {
      await sendPush([driverId], {
        title: type === "company" ? "You are now a company driver" :
          "You are now self-employed in your fleet",
        body: type === "company" ?
          `${result.fleetName || "Your fleet"} now receives your card ` +
            (result.covered ? "earnings and pays your membership." :
              "earnings. You still pay your own membership.") :
          (result.covered ?
            "Card fares now go to your wallet. Your fleet still pays " +
              "your membership." :
            "Card fares now go to your wallet, and you pay your own " +
              "membership."),
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
  /* A TakeARoute admin gives a chosen driver the paid membership for free,
     or takes it back. No end date and nothing charged while it is on: the
     renewal jobs only look at drivers with a due date. What they had before
     is kept and comes back when it is turned off. A driver whose fleet pays
     is left to the fleet. */
  out.adminSetDriverMembership = functions.https.onCall(
      async (data, context) => {
        await assertAdmin(context);
        const driverId = text(data && data.driverId, 128);
        const granted = Boolean(data && data.granted === true);
        const ref = db.collection("drivers").doc(driverId || "-");
        const by = context.auth.token.email || "an admin";
        const changed = await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) {
            throw new HttpsError("not-found", "Driver not found.");
          }
          const driver = snap.data();
          const sub = driver.subscription || null;
          const isGranted = Boolean(sub &&
            sub.paymentMethod === "admin_granted");
          if (granted === isGranted) return false;
          if (granted) {
            if (driver.approved !== true) {
              throw new HttpsError("failed-precondition",
                  "Approve this driver first.");
            }
            if (sub && sub.paymentMethod === "fleet") {
              throw new HttpsError("failed-precondition",
                  "This driver's fleet already pays their membership.");
            }
            tx.update(ref, {
              subscription: {
                status: "active", tier: "granted", amount: 0,
                paymentMethod: "admin_granted", debtAmount: 0,
                lastPaidAt: FieldValue.serverTimestamp(), graceUntil: null,
                nextBillingDate: null, grantedBy: by,
                activatedAt: FieldValue.serverTimestamp(),
              },
              subscriptionBeforeGrant: sub || FieldValue.delete(),
              onboardingComplete: true,
            });
            return true;
          }
          const before = driver.subscriptionBeforeGrant;
          const restore = before &&
            ["active", "past_due", "suspended"].includes(before.status);
          tx.update(ref, {
            subscription: restore ? before : FieldValue.delete(),
            subscriptionBeforeGrant: FieldValue.delete(),
          });
          return true;
        });
        if (changed) {
          await sendPush([driverId], granted ? {
            title: "Your membership is active",
            body: "TakeARoute has given you the driver membership. " +
              "There is nothing to pay.",
            channelId: "general",
          } : {
            title: "Your membership has changed",
            body: "Your free membership has ended. Open Membership in " +
              "the app to carry on.",
            channelId: "general",
          }).catch(() => null);
        }
        return {ok: true, granted, changed};
      });

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
        blockedByFleet: null, blockedKind: FieldValue.delete(),
      }, coll === "drivers" ? {status: "offline"} : {}) : {
        blocked: false, blockedReason: "", blockedByFleet: null,
        blockedKind: FieldValue.delete(),
        removedFromFleetId: FieldValue.delete(),
        removedFromFleetName: FieldValue.delete(),
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
            body: after.collectBy === "account" ?
              "Thanks for travelling with us. This trip goes on your " +
              "company's account." :
              total ? `Please pay £${total} ` +
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
    return {results: await placeSearch(data)};
  });

  out.fleetPlaceDetails = functions.https.onCall(async (data, context) => {
    await assertFleetManager(context, false);
    return placeDetails(data);
  });

  /**
   * Address suggestions from Google Places (New), UK first. Shared by the
   * booking form and the customer booking link.
   * @param {Object} data {input, near, sessionToken}
   * @return {Promise<Array>} [{placeId, main, secondary}]
   */
  async function placeSearch(data) {
    const input = text(data && data.input, 120);
    if (input.length < 2) return [];
    const body = {input, includedRegionCodes: ["gb"]};
    const near = point(data && data.near);
    if (near) {
      body.locationBias = {circle: {center: {latitude: near.latitude,
        longitude: near.longitude}, radius: 50000}};
    }
    if (data && typeof data.sessionToken === "string") {
      body.sessionToken = data.sessionToken.slice(0, 64);
    }
    const res = await fetch(`${PLACES_API}/v1/places:autocomplete`,
        {method: "POST", headers: {"Content-Type": "application/json",
          "X-Goog-Api-Key": MAPS_KEY}, body: JSON.stringify(body)});
    const json = await res.json().catch(() => ({}));
    return (json.suggestions || [])
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
  }

  /**
   * A Places result's name and address as one line: "Heathrow Terminal 5,
   * Longford, Hounslow ..." reads better than the street address alone.
   * @param {Object} p Place (displayName, formattedAddress).
   * @return {string} Address.
   */
  function placeLine(p) {
    const name = p.displayName && p.displayName.text;
    const addr = p.formattedAddress || "";
    return name && !addr.startsWith(name) ? `${name}, ${addr}` : addr;
  }

  /**
   * The point for a chosen suggestion.
   * @param {Object} data {placeId, sessionToken}
   * @return {Promise<Object>} {latitude, longitude, address}
   */
  async function placeDetails(data) {
    const placeId = text(data && data.placeId, 300);
    if (!/^[A-Za-z0-9_-]+$/.test(placeId)) {
      throw new HttpsError("invalid-argument", "Unknown place.");
    }
    const token = data && typeof data.sessionToken === "string" ?
      `?sessionToken=${encodeURIComponent(data.sessionToken.slice(0, 64))}` :
      "";
    const res = await fetch(`${PLACES_API}/v1/places/${placeId}${token}`,
        {headers: {"X-Goog-Api-Key": MAPS_KEY,
          "X-Goog-FieldMask": "location,formattedAddress,displayName"}});
    const p = await res.json().catch(() => ({}));
    if (!p.location) throw new HttpsError("not-found", "Place not found.");
    return {latitude: p.location.latitude, longitude: p.location.longitude,
      address: placeLine(p)};
  }

  /**
   * The best match for an address said on the phone ("12 Station Road,
   * Redditch", "the train station"), near where the caller usually is.
   * @param {string} query What was said.
   * @param {?Object} near A point to search around.
   * @return {Promise<?Object>} {latitude, longitude, address}, or null.
   */
  async function placeFromText(query, near) {
    const textQuery = text(query, 200);
    if (textQuery.length < 3) return null;
    const body = {textQuery, regionCode: "gb", maxResultCount: 1};
    if (near) {
      body.locationBias = {circle: {center: {latitude: near.latitude,
        longitude: near.longitude}, radius: 40000}};
    }
    const res = await fetch(`${PLACES_API}/v1/places:searchText`, {
      method: "POST",
      headers: {"Content-Type": "application/json", "X-Goog-Api-Key": MAPS_KEY,
        "X-Goog-FieldMask":
          "places.location,places.formattedAddress,places.displayName"},
      body: JSON.stringify(body)});
    const json = await res.json().catch(() => ({}));
    const p = json.places && json.places[0];
    if (!p || !p.location) return null;
    return {latitude: p.location.latitude, longitude: p.location.longitude,
      address: placeLine(p)};
  }

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
    return bookPhoneJob(me, data || {});
  });

  /**
   * Books a phone job for a fleet. The booking form, the phone bot and the
   * customer booking link all come here.
   * @param {Object} me {uid, fleetId, fleet, manager}, plus bookedBy when it
   *   is not an operator ({uid: null, name, via: "bot" | "link"}).
   * @param {Object} d The booking, as createFleetBooking takes it.
   * @param {Object=} opts Server-only: {paidOnline, extra} (the web booker:
   *   a card job held until paid, and fields added to the ride).
   * @return {Promise<Object>} {rideId, status, fare, currency, later,
   *   phone, pickupAtMs}
   */
  async function bookPhoneJob(me, d, opts) {
    // Set by the server only (the web booker), never from a request.
    const o = opts || {};
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
    const {mode, nearest} = dispatchChoice(d.dispatchMode, driverId, me.fleet);
    if (driverId) {
      const snap = await db.collection("drivers").doc(driverId).get();
      const drv = snap.exists ? snap.data() : null;
      if (!drv || !canTakeFleetJob(drv,
          {fleetId: me.fleetId, rideType})) {
        throw new HttpsError("failed-precondition",
            "That driver cannot take this job (not in your fleet, not " +
            "approved, documents expired, membership unpaid, resting, or " +
            "the wrong vehicle).");
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
    const collectBy = o.paidOnline ? "online" :
      ["card", "account"].includes(d.collectBy) ? d.collectBy : "cash";
    const notes = text(d.notes, 500);
    // An account job goes on the client's bill: the driver takes no money.
    let account = null;
    if (collectBy === "account") {
      const accountId = text(d.accountId, 128);
      const snap = accountId ? await db.collection("fleets").doc(me.fleetId)
          .collection("accounts").doc(accountId).get() : null;
      if (!snap || !snap.exists || snap.data().active === false) {
        throw new HttpsError("invalid-argument",
            "Choose which account this job goes on.");
      }
      account = {id: snap.id, company: snap.data().company || ""};
    }
    const notePrefix = account ?
      `ACCOUNT JOB for ${account.company}: do not take payment.` :
      collectBy === "online" ? "PAID ONLINE: do not take payment." :
      collectBy === "card" ? "CARD PAYMENT: take it on your terminal." : "";
    // Paid online: held until the card is authorised (fleetWeb.js).
    const held = o.paidOnline === true;

    const rideRef = db.collection("rides").doc();
    const ts = FieldValue.serverTimestamp();
    await rideRef.set(Object.assign({
      source: "phone",
      fleetId: me.fleetId,
      fleetName: me.fleet.name,
      riderId: null,
      driverId: null,
      customer: {name: name || (appRider ? appRider.name : ""), phone,
        riderId: appRider ? appRider.uid : null},
      // Older driver apps only know "CASH JOB", so say it in the notes too.
      notes: `${notePrefix} ${notes}`.trim(),
      bookedBy: me.bookedBy ||
        {uid: me.uid, name: me.manager.name || me.manager.email || ""},
      status: held ? "payment_pending" : later ? "scheduled" : "dispatching",
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
      paymentMethod: held ? "card" : "cash",
      collectBy,
      account,
      payment: {method: held ? "card" : "cash", status: "pending",
        transactionId: null},
      pickupAt: pickupAtMs === null ? null : Timestamp.fromMillis(pickupAtMs),
      dispatchAt: Timestamp.fromMillis(dispatchAtMs),
      dispatch: {
        mode,
        nearest,
        driverId,
        leadMinutes: lead,
        offeredAt: later || held ? null : ts,
        rounds: later || held ? 0 : 1,
      },
      timestamps: {createdAt: ts, acceptedAt: null, startedAt: null,
        completedAt: null},
      cancellation: {by: null, reason: null, at: null},
      rating: {riderToDriver: null, driverToRider: null, feedback: null},
    }, o.extra || {}));

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
    return {rideId: rideRef.id,
      status: held ? "payment_pending" : later ? "scheduled" : "dispatching",
      fare: fare.total, currency: fare.currency, later, phone,
      pickupAtMs};
  }

  /**
   * Distance, time and fare for one vehicle class (the phone bot and the
   * booking link quote before booking, as the booking form does).
   * @param {Object} pickup Point.
   * @param {Object} dropoff Point.
   * @param {string} rideType Vehicle class.
   * @return {Promise<Object>} {distanceKm, durationMinutes, total, currency}
   */
  async function quoteOne(pickup, dropoff, rideType) {
    const [route, raw] = await Promise.all([
      routeFor(pickup, dropoff, []), rawConfig()]);
    const fare = fareFor(raw, route, rideType);
    return {distanceKm: Number(route.distanceKm.toFixed(2)),
      durationMinutes: Math.round(route.durationMinutes),
      total: fare.total, currency: fare.currency};
  }

  /**
   * One route, a fare for each vehicle class (the web booker).
   * @param {Object} pickup Point.
   * @param {Object} dropoff Point.
   * @param {Array} stops Points in between.
   * @param {Array} types Vehicle class ids.
   * @return {Promise<Object>} {distanceKm, durationMinutes, fares, currency}
   */
  async function quoteTypes(pickup, dropoff, stops, types) {
    const [route, raw] = await Promise.all([
      routeFor(pickup, dropoff, stops || []), rawConfig()]);
    const fares = {};
    let currency = "GBP";
    types.forEach((t) => {
      const f = fareFor(raw, route, t);
      fares[t] = f.total;
      currency = f.currency;
    });
    return {distanceKm: Number(route.distanceKm.toFixed(2)),
      durationMinutes: Math.round(route.durationMinutes), fares, currency};
  }

  /* Sends a phone job again: to another driver, to the whole fleet, or
     straight away instead of at its booked time. */
  out.redispatchFleetBooking = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, false);
    const rideId = text(data && data.rideId, 128);
    const driverId = text(data && data.driverId, 128) || null;
    const {mode, nearest} = dispatchChoice(data && data.mode, driverId,
        me.fleet);
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
        "dispatch.nearest": nearest,
        "dispatch.driverId": driverId,
        "dispatch.offeredAt": FieldValue.serverTimestamp(),
        "dispatch.rounds": FieldValue.increment(1),
        "dispatch.returnedBy": FieldValue.delete(),
        "dispatch.queueDone": false,
        "dispatch.missed": [],
        "dispatch.reRings": 0,
        "dispatch.unansweredAt": FieldValue.delete(),
        // Sending to the whole fleet or the queue again: anyone who said no
        // before is asked again, since the operator chose to resend.
        "declinedBy": driverId ?
          (ride.declinedBy || []).filter((id) => id !== driverId) : [],
      });
    });
    return {ok: true};
  });

  /* The office changes a phone booking before any driver has accepted it:
     customer, addresses, car type, time, price, payment and notes. A
     changed route is priced again (or keeps the agreed price). A new time
     moves the release time; a job already being offered that changes where
     it goes is offered again from the start. */
  out.editFleetBooking = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, false);
    const d = data || {};
    const rideRef = db.collection("rides").doc(text(d.rideId, 128) || "-");
    const first = await rideRef.get();
    const ride = first.exists ? first.data() : null;
    if (!ride || ride.fleetId !== me.fleetId || ride.source !== "phone") {
      throw new HttpsError("not-found", "Not one of your bookings.");
    }
    if (!["scheduled", "dispatching"].includes(ride.status) || ride.driverId) {
      throw new HttpsError("failed-precondition",
          "A driver has already accepted this job, so it can no longer be " +
          "changed. Cancel it and book again if needed.");
    }
    // The customer's card was authorised for this route and price.
    if (ride.collectBy === "online") {
      throw new HttpsError("failed-precondition",
          "The customer paid for this booking online, so it can't be " +
          "changed here. Cancel it (the card hold is released) and ask " +
          "them to book again.");
    }

    const update = {};
    // Customer.
    if (d.customer) {
      const phone = toE164(d.customer.phone) || ride.customer.phone;
      update.customer = Object.assign({}, ride.customer, {
        name: text(d.customer.name, 80), phone});
    }
    // Where and what.
    const pickup = d.pickup ? point(d.pickup) : ride.pickupLocation;
    const dropoff = d.dropoff ? point(d.dropoff) : ride.dropoffLocation;
    const stops = d.stops ? d.stops.map(point).filter(Boolean).slice(0, 3) :
      ride.stops || [];
    if (!pickup || !dropoff) {
      throw new HttpsError("invalid-argument",
          "Choose a pickup and a drop-off.");
    }
    const rideType = CLASS_MULTIPLIERS[d.rideType] ? d.rideType :
      ride.rideType;
    const key = (p) => p ? `${p.latitude},${p.longitude}` : "";
    const moved = key(pickup) !== key(ride.pickupLocation) ||
      key(dropoff) !== key(ride.dropoffLocation) ||
      stops.map(key).join("|") !== (ride.stops || []).map(key).join("|");
    const priceGiven = d.agreedPrice !== undefined;
    const agreed = priceGiven && d.agreedPrice !== null &&
      d.agreedPrice !== "" ? Number(d.agreedPrice) : null;
    if (agreed !== null && (!(agreed > 0) || agreed > 10000)) {
      throw new HttpsError("invalid-argument",
          "Enter a price above zero, or leave it empty.");
    }
    if (moved || rideType !== ride.rideType || priceGiven) {
      const [route, raw] = await Promise.all([
        routeFor(pickup, dropoff, stops), rawConfig()]);
      let fare = fareFor(raw, route, rideType);
      // Keep an agreed price unless the office cleared or changed it.
      const keep = !priceGiven && ride.fare && ride.fare.agreedPrice === true ?
        Number(ride.fare.total) : null;
      const price = priceGiven ? agreed : keep;
      if (price !== null) fare = fareAtAgreedPrice(fare, price);
      Object.assign(update, {
        pickupLocation: pickup, dropoffLocation: dropoff, stops, rideType,
        route: {
          distanceKm: Number(route.distanceKm.toFixed(2)),
          distanceMiles: fare.distanceInMiles,
          durationMinutes: Number(route.durationMinutes.toFixed(2)),
          status: "calculated",
        },
        fare, fareEstimate: fare.total, currency: fare.currency,
      });
    }

    // Payment and notes. The note prefix tells older driver apps how the
    // money is taken, as on a new booking.
    const collectBy = d.collectBy === undefined ? ride.collectBy || "cash" :
      ["card", "account"].includes(d.collectBy) ? d.collectBy : "cash";
    let account = ride.account || null;
    if (collectBy === "account" && (d.accountId !== undefined || !account)) {
      const accountId = text(d.accountId, 128) || (account && account.id);
      const snap = accountId ? await fleetDoc(me.fleetId)
          .collection("accounts").doc(accountId).get() : null;
      if (!snap || !snap.exists || snap.data().active === false) {
        throw new HttpsError("invalid-argument",
            "Choose which account this job goes on.");
      }
      account = {id: snap.id, company: snap.data().company || ""};
    }
    if (collectBy !== "account") account = null;
    const prefixes = new RegExp("^(ACCOUNT JOB for .*?: do not take " +
        "payment\\.|CARD PAYMENT: take it on your terminal\\.)\\s*");
    const plainNotes = d.notes !== undefined ? text(d.notes, 500) :
      String(ride.notes || "").replace(prefixes, "");
    const notePrefix = account ?
      `ACCOUNT JOB for ${account.company}: do not take payment.` :
      collectBy === "card" ? "CARD PAYMENT: take it on your terminal." : "";
    Object.assign(update, {collectBy, account,
      notes: `${notePrefix} ${plainNotes}`.trim()});

    // Time and release.
    const now = Date.now();
    let pickupAtMs = toMillis(ride.pickupAt) || null;
    if (d.pickupAt !== undefined) {
      pickupAtMs = d.pickupAt ? Number(new Date(d.pickupAt)) : null;
      if (pickupAtMs !== null && (!Number.isFinite(pickupAtMs) ||
          pickupAtMs < now - 60 * 1000)) {
        throw new HttpsError("invalid-argument",
            "That pickup time is not valid or has passed.");
      }
      update.pickupAt = pickupAtMs === null ? null :
        Timestamp.fromMillis(pickupAtMs);
    }
    const leadRaw = d.leadMinutes !== undefined ? Number(d.leadMinutes) :
      (ride.dispatch || {}).leadMinutes;
    const lead = Number.isFinite(Number(leadRaw)) ?
      Math.min(MAX_LEAD_MINUTES, Math.max(0, Math.round(Number(leadRaw)))) :
      DEFAULT_LEAD_MINUTES;
    const dispatchAtMs = pickupAtMs === null ? now :
      Math.max(now, pickupAtMs - lead * 60 * 1000);
    const later = dispatchAtMs > now + 30 * 1000;
    update.dispatchAt = Timestamp.fromMillis(dispatchAtMs);
    update["dispatch.leadMinutes"] = lead;
    update.editedAt = FieldValue.serverTimestamp();
    update.editedBy = {uid: me.uid,
      name: me.manager.name || me.manager.email || ""};

    let resend = false;
    if (later) {
      update.status = "scheduled";
      update["dispatch.offeredAt"] = null;
    } else if (ride.status === "scheduled" || moved) {
      // Due now, or the job now goes somewhere else: offer it afresh.
      resend = true;
      update.status = "dispatching";
      update.declinedBy = [];
      update["dispatch.missed"] = [];
      update["dispatch.queueDone"] = false;
      update["dispatch.reRings"] = 0;
      update["dispatch.offeredAt"] = FieldValue.serverTimestamp();
      update["dispatch.rounds"] = FieldValue.increment(1);
      if ((ride.dispatch || {}).mode === "queue") {
        update["dispatch.driverId"] = null;
      }
    }

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(rideRef);
      const nowRide = snap.exists ? snap.data() : null;
      if (!nowRide || !["scheduled", "dispatching"].includes(nowRide.status) ||
          nowRide.driverId) {
        throw new HttpsError("failed-precondition",
            "A driver accepted this job while you were editing it.");
      }
      tx.update(rideRef, update);
    });
    return {rideId: rideRef.id, status: update.status || ride.status,
      fare: update.fare ? update.fare.total : (ride.fare || {}).total,
      resent: resend};
  });

  /* The office sends one of its drivers a short message. It arrives as a
     notification; the driver phones the office to answer. */
  out.messageFleetDriver = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, false);
    const driverId = text(data && data.driverId, 128);
    const body = text(data && data.text, 1000);
    if (!driverId || !body) {
      throw new HttpsError("invalid-argument", "Write a message first.");
    }
    const snap = await db.collection("drivers").doc(driverId).get();
    if (!snap.exists || snap.data().fleetId !== me.fleetId) {
      throw new HttpsError("not-found", "Not one of your drivers.");
    }
    const notified = await sendPush([driverId], {
      title: `Message from ${me.fleet.name}`,
      body,
      channelId: "messages",
      data: {type: "fleet_chat"},
    });
    await addChatMessage(me.fleetId, driverId, {from: "office", text: body,
      byUid: me.uid, byName: me.manager.name || me.manager.email || "Office",
      notified}, snap.data());
    return {notified};
  });

  /* ------------------- office and driver messages ---------------------- */

  /* One thread per driver: fleets/{fleetId}/driverChats/{driverId}
     {driverName, lastText, lastAt, lastFrom, unreadOffice, unreadDriver},
     messages in .../messages. The office writes through messageFleetDriver,
     the driver (app, Fleet > Messages) through messageFleetOffice. Staff
     and that driver read it (rules); only these functions write. */
  const chatRef = (fleetId, driverId) => db.collection("fleets").doc(fleetId)
      .collection("driverChats").doc(driverId);

  /**
   * Adds a message to a driver's thread with the office.
   * @param {string} fleetId Fleet.
   * @param {string} driverId Driver.
   * @param {Object} m {from: "office"|"driver", text, byUid, byName}
   * @param {Object} driver Driver data (for the name).
   * @return {Promise<void>}
   */
  async function addChatMessage(fleetId, driverId, m, driver) {
    const ref = chatRef(fleetId, driverId);
    const now = new Date().toISOString();
    await ref.collection("messages").add(Object.assign({}, m, {
      createdAt: FieldValue.serverTimestamp(), at: now}));
    await ref.set({
      driverId,
      driverName: [driver.firstName, driver.lastName].filter(Boolean)
          .join(" ") || driver.fullName || driver.name || "Driver",
      lastText: m.text.slice(0, 140), lastAt: now, lastFrom: m.from,
      [m.from === "office" ? "unreadDriver" : "unreadOffice"]:
        FieldValue.increment(1),
    }, {merge: true});
  }

  /* The driver writes to their fleet's office. */
  out.messageFleetOffice = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new HttpsError("unauthenticated", "Sign in.");
    const uid = context.auth.uid;
    const body = text(data && data.text, 1000);
    if (!body) throw new HttpsError("invalid-argument", "Write a message.");
    const snap = await db.collection("drivers").doc(uid).get();
    const driver = snap.exists ? snap.data() : null;
    if (!driver || !driver.fleetId) {
      throw new HttpsError("failed-precondition",
          "You're not driving for a taxi firm.");
    }
    await addChatMessage(driver.fleetId, uid, {from: "driver", text: body,
      byUid: uid}, driver);
    return {ok: true};
  });

  /* Marks a thread read: by the office (driverId given) or the driver. */
  out.markFleetChatRead = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new HttpsError("unauthenticated", "Sign in.");
    if (data && data.driverId) {
      const me = await assertFleetManager(context, false);
      await chatRef(me.fleetId, text(data.driverId, 128))
          .set({unreadOffice: 0}, {merge: true});
      return {ok: true};
    }
    const d = (await db.collection("drivers").doc(context.auth.uid).get())
        .data() || {};
    if (d.fleetId) {
      await chatRef(d.fleetId, context.auth.uid)
          .set({unreadDriver: 0}, {merge: true});
    }
    return {ok: true};
  });

  /* ---------------------- a driver's contact details ------------------ */

  /**
   * Who may see and change a driver's contact details: TakeARoute admins,
   * and staff of the fleet the driver works for.
   * @param {Object} context Callable context.
   * @param {string} driverId Driver.
   * @return {Promise<Object>} {isAdmin, by, driver}
   */
  async function contactAccess(context, driverId) {
    if (!context.auth) throw new HttpsError("unauthenticated", "Sign in.");
    const snap = driverId ?
      await db.collection("drivers").doc(driverId).get() : null;
    if (!snap || !snap.exists) {
      throw new HttpsError("not-found", "No such driver.");
    }
    const adminSnap = await db.collection("admins").doc(context.auth.uid)
        .get();
    const driver = await privacy.withPrivate(driverId, snap.data());
    if (adminSnap.exists && adminSnap.data().isActive === true) {
      return {isAdmin: true, by: adminSnap.data().name ||
        adminSnap.data().email || "TakeARoute", driver};
    }
    const me = await assertFleetManager(context, false);
    if (snap.data().fleetId !== me.fleetId) {
      throw new HttpsError("permission-denied", "Not one of your drivers.");
    }
    return {isAdmin: false, by: `${me.manager.name || me.manager.email ||
      "Staff"}, ${me.fleet.name || "fleet"}`, driver};
  }

  /**
   * The sign-in account behind a driver, or null.
   * @param {string} uid Driver.
   * @return {Promise<?Object>} Auth user record.
   */
  const authUser = (uid) => admin.auth().getUser(uid).catch(() => null);

  /* A driver's email and phone, wherever they were saved: the driver
     record, their app account (an email sign-up keeps the email there) or
     their sign-in. */
  out.driverContact = functions.https.onCall(async (data, context) => {
    const driverId = text(data && data.driverId, 128);
    const {isAdmin, driver} = await contactAccess(context, driverId);
    const user = (await db.collection("users").doc(driverId).get()).data() ||
      {};
    const auth = await authUser(driverId);
    const providers = ((auth && auth.providerData) || [])
        .map((x) => x.providerId);
    const email = driver.email || user.email || (auth && auth.email) || "";
    // Email sign-ups keep it on the app account: copy it to the driver
    // record so lists and searches show it too.
    if (email && !driver.email) {
      await privacy.privateRef(driverId).set({email}, {merge: true})
          .catch(() => null);
    }
    return {
      email,
      phone: driver.phoneNumber || driver.phone || user.phoneNumber ||
        (auth && auth.phoneNumber) || "",
      signsInWith: providers.includes("password") ? "email" :
        providers.includes("phone") ? "phone" : (providers[0] || ""),
      canEditEmail: isAdmin,
    };
  });

  /* The phone numbers of this fleet's drivers, its applicants and the
     drivers it removed, for its driver pages. Numbers are private
     (functions/privacy.js), so they come from here and not from the driver
     records. */
  out.fleetDriverPhones = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, false);
    const drivers = db.collection("drivers");
    const lists = await Promise.all([
      drivers.where("fleetId", "==", me.fleetId).get(),
      drivers.where("fleetRequest.fleetId", "==", me.fleetId).get(),
      drivers.where("removedFromFleetId", "==", me.fleetId).get(),
    ]);
    const ids = new Set();
    lists.forEach((l) => l.docs.forEach((d) => ids.add(d.id)));
    const refs = [...ids].map((id) => privacy.privateRef(id));
    const secrets = refs.length ? await db.getAll(...refs) : [];
    const phones = {};
    secrets.forEach((s) => {
      const phone = s.exists && (s.data().phoneNumber || s.data().phone);
      if (phone) phones[s.id] = phone;
    });
    // Drivers who signed up with their phone number may only have it on
    // their app account or their sign-in, as driverContact also finds.
    const missing = [...ids].filter((id) => !phones[id]);
    if (missing.length) {
      const users = await db.getAll(
          ...missing.map((id) => db.collection("users").doc(id)));
      users.forEach((u) => {
        const phone = u.exists && (u.data().phoneNumber || u.data().phone);
        if (phone) phones[u.id] = phone;
      });
      const left = missing.filter((id) => !phones[id]);
      for (let i = 0; i < left.length; i += 100) {
        const r = await admin.auth()
            .getUsers(left.slice(i, i + 100).map((uid) => ({uid})))
            .catch(() => ({users: []}));
        r.users.forEach((a) => {
          if (a.phoneNumber) phones[a.uid] = a.phoneNumber;
        });
      }
    }
    return {phones};
  });

  /* Staff correct a driver's phone number (and admins their email). The
     phone is the one the office and passengers ring; it doesn't change how
     the driver signs in. An email change by an admin also changes the
     email they sign in with, if they sign in by email. */
  out.saveDriverContact = functions.https.onCall(async (data, context) => {
    const d = data || {};
    const driverId = text(d.driverId, 128);
    const {isAdmin, by} = await contactAccess(context, driverId);
    const update = {};
    const userUpdate = {};
    if (d.phone !== undefined) {
      const phone = toE164(d.phone);
      if (!phone || !/^\+\d{8,15}$/.test(phone)) {
        throw new HttpsError("invalid-argument",
            "Enter a phone number, for example 07700 900123.");
      }
      const [others, held] = await Promise.all(["drivers", "driverPrivate"]
          .map((c) => db.collection(c)
              .where("phoneNumber", "==", phone).limit(2).get()));
      if (others.docs.concat(held.docs).some((x) => x.id !== driverId)) {
        throw new HttpsError("already-exists",
            "Another driver already has that number.");
      }
      update.phoneNumber = phone;
      userUpdate.phoneNumber = phone;
    }
    if (d.email !== undefined) {
      if (!isAdmin) {
        throw new HttpsError("permission-denied",
            "Only TakeARoute can change a driver's email.");
      }
      const email = text(d.email, 200).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new HttpsError("invalid-argument", "Enter a valid email.");
      }
      const auth = await authUser(driverId);
      if (auth && auth.email !== email) {
        try {
          await admin.auth().updateUser(driverId, {email});
        } catch (error) {
          throw new HttpsError("already-exists",
              error.code === "auth/email-already-exists" ?
                "Another account already uses that email." :
                "Could not change the email.");
        }
      }
      update.email = email;
      userUpdate.email = email;
    }
    if (!Object.keys(update).length) {
      throw new HttpsError("invalid-argument", "Nothing to save.");
    }
    update.contactUpdatedAt = new Date().toISOString();
    update.contactUpdatedBy = by;
    await privacy.privateRef(driverId).set(update, {merge: true});
    // Who changed it shows on the fleet's driver page; the number does not.
    await db.collection("drivers").doc(driverId).update({
      contactUpdatedAt: update.contactUpdatedAt,
      contactUpdatedBy: update.contactUpdatedBy,
    });
    await db.collection("users").doc(driverId).set(userUpdate, {merge: true});
    return Object.assign({ok: true}, update);
  });

  /* General notification: the office sends one message to many of its
     drivers. Each driver gets it as a push and in the app's Inbox (one
     announcements doc each, audience "user": notifyAnnouncement pushes it,
     and the Inbox already shows messages "For you"). Logged in
     fleets/{id}/notices. */
  const NOTICE_TO = ["all", "online", "offline"];
  const NOTICES_PER_DAY = 30;
  out.sendFleetNotice = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, false);
    const d = data || {};
    const title = text(d.title, 80);
    const body = text(d.body, 1000);
    const to = NOTICE_TO.includes(d.to) ? d.to : "all";
    const vehicleType = d.vehicleType ? text(d.vehicleType, 40) : "";
    if (!title || !body) {
      throw new HttpsError("invalid-argument",
          "Write a title and a message.");
    }
    const fleetRef = db.collection("fleets").doc(me.fleetId);
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const recent = await fleetRef.collection("notices")
        .where("sentAt", ">", since).get();
    if (recent.size >= NOTICES_PER_DAY) {
      throw new HttpsError("resource-exhausted",
          "That's a lot of notices today. Try again tomorrow.");
    }
    const drivers = (await db.collection("drivers")
        .where("fleetId", "==", me.fleetId).get()).docs.filter((s) => {
      const x = s.data();
      if (x.approved !== true || x.blocked === true) return false;
      const online = x.status === "online" || x.isOnRide === true;
      if (to === "online" && !online) return false;
      if (to === "offline" && online) return false;
      if (vehicleType && (x.vehicleType || "RouteMini") !== vehicleType) {
        return false;
      }
      return true;
    });
    if (!drivers.length) {
      throw new HttpsError("failed-precondition",
          "None of your drivers match who you chose to send it to.");
    }
    const fleetName = me.fleet.name || "Your taxi firm";
    const noticeRef = fleetRef.collection("notices").doc();
    const sentAt = new Date().toISOString();
    for (let i = 0; i < drivers.length; i += 400) {
      const batch = db.batch();
      drivers.slice(i, i + 400).forEach((s) => {
        batch.set(db.collection("announcements").doc(), {
          audience: "user", userId: s.id,
          title: `${fleetName}: ${title}`, body,
          fromFleetId: me.fleetId, noticeId: noticeRef.id,
          createdAt: FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
    }
    await noticeRef.set({title, body, to, vehicleType: vehicleType || null,
      count: drivers.length, sentAt, sentBy: me.uid,
      sentByName: me.manager.name || me.manager.email || ""});
    return {ok: true, count: drivers.length};
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
            `${name}: the radius must be between 0.15 and 18 miles.`);
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
          // a number is typed on the booking form, and someone who rang
          // the office can be rung back.
          const office = db.collection("fleets").doc(me.fleetId);
          const card = await office.collection("customers").doc(other).get();
          if (!card.exists) {
            const called = await office.collection("phoneCalls")
                .where("from", "==", other).limit(1).get();
            if (called.empty) {
              throw new HttpsError("not-found",
                  "That number is not one of your customers.");
            }
          }
          label = (card.exists && card.data().name) || "your customer";
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
        // Real phone jobs have no passenger account on them; a fake one
        // written from the passenger app must never ring the fleet.
        if (after.source !== "phone" || after.riderId) return null;
        const before = change.before.exists ? change.before.data() : null;
        const rideId = context.params.rideId;

        // A driver gave the job back (the app sets status dispatching and
        // driverId null). Send it on by itself: the same queue carries on,
        // a job sent to one named driver goes to the nearest free driver,
        // and a whole-fleet job rings the fleet again. The driver who gave
        // it back is not asked again. The office still sees who returned it
        // and can resend or cancel.
        if (before && ["accepted", "arrived"].includes(before.status) &&
            after.status === "dispatching" && !after.driverId &&
            before.driverId) {
          const old = after.dispatch || {};
          const toQueue = old.mode === "queue" || old.mode === "driver";
          await change.after.ref.update({
            "declinedBy": FieldValue.arrayUnion(before.driverId),
            "dispatch.mode": toQueue ? "queue" : "all",
            "dispatch.nearest": old.mode === "driver" ? true :
              old.nearest === true,
            "dispatch.driverId": null,
            "dispatch.queueDone": false,
            "dispatch.returnedBy": before.driverId,
            "dispatch.returnedAt": FieldValue.serverTimestamp(),
            "dispatch.autoResent": true,
            "dispatch.reRings": 0,
            "dispatch.unansweredAt": FieldValue.delete(),
            // A queue picks the next driver itself; the whole fleet is rung
            // when offeredAt changes.
            "dispatch.offeredAt": toQueue ? null :
              FieldValue.serverTimestamp(),
          });
          return null;
        }
        if (after.status !== "dispatching") return null;

        // By queue: pick the first driver in the pickup zone, and the next
        // one each time the current one says no (or runFleetQueues marks
        // them as not answering). offerNextInQueue writes the choice, which
        // brings us back here to ring them.
        const dispatch = after.dispatch || {};
        if (dispatch.mode === "queue") {
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

  /* Every minute: pre-booked jobs whose time has come are sent out. A pause
     for an unpaid subscription does not touch them: the passenger was
     promised a car and the bill is between the fleet and TakeARoute. When
     an admin has paused a fleet its work stops, so the job is cancelled (a
     web customer is texted and their card released) and an admin is alerted
     to ring anyone else. A closed fleet cannot have open jobs. */
  out.dispatchScheduledRides = functions.pubsub
      .schedule("every 1 minutes")
      .onRun(async () => {
        const due = await db.collection("rides")
            .where("status", "==", "scheduled")
            .where("dispatchAt", "<=", Timestamp.now())
            .limit(100)
            .get();
        const fleets = {};
        for (const doc of due.docs) {
          const ride = doc.data();
          if (ride.fleetId && !(ride.fleetId in fleets)) {
            fleets[ride.fleetId] = (await db.collection("fleets")
                .doc(ride.fleetId).get()).data() || null;
          }
          const fleet = ride.fleetId ? fleets[ride.fleetId] : null;
          const stopped = Boolean(fleet && fleet.status === "suspended" &&
            fleet.suspendedReason !== "unpaid");
          const moved = await db.runTransaction(async (tx) => {
            const snap = await tx.get(doc.ref);
            if (!snap.exists || snap.data().status !== "scheduled") {
              return false;
            }
            tx.update(doc.ref, stopped ? {
              status: "cancelled",
              cancelledBy: "system",
              cancelReason: "fleet_paused",
              cancelledAt: FieldValue.serverTimestamp(),
            } : {
              "status": "dispatching",
              "dispatch.offeredAt": FieldValue.serverTimestamp(),
              "dispatch.rounds": FieldValue.increment(1),
            });
            return true;
          }).catch((error) => {
            console.error("Could not send booking:", doc.id, error.message);
            return false;
          });
          if (moved && stopped) {
            await paymentAlerts.raise("fleet_paused_job_cancelled", doc.id, {
              title: "Booked job cancelled: its fleet is paused",
              detail: `Customer ${(ride.customer || {}).phone || "unknown"}` +
                " may need a call.",
              rideId: doc.id, fleetId: ride.fleetId,
            });
          }
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

        // Whole-fleet offers nobody answered ring again, a few times, so a
        // job does not sit waiting for the office to notice it. New drivers
        // who came online in the meantime are included.
        const open = await db.collection("rides")
            .where("status", "==", "dispatching")
            .where("source", "==", "phone")
            .limit(300).get();
        let rung = 0;
        for (const doc of open.docs) {
          const ride = doc.data();
          const d = ride.dispatch || {};
          // Nobody has taken it for a while: the office should look. The
          // clock restarts when the job is resent or a driver gives it back.
          const waitingSince = Math.max(toMillis(ride.dispatchAt) || 0,
              toMillis(d.returnedAt) || 0);
          if (!d.unansweredAt && waitingSince &&
              Date.now() - waitingSince > JOB_UNANSWERED_MS) {
            await doc.ref.update({
              "dispatch.unansweredAt": FieldValue.serverTimestamp(),
            }).catch(() => null);
          }
          const toFleet = d.mode === "all" ||
            (d.mode === "queue" && d.queueDone === true && !d.driverId);
          const offered = toMillis(d.offeredAt);
          if (!toFleet || !offered || (d.reRings || 0) >= MAX_RE_RINGS ||
              Date.now() - offered < RE_RING_MS) {
            continue;
          }
          await db.runTransaction(async (tx) => {
            const snap = await tx.get(doc.ref);
            const now = snap.exists ? snap.data() : null;
            if (!now || now.status !== "dispatching" ||
                toMillis((now.dispatch || {}).offeredAt) !== offered) {
              return;
            }
            tx.update(doc.ref, {
              "dispatch.offeredAt": FieldValue.serverTimestamp(),
              "dispatch.reRings": FieldValue.increment(1),
            });
          }).then(() => rung++).catch((error) => {
            console.error("Re-ring failed:", doc.id, error.message);
          });
        }
        if (rung) console.log(`Re-rang ${rung} unanswered fleet job(s)`);
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

  /* Daily: a fleet on a flat monthly plan pays its price on its billing
     date, from its wallet and then its saved card. A per-driver fleet is
     billed nothing: its drivers pay their own memberships. */
  /**
   * Bills one fleet if its bill is due: the plan's price from its wallet,
   * and any shortfall from its saved card.
   * @param {Object} doc Fleet snapshot.
   * @param {Object} cfg loadAppConfig().
   * @return {Promise<string>} What happened.
   */
  async function billOne(doc, cfg) {
    const fleet = doc.data();
    if (fleet.status === "suspended") return "suspended";
    const members = await db.collection("drivers")
        .where("fleetId", "==", doc.id).get();
    const drivers = {docs: members.docs.filter((d) =>
      fleetTypeOf(d.data()) === "company")};
    const count = drivers.docs.length;
    // Per driver, or the fleet's flat monthly price (fleetBilling.js).
    const bill = fleetBilling.billFor(fleet, count, cfg);
    // Per-driver plan: each driver pays their own membership, so the fleet
    // is billed nothing (the date still moves on).
    const amount = fleet.billingPlan === "monthly" ? bill.amount : 0;
    const price = bill.price;
    const walletRef = db.collection("fleetWallets").doc(doc.id);
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      const next = toMillis(fresh.data().nextBillingDate);
      if (!next || next > Date.now()) return;
      tx.update(doc.ref, {nextBillingDate: Timestamp.fromDate(
          addOneMonth(new Date(next))),
      billingPeriodStart: Timestamp.fromMillis(next)});
      if (!(amount > 0)) return;
      tx.set(walletRef, {
        availableBalance: FieldValue.increment(-amount),
        totalCharged: FieldValue.increment(amount),
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      tx.set(walletRef.collection("transactions").doc(), {
        type: "membership", amount: -amount, drivers: count,
        plan: fleet.billingPlan === "monthly" ? "monthly" : "per_driver",
        pricePerDriver: fleet.billingPlan === "monthly" ? null : price,
        driverIds: drivers.docs.map((d) => d.id),
        description: bill.description,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
    console.log(`Fleet ${doc.id} billed ${amount} for ${count}`);
    if (!(amount > 0)) return "nothing to bill";
    // Anything the wallet could not cover goes on the saved card; no
    // card or a declined card starts the grace period.
    const paid = await fleetBilling.chargeShortfall(doc.id)
        .catch((error) => `error: ${error.message}`);
    console.log(`Fleet ${doc.id} billing: ${paid}`);
    return paid;
  }

  /**
   * Bills a fleet now if it is due (a monthly fleet is billed at the start of
   * each month, so it is due the day it starts).
   * @param {string} fleetId Fleet.
   * @return {Promise<string>} What happened.
   */
  async function billIfDue(fleetId) {
    const doc = await db.collection("fleets").doc(fleetId).get();
    const next = doc.exists ? toMillis(doc.data().nextBillingDate) : 0;
    if (!next || next > Date.now()) return "not due";
    return billOne(doc, await loadAppConfig());
  }
  fleetBilling.billIfDue = billIfDue;

  /**
   * Drivers whose membership a per-driver fleet still pays (from before
   * per-driver fleets stopped paying) go back to paying their own.
   * @return {Promise<number>} How many moved.
   */
  async function ownMembershipsOnPerDriverFleets() {
    const snap = await db.collection("drivers")
        .where("subscription.paymentMethod", "==", "fleet").get();
    const fleets = {};
    const moved = [];
    for (const d of snap.docs) {
      const fleetId = d.data().fleetId;
      if (fleetId && !(fleetId in fleets)) {
        fleets[fleetId] = (await db.collection("fleets").doc(fleetId).get())
            .data() || null;
      }
      if (fleetId && fleetCovers(fleetTypeOf(d.data()), fleets[fleetId])) {
        continue;
      }
      const ok = await db.runTransaction(async (tx) => {
        const fresh = (await tx.get(d.ref)).data();
        if (!fresh || !fresh.subscription ||
            fresh.subscription.paymentMethod !== "fleet" ||
            fresh.fleetId !== fleetId) {
          return false;
        }
        tx.update(d.ref, ownMembershipFields(fresh).fields);
        return true;
      });
      if (ok) moved.push(d.id);
    }
    if (moved.length) {
      await sendPush(moved, {
        title: "Your TakeARoute membership is your own",
        body: "Your fleet no longer pays it. Check Membership in the app.",
        channelId: "general",
      }).catch(() => null);
    }
    console.log("ownMembershipsOnPerDriverFleets", moved.length);
    return moved.length;
  }

  out.billFleets = functions.runWith({secrets: STRIPE_SECRETS}).pubsub
      .schedule("every day 06:30").timeZone("Europe/London")
      .onRun(async () => {
        const cfg = await loadAppConfig();
        const due = await db.collection("fleets")
            .where("nextBillingDate", "<=", Timestamp.now()).get();
        for (const doc of due.docs) await billOne(doc, cfg);
        await ownMembershipsOnPerDriverFleets();
        return null;
      });

  /* A TakeARoute admin starts a fleet's billing now: this month is charged
     straight away (wallet, then card) and the next bill is a month on. */
  out.adminBillFleetNow = functions.runWith({secrets: STRIPE_SECRETS})
      .https.onCall(async (data, context) => {
        await assertAdmin(context);
        const fleetId = text(data && data.fleetId, 60);
        const ref = db.collection("fleets").doc(fleetId || "x");
        const snap = await ref.get();
        if (!fleetId || !snap.exists) {
          throw new HttpsError("not-found", "No such fleet.");
        }
        if (snap.data().status === "suspended") {
          throw new HttpsError("failed-precondition",
              "The fleet is paused. Lift the pause first.");
        }
        await ref.update({nextBillingDate: Timestamp.now()});
        const result = await billIfDue(fleetId);
        const fresh = (await ref.get()).data() || {};
        return {result, billingStatus: (fresh.billing || {}).status || "ok",
          owed: await fleetBilling.owedBy(fleetId)};
      });

  /* ---------------- driver balances, account clients, invoices ------- */

  const toPence = (v) => Math.round(Number(v || 0) * 100);
  const fareOf = (ride) => {
    const fare = ride.fare || {};
    return toPence(fare.finalTotal !== undefined && fare.finalTotal !== null ?
      fare.finalTotal : fare.total);
  };
  const fleetDoc = (fleetId) => db.collection("fleets").doc(fleetId);
  const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  /**
   * Which money rule a ride falls under, once it counts towards the driver's
   * balance. Card fares on the app only count once the fleet's wallet has
   * them, so a failed payment never shows as owed to the driver.
   * @param {Object} ride Ride document.
   * @return {?string} Kind of settlement, or null if it doesn't count yet.
   */
  function settlementKind(ride) {
    if (!ride.fleetId || !ride.driverId) return null;
    if (ride.source === "phone") {
      if (ride.status !== "completed") return null;
      // Paid online through TakeARoute: counts once the money is taken.
      if (ride.collectBy === "online") {
        return ride.webPayment && ride.webPayment.status === "captured" ?
          "online" : null;
      }
      return ride.collectBy === "account" ? "account" :
        ride.collectBy === "card" ? "card" : "cash";
    }
    if (ride.status === "completed") {
      if (ride.paymentMethod === "cash") return "appCash";
      return ride.walletProcessed && ride.earnings &&
        ride.earnings.paidTo === "fleet" ? "appCard" : null;
    }
    return ride.cancellationFeePaid &&
      Number(ride.cancellationFeeDriverShare) > 0 ? "cancelFee" : null;
  }

  /**
   * The amount a ride's settlement is worked out on.
   * @param {Object} ride Ride document.
   * @param {string} kind From settlementKind.
   * @return {number} Pence.
   */
  function settledPence(ride, kind) {
    // What actually reached the fleet's wallet, which never changes afterwards.
    if (kind === "appCard") return toPence(ride.earnings.driverEarning);
    if (kind === "cancelFee") return toPence(ride.cancellationFeeDriverShare);
    if (kind === "online") return toPence(ride.webPayment.capturedAmount);
    return fareOf(ride);
  }

  /**
   * What one finished job does to the driver's balance. Money the fleet holds
   * (account jobs, app card fares, cancellation fees) is owed on to the driver
   * less commission. Money the driver holds (cash, their own card terminal)
   * means the driver owes the fleet its commission.
   * @param {Object} ride Ride document.
   * @param {string} kind From settlementKind.
   * @param {number} percent Driver's commission percent.
   * @return {Object} Settlement to store on the ride.
   */
  function settlementOf(ride, kind, percent) {
    const farePence = settledPence(ride, kind);
    const commissionPence = Math.round(farePence * percent / 100);
    const fleetHoldsIt = ["account", "appCard", "cancelFee", "online"]
        .includes(kind);
    return {
      kind, farePence, commissionPercent: percent, commissionPence,
      balancePence: fleetHoldsIt ? farePence - commissionPence :
        -commissionPence,
    };
  }

  /* Locks the commission onto a finished job and moves the driver's balance.
     A fare that changes after completion (waiting time is added then) moves
     it by the difference, at the same locked rate. */
  out.settleFleetJob = functions.firestore
      .document("rides/{rideId}")
      .onUpdate(async (change) => {
        const seen = change.after.data();
        const kind = settlementKind(seen);
        if (!kind) return null;
        // Jobs finished before this existed stay out of the balance, even if
        // something on them changes later.
        if (!seen.settlement && settlementKind(change.before.data())) {
          return null;
        }
        if (seen.settlement &&
            seen.settlement.farePence === settledPence(seen, kind)) {
          return null;
        }
        const accountRef = fleetDoc(seen.fleetId).collection("driverAccounts")
            .doc(seen.driverId);
        await db.runTransaction(async (tx) => {
          const [rideSnap, accountSnap] = await Promise.all([
            tx.get(change.after.ref), tx.get(accountRef)]);
          const ride = rideSnap.data();
          const old = ride.settlement || null;
          const nowKind = settlementKind(ride);
          if (!nowKind ||
              (old && old.farePence === settledPence(ride, nowKind))) {
            return;
          }
          const percent = old ? old.commissionPercent :
            Number((accountSnap.exists && accountSnap.data()
                .commissionPercent) || 0);
          const next = settlementOf(ride, nowKind, percent);
          tx.update(change.after.ref, {settlement: Object.assign({}, next, {
            settledAt: FieldValue.serverTimestamp()})});
          tx.set(accountRef, {
            driverId: seen.driverId,
            owedPence: FieldValue.increment(
                next.balancePence - (old ? old.balancePence : 0)),
            updatedAt: FieldValue.serverTimestamp(),
          }, {merge: true});
        });
        return null;
      });

  /* The owner sets a driver's commission. It applies to jobs that complete
     from now on; finished jobs keep the rate they were settled at. */
  out.setFleetDriverCommission = functions.https.onCall(
      async (data, context) => {
        const me = await assertFleetManager(context, true);
        const driverId = text(data && data.driverId, 128);
        const percent = Number(data && data.percent);
        if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
          throw new HttpsError("invalid-argument",
              "Commission must be between 0 and 100 percent.");
        }
        const snap = driverId ?
          await db.collection("drivers").doc(driverId).get() : null;
        if (!snap || !snap.exists || snap.data().fleetId !== me.fleetId) {
          throw new HttpsError("not-found", "Not one of your drivers.");
        }
        await fleetDoc(me.fleetId).collection("driverAccounts").doc(driverId)
            .set({
              driverId,
              commissionPercent: Math.round(percent * 100) / 100,
              updatedAt: FieldValue.serverTimestamp(),
            }, {merge: true});
        return {percent};
      });

  /* The owner records money that moved outside TakeARoute: the fleet paid the
     driver, or the driver paid the fleet. To correct a mistake, record the
     same amount the other way. */
  out.recordFleetDriverPayment = functions.https.onCall(
      async (data, context) => {
        const me = await assertFleetManager(context, true);
        const d = data || {};
        const driverId = text(d.driverId, 128);
        const pence = toPence(d.amount);
        const direction = d.direction === "fromDriver" ?
          "fromDriver" : "toDriver";
        if (!(pence > 0) || pence > 10000000) {
          throw new HttpsError("invalid-argument", "Enter an amount above £0.");
        }
        const accountRef = fleetDoc(me.fleetId).collection("driverAccounts")
            .doc(driverId || "-");
        const [driver, account] = await Promise.all([
          driverId ? db.collection("drivers").doc(driverId).get() : null,
          accountRef.get()]);
        const inFleet = driver && driver.exists &&
          driver.data().fleetId === me.fleetId;
        // Someone who has left can still be paid what they are owed.
        if (!inFleet && !account.exists) {
          throw new HttpsError("not-found", "Not one of your drivers.");
        }
        const ref = fleetDoc(me.fleetId).collection("driverPayments").doc();
        const batch = db.batch();
        batch.set(ref, {
          driverId, direction, amountPence: pence, note: text(d.note, 200),
          recordedBy: {uid: me.uid, name: me.manager.name || ""},
          paidAt: FieldValue.serverTimestamp(),
        });
        batch.set(accountRef, {
          driverId,
          owedPence: FieldValue.increment(
              direction === "toDriver" ? -pence : pence),
          updatedAt: FieldValue.serverTimestamp(),
        }, {merge: true});
        await batch.commit();
        return {paymentId: ref.id};
      });

  /**
   * The fleet's details as printed on an invoice.
   * @param {Object} fleet Fleet document.
   * @return {Object} Name, address, phone, vatNumber, footer.
   */
  function invoiceFrom(fleet) {
    return {name: fleet.name || "", address: fleet.address || "",
      phone: fleet.phone || "", vatNumber: fleet.vatNumber || "",
      footer: fleet.invoiceFooter || ""};
  }

  /* Creates an invoice: jobs from an account, lines typed in, or both. Prices
     include any VAT, so a job's line is exactly its fare and the total never
     changes with the rate; the VAT within it is shown separately. */
  out.createFleetInvoice = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, false);
    const d = data || {};
    const rideIds = [...new Set((Array.isArray(d.rideIds) ? d.rideIds : [])
        .map((id) => text(id, 128)).filter(Boolean))];
    const typed = (Array.isArray(d.lines) ? d.lines : []).map((l) => {
      const quantity = Number(l && l.quantity);
      const unitPence = toPence(l && l.unitPrice);
      return {description: text(l && l.description, 200), quantity, unitPence,
        amountPence: Math.round(quantity * unitPence)};
    });
    if (typed.some((l) => !l.description || !(l.quantity > 0) ||
        l.quantity > 10000 || !l.unitPence ||
        Math.abs(l.amountPence) > 100000000)) {
      throw new HttpsError("invalid-argument",
          "Each line needs a description, a quantity and a price.");
    }
    if (rideIds.length + typed.length > MAX_INVOICE_LINES) {
      throw new HttpsError("invalid-argument",
          `An invoice can have up to ${MAX_INVOICE_LINES} lines.`);
    }
    const vatPercent = Number(d.vatPercent || 0);
    if (!Number.isFinite(vatPercent) || vatPercent < 0 || vatPercent > 100) {
      throw new HttpsError("invalid-argument",
          "VAT must be between 0 and 100 percent.");
    }
    const dueDays = Math.min(365, Math.max(0, Math.round(
        Number(d.dueDays === undefined ? 30 : d.dueDays) || 0)));
    const accountId = text(d.accountId, 128) || null;
    if (rideIds.length && !accountId) {
      throw new HttpsError("invalid-argument",
          "Jobs can only go on an invoice to their own account.");
    }

    let billTo;
    if (accountId) {
      const snap = await fleetDoc(me.fleetId).collection("accounts")
          .doc(accountId).get();
      if (!snap.exists) throw new HttpsError("not-found", "Account not found.");
      const a = snap.data();
      billTo = {company: a.company || "", address: a.address || "",
        telephone: a.telephone || "", email: a.email || ""};
    } else {
      const b = d.billTo || {};
      billTo = {company: text(b.company, 120), address: text(b.address, 300),
        telephone: text(b.telephone, 30), email: text(b.email, 200)};
      if (!billTo.company) {
        throw new HttpsError("invalid-argument",
            "Enter who the invoice is for.");
      }
      if (billTo.email && !validEmail(billTo.email)) {
        throw new HttpsError("invalid-argument",
            "That email address does not look right.");
      }
    }

    const fleetRef = fleetDoc(me.fleetId);
    const invoiceRef = fleetRef.collection("invoices").doc();
    const number = await db.runTransaction(async (tx) => {
      const refs = rideIds.map((id) => db.collection("rides").doc(id));
      const [fleetSnap, ...rides] = await Promise.all([
        tx.get(fleetRef), ...refs.map((r) => tx.get(r))]);
      const jobLines = rides.map((snap) => {
        const r = snap.exists ? snap.data() : null;
        if (!r || r.fleetId !== me.fleetId || r.status !== "completed" ||
            !r.account || r.account.id !== accountId) {
          throw new HttpsError("failed-precondition",
              "One of those jobs is not a finished job on this account.");
        }
        if (r.invoiceId) {
          throw new HttpsError("failed-precondition",
              "One of those jobs is already on an invoice.");
        }
        const place = (p) => ((p && p.address) || "").split(",")[0];
        const at = r.completedAt || (r.timestamps || {}).completedAt ||
          (r.timestamps || {}).createdAt;
        const when = at && at.toDate ? at.toDate().toLocaleDateString("en-GB", {
          day: "numeric", month: "short", timeZone: "Europe/London"}) : "";
        const who = (r.customer || {}).name;
        const amountPence = fareOf(r);
        return {
          description: [when, `${place(r.pickupLocation)} to ` +
            place(r.dropoffLocation), who ? `(${who})` : ""]
              .filter(Boolean).join(" "),
          quantity: 1, unitPence: amountPence, amountPence, rideId: snap.id,
        };
      });
      const lines = jobLines.concat(typed);
      const totalPence = lines.reduce((sum, l) => sum + l.amountPence, 0);
      if (!lines.length || !(totalPence > 0)) {
        throw new HttpsError("invalid-argument",
            "Add at least one job or line, with a total above £0.");
      }
      const seq = Number(fleetSnap.data().invoiceSeq || 0) + 1;
      const invoiceNumber = `INV-${String(seq).padStart(4, "0")}`;
      const now = Date.now();
      tx.update(fleetRef, {invoiceSeq: seq});
      tx.set(invoiceRef, {
        number: invoiceNumber, accountId, billTo, from: invoiceFrom(me.fleet),
        lines, rideIds, totalPence, vatPercent,
        vatPence: Math.round(totalPence * vatPercent / (100 + vatPercent)),
        currency: me.fleet.currency || "GBP", notes: text(d.notes, 1000),
        status: "unpaid", issuedAt: Timestamp.fromMillis(now),
        dueAt: Timestamp.fromMillis(now + dueDays * 24 * 3600 * 1000),
        sentAt: null, sentTo: null, paidAt: null,
        createdBy: {uid: me.uid, name: me.manager.name || ""},
      });
      refs.forEach((r) => tx.update(r, {invoiceId: invoiceRef.id,
        invoiceNumber}));
      return invoiceNumber;
    });
    return {invoiceId: invoiceRef.id, number};
  });

  /**
   * Sends one email through Resend, with replies going to the fleet.
   * @param {Object} fleet Fleet document.
   * @param {string} to Recipient.
   * @param {Object} mail {subject, html, text}.
   * @return {Promise<void>}
   */
  async function sendFleetEmail(fleet, to, mail) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new HttpsError("failed-precondition",
          "Email is not set up. Please contact TakeARoute.");
    }
    const name = String(fleet.name || "TakeARoute").replace(/[<>"\r\n]/g, "");
    const response = await fetch(
        process.env.RESEND_API_URL || "https://api.resend.com/emails", {
          method: "POST",
          headers: {"Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"},
          body: JSON.stringify(Object.assign({
            from: `${name} <invoices@invoice.takearoute.ltd>`,
            to: [to], subject: mail.subject, html: mail.html, text: mail.text,
          }, fleet.ownerEmail ? {reply_to: fleet.ownerEmail} : {})),
        });
    if (!response.ok) {
      console.error("Invoice email failed:", response.status,
          (await response.text()).slice(0, 300));
      throw new HttpsError("internal",
          "The email could not be sent. Try again.");
    }
  }

  const asDate = (t) => (t && t.toDate ? t.toDate() : null);

  /* Emails an invoice to the address on file. */
  out.sendFleetInvoice = functions.runWith({secrets: EMAIL_SECRETS}).https
      .onCall(async (data, context) => {
        const me = await assertFleetManager(context, false);
        const ref = fleetDoc(me.fleetId).collection("invoices")
            .doc(text(data && data.invoiceId, 128) || "-");
        const snap = await ref.get();
        if (!snap.exists) {
          throw new HttpsError("not-found", "Invoice not found.");
        }
        const invoice = snap.data();
        if (invoice.status === "void") {
          throw new HttpsError("failed-precondition",
              "This invoice has been cancelled.");
        }
        // Use the account's current email, in case it changed since.
        let to = (invoice.billTo || {}).email || "";
        if (invoice.accountId) {
          const account = await fleetDoc(me.fleetId).collection("accounts")
              .doc(invoice.accountId).get();
          if (account.exists && account.data().email) {
            to = account.data().email;
          }
        }
        if (!validEmail(to)) {
          throw new HttpsError("failed-precondition",
              "There is no email address on file for this client.");
        }
        await sendFleetEmail(me.fleet, to, invoiceEmail(Object.assign({},
            invoice, {issuedAt: asDate(invoice.issuedAt),
              dueAt: asDate(invoice.dueAt)})));
        await ref.update({sentAt: FieldValue.serverTimestamp(), sentTo: to});
        return {sentTo: to};
      });

  /* Emails an account client the total they owe: unpaid invoices, plus
     finished jobs not on an invoice yet. */
  out.emailFleetAccountBalance = functions.runWith({secrets: EMAIL_SECRETS})
      .https.onCall(async (data, context) => {
        const me = await assertFleetManager(context, false);
        const accountId = text(data && data.accountId, 128);
        const snap = accountId ? await fleetDoc(me.fleetId)
            .collection("accounts").doc(accountId).get() : null;
        if (!snap || !snap.exists) {
          throw new HttpsError("not-found", "Account not found.");
        }
        const account = snap.data();
        if (!validEmail(account.email || "")) {
          throw new HttpsError("failed-precondition",
              "There is no email address on file for this client.");
        }
        const [invoices, rides] = await Promise.all([
          fleetDoc(me.fleetId).collection("invoices")
              .where("accountId", "==", accountId)
              .where("status", "==", "unpaid").get(),
          db.collection("rides").where("fleetId", "==", me.fleetId)
              .where("account.id", "==", accountId)
              .where("status", "==", "completed").get(),
        ]);
        const jobs = rides.docs.map((r) => r.data())
            .filter((r) => !r.invoiceId);
        const owed = {
          invoices: invoices.docs.map((i) => ({number: i.data().number,
            dueAt: asDate(i.data().dueAt), totalPence: i.data().totalPence})),
          jobs: jobs.length,
          jobsPence: jobs.reduce((sum, r) => sum + fareOf(r), 0),
        };
        const total = owed.invoices.reduce((sum, i) => sum + i.totalPence, 0) +
          owed.jobsPence;
        if (!(total > 0)) {
          throw new HttpsError("failed-precondition",
              "This account owes nothing at the moment.");
        }
        await sendFleetEmail(me.fleet, account.email,
            balanceEmail(invoiceFrom(me.fleet), account, owed));
        return {sentTo: account.email, totalPence: total};
      });

  /* The owner marks an invoice paid or unpaid, or cancels it. Cancelling
     frees its jobs, so they can go on a new invoice. */
  out.setFleetInvoiceStatus = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, true);
    const status = data && data.status;
    if (!["paid", "unpaid", "void"].includes(status)) {
      throw new HttpsError("invalid-argument", "Unknown status.");
    }
    const ref = fleetDoc(me.fleetId).collection("invoices")
        .doc(text(data && data.invoiceId, 128) || "-");
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError("not-found", "Invoice not found.");
      const invoice = snap.data();
      if (invoice.status === "void") {
        throw new HttpsError("failed-precondition",
            "This invoice has been cancelled.");
      }
      tx.update(ref, {status, paidAt: status === "paid" ?
        FieldValue.serverTimestamp() : null});
      if (status === "void") {
        (invoice.rideIds || []).forEach((id) => {
          tx.update(db.collection("rides").doc(id), {
            invoiceId: FieldValue.delete(),
            invoiceNumber: FieldValue.delete(),
          });
        });
      }
    });
    return {status};
  });

  /* ------------------------- closing a fleet --------------------------
     A TakeARoute admin closes a fleet for good (there is no way back). Not
     while it has jobs open or money in its wallet. Drivers come out as if
     removed one by one (company drivers suspended, self-employed carry on),
     its phone line ends, and its staff logins go, which frees their emails
     and numbers; a login that is also a driver, passenger or admin keeps
     its sign-in. Customers, trips, invoices and payments all stay. The
     fleet stays "suspended", which every booking route already refuses, and
     closedAt marks it. Safe to press again if it stops part way. */
  const lineTools = {};
  const OPEN_JOBS = ["scheduled", "dispatching", "accepted", "arrived",
    "ongoing"];

  out.adminCloseFleet = functions
      .runWith({secrets: TWILIO_SECRETS, timeoutSeconds: 300})
      .https.onCall(async (data, context) => {
        await assertAdmin(context);
        const d = data || {};
        const fleetId = text(d.fleetId, 128);
        const fleetRef = db.collection("fleets").doc(fleetId || "-");
        const snap = await fleetRef.get();
        if (!snap.exists) throw new HttpsError("not-found", "No such fleet.");
        const fleet = snap.data();
        if (fleet.closedAt) {
          throw new HttpsError("already-exists", "This fleet is closed.");
        }
        if (text(d.confirmName, 200) !== fleet.name) {
          throw new HttpsError("invalid-argument",
              "Type the fleet's name exactly to close it.");
        }
        const wallet = await db.collection("fleetWallets").doc(fleetId).get();
        const balance = wallet.exists ?
          Number(wallet.data().availableBalance) || 0 : 0;
        if (balance > 0) {
          throw new HttpsError("failed-precondition",
              `This fleet still has ${balance.toFixed(2)} in its wallet. ` +
              "Pay it out first.");
        }
        const openJobs = async () => (await db.collection("rides")
            .where("fleetId", "==", fleetId)
            .where("status", "in", OPEN_JOBS).get()).size;
        const refuseOpen = (n) => new HttpsError("failed-precondition",
            `This fleet has ${n} job${n === 1 ? "" : "s"} still open. ` +
            "Finish or cancel them first.");
        const open = await openJobs();
        if (open) throw refuseOpen(open);

        // Paused first, so nothing new can be booked while it closes.
        const by = `${context.auth.token.email || "an admin"} (TakeARoute)`;
        await fleetRef.update({status: "suspended", suspendedReason: "closed",
          closing: true});
        const late = await openJobs();
        if (late) {
          await fleetRef.update({status: fleet.status || "active",
            suspendedReason: fleet.suspendedReason || FieldValue.delete(),
            closing: FieldValue.delete()});
          throw refuseOpen(late);
        }

        const drivers = await db.collection("drivers")
            .where("fleetId", "==", fleetId).get();
        let stuck = 0;
        for (const doc of drivers.docs) {
          await takeOutOfFleet(doc.id, () => null, by, {closing: true})
              .catch((error) => {
                stuck += 1;
                console.error("closeFleet driver", doc.id, error.message);
              });
        }
        if (stuck) {
          throw new HttpsError("aborted", `${stuck} driver` +
            `${stuck === 1 ? "" : "s"} could not be taken out. ` +
            "Press Close fleet again.");
        }
        const asking = await db.collection("drivers")
            .where("fleetRequest.fleetId", "==", fleetId).get();
        await Promise.all(asking.docs.map((doc) => doc.ref.update({
          fleetRequest: FieldValue.delete()})));

        if (fleet.phoneLine && fleet.phoneLine.number) {
          await lineTools.release(fleetRef, fleet.phoneLine);
        }

        const staff = await db.collection("fleetManagers")
            .where("fleetId", "==", fleetId).get();
        const closedStaff = [];
        for (const doc of staff.docs) {
          const m = doc.data();
          closedStaff.push({uid: doc.id, name: m.name || "",
            email: m.email || "", role: m.role || ""});
          const others = await Promise.all(["drivers", "riders", "admins"]
              .map((c) => db.collection(c).doc(doc.id).get()));
          await doc.ref.delete();
          if (!others.some((o) => o.exists)) {
            await admin.auth().deleteUser(doc.id).catch((error) => {
              if (error.code !== "auth/user-not-found") throw error;
            });
          }
        }
        await db.collection("fleetQueues").doc(fleetId).delete();
        const previously = fleet.closedStaff || [];
        await fleetRef.update({closedAt: FieldValue.serverTimestamp(),
          closedBy: by, closing: FieldValue.delete(),
          closedStaff: previously.concat(closedStaff)});
        return {ok: true, drivers: drivers.size, logins: closedStaff.length};
      });

  /* The fleet office phone (fleetPhone.js). */
  Object.assign(out, require("./fleetPhone")({functions, db, toE164,
    TWILIO_SECRETS, twilioConfig, assertFleetManager, assertAdmin, lineTools,
    findRiderByPhone, findDriversByPhone, phoneFor, text, FieldValue,
    stripe: deps.stripe, STRIPE_SECRETS,
    settleEndedEarly: deps.settleDriverEndedEarly,
    booking: {bookPhoneJob, quoteOne, quoteTypes, placeSearch, placeDetails,
      placeFromText, point, CLASS_MULTIPLIERS}}));

  /* Tickets and Lost & Found (fleetSupport.js). */
  Object.assign(out, require("./fleetSupport")({functions, db, FieldValue,
    text, toE164, assertFleetManager, sendPush}));

  return out;
};
