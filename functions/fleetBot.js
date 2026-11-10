/* ======================================
   FLEET PHONE BOT AND BOOKING LINKS
   When nobody in the office can take a call, a voice assistant answers
   instead of the hold music (only for fleets that switch it on in
   Settings, fleets/{id}.phoneBot.enabled):
   - all operators are busy or away when the call comes in, or
   - the operators were rung and nobody picked up.

   Each turn Twilio hears the caller (<Gather input="speech">) and posts
   what they said to fleetVoice?step=bot. An open-source model (Meta's
   Llama on TakeARoute's own Cloudflare Workers AI account) reads the call
   so far and
   says what the caller wants (pickup, destination, when, passengers, name)
   as JSON; the server looks the addresses up on Google, works out the fare,
   reads the booking back and books it only when the caller says yes. The
   job goes on the dispatch screen like an operator's, booked by "Booking
   bot" (rides/{id}.bookedBy.via "bot"), and the caller gets a text.

   The backup, when the bot cannot finish (address not found three times,
   the call runs long, the AI is down, a big group, the caller asks for it):
   a text with a booking link to a UK mobile (bookingLinks/{token}, a page
   on the dashboard at /book/{token}, one booking, 12 hours), or else the
   call goes back to ringing the operators. Saying "operator" (or pressing
   0) puts the caller back in the queue for a person at any time.

   fleets/{id}/phoneCalls/{callSid}.bot
     startedAt, endedAt, reason ("busy" | "no_answer"), stage
     ("collect" | "confirm" | "offer_link"), slots {pickup, dropoff, when,
     passengers, name, notes}, transcript [{who, text}], turns,
     outcome ("booked" | "link_sent" | "to_operator" | "hung_up"), rideId
   bookingLinks/{token}   fleetId, phone, name, expiresAt, rideId (no
                          client reads it: no rule matches)

   Needs the CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN secrets (a
   Cloudflare API token with Workers AI read and edit only).
   ====================================== */

const crypto = require("crypto");
const BOT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const AI_BASE = process.env.CF_AI_BASE || "https://api.cloudflare.com";
// Twilio waits 15 seconds for each answer; leave room for the map lookups.
const AI_TIMEOUT_MS = 8000;
const BOT_VOICE = "Polly.Amy-Neural";
const MAX_TURNS = 16;
const MAX_ADDRESS_TRIES = 3;
const LINK_HOURS = 12;
const LINK_LOOKUPS = 80;
const MAX_DAYS_AHEAD = 90;
// Seats by vehicle class, as the app's FareEstimationScreen.
const SEATS = {RouteMini: 4, RouteXL: 6};
const AI_SECRETS = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_AI_TOKEN"];

const INTENTS = ["continue", "confirm_yes", "confirm_no", "operator",
  "text_link", "goodbye"];
const orNull = (type) => ({type: [type, "null"]});
const REPLY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "pickup_query", "pickup_saved", "dropoff_query",
    "dropoff_saved", "when_now", "when_local", "passengers", "name", "notes",
    "say"],
  properties: {
    intent: {type: "string", enum: INTENTS},
    pickup_query: orNull("string"),
    pickup_saved: orNull("integer"),
    dropoff_query: orNull("string"),
    dropoff_saved: orNull("integer"),
    when_now: orNull("boolean"),
    when_local: orNull("string"),
    passengers: orNull("integer"),
    name: orNull("string"),
    notes: orNull("string"),
    say: {type: "string"},
  },
};

const SYSTEM = `You are the telephone booking assistant for a UK taxi firm. \
Callers reach you when the office staff are busy. Each turn you are given \
the booking details collected so far and the call so far, and you reply \
with JSON describing what the caller just said and what to say next.

What a booking needs: the pickup address, the destination, when (as soon as \
possible, or a time), how many passengers, and the caller's name if it is \
not already known.

Fields:
- pickup_query, dropoff_query: the address as a map search would \
understand it, with the town if the caller said one, for example "12 \
Station Road, Redditch", "Birmingham Airport" or "Redditch train station". \
Fill them only when the caller gave or changed that address in their last \
reply; otherwise null.
- pickup_saved, dropoff_saved: when the caller means one of their saved \
addresses ("home", "the usual", "same as last time", or the same street), \
its number from the list; otherwise null. Use either the saved number or \
the query for a leg, not both.
- when_now: true when they want a taxi as soon as possible. when_local: a \
later pickup time as "YYYY-MM-DDTHH:MM" in UK time, worked out from the \
current UK date and time you are given. If they give a day but no time, \
ask for the time and leave both null.
- passengers: the number of people travelling, when they said it.
- name: the caller's name, when they said it. notes: anything the driver \
should know that they mentioned (flat number, luggage, a wheelchair, a \
child seat), otherwise null.
- intent: "continue" for normal answers; "confirm_yes" when they agree to \
the booking they were just read back; "confirm_no" when they do not, or want \
to change something (fill in the changed fields too); "operator" when they \
want to speak to a person; "text_link" when they would rather book by text \
or online; "goodbye" when they want to end the call without booking.
- say: what to say next. It is spoken aloud on the phone, so write it as \
natural, warm British English speech: one or two short sentences, under 30 \
words, no lists, symbols or abbreviations. Ask for one or two missing \
things at a time. Do not read back addresses, quote a fare or say the taxi \
is booked: the system does that itself once everything is collected.

You only take taxi bookings. If the caller asks for something else, say \
you can only book taxis and offer to put them through to the office.`;

module.exports = (deps) => {
  const {functions, db, FieldValue, text, booking, twilioApi, twilioConfig,
    TWILIO_SECRETS, voiceUrl, xml, callRef,
    freeOperatorCount} = deps;
  const {HttpsError} = functions.https;
  const out = {};
  const LINK_BASE = process.env.BOOKING_LINK_BASE ||
    "https://admin.takearoute.ltd/book/";

  /* ------------------------------ helpers ---------------------------- */

  const iso = () => new Date().toISOString();
  const say = (line) =>
    `<Say voice="${BOT_VOICE}" language="en-GB">${xml(line)}</Say>`;
  const isMobile = (e164) => /^\+447\d{9}$/.test(String(e164 || ""));
  const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";

  /**
   * Whether the fleet has the bot switched on (and the server its key).
   * @param {Object} fleet Fleet data.
   * @return {boolean} On.
   */
  function enabled(fleet) {
    return Boolean(fleet && fleet.phoneBot && fleet.phoneBot.enabled ===
      true && process.env.CLOUDFLARE_ACCOUNT_ID &&
      process.env.CLOUDFLARE_AI_TOKEN);
  }

  /**
   * Says a line and listens for the answer (speech, or a key press).
   * @param {string} fleetId Fleet.
   * @param {string} line What to say.
   * @return {string} TwiML.
   */
  function ask(fleetId, line) {
    const action = xml(voiceUrl({step: "bot", fleet: fleetId}));
    return `<Gather input="speech dtmf" numDigits="1" language="en-GB" ` +
      `speechTimeout="auto" speechModel="phone_call" enhanced="true" ` +
      `timeout="7" actionOnEmptyResult="true" method="POST" ` +
      `action="${action}">${say(line)}</Gather>` +
      `<Redirect method="POST">${action}</Redirect>`;
  }

  /* UK time: the bot talks in it and callers book in it. */
  const LONDON = new Intl.DateTimeFormat("en-GB", {timeZone: "Europe/London",
    year: "numeric", month: "numeric", day: "numeric", hour: "numeric",
    minute: "numeric", hourCycle: "h23", weekday: "long"});
  /**
   * The parts of a moment in UK time.
   * @param {number} ms Time.
   * @return {Object} {year, month, day, hour, minute, weekday}
   */
  function london(ms) {
    const p = {};
    LONDON.formatToParts(new Date(ms)).forEach((x) => {
      p[x.type] = x.type === "weekday" ? x.value : Number(x.value);
    });
    return p;
  }
  /**
   * A UK wall-clock time ("2026-11-07T18:30") as a moment.
   * @param {string} local Local time.
   * @return {?number} Milliseconds, or null.
   */
  function londonToMs(local) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/
        .exec(String(local || ""));
    if (!m) return null;
    const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    const offset = (ms) => {
      const p = london(ms);
      return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) -
        Math.floor(ms / 60000) * 60000;
    };
    let ms = wall - offset(wall);
    ms = wall - offset(ms);
    return Number.isFinite(ms) ? ms : null;
  }
  const MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  /**
   * "today at 6 pm", "tomorrow at 9:30 am", "on Monday 9 November at 6 pm".
   * @param {number} ms Time.
   * @return {string} Words.
   */
  function whenWords(ms) {
    const p = london(ms);
    const today = london(Date.now());
    const tomorrow = london(Date.now() + 24 * 3600 * 1000);
    const same = (a, b) => a.year === b.year && a.month === b.month &&
      a.day === b.day;
    const h = p.hour % 12 || 12;
    const time = `${h}${p.minute ? ":" + String(p.minute).padStart(2, "0") :
      ""} ${p.hour < 12 ? "am" : "pm"}`;
    if (same(p, today)) return `today at ${time}`;
    if (same(p, tomorrow)) return `tomorrow at ${time}`;
    return `on ${p.weekday} ${p.day} ${MONTHS[p.month - 1]} at ${time}`;
  }
  /**
   * An address as said aloud: no country, at most three parts.
   * @param {string} address Address.
   * @return {string} Shorter address.
   */
  function spoken(address) {
    return String(address || "").replace(/,\s*(UK|United Kingdom)$/i, "")
        .split(",").map((s) => s.trim()).filter(Boolean).slice(0, 3)
        .join(", ");
  }
  const rideTypeFor = (n) => (Number(n) > SEATS.RouteMini ? "RouteXL" :
    "RouteMini");

  /**
   * The caller's contact card, cut down to what the bot needs.
   * @param {string} fleetId Fleet.
   * @param {string} phone E.164.
   * @return {Promise<Object>} {name, addresses: [{latitude, longitude,
   *   address, label?}]}
   */
  async function customerCard(fleetId, phone) {
    const snap = await db.collection("fleets").doc(fleetId)
        .collection("customers").doc(phone).get().catch(() => null);
    const c = snap && snap.exists ? snap.data() : {};
    const seen = new Set();
    const addresses = [];
    const add = (p, label) => {
      const pt = booking.point(p);
      if (!pt || seen.has(pt.address.toLowerCase())) return;
      seen.add(pt.address.toLowerCase());
      addresses.push(label ? Object.assign(pt, {label}) : pt);
    };
    (c.places || []).forEach((p) => add(p, text(p.label || p.name, 40)));
    (c.addresses || []).forEach((p) => add(p));
    return {name: text(c.name, 80), addresses: addresses.slice(0, 8)};
  }

  /**
   * Sends a text: from the fleet's name where the network allows it, else
   * from a TakeARoute number.
   * @param {Object} fleet Fleet data.
   * @param {string} to E.164 mobile.
   * @param {string} body Message.
   * @return {Promise<boolean>} Sent.
   */
  async function sendText(fleet, to, body) {
    let tw;
    try {
      tw = twilioConfig();
    } catch (e) {
      return false;
    }
    // UK networks show a short name instead of a number: letters, digits
    // and spaces, at most 11, with at least one letter.
    const alpha = String(fleet.name || "").replace(/[^A-Za-z0-9 ]/g, "")
        .trim().slice(0, 11).trim();
    const senders = [];
    if (/[A-Za-z]/.test(alpha)) senders.push(alpha);
    const line = fleet.phoneLine && fleet.phoneLine.number;
    if (isMobile(line)) senders.push(line);
    senders.push(tw.from);
    for (const from of senders) {
      try {
        await twilioApi(tw, "POST", "/Messages.json",
            {To: to, From: from, Body: body});
        return true;
      } catch (e) {
        console.warn("Text from", from, "failed:", e.message);
      }
    }
    return false;
  }

  /**
   * Makes a booking link for a caller and texts it to them.
   * @param {string} fleetId Fleet.
   * @param {Object} fleet Fleet data.
   * @param {string} phone E.164 mobile.
   * @param {string} name Name, if known.
   * @param {string} callSid The call it came from.
   * @return {Promise<boolean>} Sent.
   */
  async function textBookingLink(fleetId, fleet, phone, name, callSid) {
    const token = crypto.randomBytes(12).toString("base64url");
    await db.collection("bookingLinks").doc(token).set({fleetId,
      fleetName: fleet.name || "", phone, name: name || "", callSid,
      createdAt: iso(), expiresAt: Date.now() + LINK_HOURS * 3600 * 1000,
      lookups: 0, rideId: null});
    return sendText(fleet, phone, `${fleet.name}: book your taxi here ` +
      `${LINK_BASE}${token} (the link works for ${LINK_HOURS} hours).`);
  }

  /* ------------------------------ the call --------------------------- */

  /**
   * Starts the bot on a call nobody in the office could take.
   * @param {Object} c {fleetId, fleet, ref, from, reason}
   * @return {Promise<string>} TwiML.
   */
  async function start(c) {
    const card = await customerCard(c.fleetId, c.from);
    const hello = card.name ? `Hello ${firstName(card.name)}. ` : "";
    const line = (c.reason === "busy" ?
      `${hello}Thank you for calling ${c.fleet.name}. Our team are all ` +
        "busy, so I'm the booking assistant and I can book your taxi now. " :
      `Sorry to keep you waiting. ${hello}I'm the booking assistant, and I ` +
        "can book your taxi now. ") +
      "If you'd rather wait for a person, just say operator. " +
      "Where would you like to be picked up from?";
    const bot = {startedAt: iso(), reason: c.reason, stage: "collect",
      turns: 0, silent: 0, tries: {pickup: 0, dropoff: 0}, slots: {},
      card, transcript: [{who: "bot", text: line}]};
    await c.ref.set({status: "bot", bot}, {merge: true});
    return ask(c.fleetId, line);
  }

  /**
   * One answer from the caller (fleetVoice?step=bot).
   * @param {Object} p Twilio params (SpeechResult, Digits).
   * @param {Object} req Request (query: fleet).
   * @return {Promise<string>} TwiML.
   */
  async function turn(p, req) {
    const fleetId = String(req.query.fleet || "");
    const ref = callRef(fleetId, p.CallSid);
    const [callSnap, fleetSnap] = await Promise.all([ref.get(),
      db.collection("fleets").doc(fleetId).get()]);
    const call = callSnap.data() || {};
    const fleet = fleetSnap.data() || {};
    const bot = call.bot;
    if (!bot || bot.outcome) return "<Hangup/>";
    const c = {fleetId, fleet, ref, call, bot, from: call.from};
    const lastLine = [...bot.transcript].reverse()
        .find((t) => t.who === "bot");
    const speech = text(p.SpeechResult, 400);
    const digit = String(p.Digits || "").slice(0, 1);
    bot.turns += 1;

    if (!speech && !digit) {
      bot.silent = (bot.silent || 0) + 1;
      if (bot.silent >= 2) return backup(c, "silent");
      await ref.update({bot});
      return ask(fleetId, "Sorry, I didn't catch that. " +
        (lastLine ? lastLine.text : "How can I help?"));
    }
    bot.silent = 0;
    bot.transcript.push({who: "caller",
      text: speech || `(pressed ${digit})`});
    if (bot.turns > MAX_TURNS) return backup(c, "too_long");

    if (bot.stage === "offer_link") {
      const yes = digit === "1" ||
        /\b(yes|yeah|yep|please|ok|okay|sure|text)\b/i.test(speech);
      return yes ? linkAndGoodbye(c) : toOperator(c, true);
    }

    let r;
    if (digit === "0") {
      r = {intent: "operator"};
    } else if (bot.stage === "confirm" && digit === "1") {
      r = {intent: "confirm_yes"};
    } else if (bot.stage === "confirm" && digit === "2") {
      r = {intent: "confirm_no", say: "No problem. What would you like " +
        "to change?"};
    } else {
      try {
        r = await understand(c);
      } catch (error) {
        console.error("Phone bot: AI", error.message);
        return backup(c, "error");
      }
    }

    if (r.intent === "operator") return toOperator(c, false);
    if (r.intent === "goodbye") {
      return end(c, "hung_up", "No problem. Thank you for calling " +
        `${fleet.name}. Goodbye.`);
    }
    if (r.intent === "text_link") {
      if (isMobile(c.from)) return linkAndGoodbye(c);
      r.say = "Sorry, I can only text a mobile number. " + (r.say || "");
    }

    // Take in what they said.
    const s = bot.slots;
    const notes = [];
    let changed = false;
    for (const leg of ["pickup", "dropoff"]) {
      const idx = r[`${leg}_saved`];
      const query = r[`${leg}_query`];
      let place = null;
      if (Number.isInteger(idx) && bot.card.addresses[idx - 1]) {
        place = bot.card.addresses[idx - 1];
      } else if (query) {
        const near = (s.pickup || bot.card.addresses[0] || null);
        place = await booking.placeFromText(query, near).catch(() => null);
        if (!place) {
          bot.tries[leg] = (bot.tries[leg] || 0) + 1;
          notes.push(leg);
          if (bot.tries[leg] >= MAX_ADDRESS_TRIES) {
            return backup(c, "address");
          }
        }
      }
      if (place) {
        // Saying the same address again is not a change.
        if (!s[leg] || s[leg].address !== place.address) changed = true;
        s[leg] = {latitude: place.latitude, longitude: place.longitude,
          address: place.address};
        bot.tries[leg] = 0;
      }
    }
    let timeProblem = "";
    if (r.when_now === true) {
      if (!s.when || !s.when.now) changed = true;
      s.when = {now: true};
    } else if (r.when_local) {
      const at = londonToMs(r.when_local);
      if (!at || at < Date.now() - 5 * 60 * 1000) {
        timeProblem = "Sorry, that time has already passed. What time " +
          "would you like the taxi?";
      } else if (at > Date.now() + MAX_DAYS_AHEAD * 24 * 3600 * 1000) {
        timeProblem = `Sorry, I can only book up to ${MAX_DAYS_AHEAD} days ` +
          "ahead. When would you like the taxi?";
      } else {
        // Within ten minutes is as good as now.
        const when = at - Date.now() < 10 * 60 * 1000 ? {now: true} : {at};
        if (!s.when || s.when.now !== when.now || s.when.at !== when.at) {
          changed = true;
        }
        s.when = when;
      }
    }
    if (Number.isInteger(r.passengers) && r.passengers > 0) {
      if (r.passengers > SEATS.RouteXL) return backup(c, "large_group");
      if (s.passengers !== r.passengers) changed = true;
      s.passengers = r.passengers;
    }
    // A name or a note does not change what was read back.
    if (r.name) s.name = text(r.name, 80);
    if (r.notes) {
      s.notes = text([s.notes, r.notes].filter(Boolean).join(". "),
          300);
    }

    // "No" with nothing changed yet: ask what to change before reading the
    // booking back again.
    let holdSummary = false;
    if (bot.stage === "confirm" && !changed) {
      if (r.intent === "confirm_yes") return book(c);
      if (r.intent !== "confirm_no") {
        // Not a clear yes or no: ask again, the booking still stands.
        const again = text(r.say, 300) ||
          "Sorry, shall I book that for you? Say yes, or press 1.";
        bot.transcript.push({who: "bot", text: again});
        await ref.update({bot});
        return ask(fleetId, again);
      }
      holdSummary = true;
    }
    bot.stage = "collect";

    const ready = !holdSummary && s.pickup && s.dropoff && s.when &&
      s.passengers && (s.name || bot.card.name || bot.turns > 10);
    let line;
    if (notes.length) {
      line = `Sorry, I couldn't find that ${notes[0] === "pickup" ?
        "pickup address" : "destination"}. Could you tell me the street ` +
        "and the town, or the postcode?";
    } else if (timeProblem) {
      line = timeProblem;
    } else if (ready) {
      let quote;
      try {
        quote = await booking.quoteOne(s.pickup, s.dropoff,
            rideTypeFor(s.passengers));
      } catch (error) {
        console.error("Phone bot: quote", error.message);
        return backup(c, "route");
      }
      s.fare = quote.total;
      bot.stage = "confirm";
      const people = `${s.passengers} ${s.passengers === 1 ? "passenger" :
        "passengers"}`;
      line = `So that's a taxi from ${spoken(s.pickup.address)} to ` +
        `${spoken(s.dropoff.address)}, ${s.when.now ? "as soon as possible" :
          whenWords(s.when.at)}, for ${people}` +
        `${rideTypeFor(s.passengers) === "RouteXL" ? " in a larger car" :
          ""}. The fare is about £${quote.total.toFixed(2)}. Shall I book ` +
        "it? Say yes, or press 1.";
    } else {
      line = text(r.say, 300) || "Sorry, could you say that again?";
    }
    bot.transcript.push({who: "bot", text: line});
    await ref.update({bot});
    return ask(fleetId, line);
  }

  /**
   * Asks the AI what the caller said.
   * @param {Object} c Call context.
   * @return {Promise<Object>} REPLY_SCHEMA object.
   */
  async function understand(c) {
    const {bot, fleet} = c;
    const s = bot.slots;
    const now = london(Date.now());
    const saved = bot.card.addresses.map((a, i) =>
      `${i + 1}. ${a.label ? a.label + ": " : ""}${a.address}`).join("\n");
    const state = [
      `Taxi firm: ${fleet.name}`,
      `Now in the UK: ${now.weekday} ${now.day} ${MONTHS[now.month - 1]} ` +
        `${now.year}, ${String(now.hour).padStart(2, "0")}:` +
        `${String(now.minute).padStart(2, "0")}`,
      `Caller's name: ${s.name || bot.card.name || "not known yet"}`,
      `Caller's saved addresses:\n${saved || "none"}`,
      "Booking so far:",
      `- Pickup: ${s.pickup ? s.pickup.address : "not given yet"}`,
      `- Destination: ${s.dropoff ? s.dropoff.address : "not given yet"}`,
      `- When: ${s.when ? (s.when.now ? "as soon as possible" :
        whenWords(s.when.at)) : "not given yet"}`,
      `- Passengers: ${s.passengers || "not given yet"}`,
      bot.stage === "confirm" ?
        "The caller has just been read the booking and the fare, and " +
          "asked whether to book it." : "Still collecting the details.",
      "",
      "The call so far:",
      bot.transcript.map((t) =>
        `${t.who === "bot" ? "Assistant" : "Caller"}: ${t.text}`).join("\n"),
    ].join("\n");
    const url = `${AI_BASE}/client/v4/accounts/` +
      `${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${BOT_MODEL}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {"Authorization": `Bearer ${process.env.CLOUDFLARE_AI_TOKEN}`,
        "Content-Type": "application/json"},
      body: JSON.stringify({
        messages: [{role: "system", content: SYSTEM},
          {role: "user", content: state}],
        response_format: {type: "json_schema", json_schema: REPLY_SCHEMA},
        max_tokens: 400,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success || !body.result) {
      const e = (body.errors || [])[0];
      throw new Error(`Workers AI ${res.status} ${e ? e.message : ""}`);
    }
    // JSON mode gives an object, though older answers came as text.
    let r = body.result.response;
    if (typeof r === "string") r = JSON.parse(r);
    return tidyReply(r);
  }

  /**
   * Checks the model's answer field by field, since an open model can
   * stray from the schema: anything malformed becomes null.
   * @param {Object} r Raw answer.
   * @return {Object} REPLY_SCHEMA object.
   */
  function tidyReply(r) {
    if (!r || typeof r !== "object") throw new Error("no answer");
    if (!INTENTS.includes(r.intent)) throw new Error("no intent");
    const str = (v) => typeof v === "string" && v.trim() ? v.trim() : null;
    const int = (v) => {
      const n = typeof v === "string" ? Number(v) : v;
      return Number.isInteger(n) && n > 0 ? n : null;
    };
    const bool = (v) => v === true || v === "true" ? true :
      (v === false || v === "false" ? false : null);
    const when = str(r.when_local);
    return {
      intent: r.intent,
      pickup_query: str(r.pickup_query),
      pickup_saved: int(r.pickup_saved),
      dropoff_query: str(r.dropoff_query),
      dropoff_saved: int(r.dropoff_saved),
      when_now: bool(r.when_now),
      when_local: when && /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(when) ? when :
        null,
      passengers: int(r.passengers),
      name: str(r.name),
      notes: str(r.notes),
      say: str(r.say) || "",
    };
  }

  /**
   * Books the job the caller agreed to.
   * @param {Object} c Call context.
   * @return {Promise<string>} TwiML.
   */
  async function book(c) {
    const {bot, fleet, fleetId} = c;
    const s = bot.slots;
    let result;
    try {
      result = await booking.bookPhoneJob({uid: null, fleetId, fleet,
        manager: {name: "Booking bot"},
        bookedBy: {uid: null, name: "Booking bot", via: "bot"}}, {
        customer: {phone: c.from, name: s.name || bot.card.name || ""},
        pickup: s.pickup,
        dropoff: s.dropoff,
        rideType: rideTypeFor(s.passengers),
        pickupAt: s.when.now ? null : new Date(s.when.at).toISOString(),
        dispatchMode: "all",
        collectBy: "cash",
        notes: [`${s.passengers} passenger${s.passengers === 1 ? "" : "s"}`,
          s.notes].filter(Boolean).join(". "),
      });
    } catch (error) {
      console.error("Phone bot: booking", error.message);
      return backup(c, "book_failed");
    }
    bot.rideId = result.rideId;
    await db.collection("fleets").doc(fleetId).update({
      [`phoneUsage.${monthKey()}.botBookings`]: FieldValue.increment(1),
    }).catch(() => null);
    const when = s.when.now ? "A driver will be on the way shortly." :
      `We'll send your taxi for ${whenWords(s.when.at)}.`;
    let texted = false;
    if (isMobile(c.from)) {
      texted = await sendText(fleet, c.from, `${fleet.name}: your taxi is ` +
        `booked. From ${spoken(s.pickup.address)}, ` +
        `${s.when.now ? "now" : whenWords(s.when.at)}, to ` +
        `${spoken(s.dropoff.address)}. Fare about £${result.fare.toFixed(2)}` +
        ", pay the driver. Call us to change it.");
    }
    return end(c, "booked", `That's booked. ${when} ` +
      `${texted ? "I've sent you a text with the details. " : ""}` +
      `Thank you for calling ${fleet.name}. Goodbye.`);
  }

  const monthKey = () => new Intl.DateTimeFormat("en-CA",
      {timeZone: "Europe/London", year: "numeric", month: "2-digit"})
      .format(new Date()).slice(0, 7);

  /**
   * Ends the bot's part of the call.
   * @param {Object} c Call context.
   * @param {string} outcome booked | link_sent | hung_up
   * @param {string} line Last words.
   * @return {Promise<string>} TwiML.
   */
  async function end(c, outcome, line) {
    c.bot.outcome = outcome;
    c.bot.endedAt = iso();
    c.bot.transcript.push({who: "bot", text: line});
    await c.ref.update({bot: c.bot,
      status: outcome === "hung_up" ? "missed" : "completed",
      endedAt: iso()});
    return say(line) + "<Hangup/>";
  }

  /**
   * Texts the booking link and says goodbye.
   * @param {Object} c Call context.
   * @return {Promise<string>} TwiML.
   */
  async function linkAndGoodbye(c) {
    const sent = await textBookingLink(c.fleetId, c.fleet, c.from,
        c.bot.slots.name || c.bot.card.name, c.ref.id)
        .catch((e) => {
          console.error("Booking link", e.message);
          return false;
        });
    if (!sent) return toOperator(c, true);
    return end(c, "link_sent", "I've sent you a text with a link to book " +
      `your taxi. Thank you for calling ${c.fleet.name}. Goodbye.`);
  }

  /**
   * Back to the office queue. If nobody is free and the caller has a
   * mobile, offer the booking link first.
   * @param {Object} c Call context.
   * @param {boolean} offered Already offered the link.
   * @return {Promise<string>} TwiML.
   */
  async function toOperator(c, offered) {
    const free = await freeOperatorCount(c.fleetId).catch(() => 0);
    if (!free && !offered && isMobile(c.from)) {
      c.bot.stage = "offer_link";
      const line = "Everyone in the office is busy at the moment. I can " +
        "text you a link to book online instead. Would you like that? Say " +
        "yes or press 1, or say no to hold for a person.";
      c.bot.transcript.push({who: "bot", text: line});
      await c.ref.update({bot: c.bot});
      return ask(c.fleetId, line);
    }
    c.bot.outcome = "to_operator";
    c.bot.endedAt = iso();
    await c.ref.update({bot: c.bot, status: "ringing"});
    return say(free ? "Putting you through. Please hold." :
      "Please hold for the next person.") +
      `<Redirect method="POST">${xml(voiceUrl({step: "incoming",
        fleet: c.fleetId, round: 2, nobot: 1}))}</Redirect>`;
  }

  /**
   * When the bot cannot finish: the booking link to a mobile, else the
   * office queue.
   * @param {Object} c Call context.
   * @param {string} why For the call log.
   * @return {Promise<string>} TwiML.
   */
  async function backup(c, why) {
    c.bot.gaveUp = why;
    if (isMobile(c.from)) {
      const sent = await textBookingLink(c.fleetId, c.fleet, c.from,
          c.bot.slots.name || c.bot.card.name, c.ref.id).catch(() => false);
      if (sent) {
        return end(c, "link_sent", "Sorry, I couldn't finish your booking " +
          "on the phone. I've sent you a text with a link to book it in a " +
          `minute. Thank you for calling ${c.fleet.name}. Goodbye.`);
      }
    }
    return toOperator(c, true);
  }

  /**
   * At the end of the call: how long the bot talked, for the monthly
   * totals, and a caller who hung up on the bot counts as missed.
   * @param {Object} call phoneCalls data.
   * @return {Object} {seconds, missed, patch}
   */
  function onCallEnded(call) {
    const b = call.bot;
    if (!b || !b.startedAt) return {seconds: 0, missed: false, patch: null};
    const endMs = b.endedAt ? Date.parse(b.endedAt) : Date.now();
    // At least a second, so every bot call counts a minute (rounded up).
    const seconds = Math.max(1, Math.round((endMs -
      Date.parse(b.startedAt)) / 1000));
    if (b.outcome) return {seconds, missed: false, patch: null};
    return {seconds, missed: true, patch: {"status": "missed",
      "endedAt": iso(), "bot.outcome": "hung_up", "bot.endedAt": iso()}};
  }

  /* ------------------------------ settings --------------------------- */

  /* The owner switches the booking bot on or off. */
  out.saveFleetPhoneBot = functions.runWith({secrets: AI_SECRETS})
      .https.onCall(async (data, context) => {
        const me = await deps.assertFleetManager(context, true);
        const on = Boolean(data && data.enabled);
        // Without its keys the bot never answers (enabled() above), so do not
        // let the switch say On.
        if (on && !(process.env.CLOUDFLARE_ACCOUNT_ID &&
        process.env.CLOUDFLARE_AI_TOKEN)) {
          throw new functions.https.HttpsError("failed-precondition",
              "The booking bot is not set up yet. Please contact TakeARoute.");
        }
        await db.collection("fleets").doc(me.fleetId).update({
          phoneBot: {enabled: on, updatedAt: iso(), updatedBy: me.uid}});
        return {enabled: on};
      });

  /* --------------------------- booking links ------------------------- */

  /**
   * A booking link and its fleet, or throws.
   * @param {*} token From the page.
   * @param {boolean=} forBooking Refuse a used link.
   * @return {Promise<Object>} {ref, link, fleet}
   */
  async function linkFor(token, forBooking) {
    const t = typeof token === "string" ? token : "";
    if (!/^[A-Za-z0-9_-]{16}$/.test(t)) {
      throw new HttpsError("not-found", "This booking link is not valid.");
    }
    const ref = db.collection("bookingLinks").doc(t);
    const snap = await ref.get();
    const link = snap.exists ? snap.data() : null;
    if (!link || Date.now() > Number(link.expiresAt || 0)) {
      throw new HttpsError("not-found", "This booking link has expired. " +
        "Please call us to book.");
    }
    if (forBooking && link.rideId) {
      throw new HttpsError("failed-precondition",
          "This link has already been used to book a taxi.");
    }
    const fleetSnap = await db.collection("fleets").doc(link.fleetId).get();
    const fleet = fleetSnap.exists ? fleetSnap.data() : null;
    if (!fleet || fleet.status === "suspended") {
      throw new HttpsError("failed-precondition",
          "Bookings are not available at the moment. Please call us.");
    }
    return {ref, link, fleet};
  }

  /**
   * Counts an address lookup against the link, so one link cannot be used
   * to run up the maps bill.
   * @param {Object} ref Link doc.
   * @return {Promise<void>}
   */
  async function countLookup(ref) {
    const n = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const used = Number(snap.data().lookups || 0) + 1;
      tx.update(ref, {lookups: used});
      return used;
    });
    if (n > LINK_LOOKUPS) {
      throw new HttpsError("resource-exhausted",
          "Too many searches on this link. Please call us to book.");
    }
  }

  /* What the booking page shows first. */
  out.bookingLinkInfo = functions.https.onCall(async (data) => {
    const {link, fleet} = await linkFor(data && data.token);
    const card = await customerCard(link.fleetId, link.phone);
    let booked = null;
    if (link.rideId) {
      const ride = (await db.collection("rides").doc(link.rideId).get())
          .data() || {};
      booked = {pickup: ride.pickupLocation && ride.pickupLocation.address,
        dropoff: ride.dropoffLocation && ride.dropoffLocation.address,
        fare: ride.fare && ride.fare.total, status: ride.status || ""};
    }
    return {fleetName: fleet.name || link.fleetName || "",
      name: link.name || card.name || "",
      phoneEnding: String(link.phone).slice(-3),
      saved: card.addresses.slice(0, 5),
      maxPassengers: SEATS.RouteXL, booked};
  });

  out.bookingLinkPlaces = functions.https.onCall(async (data) => {
    const {ref} = await linkFor(data && data.token);
    await countLookup(ref);
    return {results: await booking.placeSearch(data)};
  });

  out.bookingLinkPlace = functions.https.onCall(async (data) => {
    const {ref} = await linkFor(data && data.token);
    await countLookup(ref);
    return booking.placeDetails(data);
  });

  out.bookingLinkQuote = functions.https.onCall(async (data) => {
    const {ref} = await linkFor(data && data.token, true);
    const pickup = booking.point(data && data.pickup);
    const dropoff = booking.point(data && data.dropoff);
    if (!pickup || !dropoff) {
      throw new HttpsError("invalid-argument",
          "Choose a pickup and a destination.");
    }
    await countLookup(ref);
    const q = await booking.quoteOne(pickup, dropoff,
        rideTypeFor(data.passengers));
    return {fare: q.total, currency: q.currency,
      durationMinutes: q.durationMinutes};
  });

  /* Books the taxi. One booking per link. */
  out.bookingLinkBook = functions.https.onCall(async (data) => {
    const d = data || {};
    const {ref, link, fleet} = await linkFor(d.token, true);
    const passengers = Math.round(Number(d.passengers) || 1);
    if (passengers < 1 || passengers > SEATS.RouteXL) {
      throw new HttpsError("invalid-argument", `For more than ` +
        `${SEATS.RouteXL} passengers, please call us.`);
    }
    // Claim the link first, so two taps cannot book twice.
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.data().rideId || snap.data().booking) {
        throw new HttpsError("failed-precondition",
            "This link has already been used to book a taxi.");
      }
      tx.update(ref, {booking: iso()});
    });
    let result;
    try {
      result = await booking.bookPhoneJob({uid: null, fleetId: link.fleetId,
        fleet, manager: {name: "Booking link"},
        bookedBy: {uid: null, name: "Booking link", via: "link"}}, {
        customer: {phone: link.phone, name: text(d.name, 80) || link.name},
        pickup: d.pickup,
        dropoff: d.dropoff,
        rideType: rideTypeFor(passengers),
        pickupAt: d.pickupAt || null,
        dispatchMode: "all",
        collectBy: "cash",
        notes: [`${passengers} passenger${passengers === 1 ? "" : "s"}`,
          text(d.notes, 300)].filter(Boolean).join(". "),
      });
    } catch (error) {
      await ref.update({booking: FieldValue.delete()}).catch(() => null);
      throw error;
    }
    await ref.update({rideId: result.rideId, bookedAt: iso()});
    return {rideId: result.rideId, status: result.status, fare: result.fare};
  });

  return {out, enabled, start, turn, onCallEnded, AI_SECRETS, sendText,
    customerCard,
    allSecrets: TWILIO_SECRETS.concat(AI_SECRETS)};
};
