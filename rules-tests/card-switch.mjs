// A cash trip paid by card instead (functions/cardSwitch.js), through the
// real rules and functions: the passenger switching in the app (a hold
// during the trip, a charge after it), the driver's payment link (QR and
// text, the page, Stripe's webhook), never paid twice either way or by both
// at once, the time window, taxi firm jobs, and the driver paid as on any
// card job.
// Run like tips.mjs (see README): STRIPE_API_BASE and TWILIO_API_BASE =
// http://127.0.0.1:8999 in functions/.env.local, dummy Stripe secrets and
// the test Twilio ones in functions/.secret.local. Fake Stripe and Twilio
// on :8999.
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';

/* ------------------------------ fakes ------------------------------ */
// Fake Stripe: PaymentIntents, Checkout pages, ephemeral keys, refunds.
// The tests play the passenger's phone and Stripe's page by changing
// what the fake holds (confirm, payLink).
const intents = {};
const sessions = {};
const refunds = [];
const texts = [];
const calls = [];
let made = 0;
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const form = (body) => {
  const out = {};
  for (const [k, v] of new URLSearchParams(body)) out[k] = v;
  return out;
};
const metaOf = (f, prefix) => Object.fromEntries(Object.entries(f)
  .filter(([k]) => k.startsWith(`${prefix}[`) && k.split('[').length === prefix.split('[').length + 1)
  .map(([k, v]) => [k.slice(prefix.length + 1, -1), v]));
const pmObject = (id) => id ? { id, object: 'payment_method', card: { last4: id === 'pm_amex' ? '0005' : '4242', brand: id === 'pm_amex' ? 'amex' : 'visa' } } : null;
const piOut = (pi, url) => {
  const o = { ...pi };
  if (url.includes('payment_method')) o.payment_method = pmObject(pi.payment_method);
  if (url.includes('latest_charge')) o.latest_charge = { id: 'ch_1', balance_transaction: { fee: 36 } };
  return o;
};
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const f = form(body);
    const url = decodeURIComponent(req.url);
    if (url.includes('/Messages.json')) {
      texts.push({ to: f.To, from: f.From, body: f.Body });
      return json(res, 201, { sid: `SM${texts.length}` });
    }
    if (url.startsWith('/v1/ephemeral_keys')) return json(res, 200, { id: 'ephkey_1', secret: 'ek_test_secret' });
    if (url.startsWith('/v1/customers')) return json(res, 200, { id: 'cus_new' });
    if (url.startsWith('/v1/refunds')) {
      refunds.push(f.payment_intent);
      return json(res, 200, { id: `re_${refunds.length}`, payment_intent: f.payment_intent, status: 'succeeded' });
    }
    let m = url.match(/^\/v1\/checkout\/sessions(?:\/([^/?]+))?(?:\/(expire))?/);
    if (m) {
      const [, id, op] = m;
      if (!id && req.method === 'POST') {
        made += 1;
        const cs = {
          id: `cs_${made}`, object: 'checkout.session', status: 'open', payment_status: 'unpaid',
          url: `https://checkout.stripe.test/cs_${made}`, amount_total: Number(f['line_items[0][price_data][unit_amount]']),
          currency: f['line_items[0][price_data][currency]'], metadata: metaOf(f, 'metadata'),
          piMeta: metaOf(f, 'payment_intent_data[metadata]'), payment_intent: null,
          expires_at: Number(f.expires_at), success_url: f.success_url, key: req.headers['idempotency-key'],
        };
        sessions[cs.id] = cs;
        calls.push({ op: 'session', id: cs.id, amount: cs.amount_total });
        return json(res, 200, cs);
      }
      const cs = sessions[id];
      if (!cs) return json(res, 404, { error: { type: 'invalid_request_error', message: 'No such session' } });
      if (op === 'expire') {
        if (cs.status !== 'open') return json(res, 400, { error: { type: 'invalid_request_error', message: 'Session is not open' } });
        cs.status = 'expired';
        calls.push({ op: 'expire', id });
        return json(res, 200, cs);
      }
      const o = { ...cs };
      if (cs.payment_intent && url.includes('expand')) o.payment_intent = piOut(intents[cs.payment_intent], url);
      return json(res, 200, o);
    }
    m = url.match(/^\/v1\/payment_intents(?:\/([^/?]+))?(?:\/(capture|cancel))?/);
    if (!m) return json(res, 404, { error: { message: 'not faked' } });
    const [, id, op] = m;
    if (!id && req.method === 'POST') {
      made += 1;
      const manual = f.capture_method === 'manual';
      const pi = {
        id: `pi_${made}`, object: 'payment_intent', amount: Number(f.amount), currency: f.currency,
        customer: f.customer, payment_method: f.payment_method || null, capture_method: manual ? 'manual' : 'automatic',
        status: f.payment_method && f.confirm === 'true' ? (manual ? 'requires_capture' : 'succeeded') : 'requires_payment_method',
        client_secret: `pi_${made}_secret`, metadata: metaOf(f, 'metadata'), key: req.headers['idempotency-key'],
      };
      if (pi.status === 'succeeded') pi.amount_received = pi.amount;
      intents[pi.id] = pi;
      calls.push({ op: 'create', id: pi.id, amount: pi.amount, manual, type: pi.metadata.type });
      return json(res, 200, pi);
    }
    const pi = intents[id];
    if (!pi) return json(res, 404, { error: { type: 'invalid_request_error', message: 'No such payment_intent' } });
    if (!op) return json(res, 200, piOut(pi, url));
    if (op === 'capture') {
      if (pi.status !== 'requires_capture') return json(res, 400, { error: { type: 'invalid_request_error', message: 'Not capturable' } });
      pi.status = 'succeeded';
      pi.amount_received = Number(f.amount_to_capture || pi.amount);
      calls.push({ op: 'capture', id, amount: pi.amount_received });
      return json(res, 200, pi);
    }
    if (['succeeded', 'canceled'].includes(pi.status)) {
      return json(res, 400, { error: { type: 'invalid_request_error', message: `Cannot cancel a ${pi.status} PaymentIntent` } });
    }
    pi.status = 'canceled';
    calls.push({ op: 'cancel', id });
    return json(res, 200, pi);
  });
});
await new Promise((r) => fake.listen(8999, '127.0.0.1', r));

/** The passenger's phone completing Stripe's payment sheet. */
const confirm = (piId, pm = 'pm_visa') => {
  const pi = intents[piId];
  pi.payment_method = pm;
  pi.status = pi.capture_method === 'manual' ? 'requires_capture' : 'succeeded';
  if (pi.status === 'succeeded') pi.amount_received = pi.amount;
};
/** The customer paying on Stripe's Checkout page. */
const payLink = (csId, pm = 'pm_amex') => {
  const cs = sessions[csId];
  made += 1;
  const pi = { id: `pi_${made}`, object: 'payment_intent', amount: cs.amount_total, amount_received: cs.amount_total, currency: cs.currency, payment_method: pm, status: 'succeeded', metadata: cs.piMeta };
  intents[pi.id] = pi;
  Object.assign(cs, { status: 'complete', payment_status: 'paid', payment_intent: pi.id });
  return pi;
};
/** Stripe calling the webhook, signed with the test secret. */
let events = 0;
async function webhook(type, object) {
  events += 1;
  const payload = JSON.stringify({ id: `evt_${events}`, object: 'event', type, data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', 'whsec_dummy').update(`${t}.${payload}`).digest('hex');
  const r = await fetch('http://127.0.0.1:5001/demo-tar/us-central1/stripeWebhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${sig}` }, body: payload,
  });
  assert.equal(r.status, 200, await r.text());
}

/* ------------------------------ harness ------------------------------ */
const PROJECT = 'demo-tar';
const mk = (name) => {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'fake', authDomain: 'x' }, name);
  const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const fn = getFunctions(app, 'us-central1'); connectFunctionsEmulator(fn, '127.0.0.1', 5001);
  return { auth, db, call: (n, d) => httpsCallable(fn, n, { timeout: 300000 })(d).then((r) => r.data) };
};
const REST = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const H = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const enc = (v) => v instanceof Date ? { timestampValue: v.toISOString() }
  : typeof v === 'boolean' ? { booleanValue: v }
  : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : typeof v === 'string' ? { stringValue: v }
  : v === null ? { nullValue: null }
  : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } }
  : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
async function adminSet(path, data, mask = false) {
  const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)]));
  const q = mask ? '?' + Object.keys(data).map((k) => 'updateMask.fieldPaths=' + k).join('&') : '';
  const r = await fetch(`${REST}/${path}${q}`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields }) });
  if (!r.ok) throw new Error(await r.text());
}
const val = (f) => {
  if (!f) return undefined;
  if ('integerValue' in f) return Number(f.integerValue);
  if ('doubleValue' in f) return f.doubleValue;
  if ('nullValue' in f) return null;
  if ('mapValue' in f) return Object.fromEntries(Object.entries(f.mapValue.fields || {}).map(([k, x]) => [k, val(x)]));
  if ('arrayValue' in f) return (f.arrayValue.values || []).map(val);
  return f.stringValue ?? f.booleanValue ?? f.timestampValue;
};
const get = async (path) => {
  const fields = (await (await fetch(`${REST}/${path}`, { headers: H })).json()).fields;
  return fields ? Object.fromEntries(Object.entries(fields).map(([k, x]) => [k, val(x)])) : null;
};
const list = async (path) => ((await (await fetch(`${REST}/${path}?pageSize=300`, { headers: H })).json()).documents || [])
  .map((d) => Object.fromEntries(Object.entries(d.fields || {}).map(([k, x]) => [k, val(x)])));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Up to 3 minutes: every ride write wakes some 30 triggers in the emulator,
// one after another, so a busy run can fall a minute or more behind.
async function until(check, what, tries = 720) {
  for (let i = 0; i < tries; i++) {
    const got = await check();
    if (got) return got;
    await sleep(250);
  }
  throw new Error('Timed out waiting for ' + what);
}
const step = (s) => console.log('•', s);
async function refused(promise, pattern, code) {
  try {
    await promise;
  } catch (e) {
    if (code) assert.equal(e.code, code, e.message);
    if (pattern) assert.match(e.message, pattern);
    return e;
  }
  throw new Error('expected a refusal');
}
const balance = async (path) => Number((await get(path))?.availableBalance || 0);

/* ------------------------------ people ------------------------------ */
const R = mk('rider'), DR = mk('driver'), ANON = mk('anon');
const rider = (await createUserWithEmailAndPassword(R.auth, 'rider-cs@test.dev', 'secret123')).user.uid;
const driverId = (await createUserWithEmailAndPassword(DR.auth, 'driver-cs@test.dev', 'secret123')).user.uid;
const config = (cardSwitch = {}) => adminSet('config/app', { currency: 'GBP', cardSwitch: { enabled: 1, windowMinutes: 30, fleetJobs: 0, ...cardSwitch } });
await config();
await adminSet(`riders/${rider}`, { stripeCustomerId: 'cus_r', phoneNumber: '+447700900111', fullName: 'Rita Rider' });
await adminSet(`drivers/${driverId}`, { approved: true, firstName: 'Dan', status: 'on_ride', isOnRide: true, location: { latitude: 52.3, longitude: -1.9 } });
await adminSet(`driverWallets/${driverId}`, { availableBalance: 0, totalEarned: 0, currency: 'GBP' });

const P = { latitude: 52.30, longitude: -1.9, address: 'Pickup Street, Redditch' };
const D = { latitude: 52.35, longitude: -1.9, address: 'Booked Road, Redditch' };
let n = 0;
/** A cash trip under way. 6½ minutes waiting at pickup: 2 started minutes
    over the 5 free, at 25p, so 50p on top of the fare. */
async function seedTrip(extra = {}) {
  n += 1;
  const id = `cstrip${n}`;
  const t = Date.now();
  await adminSet(`rides/${id}`, {
    riderId: rider, driverId, status: 'ongoing', rideType: 'RouteMini', source: 'app',
    pickupLocation: P, dropoffLocation: D, stops: [], stopsCompleted: 0,
    fare: { total: 10, subtotal: 8.33, vat: 1.67, vatPercent: 20, currency: 'GBP' },
    fareEstimate: 10, currency: 'gbp', paymentMethod: 'cash', walletProcessed: false,
    arrivedAt: new Date(t - 20 * 60000), startedAt: new Date(t - 13.5 * 60000),
    ...extra,
  });
  return id;
}
const complete = (rideId, extra = {}) => updateDoc(doc(DR.db, 'rides', rideId), {
  status: 'completed', completedAt: serverTimestamp(), expiresAt: serverTimestamp(), ...extra,
});
/** Completed without cash taken (the driver chose card), and settled. */
async function finishedTrip(extra = {}) {
  const id = await seedTrip(extra);
  await complete(id);
  await until(async () => (await get(`rides/${id}`)).paymentStatus === 'cash', `the fare of ${id} settled`);
  return id;
}
const ride = (id) => get(`rides/${id}`);
const earnings = async () => (await list(`driverWallets/${driverId}/transactions`)).filter((t) => t.type === 'ride_earning');

/* ----------------- 1. in the app, during the trip: a hold ----------------- */
step('during the trip: "Pay by card instead" makes a hold for the fare so far (fare + waiting), for the payment sheet');
const a = await seedTrip();
let res = await R.call('cardSwitchStart', { rideId: a });
assert.equal(res.state, 'pending'); assert.equal(res.hold, true); assert.equal(res.amount, 10.5);
assert.equal(res.customerId, 'cus_r'); assert.equal(res.ephemeralKey, 'ek_test_secret');
const aPi = Object.values(intents).find((p) => p.client_secret === res.clientSecret);
assert.equal(aPi.amount, 1050); assert.equal(aPi.capture_method, 'manual'); assert.equal(aPi.metadata.type, 'card_switch');
assert.equal(aPi.payment_method, null, 'the passenger picks the card on their own phone');

step('a second tap gives the same payment, not a second one');
const created = calls.filter((c) => c.op === 'create').length;
res = await R.call('cardSwitchStart', { rideId: a });
assert.equal(res.clientSecret, aPi.client_secret);
assert.equal(calls.filter((c) => c.op === 'create').length, created);

step('the driver cannot start a link while the trip is under way, nor anyone else\'s payment');
await refused(DR.call('cardLinkStart', { rideId: a }), /Complete the trip first/);
await refused(DR.call('cardSwitchStart', { rideId: a }), /Not your trip/, 'functions/permission-denied');

step('nothing counts until Stripe has it: before the phone confirms, still pending');
res = await R.call('cardSwitchStatus', { rideId: a });
assert.equal(res.state, 'pending');
assert.equal((await ride(a)).paymentMethod, 'cash');

step('the phone confirms (3D Secure there): the ride becomes a card ride, held; the driver sees "Paid by card"');
confirm(aPi.id);
res = await R.call('cardSwitchStatus', { rideId: a });
assert.equal(res.state, 'held'); assert.equal(res.cardLast4, '4242');
let r = await ride(a);
assert.equal(r.paymentMethod, 'card'); assert.equal(r.paymentStatus, 'authorized'); assert.equal(r.paymentIntentId, aPi.id);
assert.equal(r.paymentSwitch.from, 'cash'); assert.equal(r.paymentSwitch.method, 'app'); assert.equal(r.paymentSwitch.amount, 10.5);
assert.equal((await get(`payments/${aPi.id}`)).status, 'authorized');

step('an old driver app that only knows cash cannot record cash on it');
await refused(complete(a, { cashCollected: true }), /PERMISSION_DENIED|permission/i);

step('completed: the final fare is captured from the hold and the driver\'s wallet credited as on any card job');
await complete(a);
r = await until(async () => { const x = await ride(a); return x.paymentStatus === 'captured' && x.walletProcessed && x; }, 'the capture and the wallet credit')
  .catch(async (e) => { console.log('RIDE-DUMP', JSON.stringify(await ride(a))); throw e; });
assert.equal(r.fare.finalTotal, 10.5);
assert.deepEqual(calls.filter((c) => c.op === 'capture' && c.id === aPi.id).map((c) => c.amount), [1050]);
assert.equal(await balance(`driverWallets/${driverId}`), 10.5);
assert.equal(r.earnings.driverEarning, 10.5); assert.equal(r.earnings.paidTo, 'driver');
await until(async () => (await ride(a)).paymentSwitch.state === 'paid', 'the switch marked paid');

step('a webhook arriving late (or twice) changes nothing');
await webhook('payment_intent.amount_capturable_updated', { ...aPi, status: 'requires_capture' });
await webhook('payment_intent.succeeded', { ...intents[aPi.id] });
await sleep(1500);
assert.equal(await balance(`driverWallets/${driverId}`), 10.5);
assert.equal((await earnings()).length, 1);
assert.equal((await R.call('cardSwitchStart', { rideId: a })).state, 'paid', 'starting again says it is paid');

/* ----------------- 2. in the app, after the trip: a charge ----------------- */
step('after the trip: a charge for the final fare the server settled (fare + waiting), not a hold');
const b = await finishedTrip();
assert.equal((await ride(b)).fare.finalTotal, 10.5);
res = await R.call('cardSwitchStart', { rideId: b });
assert.equal(res.hold, false); assert.equal(res.amount, 10.5);
const bPi = Object.values(intents).find((p) => p.client_secret === res.clientSecret);
assert.equal(bPi.capture_method, 'automatic'); assert.equal(bPi.amount, 1050);

step('Stripe\'s webhook reports it paid: the ride is paid by card, the driver credited once, even when the webhook comes twice');
confirm(bPi.id, 'pm_amex');
await webhook('payment_intent.succeeded', { ...intents[bPi.id], payment_method: 'pm_amex' });
r = await until(async () => { const x = await ride(b); return x.walletProcessed && x; }, 'the wallet credit after the switch');
assert.equal(r.paymentMethod, 'card'); assert.equal(r.paymentStatus, 'captured'); assert.equal(r.cardLast4, '0005');
assert.equal(r.paymentSwitch.state, 'paid'); assert.equal(r.paymentSwitch.from, 'cash');
assert.equal((await get(`payments/${bPi.id}`)).status, 'captured');
await webhook('payment_intent.succeeded', { ...intents[bPi.id], payment_method: 'pm_amex' });
await sleep(1500);
assert.equal(await balance(`driverWallets/${driverId}`), 21);
assert.equal((await earnings()).filter((t) => t.rideId === b).length, 1);

step('paid by card: the driver can no longer record cash for it');
res = await DR.call('cardSwitchCancel', { rideId: b, cash: true });
assert.equal(res.state, 'paid'); assert.equal((await ride(b)).cashCollected, undefined);

/* ----------------- 3. the driver's link ----------------- */
step('link: the passenger can\'t use the app; the driver completes and asks for card: a Stripe page for the final fare, a QR code and a text');
const c = await finishedTrip({ passengerFor: { name: 'Gran', hasPhone: true } });
await adminSet(`rides/${c}/contact/passenger`, { phone: '+447700900555' });
res = await DR.call('cardLinkStart', { rideId: c });
assert.equal(res.state, 'pending'); assert.equal(res.method, 'link'); assert.equal(res.amount, 10.5);
assert.match(res.url, /^https:\/\/admin\.takearoute\.ltd\/p\/[A-Za-z0-9_-]{22}$/);
assert.ok(res.qr.length >= 21 && res.qr.every((row) => row.length === res.qr.length && /^[01]+$/.test(row)), 'a square QR code');
assert.equal(res.texted, true); assert.equal(res.textedTo, '555');
const cSession = Object.values(sessions).find((s) => s.metadata.rideId === c);
assert.equal(cSession.amount_total, 1050, 'the server\'s final fare');
assert.equal(texts.at(-1).to, '+447700900555'); assert.ok(texts.at(-1).body.includes(res.url)); assert.match(texts.at(-1).body, /£10\.50/);
const token = res.url.split('/p/')[1];

step('a second tap: the same link, no new page and no second text');
const textsBefore = texts.length;
const again = await DR.call('cardLinkStart', { rideId: c });
assert.equal(again.url, res.url); assert.equal(again.texted, false);
assert.equal(Object.values(sessions).filter((s) => s.metadata.rideId === c).length, 1);
assert.equal(texts.length, textsBefore);

step('the driver can text it to another UK mobile, but not type a price or a bad number');
const other = await DR.call('cardLinkStart', { rideId: c, phone: '07700 900777', amount: 1 });
assert.equal(other.textedTo, '777'); assert.equal(other.amount, 10.5);
await refused(DR.call('cardLinkStart', { rideId: c, phone: '0121 496 0000' }), /UK mobile/);

step('the page (no sign-in): what to pay and the Stripe page to pay on');
let page = await ANON.call('cardLinkPage', { token });
assert.equal(page.state, 'pending'); assert.equal(page.amount, 10.5); assert.equal(page.payUrl, cSession.url);
assert.equal(page.pickup, 'Pickup Street'); assert.equal(page.name, 'TakeARoute');
await refused(ANON.call('cardLinkPage', { token: 'x'.repeat(22) }), /isn't valid/);

step('waiting: the driver\'s check asks Stripe; a declined card shows, the page stays open');
made += 1;
intents[`pi_${made}`] = { id: `pi_${made}`, object: 'payment_intent', amount: 1050, status: 'requires_payment_method', metadata: cSession.piMeta, last_payment_error: { message: 'Your card was declined.' } };
cSession.payment_intent = `pi_${made}`;
res = await DR.call('cardSwitchStatus', { rideId: c });
assert.equal(res.state, 'pending'); assert.equal(res.declined, 'Your card was declined.');

step('paid on the page, confirmed by Stripe\'s webhook: "Paid ✓", the driver credited like a card job');
const cPi = payLink(cSession.id);
await webhook('checkout.session.completed', { ...sessions[cSession.id], payment_intent: cPi.id });
r = await until(async () => { const x = await ride(c); return x.walletProcessed && x; }, 'the link payment credited');
assert.equal(r.paymentSwitch.state, 'paid'); assert.equal(r.paymentSwitch.method, 'link'); assert.equal(r.paymentMethod, 'card');
assert.equal(r.paymentIntentId, cPi.id); assert.equal(r.cardLast4, '0005');
assert.equal(await balance(`driverWallets/${driverId}`), 31.5);
assert.equal((await DR.call('cardSwitchStatus', { rideId: c })).state, 'paid');
page = await ANON.call('cardLinkPage', { token });
assert.equal(page.state, 'paid'); assert.equal(page.payUrl, null); assert.equal(page.cardLast4, '0005');
await webhook('payment_intent.succeeded', { ...cPi });
await sleep(1500);
assert.equal(await balance(`driverWallets/${driverId}`), 31.5, 'credited once');

step('link confirmed without any webhook: the driver\'s check finds it paid at Stripe');
const c2 = await finishedTrip();
res = await DR.call('cardLinkStart', { rideId: c2 });
assert.equal(texts.at(-1).to, '+447700900111', 'the passenger\'s own mobile');
payLink(Object.values(sessions).find((s) => s.metadata.rideId === c2).id, 'pm_visa');
res = await DR.call('cardSwitchStatus', { rideId: c2 });
assert.equal(res.state, 'paid'); assert.equal(res.cardLast4, '4242');
await until(async () => (await ride(c2)).walletProcessed, 'c2 credited');

step('a link that runs out: "expired", and a new one can be made');
const c3 = await finishedTrip();
res = await DR.call('cardLinkStart', { rideId: c3 });
const c3s = Object.values(sessions).find((s) => s.metadata.rideId === c3);
c3s.status = 'expired';
assert.equal((await DR.call('cardSwitchStatus', { rideId: c3 })).state, 'expired');
const c3b = await DR.call('cardLinkStart', { rideId: c3 });
assert.notEqual(c3b.url, res.url);
assert.equal((await ANON.call('cardLinkPage', { token: res.url.split('/p/')[1] })).state, 'replaced');

/* ----------------- 4. never paid twice ----------------- */
step('cash first: the driver records cash while the passenger is still on the payment sheet; the card payment is closed');
const d1 = await seedTrip();
res = await R.call('cardSwitchStart', { rideId: d1 });
const d1Pi = Object.values(intents).find((p) => p.client_secret === res.clientSecret);
await complete(d1, { cashCollected: true });
await until(async () => intents[d1Pi.id].status === 'canceled', 'the open card payment cancelled');
r = await until(async () => { const x = await ride(d1); return x.paymentSwitch.state === 'cancelled' && x; }, 'the switch closed');
assert.equal(r.paymentSwitch.endedBy, 'cash'); assert.equal(r.paymentMethod, 'cash');
await refused(R.call('cardSwitchStart', { rideId: d1 }), /already taken cash/);
await refused(DR.call('cardLinkStart', { rideId: d1 }), /already taken cash/);

step('cash recorded, then a card payment lands anyway: refunded, never kept, the driver not credited');
const d2 = await finishedTrip();
res = await R.call('cardSwitchStart', { rideId: d2 });
const d2Pi = Object.values(intents).find((p) => p.client_secret === res.clientSecret);
await DR.call('cardSwitchCancel', { rideId: d2, cash: true });
assert.equal(intents[d2Pi.id].status, 'canceled');
assert.equal((await ride(d2)).cashCollected, true);
intents[d2Pi.id].status = 'succeeded'; intents[d2Pi.id].payment_method = 'pm_visa';
await webhook('payment_intent.succeeded', { ...intents[d2Pi.id] });
await until(async () => refunds.includes(d2Pi.id), 'the refund');
r = await ride(d2);
assert.equal(r.paymentMethod, 'cash'); assert.equal(r.paymentStatus, 'cash'); assert.notEqual(r.walletProcessed, true);

step('card first: paid at Stripe a moment before the driver taps "take cash": the card stands, no cash recorded');
const d3 = await finishedTrip();
res = await R.call('cardSwitchStart', { rideId: d3 });
confirm(Object.values(intents).find((p) => p.client_secret === res.clientSecret).id);
res = await DR.call('cardSwitchCancel', { rideId: d3, cash: true });
assert.equal(res.state, 'paid'); assert.equal((await ride(d3)).cashCollected, undefined);

step('both at once: the driver\'s link closes the passenger\'s open payment, and the other way round; one open at a time');
const e = await finishedTrip();
res = await R.call('cardSwitchStart', { rideId: e });
const ePi = Object.values(intents).find((p) => p.client_secret === res.clientSecret);
await DR.call('cardLinkStart', { rideId: e });
assert.equal(intents[ePi.id].status, 'canceled');
const eS = Object.values(sessions).find((s) => s.metadata.rideId === e);
assert.equal(eS.status, 'open');
res = await R.call('cardSwitchStart', { rideId: e });
assert.equal(eS.status, 'expired');
const ePi2 = Object.values(intents).find((p) => p.client_secret === res.clientSecret);
assert.equal(ePi2.status, 'requires_payment_method');

step('both at once, at the same moment: never two payments open');
const e2 = await finishedTrip();
const both = await Promise.allSettled([R.call('cardSwitchStart', { rideId: e2 }), DR.call('cardLinkStart', { rideId: e2 })]);
assert.ok(both.some((x) => x.status === 'fulfilled'), JSON.stringify(both.map((x) => x.reason?.message)));
const openPis = Object.values(intents).filter((p) => p.metadata?.rideId === e2 && !['canceled'].includes(p.status));
const openLinks = Object.values(sessions).filter((s) => s.metadata.rideId === e2 && s.status === 'open');
assert.equal(openPis.length + openLinks.length, 1, 'exactly one way to pay is open');

step('an old payment paid after a newer one began: it stands, the newer one is closed, the driver paid once');
const e3 = await finishedTrip();
res = await R.call('cardSwitchStart', { rideId: e3 });
const e3Pi = Object.values(intents).find((p) => p.client_secret === res.clientSecret);
await DR.call('cardLinkStart', { rideId: e3 }); // closes e3Pi at Stripe
intents[e3Pi.id].status = 'succeeded'; intents[e3Pi.id].payment_method = 'pm_visa'; // it had gone through after all
await webhook('payment_intent.succeeded', { ...intents[e3Pi.id] });
r = await until(async () => { const x = await ride(e3); return x.walletProcessed && x; }, 'e3 credited');
assert.equal(r.paymentIntentId, e3Pi.id);
assert.equal(Object.values(sessions).find((s) => s.metadata.rideId === e3).status, 'expired');
const lateLink = payLink(Object.values(sessions).find((s) => s.metadata.rideId === e3).id); // and if the page was paid too
await webhook('payment_intent.succeeded', { ...lateLink });
await until(async () => refunds.includes(lateLink.id), 'the second payment refunded');
assert.equal((await earnings()).filter((t) => t.rideId === e3).length, 1);

/* ----------------- 5. the passenger ends the trip early ----------------- */
step('held, then the passenger ends the trip early: the fare so far is taken from the hold, the switch is not lost');
const endEarly = (rideId) => updateDoc(doc(R.db, 'rides', rideId), { status: 'cancelled', cancelledBy: 'rider', cancelReason: 'rider_ended_early', endedEarly: true, cancelledAt: serverTimestamp() });
const before = await balance(`driverWallets/${driverId}`);
const g = await seedTrip();
res = await R.call('cardSwitchStart', { rideId: g });
const gPi = Object.values(intents).find((p) => p.client_secret === res.clientSecret);
confirm(gPi.id);
assert.equal((await R.call('cardSwitchStatus', { rideId: g })).state, 'held');
await endEarly(g);
r = await until(async () => { const x = await ride(g); return x.walletProcessed && x; }, 'the ended-early trip charged from the hold');
// The car is still at the pickup: the £6 minimum, plus the 50p waiting.
assert.equal(r.fare.finalTotal, 6.5); assert.equal(r.status, 'completed');
assert.deepEqual(calls.filter((c) => c.op === 'capture' && c.id === gPi.id).map((c) => c.amount), [650]);
await until(async () => (await ride(g)).paymentSwitch.state === 'paid', 'the switch marked paid, not cancelled');
assert.equal(await balance(`driverWallets/${driverId}`), before + 6.5);

step('still on the payment sheet when the passenger ends early: confirmed afterwards, the final fare is taken from that hold');
const g2 = await seedTrip();
res = await R.call('cardSwitchStart', { rideId: g2 });
const g2Pi = Object.values(intents).find((p) => p.client_secret === res.clientSecret);
await endEarly(g2);
await until(async () => (await ride(g2)).paymentStatus === 'cash', 'the ended-early fare settled');
assert.notEqual(intents[g2Pi.id].status, 'canceled', 'the open payment is kept');
confirm(g2Pi.id);
res = await R.call('cardSwitchStatus', { rideId: g2 });
assert.equal(res.state, 'paid');
assert.deepEqual(calls.filter((c) => c.op === 'capture' && c.id === g2Pi.id).map((c) => c.amount), [650]);
r = await until(async () => { const x = await ride(g2); return x.walletProcessed && x; }, 'g2 credited');
assert.equal(r.paymentMethod, 'card'); assert.equal(r.paymentStatus, 'captured');

/* ----------------- 6. the window, settings, taxi firm jobs ----------------- */
step(`after the window (${30} minutes): refused in the app and by link; a longer window in Settings allows it`);
const w = await seedTrip({ status: 'completed', completedAt: new Date(Date.now() - 31 * 60000), paymentStatus: 'cash', fare: { total: 10, finalTotal: 10.5 } });
await refused(R.call('cardSwitchStart', { rideId: w }), /too late/);
await refused(DR.call('cardLinkStart', { rideId: w }), /too late/);
await config({ windowMinutes: 60 });
assert.equal((await R.call('cardSwitchStart', { rideId: w })).state, 'pending');
await config();

step('the fare not settled yet: asked to try again in a moment');
const s1 = await seedTrip({ status: 'completed', completedAt: new Date(), paymentStatus: 'pending' });
const notYet = await refused(R.call('cardSwitchStart', { rideId: s1 }), /still being worked out/);
assert.equal(notYet.details.retry, true);

step('switched off in Settings: refused');
await config({ enabled: 0 });
await refused(R.call('cardSwitchStart', { rideId: await seedTrip() }), /switched off/);
await config();

step('taxi firm jobs refused while cardSwitch.fleetJobs is 0: a company driver\'s app trip, a phone job');
const f1 = await seedTrip({ fleetId: 'f1' });
await refused(R.call('cardSwitchStart', { rideId: f1 }), /taxi firm jobs/);
await adminSet('fleets/f1', { name: 'Redditch Cars' });
const ph = await seedTrip({ source: 'phone', fleetId: 'f1', fleetName: 'Redditch Cars', riderId: null, customer: { name: 'Pat', phone: '+447700900888' }, collectBy: 'cash' });
await complete(ph);
await until(async () => (await ride(ph)).paymentStatus === 'cash', 'the phone job settled');
await refused(DR.call('cardLinkStart', { rideId: ph }), /taxi firm jobs/);
const acct = await seedTrip({ collectBy: 'account' });
await refused(R.call('cardSwitchStart', { rideId: acct }), /isn't paid in cash/);

step('with fleetJobs 1: the phone job is paid by link like the firm\'s online bookings: the fleet\'s wallet, less Stripe\'s fee');
await config({ fleetJobs: 1 });
await adminSet('fleetWallets/f1', { availableBalance: 0 });
res = await DR.call('cardLinkStart', { rideId: ph });
assert.equal(texts.at(-1).to, '+447700900888'); assert.match(texts.at(-1).body, /^Redditch Cars: /);
const phS = Object.values(sessions).find((s) => s.metadata.rideId === ph);
const phPi = payLink(phS.id);
await webhook('checkout.session.completed', { ...sessions[phS.id], payment_intent: phPi.id });
r = await until(async () => { const x = await ride(ph); return x.webPayment?.cardFee !== undefined && x; }, 'the phone job paid into the fleet');
assert.equal(r.collectBy, 'online'); assert.equal(r.webPayment.status, 'captured'); assert.equal(r.webPayment.capturedAmount, 10.5);
assert.equal(await balance('fleetWallets/f1'), 10.14, '£10.50 less the 36p fee');
await until(async () => (await ride(ph)).settlement?.kind === 'online', 'the driver\'s fleet balance re-settled as online');
assert.equal((await R.call('cardSwitchStart', { rideId: f1 })).state, 'pending', 'a company driver\'s app trip is allowed too');
await config();

console.log('\nAll card-instead-of-cash checks passed.');
fake.close();
process.exit(0);
