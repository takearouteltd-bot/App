/* ======================================
   FLEET OFFICE PHONE
   Customers ring the fleet's usual taxi number. The fleet forwards it,
   once, to a TakeARoute (Twilio) number; calls then ring on every
   available operator's screen in the fleet dashboard (Twilio Voice in the
   browser) and the first to answer gets the call, with the booking form
   filled in from the caller's contact card.

   Setting up, all from the dashboards (no Twilio console):
   - A TakeARoute admin gives the fleet a line: buys a UK number
     (adminFleetPhoneSearch, adminFleetPhoneBuy) or, for one fleet, lends
     it the app's own calling number (adminFleetPhoneUseAppNumber). The
     server points the number at fleetVoice. adminFleetPhoneRelease ends it.
   - The fleet owner enters their own taxi number and line type
     (saveFleetPhoneSettings), dials the forwarding code the dashboard
     shows, and presses Test (testFleetForwarding): we ring their number
     from ours, and when it comes back to us forwarded the fleet is marked
     connected (phoneLine.forwarding), noting whether the caller's number
     came through (some networks hide it, which stops the pop-up).
   - The voice keys the browser phone needs (an API key and a TwiML app)
     are created on first use and kept in serverOnly/twilioVoice, which no
     client can read (no rule matches it).

   fleets/{id}.phoneLine
     number, numberSid      the TakeARoute number calls arrive on
     shared                 true when it is the app's own calling number
     ownNumber, lineType    the fleet's taxi number and kind of line
     forwarding             {status: "connected", at, callerIdShown}
   fleetManagers/{uid}.phoneAvailable   rings for this operator
   fleets/{id}/phoneCalls/{callSid}     call log (in and out)

   Calls into the app's own number from someone on a live trip are put
   through to their driver or passenger, as app calls are; everyone else
   reaches the fleet that number is lent to.
   ====================================== */

const crypto = require("crypto");

module.exports = (deps) => {
  const {functions, db, toE164, TWILIO_SECRETS, twilioConfig,
    assertFleetManager, assertAdmin, findRiderByPhone, findDriversByPhone,
    phoneFor, text, FieldValue} = deps;
  const {HttpsError} = functions.https;
  const out = {};

  const PROJECT = process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT || "takearoute-719df";
  const EMULATED = process.env.FUNCTIONS_EMULATOR === "true";
  // Where Twilio calls us back. Tests point TWILIO_API_BASE at a fake.
  const VOICE_URL = EMULATED ?
    `http://127.0.0.1:5001/${PROJECT}/us-central1/fleetVoice` :
    `https://us-central1-${PROJECT}.cloudfunctions.net/fleetVoice`;
  const API = process.env.TWILIO_API_BASE || "https://api.twilio.com";
  const NUMBERS_API = process.env.TWILIO_NUMBERS_BASE ||
    "https://numbers.twilio.com";
  const HOLD_MUSIC =
    "http://com.twilio.sounds.music.s3.amazonaws.com/MARKOVICHAMP-Borghestral.mp3";
  const RING_SECONDS = 25;
  const MAX_ROUNDS = 4; // ring rounds before a call counts as missed
  // Twilio rings at most 10 browsers for one call.
  const MAX_OPERATORS = 10;
  // An operator marked on a call longer than this is treated as free (a
  // flag left behind by a closed browser).
  const ON_CALL_STALE_MS = 2 * 3600 * 1000;
  const LIVE_TRIP = ["accepted", "arrived", "ongoing"];

  /* ------------------------------ helpers ---------------------------- */

  const xml = (v) => String(v == null ? "" : v).replace(/[<>&"']/g, (c) =>
    ({"<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;",
      "'": "&apos;"})[c]);
  const say = (line) =>
    `<Say voice="alice" language="en-GB">${xml(line)}</Say>`;
  const twiml = (inner) =>
    `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
  const voiceUrl = (params) => VOICE_URL + "?" +
    new URLSearchParams(params).toString();
  const operatorId = (uid) => `fm_${uid}`;

  /**
   * Calls the Twilio REST API with the account's own key.
   * @param {Object} tw twilioConfig().
   * @param {string} method GET, POST or DELETE.
   * @param {string} path After /2010-04-01/Accounts/{sid}, or a full URL.
   * @param {Object=} params Form fields (POST) or query (GET).
   * @return {Promise<Object>} Parsed JSON ({} for DELETE).
   */
  async function twilioApi(tw, method, path, params) {
    const base = path.startsWith("http") ? path :
      `${API}/2010-04-01/Accounts/${tw.sid}${path}`;
    const qs = params ? new URLSearchParams(params).toString() : "";
    const url = method === "GET" && qs ? `${base}?${qs}` : base;
    const response = await fetch(url, {
      method,
      headers: {
        "Authorization": "Basic " +
          Buffer.from(`${tw.sid}:${tw.token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: method === "POST" ? qs : undefined,
    });
    if (method === "DELETE" && response.ok) return {};
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("Twilio", method, path, response.status,
          result && result.message);
      throw new HttpsError("internal", (result && result.message) ||
        "The phone service did not accept that. Please try again.");
    }
    return result;
  }

  /**
   * Twilio signs every webhook with the account's auth token; anything
   * unsigned or signed wrongly is refused.
   * @param {Object} req Express request.
   * @param {string} token Auth token.
   * @return {boolean} Whether the signature matches.
   */
  function signedByTwilio(req, token) {
    const given = req.get("X-Twilio-Signature") || "";
    const original = req.originalUrl || req.url || "";
    const query = original.includes("?") ?
      original.slice(original.indexOf("?")) : "";
    const params = req.body && typeof req.body === "object" ? req.body : {};
    const data = Object.keys(params).sort()
        .reduce((acc, k) => acc + k + params[k], VOICE_URL + query);
    const expected = crypto.createHmac("sha1", token)
        .update(Buffer.from(data, "utf-8")).digest("base64");
    return given.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  }

  /**
   * The API key and TwiML app the browser phone needs, made on first use.
   * @param {Object} tw twilioConfig().
   * @return {Promise<Object>} {keySid, keySecret, appSid}
   */
  async function voiceKeys(tw) {
    const ref = db.collection("serverOnly").doc("twilioVoice");
    const snap = await ref.get();
    const have = snap.exists ? snap.data() : {};
    if (have.keySid && have.keySecret && have.appSid &&
        have.accountSid === tw.sid && have.voiceUrl === VOICE_URL) {
      return have;
    }
    const keys = have.keySid && have.keySecret && have.accountSid === tw.sid ?
      {sid: have.keySid, secret: have.keySecret} :
      await twilioApi(tw, "POST", "/Keys.json",
          {FriendlyName: "TakeARoute fleet dashboard phone"});
    const app = have.appSid && have.accountSid === tw.sid ?
      await twilioApi(tw, "POST", `/Applications/${have.appSid}.json`, {
        VoiceUrl: voiceUrl({step: "outgoing"}), VoiceMethod: "POST",
      }) :
      await twilioApi(tw, "POST", "/Applications.json", {
        FriendlyName: "TakeARoute fleet dashboard phone",
        VoiceUrl: voiceUrl({step: "outgoing"}), VoiceMethod: "POST",
      });
    const saved = {keySid: keys.sid, keySecret: keys.secret,
      appSid: app.sid, accountSid: tw.sid, voiceUrl: VOICE_URL,
      updatedAt: new Date().toISOString()};
    await ref.set(saved);
    return saved;
  }

  /**
   * A Twilio access token for the browser phone (a signed JWT).
   * @param {Object} tw twilioConfig().
   * @param {Object} keys voiceKeys().
   * @param {string} identity Operator identity.
   * @param {number} ttl Seconds.
   * @return {string} Token.
   */
  function accessToken(tw, keys, identity, ttl) {
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const head = b64({typ: "JWT", alg: "HS256", cty: "twilio-fpa;v=1"});
    const body = b64({
      jti: `${keys.keySid}-${now}`, iss: keys.keySid, sub: tw.sid,
      iat: now, nbf: now, exp: now + ttl,
      grants: {identity, voice: {
        incoming: {allow: true},
        outgoing: {application_sid: keys.appSid},
      }},
    });
    const sig = crypto.createHmac("sha256", keys.keySecret)
        .update(`${head}.${body}`).digest("base64url");
    return `${head}.${body}.${sig}`;
  }

  /**
   * The fleet a TakeARoute number is set up for.
   * @param {string} number E.164.
   * @return {Promise<?Object>} {id, data}
   */
  async function fleetForNumber(number) {
    const snap = await db.collection("fleets")
        .where("phoneLine.number", "==", number).limit(1).get();
    return snap.empty ? null : {id: snap.docs[0].id,
      data: snap.docs[0].data()};
  }

  /**
   * The other side of a live app trip for someone ringing the app number.
   * @param {string} from Caller, E.164.
   * @return {Promise<?string>} Number to put them through to.
   */
  async function tripPartnerFor(from) {
    const rider = await findRiderByPhone(from).catch(() => null);
    if (rider && rider.currentRideId) {
      const ride = await db.collection("rides").doc(rider.currentRideId).get();
      const r = ride.exists ? ride.data() : null;
      if (r && LIVE_TRIP.includes(r.status) && r.driverId) {
        return phoneFor("drivers", r.driverId);
      }
    }
    const drivers = await findDriversByPhone(from).catch(() => []);
    for (const d of drivers) {
      const rideId = d.data().currentRideId;
      if (!rideId) continue;
      const ride = await db.collection("rides").doc(rideId).get();
      const r = ride.exists ? ride.data() : null;
      if (r && LIVE_TRIP.includes(r.status) && r.riderId) {
        return phoneFor("riders", r.riderId);
      }
    }
    return null;
  }

  /**
   * Points a TakeARoute number at fleetVoice.
   * @param {Object} tw twilioConfig().
   * @param {string} numberSid Twilio number SID.
   * @return {Promise<void>}
   */
  async function routeNumber(tw, numberSid) {
    await twilioApi(tw, "POST", `/IncomingPhoneNumbers/${numberSid}.json`, {
      VoiceUrl: voiceUrl({step: "incoming"}), VoiceMethod: "POST",
      StatusCallback: voiceUrl({step: "status"}), StatusCallbackMethod: "POST",
    });
  }

  /**
   * Whether an operator is free to ring: not on a call (or the flag is
   * stale).
   * @param {Object} m fleetManagers data.
   * @return {boolean} Free.
   */
  function freeToRing(m) {
    const on = m.phoneOnCall;
    return !on || !on.since || Date.now() - Date.parse(on.since) >
      ON_CALL_STALE_MS;
  }

  /**
   * Marks an operator on a call, or free again (only if it is that call).
   * @param {string} uid Operator.
   * @param {?string} callSid The call, or null to clear.
   * @param {string=} clearing The call being cleared.
   * @return {Promise<void>}
   */
  async function markOnCall(uid, callSid, clearing) {
    if (!uid) return;
    const ref = db.collection("fleetManagers").doc(uid);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const on = snap.data().phoneOnCall;
      if (callSid) {
        tx.update(ref, {phoneOnCall: {callSid,
          since: new Date().toISOString()}});
      } else if (on && (!clearing || on.callSid === clearing)) {
        tx.update(ref, {phoneOnCall: FieldValue.delete()});
      }
    }).catch((e) => console.error("markOnCall", uid, e.message));
  }

  const callRef = (fleetId, callSid) => db.collection("fleets").doc(fleetId)
      .collection("phoneCalls").doc(callSid);

  /* ------------------------------ webhooks --------------------------- */

  /* Every Twilio callback for the office phone, by ?step=. Answers TwiML. */
  out.fleetVoice = functions.runWith({secrets: TWILIO_SECRETS})
      .https.onRequest(async (req, res) => {
        let tw;
        try {
          tw = twilioConfig();
        } catch (e) {
          res.status(503).send("Calling is not switched on.");
          return;
        }
        if (req.method !== "POST" || !signedByTwilio(req, tw.token)) {
          res.status(403).send("Forbidden");
          return;
        }
        const step = String(req.query.step || "");
        const p = req.body || {};
        const send = (inner) => res.type("text/xml").send(twiml(inner));
        try {
          if (step === "incoming") return send(await incoming(tw, p, req));
          if (step === "after") return send(await afterDial(p, req));
          if (step === "answered") {
            await answered(p, req);
            return res.status(204).send("");
          }
          if (step === "status") {
            await callEnded(p);
            return res.status(204).send("");
          }
          if (step === "outgoing") return send(await outgoing(tw, p));
          if (step === "outDone") {
            await markOnCall(String(req.query.uid || ""), null, p.CallSid);
            await callRef(String(req.query.fleet || ""), p.CallSid).set({
              seconds: Number(p.DialCallDuration) || 0,
              endedAt: new Date().toISOString()}, {merge: true});
            return send("<Hangup/>");
          }
          if (step === "test") return send("<Pause length=\"20\"/>");
          return res.status(404).send("Unknown step");
        } catch (error) {
          console.error("fleetVoice", step, error);
          return send(say("Sorry, something went wrong. Please call " +
            "again.") + "<Hangup/>");
        }
      });

  /**
   * A call to a TakeARoute number.
   * @param {Object} tw twilioConfig().
   * @param {Object} p Twilio params.
   * @param {Object} req Request (query: fleet, round).
   * @return {Promise<string>} TwiML.
   */
  async function incoming(tw, p, req) {
    const from = toE164(p.From) || String(p.From || "");
    const to = toE164(p.To) || String(p.To || "");
    const round = Math.max(1, Number(req.query.round) || 1);
    const found = req.query.fleet ?
      {id: String(req.query.fleet), data: (await db.collection("fleets")
          .doc(String(req.query.fleet)).get()).data() || {}} :
      await fleetForNumber(to);
    const line = found && found.data.phoneLine;

    // Someone on a live app trip ringing the app's number back.
    if (round === 1 && to === toE164(tw.from) && from) {
      const partner = await tripPartnerFor(from);
      if (partner) {
        return say("Connecting you to your trip.") +
          `<Dial callerId="${xml(tw.from)}" timeout="30">` +
          `${xml(partner)}</Dial>`;
      }
    }
    if (!found || !line || !line.number) {
      return say("Sorry, this number is not in use.") + "<Hangup/>";
    }
    const fleetId = found.id;

    // Our forwarding test coming back to us.
    if (round === 1 && line.forwardingTest && line.forwardingTest.callSid &&
        Date.now() - Date.parse(line.forwardingTest.at || 0) < 120000 &&
        (from === line.number || from === line.ownNumber)) {
      await db.collection("fleets").doc(fleetId).update({
        "phoneLine.forwarding": {status: "connected",
          at: new Date().toISOString(),
          callerIdShown: from === line.number},
        "phoneLine.forwardingTest": FieldValue.delete(),
      });
      return say("Your taxi number is connected to TakeARoute.") + "<Hangup/>";
    }

    const fleetName = found.data.name || "the taxi office";
    if (found.data.status === "suspended") {
      return say(`Sorry, ${fleetName} cannot take bookings at the ` +
        "moment.") + "<Hangup/>";
    }

    const ref = callRef(fleetId, p.CallSid);
    if (round === 1) {
      const card = from.startsWith("+") ? await db.collection("fleets")
          .doc(fleetId).collection("customers").doc(from).get() : null;
      const name = card && card.exists ? (card.data().name || "") : "";
      await ref.set({direction: "in", from, name, known: Boolean(name),
        status: "ringing", startedAt: new Date().toISOString(),
        rounds: 1}, {merge: true});
    } else {
      await ref.set({rounds: round}, {merge: true});
    }
    const snap = await ref.get();
    const call = snap.data() || {};

    const ops = await db.collection("fleetManagers")
        .where("fleetId", "==", fleetId)
        .where("phoneAvailable", "==", true).get();
    // Only free operators ring: anyone already on a call is skipped, so the
    // next call goes to whoever is free. Longest-waiting first, up to 10.
    const operators = ops.docs.filter((d) => d.data().isActive === true &&
      freeToRing(d.data()))
        .sort((a, b) => String(a.data().phoneLastCallAt || "")
            .localeCompare(String(b.data().phoneLastCallAt || "")))
        .slice(0, MAX_OPERATORS);
    const greeting = round === 1 ? say(`Thank you for calling ${fleetName}.`) :
      "";
    if (!operators.length) {
      if (round >= MAX_ROUNDS) return missed(ref, fleetName);
      return greeting + say("All our operators are busy. Please hold.") +
        `<Play>${HOLD_MUSIC}</Play>` +
        `<Redirect method="POST">${xml(voiceUrl({step: "incoming",
          fleet: fleetId, round: round + 1}))}</Redirect>`;
    }
    const clients = operators.map((d) =>
      `<Client statusCallbackEvent="answered" statusCallbackMethod="POST" ` +
      `statusCallback="${xml(voiceUrl({step: "answered", fleet: fleetId,
        call: p.CallSid}))}">` +
      `<Identity>${xml(operatorId(d.id))}</Identity>` +
      `<Parameter name="callSid" value="${xml(p.CallSid)}"/>` +
      `<Parameter name="from" value="${xml(from)}"/>` +
      `<Parameter name="name" value="${xml(call.name || "")}"/>` +
      `<Parameter name="fleetId" value="${xml(fleetId)}"/>` +
      "</Client>").join("");
    return greeting + (round > 1 ? say("Putting you through.") : "") +
      `<Dial timeout="${RING_SECONDS}" answerOnBridge="true" ` +
      `action="${xml(voiceUrl({step: "after", fleet: fleetId,
        round}))}" method="POST">${clients}</Dial>`;
  }

  /**
   * Logs a missed call and says goodbye.
   * @param {Object} ref phoneCalls doc.
   * @param {string} fleetName For the message.
   * @return {Promise<string>} TwiML.
   */
  async function missed(ref, fleetName) {
    await ref.set({status: "missed", endedAt: new Date().toISOString()},
        {merge: true});
    return say(`Sorry, nobody at ${fleetName} could take your call. ` +
      "We will call you back.") + "<Hangup/>";
  }

  /**
   * After ringing the operators: answered and done, or ring again.
   * @param {Object} p Twilio params.
   * @param {Object} req Request (query: fleet, round).
   * @return {Promise<string>} TwiML.
   */
  async function afterDial(p, req) {
    const fleetId = String(req.query.fleet || "");
    const round = Math.max(1, Number(req.query.round) || 1);
    const ref = callRef(fleetId, p.CallSid);
    if (p.DialCallStatus === "completed" || p.DialCallStatus === "answered") {
      await ref.set({status: "completed", endedAt: new Date().toISOString(),
        seconds: Number(p.DialCallDuration) || 0}, {merge: true});
      const c = (await ref.get()).data() || {};
      await markOnCall(c.answeredBy, null, p.CallSid);
      return "<Hangup/>";
    }
    const fleet = (await db.collection("fleets").doc(fleetId).get()).data() ||
      {};
    if (round >= MAX_ROUNDS) return missed(ref, fleet.name || "the office");
    return say("Sorry to keep you waiting. Please hold.") +
      `<Play>${HOLD_MUSIC}</Play>` +
      `<Redirect method="POST">${xml(voiceUrl({step: "incoming",
        fleet: fleetId, round: round + 1}))}</Redirect>`;
  }

  /**
   * An operator picked up: note who.
   * @param {Object} p Twilio params (To = client:fm_uid).
   * @param {Object} req Request (query: fleet, call).
   * @return {Promise<void>}
   */
  async function answered(p, req) {
    const fleetId = String(req.query.fleet || "");
    const callSid = String(req.query.call || "");
    const who = String(p.To || p.Called || "").replace(/^client:/, "")
        .replace(/^fm_/, "");
    if (!fleetId || !callSid) return;
    const manager = who ? (await db.collection("fleetManagers").doc(who)
        .get()).data() : null;
    await callRef(fleetId, callSid).set({status: "answered",
      answeredBy: who || null,
      answeredByName: manager ? (manager.name || manager.email || "") : "",
      answeredAt: new Date().toISOString()}, {merge: true});
    if (manager) {
      await markOnCall(who, callSid);
      await db.collection("fleetManagers").doc(who).update({
        phoneLastCallAt: new Date().toISOString()}).catch(() => null);
    }
  }

  /**
   * The caller's call ended. Ringing that never got answered is missed.
   * @param {Object} p Twilio params.
   * @return {Promise<void>}
   */
  async function callEnded(p) {
    if (p.CallStatus !== "completed" && p.CallStatus !== "no-answer" &&
        p.CallStatus !== "busy" && p.CallStatus !== "failed" &&
        p.CallStatus !== "canceled") {
      return;
    }
    const to = toE164(p.To) || String(p.To || "");
    const found = await fleetForNumber(to);
    if (!found) return;
    const ref = callRef(found.id, p.CallSid);
    const snap = await ref.get();
    if (!snap.exists) return;
    const c = snap.data();
    if (c.status === "ringing") {
      await ref.update({status: "missed", endedAt: new Date().toISOString(),
        hungUpWaiting: true});
    } else if (c.status === "answered") {
      await ref.update({status: "completed",
        endedAt: new Date().toISOString(),
        seconds: Number(p.CallDuration) || 0});
    }
    if (c.answeredBy) await markOnCall(c.answeredBy, null, p.CallSid);
  }

  /**
   * An operator rings out from the dashboard: only the fleet's own
   * customers (a contact card) and drivers, shown as the fleet's number.
   * @param {Object} tw twilioConfig().
   * @param {Object} p Twilio params (From = client:fm_uid, To).
   * @return {Promise<string>} TwiML.
   */
  async function outgoing(tw, p) {
    const uid = String(p.From || p.Caller || "").replace(/^client:/, "")
        .replace(/^fm_/, "");
    const manager = uid ? (await db.collection("fleetManagers").doc(uid)
        .get()).data() : null;
    if (!manager || manager.isActive !== true || !manager.fleetId) {
      return say("Sorry, you can't call from here.") + "<Hangup/>";
    }
    const fleetSnap = await db.collection("fleets").doc(manager.fleetId).get();
    const fleet = fleetSnap.data() || {};
    const line = fleet.phoneLine || {};
    const to = toE164(p.To);
    if (!line.number || !to) {
      return say("Sorry, that number can't be called.") + "<Hangup/>";
    }
    const card = await fleetSnap.ref.collection("customers").doc(to).get();
    let allowed = card.exists;
    if (!allowed) {
      const drivers = await findDriversByPhone(to).catch(() => []);
      allowed = drivers.some((d) => d.data().fleetId === manager.fleetId);
    }
    if (!allowed) {
      return say("Only your own customers and drivers can be called from " +
        "here.") + "<Hangup/>";
    }
    await callRef(manager.fleetId, p.CallSid).set({direction: "out", to,
      name: card.exists ? (card.data().name || "") : "",
      by: uid, byName: manager.name || manager.email || "",
      status: "completed", startedAt: new Date().toISOString()});
    await markOnCall(uid, p.CallSid);
    return `<Dial callerId="${xml(line.number)}" timeout="30" ` +
      `action="${xml(voiceUrl({step: "outDone", fleet: manager.fleetId,
        uid}))}" method="POST">${xml(to)}</Dial>`;
  }

  /* ----------------------------- operators --------------------------- */

  /* A token for the browser phone. Rings only when the fleet has a line. */
  out.fleetPhoneToken = functions.runWith({secrets: TWILIO_SECRETS})
      .https.onCall(async (data, context) => {
        const me = await assertFleetManager(context, false);
        if (!me.fleet.phoneLine || !me.fleet.phoneLine.number) {
          throw new HttpsError("failed-precondition",
              "Phone bookings are not set up for your fleet yet.");
        }
        const tw = twilioConfig();
        const keys = await voiceKeys(tw);
        return {token: accessToken(tw, keys, operatorId(me.uid), 3600),
          identity: operatorId(me.uid), ttl: 3600};
      });

  /* An operator says whether calls should ring for them. */
  out.setFleetPhoneAvailable = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, false);
    const available = Boolean(data && data.available);
    await db.collection("fleetManagers").doc(me.uid).update({
      phoneAvailable: available,
      phoneAvailableAt: new Date().toISOString(),
      // Switching on or off starts clean (a closed browser can leave it).
      phoneOnCall: FieldValue.delete(),
    });
    return {ok: true, available};
  });

  /* The office's recent calls, newest first. */
  out.listFleetPhoneCalls = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, false);
    const snap = await db.collection("fleets").doc(me.fleetId)
        .collection("phoneCalls").orderBy("startedAt", "desc").limit(100)
        .get();
    return {calls: snap.docs.map((d) => Object.assign({id: d.id}, d.data()))};
  });

  /* The owner saves their own taxi number and kind of line. */
  out.saveFleetPhoneSettings = functions.https.onCall(async (data, context) => {
    const me = await assertFleetManager(context, true);
    const ownNumber = toE164(data && data.ownNumber);
    if (!ownNumber) {
      throw new HttpsError("invalid-argument",
          "Enter your taxi number, for example 01527 123456.");
    }
    const lineType = ["mobile", "landline", "office"]
        .includes(data && data.lineType) ? data.lineType : "landline";
    const line = me.fleet.phoneLine || {};
    if (line.number && ownNumber === line.number) {
      throw new HttpsError("invalid-argument",
          "That is the TakeARoute number. Enter the number your customers " +
          "ring.");
    }
    const changed = line.ownNumber !== ownNumber;
    await db.collection("fleets").doc(me.fleetId).update(Object.assign({
      "phoneLine.ownNumber": ownNumber,
      "phoneLine.lineType": lineType,
    }, changed ? {"phoneLine.forwarding": FieldValue.delete()} : {}));
    return {ok: true, ownNumber, lineType};
  });

  /* We ring the fleet's own number from ours; if it is forwarded it comes
     straight back to us (fleetVoice step=incoming) and is marked
     connected. */
  out.testFleetForwarding = functions.runWith({secrets: TWILIO_SECRETS})
      .https.onCall(async (data, context) => {
        const me = await assertFleetManager(context, true);
        const line = me.fleet.phoneLine || {};
        if (!line.number) {
          throw new HttpsError("failed-precondition",
              "TakeARoute has not set up your phone line yet.");
        }
        if (!line.ownNumber) {
          throw new HttpsError("failed-precondition",
              "Save your taxi number first.");
        }
        const tw = twilioConfig();
        const call = await twilioApi(tw, "POST", "/Calls.json", {
          To: line.ownNumber, From: line.number,
          Url: voiceUrl({step: "test"}), Method: "POST", Timeout: "30",
          TimeLimit: "40",
        });
        await db.collection("fleets").doc(me.fleetId).update({
          "phoneLine.forwardingTest": {callSid: call.sid,
            at: new Date().toISOString()},
          "phoneLine.forwarding": FieldValue.delete(),
        });
        return {ok: true};
      });

  /* ------------------------------- admins ---------------------------- */

  /* UK local numbers free to buy, by area code (e.g. 01527). */
  out.adminFleetPhoneSearch = functions.runWith({secrets: TWILIO_SECRETS})
      .https.onCall(async (data, context) => {
        await assertAdmin(context);
        const tw = twilioConfig();
        const area = String((data && data.areaCode) || "").replace(/\D/g, "")
            .replace(/^0/, "").slice(0, 6);
        const params = {PageSize: "20", VoiceEnabled: "true"};
        if (area) params.Contains = `+44${area}*`;
        const found = await twilioApi(tw, "GET",
            "/AvailablePhoneNumbers/GB/Local.json", params);
        return {numbers: (found.available_phone_numbers || []).map((n) => ({
          number: n.phone_number, friendly: n.friendly_name,
          locality: n.locality || n.region || "",
        }))};
      });

  /* Buys a number for a fleet with TakeARoute's approved UK registration
     and points it at the office phone. */
  out.adminFleetPhoneBuy = functions.runWith({secrets: TWILIO_SECRETS})
      .https.onCall(async (data, context) => {
        await assertAdmin(context);
        const fleetId = text(data && data.fleetId, 128);
        const number = toE164(data && data.number);
        const fleetRef = db.collection("fleets").doc(fleetId);
        const fleet = (await fleetRef.get()).data();
        if (!fleet) throw new HttpsError("not-found", "No such fleet.");
        if (!number) throw new HttpsError("invalid-argument", "Pick a number.");
        if (fleet.phoneLine && fleet.phoneLine.number) {
          throw new HttpsError("already-exists",
              "This fleet already has a line. Release it first.");
        }
        const tw = twilioConfig();
        const bundles = await twilioApi(tw, "GET",
            `${NUMBERS_API}/v2/RegulatoryCompliance/Bundles`,
            {Status: "twilio-approved", IsoCountry: "GB", NumberType: "local",
              PageSize: "5"});
        const bundle = (bundles.results || [])[0];
        const addresses = await twilioApi(tw, "GET", "/Addresses.json",
            {IsoCountry: "GB", PageSize: "5"});
        const address = (addresses.addresses || [])[0];
        if (!bundle || !address) {
          throw new HttpsError("failed-precondition",
              "TakeARoute's UK number registration was not found in Twilio.");
        }
        const bought = await twilioApi(tw, "POST",
            "/IncomingPhoneNumbers.json", {
              PhoneNumber: number, BundleSid: bundle.sid,
              AddressSid: address.sid,
              FriendlyName: `${fleet.name || fleetId} (fleet office)`,
              VoiceUrl: voiceUrl({step: "incoming"}), VoiceMethod: "POST",
              StatusCallback: voiceUrl({step: "status"}),
              StatusCallbackMethod: "POST",
            });
        await fleetRef.update({phoneLine: {number: bought.phone_number,
          numberSid: bought.sid, shared: false,
          setUpAt: new Date().toISOString(),
          setUpBy: context.auth.token.email || "an admin"}});
        return {ok: true, number: bought.phone_number};
      });

  /* Lends the app's own calling number to one fleet. Callers on a live app
     trip still reach their trip. */
  out.adminFleetPhoneUseAppNumber = functions.runWith({secrets: TWILIO_SECRETS})
      .https.onCall(async (data, context) => {
        await assertAdmin(context);
        const fleetId = text(data && data.fleetId, 128);
        const fleetRef = db.collection("fleets").doc(fleetId);
        const fleet = (await fleetRef.get()).data();
        if (!fleet) throw new HttpsError("not-found", "No such fleet.");
        const tw = twilioConfig();
        const appNumber = toE164(tw.from);
        const other = await fleetForNumber(appNumber);
        if (other && other.id !== fleetId) {
          throw new HttpsError("already-exists",
              `${other.data.name || "Another fleet"} already uses the app's ` +
              "number.");
        }
        const list = await twilioApi(tw, "GET", "/IncomingPhoneNumbers.json",
            {PhoneNumber: appNumber});
        const record = (list.incoming_phone_numbers || [])[0];
        if (!record) {
          throw new HttpsError("not-found",
              "The app's number was not found in Twilio.");
        }
        await routeNumber(tw, record.sid);
        const line = fleet.phoneLine || {};
        await fleetRef.update({phoneLine: Object.assign({}, line, {
          number: appNumber, numberSid: record.sid, shared: true,
          setUpAt: new Date().toISOString(),
          setUpBy: context.auth.token.email || "an admin"})});
        return {ok: true, number: appNumber};
      });

  /* Ends a fleet's line: a bought number goes back to Twilio (its monthly
     charge stops); the app's own number just stops ringing the fleet. */
  out.adminFleetPhoneRelease = functions.runWith({secrets: TWILIO_SECRETS})
      .https.onCall(async (data, context) => {
        await assertAdmin(context);
        const fleetId = text(data && data.fleetId, 128);
        const fleetRef = db.collection("fleets").doc(fleetId);
        const fleet = (await fleetRef.get()).data();
        const line = fleet && fleet.phoneLine;
        if (!line || !line.number) {
          throw new HttpsError("not-found", "This fleet has no line.");
        }
        const tw = twilioConfig();
        if (!line.shared && line.numberSid) {
          await twilioApi(tw, "DELETE",
              `/IncomingPhoneNumbers/${line.numberSid}.json`);
        }
        await fleetRef.update({phoneLine: FieldValue.delete()});
        return {ok: true};
      });

  return out;
};
