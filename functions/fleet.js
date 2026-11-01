/* ======================================
   FLEETS AND PHONE BOOKINGS
   A fleet is a taxi firm that runs its own drivers on TakeARoute.

   - The TakeARoute admin creates a fleet and its owner login (createFleet).
   - Drivers join with the fleet's join code (requestFleetJoin) and the fleet
     approves them, or the fleet invites a driver by phone number and the
     driver accepts in the app. TakeARoute still checks every driver's
     documents as usual (drivers/{id}.approved).
   - While in a fleet, a driver's card earnings go to the fleet's wallet
     (fleetWallets/{fleetId}), not their own, and they cannot withdraw. The
     fleet pays a monthly membership per driver instead of the driver
     (billFleets), and admins pay fleets by bank and record it
     (recordFleetPayout).
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
                  that is null; a driver who declines is added to declinedBy
     accepted / arrived / ongoing / completed / cancelled   as app jobs

   Collections:
     fleets/{fleetId}                 name, joinCode, status, contact, price
     fleets/{fleetId}/customers/{e164}  phone booking history
     fleetManagers/{uid}              fleetId, role owner|operator, isActive
     fleetWallets/{fleetId}           availableBalance, totalEarned, ...
       /transactions/{id}             ride_earning, membership, payout
     fleetInvites/{e164}              a driver invited by phone number
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

module.exports = (deps) => {
  const {functions, admin, db, sendPush, loadAppConfig, distanceKm, canServe,
    hasExpiredDocument, toE164, toMillis, addOneMonth} = deps;
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
    return d.fleetId === ride.fleetId && d.approved === true &&
      d.blocked !== true && !hasExpiredDocument(d) &&
      d.restDue !== true && canServe(d.vehicleType, ride.rideType);
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
   * Upserts a phone customer and remembers the addresses they used.
   * @param {string} fleetId Fleet.
   * @param {Object} customer {name, phone}
   * @param {Array} places Points used on this booking.
   * @return {Promise<void>}
   */
  async function rememberCustomer(fleetId, customer, places) {
    const ref = db.collection("fleets").doc(fleetId)
        .collection("customers").doc(customer.phone);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const old = snap.exists ? snap.data() : {};
      const seen = new Set();
      const addresses = places.concat(old.addresses || [])
          .filter((p) => {
            const key = String(p.address).toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, 10)
          .map((p) => ({latitude: p.latitude, longitude: p.longitude,
            address: p.address}));
      tx.set(ref, {
        phone: customer.phone,
        name: customer.name || old.name || "",
        addresses,
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
   * Puts a driver into a fleet: earnings and membership move to the fleet.
   * @param {Object} tx Transaction.
   * @param {Object} driverRef Driver document.
   * @param {Object} driver Driver data.
   * @param {string} fleetId Fleet id.
   * @param {Object} fleet Fleet data.
   */
  function joinInTx(tx, driverRef, driver, fleetId, fleet) {
    const sub = driver.subscription || null;
    tx.update(driverRef, {
      fleetId,
      fleetName: fleet.name,
      fleetJoinedAt: FieldValue.serverTimestamp(),
      fleetRequest: FieldValue.delete(),
      fleetInvite: FieldValue.delete(),
      // The fleet pays the membership. Kept as "active" so every build of
      // the app lets the driver go online; renewals skip anything that is
      // not wallet_deduction.
      subscriptionBeforeFleet: sub && sub.paymentMethod !== "fleet" ?
        sub : (driver.subscriptionBeforeFleet || null),
      subscription: {status: "active", paymentMethod: "fleet", fleetId,
        fleetName: fleet.name},
    });
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
          "Ask them to remove you first.");
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
      joinInTx(tx, driverRef, driver, invite.fleetId, fleetSnap.data());
      if (inviteRef) tx.delete(inviteRef);
      return {joined: true, fleetName: fleetSnap.data().name};
    });
    return result;
  });

  /* The fleet approves or turns down a driver who asked to join. */
  out.decideFleetDriver = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, false);
    const driverId = text(data && data.driverId, 128);
    const approve = data && data.approve === true;
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
      joinInTx(tx, driverRef, driver, me.fleetId, me.fleet);
    });
    await sendPush([driverId], {
      title: approve ? `You joined ${me.fleet.name}` : "Fleet request declined",
      body: approve ?
        "Your fleet now receives your card earnings and pays your membership." :
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
          fleetName: i.fleetName, invitedAt: i.invitedAt,
          invitedBy: i.invitedBy || null}});
        return null;
      });

  /* The fleet lets a driver go: they become an independent driver again
     and pay their own membership from now on. */
  out.removeFleetDriver = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, false);
    const driverId = text(data && data.driverId, 128);
    const driverRef = db.collection("drivers").doc(driverId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(driverRef);
      const driver = snap.exists ? snap.data() : null;
      if (!driver || driver.fleetId !== me.fleetId) {
        throw new HttpsError("not-found", "Not one of your drivers.");
      }
      tx.update(driverRef, {
        fleetId: null,
        fleetName: null,
        fleetLeftAt: FieldValue.serverTimestamp(),
        lastFleetId: me.fleetId,
        // No membership until they activate their own (Membership screen).
        subscription: {status: "inactive", paymentMethod: "wallet_deduction",
          endedFleetAt: Timestamp.now()},
      });
    });
    await sendPush([driverId], {
      title: `You left ${me.fleet.name}`,
      body: "You now drive independently. Activate your membership in " +
        "the app to keep going online.",
      channelId: "general",
    }).catch(() => null);
    return {ok: true};
  });

  /* --------------------------- phone bookings ------------------------ */

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

    const rideRef = db.collection("rides").doc();
    const ts = FieldValue.serverTimestamp();
    await rideRef.set({
      source: "phone",
      fleetId: me.fleetId,
      fleetName: me.fleet.name,
      riderId: null,
      driverId: null,
      customer: {name, phone},
      notes: text(d.notes, 500),
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
      payment: {method: "cash", status: "pending", transactionId: null},
      pickupAt: pickupAtMs === null ? null : Timestamp.fromMillis(pickupAtMs),
      dispatchAt: Timestamp.fromMillis(dispatchAtMs),
      dispatch: {
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

    await rememberCustomer(me.fleetId, {name, phone},
        [pickup].concat(stops, [dropoff])).catch((error) => {
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
        "dispatch.driverId": driverId,
        "dispatch.offeredAt": FieldValue.serverTimestamp(),
        "dispatch.rounds": FieldValue.increment(1),
        "dispatch.returnedBy": FieldValue.delete(),
        // Sending to the whole fleet again: anyone who said no before is
        // asked again, since the operator chose to resend.
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
        const fleetId = snap.exists ? snap.data().fleetId || null : null;
        if ((after.fleetId || null) === fleetId) return null;
        await change.after.ref.update({
          fleetId,
          fleetName: fleetId ? snap.data().fleetName || null : null,
        });
        return null;
      });

  /* Daily: each fleet's monthly membership, for every driver in the fleet
     on its billing date, taken from the fleet's wallet. The wallet may go
     below zero; the admin settles that with the fleet. */
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
          const drivers = await db.collection("drivers")
              .where("fleetId", "==", doc.id).get();
          const count = drivers.size;
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
