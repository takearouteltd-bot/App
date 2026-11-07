/* ======================================
   WEB BOOKER AND TRACKING
   Each fleet can switch on its own booking page (fleets/{id}.webBooking,
   saved by the owner): admin.takearoute.ltd/b/{slug}, linked or embedded
   on the firm's own website.

   - The customer proves their UK mobile with a texted code; a session
     token (webSessions/{token}, 90 days) then lets that phone search
     addresses, see fares and book. Code sends are capped per phone, per
     IP and per fleet per day, so nobody can run up the text bill.
   - The booking is a normal phone job (source "phone", channel "web",
     bookedBy.via "web"), so dispatch, queues, commission and the office
     screens all work as for an operator's booking.
   - Pay the driver (cash, as phone jobs), or pay online by card when the
     fleet allows it: Stripe Checkout on TakeARoute's account puts a hold on
     the card (manual capture), the job is only sent to drivers once the
     hold is in place, the fare is taken when the trip completes and
     credited to the fleet's wallet (paid out with its other card fares),
     and the hold is released if the job is cancelled.
   - Tracking: every web booking has a tracking page /t/{token}, texted to
     the customer, with the driver, car and position once accepted. Texts
     go out at booking, when a driver accepts, when they arrive and if the
     job is cancelled.

   webBookers/{slug}        fleetId (server only)
   webCodes/{phone}         codeHash, expiresAt, tries, sends[] (server only)
   webLimits/{key}          count per hour or day (server only)
   webSessions/{token}      fleetId, phone, expiresAt, lookups (server only)
   rides/{id}               channel "web", trackToken, webPayment {sessionId,
                            intentId, status pending|authorised|captured|
                            released|failed, amount, capturedAmount}
   fleets/{id}/customers/{phone}.webRides   latest web booking ids
   ====================================== */

const crypto = require("crypto");

const BASE = process.env.WEB_BOOKER_BASE || "https://admin.takearoute.ltd";
const CODE_MINUTES = 10;
const CODE_TRIES = 5;
const CODES_PER_PHONE_HOUR = 3;
const CODES_PER_IP_HOUR = 10;
const CODES_PER_FLEET_DAY = 300;
const SESSION_DAYS = 90;
const LOOKUPS_PER_DAY = 200;
const OPEN_BOOKINGS = 3;
// A card hold lasts 7 days, so card bookings are for the next 5.
const CARD_DAYS_AHEAD = 5;
const PAY_MINUTES = 30;
const ALL_TYPES = ["RouteMini", "RoutePlus", "RouteXL", "RouteEco",
  "RouteExecutive"];
const TYPE_INFO = {
  RouteMini: {label: "Standard", seats: 4},
  RoutePlus: {label: "Plus", seats: 4},
  RouteXL: {label: "Large (6 seats)", seats: 6},
  RouteEco: {label: "Eco", seats: 4},
  RouteExecutive: {label: "Executive", seats: 4},
};
const LIVE = ["payment_pending", "scheduled", "dispatching", "accepted",
  "arrived", "ongoing"];

module.exports = (deps) => {
  const {functions, db, FieldValue, text, toE164, booking, sendText,
    customerCard, assertFleetManager, TWILIO_SECRETS, stripe,
    STRIPE_SECRETS} = deps;
  // Numbers the fleet has blocked can't book online either (fleetPhone.js).
  const isBlocked = deps.isBlocked || (async () => false);
  const BLOCKED_TEXT = "Sorry, we can't take online bookings from this " +
    "number. Please call us.";
  const {HttpsError} = functions.https;
  const {Timestamp} = require("firebase-admin/firestore");
  const out = {};
  const SECRETS = TWILIO_SECRETS.concat(STRIPE_SECRETS || []);

  /* ------------------------------ helpers ---------------------------- */

  const sha = (s) => crypto.createHash("sha256").update(String(s))
      .digest("hex");
  const token = (n) => crypto.randomBytes(n).toString("base64url");
  const money = (n) => `£${Number(n || 0).toFixed(2)}`;
  const isUkMobile = (p) => /^\+447\d{9}$/.test(String(p || ""));
  const hourKey = () => new Date().toISOString().slice(0, 13);
  const dayKey = () => new Date().toISOString().slice(0, 10);

  /**
   * A page address from a fleet name: "A2B Taxis" -> "a2b-taxis".
   * @param {string} raw Name or address.
   * @return {string} Slug.
   */
  function slugOf(raw) {
    return String(raw || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "").slice(0, 40);
  }

  /**
   * The fleet's web booker settings with defaults.
   * @param {Object} fleet Fleet data.
   * @return {Object} {enabled, slug, payDriver, payOnline, types}
   */
  function settingsOf(fleet) {
    const w = (fleet && fleet.webBooking) || {};
    const types = Array.isArray(w.types) ?
      w.types.filter((t) => ALL_TYPES.includes(t)) : [];
    return {
      enabled: w.enabled === true,
      slug: w.slug || "",
      payDriver: w.payDriver !== false,
      payOnline: w.payOnline === true,
      types: types.length ? types : ["RouteMini", "RouteXL"],
    };
  }

  /**
   * The fleet behind a booking page, if it is switched on.
   * @param {*} slug From the page address.
   * @return {Promise<Object>} {fleetId, fleet, settings}
   */
  async function fleetBySlug(slug) {
    const s = slugOf(slug);
    const map = s ? await db.collection("webBookers").doc(s).get() : null;
    const fleetId = map && map.exists ? map.data().fleetId : null;
    const snap = fleetId ?
      await db.collection("fleets").doc(fleetId).get() : null;
    const fleet = snap && snap.exists ? snap.data() : null;
    const settings = settingsOf(fleet);
    if (!fleet || !settings.enabled || settings.slug !== s) {
      throw new HttpsError("not-found",
          "This booking page is not available.");
    }
    if (fleet.status === "suspended" || fleet.status === "paused") {
      throw new HttpsError("failed-precondition",
          "Online booking is closed at the moment. Please call us.");
    }
    return {fleetId, fleet, settings};
  }

  /**
   * A signed-in customer's session, checked against the page's fleet.
   * @param {*} t Session token.
   * @param {boolean=} lookup Counts as an address or fare lookup.
   * @return {Promise<Object>} {ref, session, fleetId, fleet, settings}
   */
  async function sessionFor(t, lookup) {
    const tk = typeof t === "string" && /^[A-Za-z0-9_-]{32}$/.test(t) ? t : "";
    const ref = tk ? db.collection("webSessions").doc(tk) : null;
    const snap = ref ? await ref.get() : null;
    const session = snap && snap.exists ? snap.data() : null;
    if (!session || Date.now() > Number(session.expiresAt || 0)) {
      throw new HttpsError("unauthenticated",
          "Please confirm your mobile number again.");
    }
    const fleetSnap = await db.collection("fleets").doc(session.fleetId).get();
    const fleet = fleetSnap.exists ? fleetSnap.data() : null;
    const settings = settingsOf(fleet);
    if (!fleet || !settings.enabled) {
      throw new HttpsError("not-found",
          "This booking page is not available.");
    }
    if (lookup) {
      const n = await db.runTransaction(async (tx) => {
        const s = (await tx.get(ref)).data() || {};
        const used = s.lookupDay === dayKey() ? Number(s.lookups || 0) + 1 : 1;
        tx.update(ref, {lookupDay: dayKey(), lookups: used});
        return used;
      });
      if (n > LOOKUPS_PER_DAY) {
        throw new HttpsError("resource-exhausted",
            "Too many searches today. Please call us to book.");
      }
    }
    return {ref, session, fleetId: session.fleetId, fleet, settings};
  }

  /**
   * Adds one to a counter and says whether it is now over the limit.
   * @param {string} key webLimits doc id.
   * @param {number} max Limit.
   * @return {Promise<boolean>} Over.
   */
  async function overLimit(key, max) {
    const ref = db.collection("webLimits").doc(key.slice(0, 200));
    const n = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const used = (snap.exists ? Number(snap.data().count || 0) : 0) + 1;
      tx.set(ref, {count: used, at: Date.now()});
      return used;
    });
    return n > max;
  }

  /**
   * The words for when a booking is for.
   * @param {?number} ms Pickup time, or null for as soon as possible.
   * @return {string} "as soon as possible" or "Sat 8 Nov at 18:30".
   */
  function whenText(ms) {
    if (!ms) return "as soon as possible";
    return new Intl.DateTimeFormat("en-GB", {timeZone: "Europe/London",
      weekday: "short", day: "numeric", month: "short", hour: "2-digit",
      minute: "2-digit", hour12: false}).format(new Date(ms))
        .replace(",", "").replace(/ (\d\d:\d\d)$/, " at $1");
  }

  /**
   * First part of an address, for a text.
   * @param {Object} p Point.
   * @return {string} "12 Station Road".
   */
  const short = (p) => String((p && p.address) || "").split(",")[0]
      .slice(0, 40);
  const trackUrl = (ride) => `${BASE}/t/${ride.trackToken}`;
  const msOf = (ts) => ts && typeof ts.toMillis === "function" ?
    ts.toMillis() : (ts ? Number(ts) : null);

  /**
   * Texts the customer about their web booking. Never throws.
   * @param {Object} ride Ride data.
   * @param {string} body Message (the tracking link is added).
   * @return {Promise<boolean>} Sent.
   */
  async function textCustomer(ride, body) {
    const phone = ride.customer && ride.customer.phone;
    if (!isUkMobile(phone)) return false;
    const fleetSnap = await db.collection("fleets").doc(ride.fleetId).get()
        .catch(() => null);
    const fleet = fleetSnap && fleetSnap.exists ? fleetSnap.data() :
      {name: ride.fleetName};
    return sendText(fleet, phone, `${fleet.name || "Your taxi"}: ${body}`)
        .catch(() => false);
  }

  /**
   * The text sent when a web booking is confirmed.
   * @param {Object} ride Ride data.
   * @return {string} Message.
   */
  function bookedText(ride) {
    const paid = ride.collectBy === "online" ?
      ` Paid by card: ${money(ride.fare && ride.fare.total)}.` :
      ` Fare about ${money(ride.fare && ride.fare.total)}, ` +
        "paid to the driver.";
    return `taxi booked, ${whenText(msOf(ride.pickupAt))} from ` +
      `${short(ride.pickupLocation)}.${paid} Track or cancel: ` +
      `${trackUrl(ride)}`;
  }

  /* --------------------------- owner settings ------------------------ */

  /* The owner switches the page on and chooses its address, how customers
     pay and which cars they can book. */
  out.saveFleetWebBooking = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, true);
    const d = data || {};
    const old = settingsOf(me.fleet);
    const slug = slugOf(d.slug || old.slug || me.fleet.name);
    if (slug.length < 3) {
      throw new HttpsError("invalid-argument",
          "Choose a page address of at least 3 letters or numbers.");
    }
    const types = (Array.isArray(d.types) ? d.types : old.types)
        .filter((t) => ALL_TYPES.includes(t));
    if (!types.length) {
      throw new HttpsError("invalid-argument",
          "Choose at least one type of car customers can book.");
    }
    const payDriver = d.payDriver !== undefined ? d.payDriver === true :
      old.payDriver;
    const payOnline = d.payOnline !== undefined ? d.payOnline === true :
      old.payOnline;
    if (!payDriver && !payOnline) {
      throw new HttpsError("invalid-argument",
          "Customers need at least one way to pay.");
    }
    const ref = db.collection("webBookers").doc(slug);
    await db.runTransaction(async (tx) => {
      const taken = await tx.get(ref);
      if (taken.exists && taken.data().fleetId !== me.fleetId) {
        throw new HttpsError("already-exists",
            "Another taxi firm already uses that page address. " +
            "Try another.");
      }
      if (old.slug && old.slug !== slug) {
        tx.delete(db.collection("webBookers").doc(old.slug));
      }
      tx.set(ref, {fleetId: me.fleetId, at: Date.now()});
      tx.update(db.collection("fleets").doc(me.fleetId), {webBooking: {
        enabled: d.enabled !== undefined ? d.enabled === true : old.enabled,
        slug, payDriver, payOnline, types,
        updatedAt: Date.now(), updatedBy: me.uid}});
    });
    return {ok: true, slug, url: `${BASE}/b/${slug}`};
  });

  /* ---------------------------- public page -------------------------- */

  /* What the booking page shows before sign-in. */
  out.webBookerInfo = functions.https.onCall(async (data) => {
    const {fleet, settings} = await fleetBySlug(data && data.slug);
    return {
      fleetName: fleet.name || "",
      phone: fleet.officePhone || fleet.phone || "",
      payDriver: settings.payDriver,
      payOnline: settings.payOnline,
      cardDaysAhead: CARD_DAYS_AHEAD,
      types: settings.types.map((t) => Object.assign({id: t}, TYPE_INFO[t])),
    };
  });

  /* Texts a sign-in code to a UK mobile. */
  out.webSendCode = functions.runWith({secrets: TWILIO_SECRETS}).https
      .onCall(async (data, context) => {
        const {fleetId, fleet} = await fleetBySlug(data && data.slug);
        const phone = toE164(data && data.phone);
        if (!isUkMobile(phone)) {
          throw new HttpsError("invalid-argument",
              "Enter a UK mobile number, for example 07700 900123.");
        }
        if (await isBlocked(fleetId, fleet, phone)) {
          throw new HttpsError("permission-denied", BLOCKED_TEXT);
        }
        const req = context.rawRequest || {};
        const ip = String((req.headers && req.headers["x-forwarded-for"]) ||
          req.ip || "").split(",")[0].trim();
        if (await overLimit(`ip_${sha(ip).slice(0, 24)}_${hourKey()}`,
            CODES_PER_IP_HOUR) ||
            await overLimit(`fleet_${fleetId}_${dayKey()}`,
                CODES_PER_FLEET_DAY)) {
          throw new HttpsError("resource-exhausted",
              "Too many codes requested. Please try again later or call us.");
        }
        const ref = db.collection("webCodes").doc(phone);
        const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          const sends = ((snap.exists && snap.data().sends) || [])
              .filter((t) => t > Date.now() - 3600 * 1000);
          if (sends.length >= CODES_PER_PHONE_HOUR) {
            throw new HttpsError("resource-exhausted",
                "We've sent a few codes already. Please wait a while and " +
                "try again.");
          }
          tx.set(ref, {codeHash: sha(`${phone}:${code}`), fleetId,
            expiresAt: Date.now() + CODE_MINUTES * 60 * 1000, tries: 0,
            sends: sends.concat(Date.now())});
        });
        const sent = await sendText(fleet, phone, `Your ${fleet.name || ""} ` +
          `booking code is ${code}. It works for ${CODE_MINUTES} minutes.`);
        if (!sent) {
          throw new HttpsError("unavailable",
              "We couldn't send a text just now. Please call us to book.");
        }
        return {ok: true};
      });

  /* Checks the code and starts a session. */
  out.webVerifyCode = functions.https.onCall(async (data) => {
    const {fleetId} = await fleetBySlug(data && data.slug);
    const phone = toE164(data && data.phone);
    const code = String((data && data.code) || "").replace(/\D/g, "");
    const ref = phone ? db.collection("webCodes").doc(phone) : null;
    if (!ref || code.length !== 6) {
      throw new HttpsError("invalid-argument", "Enter the 6-digit code.");
    }
    const ok = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const c = snap.exists ? snap.data() : null;
      if (!c || c.fleetId !== fleetId || Date.now() > c.expiresAt ||
          c.tries >= CODE_TRIES) {
        return null;
      }
      if (c.codeHash !== sha(`${phone}:${code}`)) {
        tx.update(ref, {tries: c.tries + 1});
        return false;
      }
      // Spent, but the send times stay for the hourly limit.
      tx.update(ref, {codeHash: null, tries: CODE_TRIES});
      return true;
    });
    if (ok === null) {
      throw new HttpsError("failed-precondition",
          "That code has expired. Ask for a new one.");
    }
    if (!ok) throw new HttpsError("invalid-argument", "That code is wrong.");
    const t = token(24);
    await db.collection("webSessions").doc(t).set({fleetId, phone,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_DAYS * 24 * 3600 * 1000});
    return {token: t};
  });

  /**
   * The customer's latest web bookings with this fleet.
   * @param {string} fleetId Fleet.
   * @param {string} phone E.164.
   * @return {Promise<Array>} Bookings, newest first.
   */
  async function myBookings(fleetId, phone) {
    const c = await db.collection("fleets").doc(fleetId).collection("customers")
        .doc(phone).get().catch(() => null);
    const ids = ((c && c.exists && c.data().webRides) || []).slice(-10)
        .reverse();
    const snaps = await Promise.all(ids.map((id) =>
      db.collection("rides").doc(id).get()));
    return snaps.filter((s) => s.exists).map((s) => {
      const r = s.data();
      return {id: s.id, status: r.status, trackToken: r.trackToken,
        pickup: r.pickupLocation && r.pickupLocation.address,
        dropoff: r.dropoffLocation && r.dropoffLocation.address,
        pickupAt: msOf(r.pickupAt), createdAt: msOf(r.timestamps &&
          r.timestamps.createdAt), fare: r.fare && r.fare.total,
        paidOnline: r.collectBy === "online"};
    });
  }

  /* The signed-in customer: name, saved addresses and bookings. */
  out.webSession = functions.https.onCall(async (data) => {
    const {session, fleetId} = await sessionFor(data && data.token);
    const card = await customerCard(fleetId, session.phone);
    return {phoneEnding: session.phone.slice(-3), name: card.name,
      saved: card.addresses.slice(0, 6),
      bookings: await myBookings(fleetId, session.phone)};
  });

  out.webPlaces = functions.https.onCall(async (data) => {
    await sessionFor(data && data.token, true);
    return {results: await booking.placeSearch(data)};
  });

  out.webPlace = functions.https.onCall(async (data) => {
    await sessionFor(data && data.token, true);
    return booking.placeDetails(data);
  });

  /* Fares for every car type the fleet offers. */
  out.webQuote = functions.https.onCall(async (data) => {
    const {settings} = await sessionFor(data && data.token, true);
    const pickup = booking.point(data && data.pickup);
    const dropoff = booking.point(data && data.dropoff);
    if (!pickup || !dropoff) {
      throw new HttpsError("invalid-argument",
          "Choose a pickup and a destination.");
    }
    const q = await booking.quoteTypes(pickup, dropoff, [], settings.types);
    return {durationMinutes: q.durationMinutes, currency: q.currency,
      fares: settings.types.map((t) => Object.assign({id: t, fare: q.fares[t]},
          TYPE_INFO[t]))};
  });

  /* Books the taxi; for card payment, returns the Stripe page to pay on. */
  out.webBook = functions.runWith({secrets: SECRETS}).https
      .onCall(async (data) => {
        const d = data || {};
        const {session, fleetId, fleet, settings} =
          await sessionFor(d.token);
        if (await isBlocked(fleetId, fleet, session.phone)) {
          throw new HttpsError("permission-denied", BLOCKED_TEXT);
        }
        const rideType = settings.types.includes(d.rideType) ? d.rideType :
          settings.types[0];
        const passengers = Math.round(Number(d.passengers) || 1);
        if (passengers < 1 || passengers > TYPE_INFO[rideType].seats) {
          throw new HttpsError("invalid-argument", `A ` +
            `${TYPE_INFO[rideType].label} car takes up to ` +
            `${TYPE_INFO[rideType].seats} passengers.`);
        }
        const online = d.pay === "card";
        if (online ? !settings.payOnline : !settings.payDriver) {
          throw new HttpsError("invalid-argument",
              "That way of paying is not available.");
        }
        const at = d.pickupAt ? Number(new Date(d.pickupAt)) : null;
        if (online && at && at > Date.now() + CARD_DAYS_AHEAD * 86400000) {
          throw new HttpsError("invalid-argument", "Card payment is for " +
            `trips in the next ${CARD_DAYS_AHEAD} days. Choose pay the ` +
            "driver, or book nearer the time.");
        }
        const open = (await myBookings(fleetId, session.phone))
            .filter((b) => LIVE.includes(b.status)).length;
        if (open >= OPEN_BOOKINGS) {
          throw new HttpsError("resource-exhausted", "You already have " +
            `${open} bookings open. Please call us for more.`);
        }
        const trackToken = token(16);
        const result = await booking.bookPhoneJob({uid: null, fleetId, fleet,
          manager: {name: "Web booking"},
          bookedBy: {uid: null, name: "Web booking", via: "web"}}, {
          customer: {phone: session.phone, name: text(d.name, 80)},
          pickup: d.pickup,
          dropoff: d.dropoff,
          rideType,
          pickupAt: d.pickupAt || null,
          dispatchMode: (fleet.zones || []).length ? "queue" : "all",
          notes: [`${passengers} passenger${passengers === 1 ? "" : "s"}`,
            text(d.notes, 300)].filter(Boolean).join(". "),
        }, {paidOnline: online, extra: {channel: "web", trackToken,
          webPayment: online ? {status: "pending"} : null}});

        await db.collection("fleets").doc(fleetId).collection("customers")
            .doc(session.phone).set({webRides:
              FieldValue.arrayUnion(result.rideId)}, {merge: true});
        const rideRef = db.collection("rides").doc(result.rideId);

        if (!online) {
          const ride = (await rideRef.get()).data();
          await textCustomer(ride, bookedText(ride));
          return {rideId: result.rideId, trackToken, status: result.status};
        }

        // Card: a hold on TakeARoute's Stripe account, taken at the end of
        // the trip. The job waits for it (status payment_pending).
        const back = `${BASE}/b/${settings.slug}`;
        let checkout;
        try {
          checkout = await stripe.checkout.sessions.create({
            mode: "payment",
            line_items: [{quantity: 1, price_data: {
              currency: String(result.currency || "GBP").toLowerCase(),
              unit_amount: Math.round(result.fare * 100),
              product_data: {name: `Taxi with ${fleet.name || "your taxi"}`,
                description: `${whenText(result.pickupAtMs)}. Your card ` +
                  "is charged when the trip ends."},
            }}],
            payment_intent_data: {capture_method: "manual",
              description: `Taxi booking ${result.rideId} (${fleet.name})`,
              metadata: {type: "web_booking", webRideId: result.rideId,
                fleetId}},
            metadata: {type: "web_booking", webRideId: result.rideId, fleetId},
            client_reference_id: result.rideId,
            expires_at: Math.floor(Date.now() / 1000) + PAY_MINUTES * 60,
            success_url: `${back}?paid=${result.rideId}`,
            cancel_url: `${back}?unpaid=${result.rideId}`,
          });
        } catch (error) {
          console.error("Web booking checkout", error.message);
          await rideRef.update({"status": "cancelled", "cancelledBy": "system",
            "cancelReason": "payment_unavailable",
            "webPayment.status": "failed"});
          throw new HttpsError("unavailable", "Card payment isn't " +
            "working just now. Please choose pay the driver, or call us.");
        }
        await rideRef.update({"webPayment.sessionId": checkout.id});
        return {rideId: result.rideId, trackToken, checkoutUrl: checkout.url};
      });

  /**
   * Once the card is held, sends the job out and texts the customer. Safe
   * to call more than once.
   * @param {string} rideId Ride.
   * @return {Promise<string>} The ride's status afterwards.
   */
  async function settlePayment(rideId) {
    const ref = db.collection("rides").doc(rideId);
    const ride = (await ref.get()).data();
    if (!ride || ride.status !== "payment_pending") {
      return ride ? ride.status : "missing";
    }
    const sessionId = ride.webPayment && ride.webPayment.sessionId;
    if (!sessionId) return ride.status;
    const cs = await stripe.checkout.sessions.retrieve(sessionId,
        {expand: ["payment_intent"]});
    const pi = cs.payment_intent;
    if (pi && pi.status === "requires_capture") {
      const nowMs = Date.now();
      const later = (msOf(ride.dispatchAt) || nowMs) > nowMs + 30 * 1000;
      const moved = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.data().status !== "payment_pending") return false;
        tx.update(ref, Object.assign({
          "status": later ? "scheduled" : "dispatching",
          "webPayment.status": "authorised",
          "webPayment.intentId": pi.id,
          "webPayment.amount": pi.amount / 100,
          "payment.status": "authorised",
        }, later ? {} : {
          "dispatch.offeredAt": FieldValue.serverTimestamp(),
          "dispatch.rounds": 1,
        }));
        return true;
      });
      if (moved) await textCustomer(ride, bookedText(ride));
      return later ? "scheduled" : "dispatching";
    }
    const expired = cs.status === "expired" ||
      Date.now() > msOf(ride.timestamps && ride.timestamps.createdAt) +
        (PAY_MINUTES + 5) * 60 * 1000;
    if (expired) {
      await ref.update({"status": "cancelled", "cancelledBy": "system",
        "cancelReason": "not_paid", "cancelledAt": FieldValue.serverTimestamp(),
        "webPayment.status": "failed"});
      return "cancelled";
    }
    return ride.status;
  }

  /* The page calls this when Stripe sends the customer back. */
  out.webConfirmPayment = functions.runWith({secrets: SECRETS}).https
      .onCall(async (data) => {
        const {session} = await sessionFor(data && data.token);
        const rideId = text(data && data.rideId, 128);
        const snap = await db.collection("rides").doc(rideId).get();
        const ride = snap.exists ? snap.data() : null;
        if (!ride || ride.channel !== "web" || !ride.customer ||
            ride.customer.phone !== session.phone) {
          throw new HttpsError("not-found", "Booking not found.");
        }
        const status = await settlePayment(rideId);
        return {status, trackToken: ride.trackToken};
      });

  /* Every 5 minutes: card bookings whose customer closed the page before
     coming back are sent out once the hold shows up; unpaid ones lapse. */
  out.webBookingSweep = functions.runWith({secrets: SECRETS}).pubsub
      .schedule("every 5 minutes").onRun(async () => {
        const pending = await db.collection("rides")
            .where("status", "==", "payment_pending").limit(100).get();
        for (const doc of pending.docs) {
          await settlePayment(doc.id).catch((error) =>
            console.error("Web booking sweep", doc.id, error.message));
        }
        return null;
      });

  /* The customer cancels before a driver has accepted. */
  out.webCancel = functions.https.onCall(async (data) => {
    const t = text(data && data.trackToken, 64);
    const found = t ? await db.collection("rides")
        .where("trackToken", "==", t).limit(1).get() : null;
    const doc = found && !found.empty ? found.docs[0] : null;
    if (!doc) throw new HttpsError("not-found", "Booking not found.");
    await db.runTransaction(async (tx) => {
      const r = (await tx.get(doc.ref)).data();
      if (!["payment_pending", "scheduled", "dispatching"].includes(r.status) ||
          r.driverId) {
        throw new HttpsError("failed-precondition", "A driver is already " +
          "on the way, so please call us to cancel.");
      }
      tx.update(doc.ref, {status: "cancelled", cancelledBy: "customer",
        cancelReason: "customer_web", cancelledAt:
          FieldValue.serverTimestamp()});
    });
    return {ok: true};
  });

  /* ------------------------------ tracking --------------------------- */

  /* What the tracking page shows. Polled every few seconds; the link in
     the customer's text is the key. */
  out.webTrack = functions.https.onCall(async (data) => {
    const t = text(data && data.trackToken, 64);
    const found = /^[A-Za-z0-9_-]{22}$/.test(t) ? await db.collection("rides")
        .where("trackToken", "==", t).limit(1).get() : null;
    const doc = found && !found.empty ? found.docs[0] : null;
    if (!doc) throw new HttpsError("not-found", "Booking not found.");
    const r = doc.data();
    const fleetSnap = await db.collection("fleets").doc(r.fleetId).get();
    const fleet = fleetSnap.exists ? fleetSnap.data() : {};
    const result = {
      status: r.status,
      fleetName: fleet.name || r.fleetName || "",
      phone: fleet.officePhone || fleet.phone || "",
      pickup: booking.point(r.pickupLocation),
      dropoff: booking.point(r.dropoffLocation),
      pickupAt: msOf(r.pickupAt),
      fare: r.fare && (r.fare.finalTotal || r.fare.total),
      paidOnline: r.collectBy === "online",
      paymentStatus: r.webPayment ? r.webPayment.status : null,
      canCancel: ["payment_pending", "scheduled", "dispatching"]
          .includes(r.status) && !r.driverId,
      driver: null,
    };
    if (r.driverId && ["accepted", "arrived", "ongoing"].includes(r.status)) {
      // On a job the driver's phone writes drivers/{id}.location.
      const dSnap = await db.collection("drivers").doc(r.driverId).get();
      const dv = dSnap.exists ? dSnap.data() : {};
      const loc = dv.location || {};
      const pos = Number.isFinite(Number(loc.latitude)) &&
        Number.isFinite(Number(loc.longitude)) ?
        {latitude: Number(loc.latitude), longitude: Number(loc.longitude)} :
        null;
      result.driver = {
        name: dv.firstName || String(dv.fullName || "").split(" ")[0] ||
          "Your driver",
        car: [dv.vehicleColor, dv.makeModel].filter(Boolean).join(" "),
        registration: dv.registrationNumber ?
          String(dv.registrationNumber).toUpperCase() : "",
        photo: dv.profileImage || null,
        position: pos,
      };
    }
    return result;
  });

  /* Texts the customer as the job moves on, takes the card payment when it
     ends and releases the hold if it is cancelled. */
  out.webBookingUpdates = functions.runWith({secrets: SECRETS}).firestore
      .document("rides/{rideId}")
      .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();
        if (after.channel !== "web" || before.status === after.status) {
          return null;
        }
        const rideId = context.params.rideId;
        const wp = after.webPayment || {};

        if (after.status === "accepted" && after.driverId) {
          const dSnap = await db.collection("drivers").doc(after.driverId)
              .get();
          const dv = dSnap.exists ? dSnap.data() : {};
          const who = dv.firstName ||
            String(dv.fullName || "").split(" ")[0] || "Your driver";
          const car = [dv.vehicleColor, dv.makeModel,
            dv.registrationNumber ?
              String(dv.registrationNumber).toUpperCase() : null]
              .filter(Boolean).join(" ");
          await textCustomer(after, `${who} is on the way` +
            `${car ? ` in a ${car}` : ""}. Track: ${trackUrl(after)}`);
        } else if (after.status === "arrived") {
          await textCustomer(after, "your driver is outside. " +
            `Track: ${trackUrl(after)}`);
        } else if (after.status === "completed" && wp.status === "authorised" &&
            wp.intentId) {
          await takePayment(rideId, after);
        } else if (["cancelled", "canceled"].includes(after.status)) {
          if (wp.status === "authorised" && wp.intentId) {
            try {
              await stripe.paymentIntents.cancel(wp.intentId);
              await change.after.ref.update({"webPayment.status": "released"});
            } catch (error) {
              console.error("Web hold release", rideId, error.message);
            }
          }
          if (before.status !== "payment_pending" &&
              after.cancelledBy !== "customer") {
            await textCustomer(after, "sorry, your booking was cancelled." +
              `${wp.status === "authorised" ? " The hold on your card " +
                "has been released." : ""} Please call us if you still ` +
              "need a taxi.");
          } else if (after.cancelledBy === "customer") {
            await textCustomer(after, "your booking is cancelled." +
              `${wp.status === "authorised" ? " The hold on your card " +
                "has been released." : ""}`);
          }
        }
        return null;
      });

  /**
   * Takes the fare from the card hold and credits the fleet's wallet, once.
   * @param {string} rideId Ride.
   * @param {Object} ride Ride data (completed).
   * @return {Promise<void>}
   */
  async function takePayment(rideId, ride) {
    const wp = ride.webPayment;
    const fare = Number((ride.fare && (ride.fare.finalTotal ||
      ride.fare.total)) || 0);
    const held = Math.round(Number(wp.amount || 0) * 100);
    const pence = Math.min(Math.round(fare * 100), held);
    let pi;
    try {
      pi = await stripe.paymentIntents.capture(wp.intentId,
          {amount_to_capture: pence}, {idempotencyKey: `web_${rideId}`});
    } catch (error) {
      console.error("Web booking capture", rideId, error.message);
      await db.collection("rides").doc(rideId).update({
        "webPayment.status": "failed",
        "webPayment.error": String(error.message).slice(0, 200)});
      return;
    }
    const amount = (pi.amount_received || pence) / 100;
    const walletRef = db.collection("fleetWallets").doc(ride.fleetId);
    const txRef = walletRef.collection("transactions").doc(`web_${rideId}`);
    await db.runTransaction(async (tx) => {
      if ((await tx.get(txRef)).exists) return;
      tx.set(walletRef, {availableBalance: FieldValue.increment(amount),
        totalWebCardFares: FieldValue.increment(amount),
        updatedAt: FieldValue.serverTimestamp()}, {merge: true});
      tx.set(txRef, {type: "web_card_fare", amount, rideId,
        driverId: ride.driverId || null, paymentIntentId: wp.intentId,
        description: "Online booking paid by card",
        createdAt: FieldValue.serverTimestamp()});
      tx.update(db.collection("rides").doc(rideId), {
        "webPayment.status": "captured",
        "webPayment.capturedAmount": amount,
        "webPayment.capturedAt": Timestamp.now(),
        "payment.status": "captured"});
    });
  }

  return out;
};
