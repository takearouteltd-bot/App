// The passenger changing the destination mid-trip, the driver accepting,
// the card hold raised (or the difference in cash), and extended trips
// (functions/destinationChange.js), through the real rules and functions.
// Run like driver-cancel.mjs (see README): ROUTES_API_BASE and
// STRIPE_API_BASE=http://127.0.0.1:8999 in functions/.env.local, dummy
// Stripe secrets in functions/.secret.local. Fake Google Routes and Stripe
// on :8999. Waits about 12 s for the unanswered case.
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import assert from 'node:assert/strict';
import http from 'node:http';

/* ------------------------------ fakes ------------------------------ */
const km = (a, b) => {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};
// Google's route is the straight line here, to the metre, and no time.
const routeKm = (...points) => {
  let m = 0;
  for (let i = 1; i < points.length; i++) m += km(points[i - 1], points[i]);
  return Math.round(m * 1000) / 1000;
};
const routeCalls = [];
// Fake Stripe PaymentIntents, kept in memory. A card ending pm_decline is
// refused for any new PaymentIntent.
const intents = {};
const stripeCalls = [];
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
let made = 0;
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.url.includes('computeRoutes')) {
      const b = JSON.parse(body || '{}');
      const p = (w) => w.location.latLng;
      const points = [p(b.origin), ...(b.intermediates || []).map(p), p(b.destination)];
      routeCalls.push(points);
      return json(res, 200, { routes: [{ distanceMeters: Math.round(routeKm(...points) * 1000), duration: '0s' }] });
    }
    const params = new URLSearchParams(body);
    const m = req.url.match(/^\/v1\/payment_intents(?:\/([^/?]+))?(?:\/(capture|cancel|increment_authorization))?/);
    if (!m) return json(res, 404, { error: { message: 'not faked' } });
    const [, id, op] = m;
    if (!id && req.method === 'POST') {
      const pm = params.get('payment_method');
      const call = { op: 'create', amount: Number(params.get('amount')), pm, manual: params.get('capture_method') === 'manual', type: params.get('metadata[type]'), key: req.headers['idempotency-key'] };
      stripeCalls.push(call);
      if (pm === 'pm_decline') return json(res, 402, { error: { type: 'card_error', code: 'card_declined', message: 'Your card was declined.' } });
      made += 1;
      const pi = { id: `pi_made_${made}`, object: 'payment_intent', amount: call.amount, customer: params.get('customer'), payment_method: pm, status: call.manual ? 'requires_capture' : 'succeeded' };
      intents[pi.id] = pi;
      return json(res, 200, pi);
    }
    const pi = intents[id];
    if (!pi) return json(res, 404, { error: { type: 'invalid_request_error', message: 'No such payment_intent' } });
    if (!op) return json(res, 200, pi);
    stripeCalls.push({ op, id, amount: Number(params.get('amount_to_capture') || params.get('amount')) || null });
    if (op === 'capture') pi.status = 'succeeded';
    if (op === 'cancel') pi.status = 'canceled';
    return json(res, 200, pi);
  });
});
await new Promise((r) => fake.listen(8999, '127.0.0.1', r));

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, what, tries = 720) {
  for (let i = 0; i < tries; i++) {
    const got = await check();
    if (got) return got;
    await sleep(250);
  }
  throw new Error('Timed out waiting for ' + what);
}
let steps = 0;
const step = (s) => { steps += 1; console.log('•', s); };
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

/* ------------------------------ prices ------------------------------ */
// Normal, as fleet.js FARE_DEFAULTS: £4.50 the first mile, £1 a mile
// after it to the tenth of a mile, no time charge, 20% VAT.
const r2 = (n) => Math.round(n * 100) / 100;
const normal = (distanceKm) => {
  const miles = Math.round(distanceKm * 0.621371 * 10) / 10;
  return 4.5 + Math.max(0, miles - 1);
};
const price = (distanceKm, discount = 0) => r2(normal(distanceKm) * (1 - discount) * 1.2);

// Along one line north: pickup, the car, the drop-off, past it, the new
// destination.
const P = { latitude: 52.30, longitude: -1.9, address: 'Pickup Street, Redditch' };
const CAR = { latitude: 52.32, longitude: -1.9 };
const D = { latitude: 52.35, longitude: -1.9, address: 'Booked Road, Redditch' };
const PAST = { latitude: 52.37, longitude: -1.9 };
const N = { latitude: 52.40, longitude: -1.9, address: 'New Place, Bromsgrove' };
const NEAR = { latitude: 52.33, longitude: -1.9, address: 'Near Lane, Redditch' };
const ASIDE = { latitude: 52.35, longitude: -1.85 }; // about 3.4 km east of D
const BOOKED_KM = routeKm(P, D);
const BOOKED = price(BOOKED_KM);

const R = mk('rider'), O = mk('other'), DR = mk('driver');
const rider = (await createUserWithEmailAndPassword(R.auth, 'rider-dc2@test.dev', 'secret123')).user.uid;
const other = (await createUserWithEmailAndPassword(O.auth, 'other-dc2@test.dev', 'secret123')).user.uid;
const driverId = (await createUserWithEmailAndPassword(DR.auth, 'driver-dc2@test.dev', 'secret123')).user.uid;
await adminSet('config/app', { currency: 'GBP', destinationChange: { acceptSeconds: 10 }, extendedTrips: { enabled: 1 } });
await adminSet(`riders/${rider}`, { stripeCustomerId: 'cus_r', defaultPaymentMethodId: 'pm_good' });
await adminSet(`riders/${other}`, { stripeCustomerId: 'cus_o', defaultPaymentMethodId: 'pm_good' });

/** The driver's phone saving a position, as utils/driverLocation.js does. */
const carAt = (point, rideId, ageMs = 0) => adminSet(`drivers/${driverId}`, {
  approved: true, status: 'on_ride', isOnRide: true, currentRideId: rideId,
  location: { latitude: point.latitude, longitude: point.longitude },
  lastUpdated: new Date(Date.now() - ageMs),
});

let n = 0;
/** A trip under way, booked pickup to D at the normal price. */
async function seedTrip(extra = {}, hold = { amount: Math.round(BOOKED * 100), pm: 'pm_good' }) {
  n += 1;
  const id = `dctrip${n}`;
  const card = (extra.paymentMethod || 'card') === 'card';
  const piId = `pi_main_${n}`;
  if (card) {
    intents[piId] = { id: piId, object: 'payment_intent', amount: hold.amount, customer: 'cus_r', payment_method: hold.pm, status: 'requires_capture' };
    await adminSet(`payments/${piId}`, { rideId: id, riderId: rider, driverId, amount: hold.amount, currency: 'gbp', status: 'authorized' });
  }
  await adminSet(`rides/${id}`, {
    riderId: rider, driverId, status: 'ongoing', rideType: 'RouteMini', source: 'app',
    pickupLocation: P, dropoffLocation: D, stops: [], stopsCompleted: 0,
    route: { distanceKm: BOOKED_KM, durationMinutes: 0 },
    priceCheck: { distanceKm: BOOKED_KM, durationMinutes: 0, source: 'routes' },
    fare: { total: BOOKED, subtotal: r2(BOOKED / 1.2), vat: r2(BOOKED - BOOKED / 1.2), vatPercent: 20, surgeMultiplier: 1, currency: 'GBP', discount: 0, promoCode: null },
    fareEstimate: BOOKED, currency: 'gbp', paymentMethod: 'card', walletProcessed: false,
    ...(card ? { paymentIntentId: piId, paymentStatus: 'authorized' } : {}),
    arrivedAt: new Date(Date.now() - 600000), startedAt: new Date(Date.now() - 590000),
    ...extra,
  });
  await carAt(CAR, id);
  return { id, piId };
}
const complete = (rideId, extra = {}) => updateDoc(doc(DR.db, 'rides', rideId), {
  status: 'completed', completedAt: serverTimestamp(), expiresAt: serverTimestamp(), ...extra,
});

/* ------------------------------ a change, accepted ------------------------------ */
const t1 = await seedTrip();
const newKm = routeKm(P, CAR) + routeKm(CAR, N);
const NEW = price(newKm);
const q1 = await R.call('requestDestinationChange', { rideId: t1.id, destination: N });
assert.equal(q1.quote.total, NEW);
assert.equal(q1.quote.was, BOOKED);
assert.ok(NEW > BOOKED);
assert.equal((await get(`rides/${t1.id}`)).destinationChange, undefined);
step(`quote: driven so far (pickup to the car) plus the car to the new place, one first mile: £${NEW} (was £${BOOKED}); nothing saved yet`);

await refused(DR.call('requestDestinationChange', { rideId: t1.id, destination: N }), /not your trip/i, 'functions/failed-precondition');
await refused(O.call('requestDestinationChange', { rideId: t1.id, destination: N }), /not your trip/i, 'functions/failed-precondition');
await refused(updateDoc(doc(DR.db, 'rides', t1.id), { dropoffLocation: N }), null, 'permission-denied');
await refused(updateDoc(doc(R.db, 'rides', t1.id), { dropoffLocation: N, fare: { total: 1 } }), null, 'permission-denied');
step('the driver, or another passenger, cannot ask; nobody can write the drop-off or fare from the app');

const moved = await R.call('requestDestinationChange', { rideId: t1.id, destination: N, confirm: true, quotedTotal: NEW - 5 });
assert.equal(moved.priceChanged, true);
assert.equal(moved.quote.total, NEW);
assert.equal((await get(`rides/${t1.id}`)).destinationChange, undefined);
step('confirming a price more than 50p away from the real one gets the new quote back, not a request');

const asked = await R.call('requestDestinationChange', { rideId: t1.id, destination: N, confirm: true, quotedTotal: NEW });
assert.equal(asked.requested, true);
assert.equal(asked.n, 1);
let ride = await get(`rides/${t1.id}`);
assert.equal(ride.destinationChange.state, 'pending');
assert.equal(ride.destinationChange.newTotal, NEW);
assert.equal(ride.destinationChange.oldTotal, BOOKED);
assert.equal(ride.destinationChange.to.address, N.address);
assert.equal(ride.destinationChange.seconds, 10);
assert.equal(ride.dropoffLocation.address, D.address);
await refused(R.call('requestDestinationChange', { rideId: t1.id, destination: NEAR }), /still answering/i, 'functions/failed-precondition');
step('confirmed: one pending request for the driver (10 s), the trip unchanged meanwhile; a second one waits');

await refused(R.call('answerDestinationChange', { rideId: t1.id, n: 1, accept: true }), /not your trip/i, 'functions/permission-denied');
const before1 = stripeCalls.length;
const ans = await DR.call('answerDestinationChange', { rideId: t1.id, n: 1, accept: true });
assert.equal(ans.outcome, 'accepted');
assert.equal(ans.cashExtraDue, 0);
ride = await get(`rides/${t1.id}`);
assert.equal(ride.dropoffLocation.address, N.address);
assert.equal(ride.originalDropoffLocation.address, D.address);
assert.equal(ride.fare.total, NEW);
assert.equal(ride.fareEstimate, NEW);
assert.equal(ride.fare.vat, r2(NEW - r2(NEW / 1.2)));
assert.equal(ride.destinationChange.state, 'accepted');
assert.equal(ride.destinationChanges.length, 1);
assert.equal(ride.destinationChanges[0].outcome, 'accepted');
assert.equal(ride.destinationChanges[0].oldTotal, BOOKED);
assert.equal(ride.destinationChanges[0].newTotal, NEW);
const extraHold = stripeCalls.slice(before1).find((c) => c.op === 'create');
assert.ok(extraHold, 'a second hold was asked for');
assert.equal(extraHold.manual, true);
assert.equal(extraHold.type, 'extra_hold');
assert.equal(extraHold.amount, Math.round(NEW * 100) - Math.round(BOOKED * 100));
assert.equal(ride.extraHolds.length, 1);
assert.equal(ride.extraHolds[0].amount, extraHold.amount);
assert.equal(ride.cashExtraDue, undefined);
assert.equal(ride.holdRaise.how, 'extra_hold');
step(`driver accepts: drop-off, fare and hold estimate updated, history kept, and a second hold of £${(extraHold.amount / 100).toFixed(2)} placed (the first hold cannot be raised)`);

/* ------------------------------ never lower; declined ------------------------------ */
const lowKm = routeKm(P, CAR) + routeKm(CAR, NEAR);
assert.ok(price(lowKm) < NEW);
const q2 = await R.call('requestDestinationChange', { rideId: t1.id, destination: NEAR });
assert.equal(q2.quote.total, NEW);
step(`a nearer place would cost £${price(lowKm)} but the price never goes below the fare already agreed: £${NEW}`);

await R.call('requestDestinationChange', { rideId: t1.id, destination: NEAR, confirm: true, quotedTotal: NEW });
const no = await DR.call('answerDestinationChange', { rideId: t1.id, n: 2, accept: false });
assert.equal(no.outcome, 'declined');
ride = await get(`rides/${t1.id}`);
assert.equal(ride.destinationChange.state, 'declined');
assert.equal(ride.dropoffLocation.address, N.address);
assert.equal(ride.fare.total, NEW);
assert.equal(ride.destinationChanges.length, 2);
assert.equal(ride.destinationChanges[1].outcome, 'declined');
await refused(DR.call('answerDestinationChange', { rideId: t1.id, n: 2, accept: true }), /already ended/i, 'functions/failed-precondition');
step('driver declines: the trip stays as it was, the decline is in the history and cannot be turned into an accept');

/* ------------------------------ nobody answers ------------------------------ */
await R.call('requestDestinationChange', { rideId: t1.id, destination: NEAR, confirm: true, quotedTotal: NEW });
await sleep(4000);
assert.equal((await get(`rides/${t1.id}`)).destinationChange.state, 'pending');
// The emulator runs each change's triggers one after another, so the timer
// can start late when it is busy: up to a minute.
ride = await until(async () => { const r = await get(`rides/${t1.id}`); return r.destinationChange.state === 'expired' && r; }, 'the request to run out', 240);
assert.equal(ride.dropoffLocation.address, N.address);
assert.equal(ride.destinationChanges.length, 3);
assert.equal(ride.destinationChanges[2].outcome, 'expired');
await refused(DR.call('answerDestinationChange', { rideId: t1.id, n: 3, accept: true }), /already ended/i, 'functions/failed-precondition');
step('no answer in 10 s: the server closes it (timeDestinationChanges), the trip continues as it was, a late accept is refused');

await refused(R.call('requestDestinationChange', { rideId: t1.id, destination: NEAR }), /up to 3 times/i, 'functions/failed-precondition');
step('a fourth request on the same trip is refused');

/* ------------------------------ completion takes both holds ------------------------------ */
await carAt(N, t1.id);
await complete(t1.id);
ride = await until(async () => { const r = await get(`rides/${t1.id}`); return r.paymentStatus === 'captured' && r; }, 'the capture of trip 1');
assert.equal(ride.fare.finalTotal, NEW);
assert.equal(ride.fare.cashExtra, undefined);
assert.equal(ride.extendedTrip, undefined);
const caps1 = stripeCalls.filter((c) => c.op === 'capture' && [t1.piId, ride.extraHolds[0].id].includes(c.id));
assert.deepEqual(caps1.map((c) => c.amount).sort((a, b) => a - b), [extraHold.amount, Math.round(BOOKED * 100)].sort((a, b) => a - b));
assert.equal(stripeCalls.filter((c) => c.op === 'create' && c.type === 'extra_charge').length, 0);
step('completed at the new place: the first hold and the second hold are captured in full, nothing charged on its own');

/* ------------------------------ the card won't cover it: cash ------------------------------ */
const t2 = await seedTrip({}, { amount: Math.round(BOOKED * 100), pm: 'pm_decline' });
const a2 = await R.call('requestDestinationChange', { rideId: t2.id, destination: N, confirm: true, quotedTotal: NEW });
assert.equal(a2.requested, true);
const ans2 = await DR.call('answerDestinationChange', { rideId: t2.id, n: 1, accept: true });
const due = r2(NEW - BOOKED);
assert.equal(ans2.cashExtraDue, due);
ride = await get(`rides/${t2.id}`);
assert.equal(ride.cashExtraDue, due);
assert.equal(ride.holdRaise.how, 'cash');
assert.equal(ride.fare.total, NEW);
assert.equal(ride.extraHolds, undefined);
step(`second hold refused: the change still goes ahead and the driver collects £${due} extra in cash (cashExtraDue)`);

await carAt(N, t2.id);
await complete(t2.id);
ride = await until(async () => { const r = await get(`rides/${t2.id}`); return r.paymentStatus === 'captured' && r; }, 'the capture of trip 2');
const cap2 = stripeCalls.filter((c) => c.op === 'capture' && c.id === t2.piId);
assert.equal(cap2.length, 1);
assert.equal(cap2[0].amount, Math.round(BOOKED * 100));
assert.equal(ride.fare.finalTotal, NEW);
assert.equal(ride.fare.cashExtra, due);
assert.equal(ride.fare.cardTotal, BOOKED);
assert.equal(ride.extraChargeFailed, false);
step('completed: the card is charged only what was held, the rest recorded as cash (fare.cashExtra, fare.cardTotal)');

/* ------------------------------ old position ------------------------------ */
const t3 = await seedTrip();
await carAt(CAR, t3.id, 5 * 60 * 1000);
await refused(R.call('requestDestinationChange', { rideId: t3.id, destination: N }), /can't see where your car is/i, 'functions/failed-precondition');
await adminSet(`rides/${t3.id}`, { status: 'arrived' }, true);
await carAt(CAR, t3.id);
await refused(R.call('requestDestinationChange', { rideId: t3.id, destination: N }), /once you are on your way/i, 'functions/failed-precondition');
step('refused when the car last reported over 2 minutes ago, and before the passenger is on board');

/* ------------------------------ agreed price, promo, stops ------------------------------ */
const t4 = await seedTrip({ fare: { total: 15, subtotal: 12.5, vat: 2.5, vatPercent: 20, surgeMultiplier: 1, agreedPrice: 15 }, fareEstimate: 15, bidding: true });
const q4 = await R.call('requestDestinationChange', { rideId: t4.id, destination: N });
assert.equal(q4.quote.total, r2(15 + NEW - BOOKED));
step(`bidding price £15: plus the normal price of the extra miles, £${r2(NEW - BOOKED)}`);

const t5 = await seedTrip({ fare: { total: price(BOOKED_KM, 0.1), vatPercent: 20, surgeMultiplier: 1, promoCode: 'TEN', discount: 0.1 } });
const q5 = await R.call('requestDestinationChange', { rideId: t5.id, destination: N });
assert.equal(q5.quote.total, price(newKm, 0.1));
step(`10% promo: the same 10% off the new price, £${price(newKm, 0.1)}`);

const S = { latitude: 52.31, longitude: -1.95, address: 'Stop One' };
const t6 = await seedTrip({ stops: [S], stopsCompleted: 1 });
const q6 = await R.call('requestDestinationChange', { rideId: t6.id, destination: N });
assert.equal(q6.quote.total, price(routeKm(P, S, CAR) + routeKm(CAR, N)));
assert.deepEqual(routeCalls.at(-2).map((p) => p.latitude), [P.latitude, S.latitude, CAR.latitude]);
step('a stop already passed is part of the distance driven (pickup, stop, car)');

/* ------------------------------ extended trips ------------------------------ */
const t7 = await seedTrip({ paymentMethod: 'cash' });
await carAt({ latitude: D.latitude + 0.001, longitude: D.longitude }, t7.id);
ride = await until(async () => { const r = await get(`rides/${t7.id}`); return r.reachedDropoffAt && r; }, 'the car at the drop-off');
assert.ok(ride.reachedDropoffPoint);
await refused(updateDoc(doc(DR.db, 'rides', t7.id), { reachedDropoffAt: serverTimestamp() }), null, 'permission-denied');
await carAt(PAST, t7.id);
await complete(t7.id);
ride = await until(async () => { const r = await get(`rides/${t7.id}`); return r.paymentStatus === 'cash' && r.extendedTrip && r; }, 'trip 7 settled');
const LONG = price(BOOKED_KM + routeKm(D, PAST));
const EXTRA = r2(LONG - BOOKED);
assert.equal(ride.extendedTrip.state, 'pending');
assert.equal(ride.extendedTrip.flagged, true);
assert.equal(ride.extendedTrip.previousFare, BOOKED);
assert.equal(ride.extendedTrip.newFare, LONG);
assert.equal(ride.extendedTrip.extra, EXTRA);
assert.equal(ride.extendedTrip.extraKm, r2(routeKm(D, PAST)));
assert.ok(ride.extendedTrip.decideBy && ride.extendedTrip.dueAt);
assert.equal(ride.fare.total, BOOKED);
assert.equal(ride.fare.finalTotal, BOOKED);
step(`cash trip completed ${r2(routeKm(D, PAST))} km past the drop-off after reaching it: extended trip priced (£${LONG}, was £${BOOKED}) but only the booked fare is due until the passenger approves the £${EXTRA}`);

await refused(O.call('answerExtendedTrip', { rideId: t7.id, approve: true }), /not your trip/i, 'functions/failed-precondition');
await refused(updateDoc(doc(R.db, 'rides', t7.id), { 'extendedTrip.state': 'waived' }), null, 'permission-denied');
const a7 = await R.call('answerExtendedTrip', { rideId: t7.id, approve: true });
assert.equal(a7.state, 'collect');
ride = await get(`rides/${t7.id}`);
assert.equal(ride.extendedTrip.state, 'collect');
assert.equal(ride.extendedTrip.approvedBy, 'passenger');
assert.equal(ride.extendedTrip.dueAt, undefined);
assert.equal(ride.fare.extendedExtra, EXTRA);
assert.equal(ride.fare.finalTotal, LONG);
await refused(R.call('answerExtendedTrip', { rideId: t7.id, approve: false }), /already been settled/i, 'functions/failed-precondition');
step('only the passenger can answer, not by writing the ride; approved: the cash fare goes up by the extra for the driver to collect, once');

const t8 = await seedTrip();
await carAt({ latitude: D.latitude - 0.001, longitude: D.longitude }, t8.id);
await until(async () => (await get(`rides/${t8.id}`)).reachedDropoffAt, 'the car at the drop-off');
await carAt(PAST, t8.id);
// What the driver app writes when they end the trip over 0.5 km from the
// drop-off ("Passenger got out here"): without the server's evidence that
// would be the fare so far; with it, the trip is extended.
await complete(t8.id, { completedAwayFromDropoff: true, completeDistanceKm: r2(routeKm(D, PAST)) });
ride = await until(async () => { const r = await get(`rides/${t8.id}`); return r.paymentStatus === 'captured' && r.walletProcessed && r; }, 'trip 8 captured');
assert.equal(ride.extendedTrip.state, 'pending');
assert.equal(ride.extendedTrip.newFare, LONG);
assert.equal(ride.fare.finalTotal, BOOKED);
assert.equal(ride.endedEarlyBy, undefined);
assert.equal(ride.fare.fullTotal, undefined);
assert.equal((ride.extraHolds || []).length, 0);
assert.deepEqual(stripeCalls.filter((c) => c.op === 'capture' && c.id === t8.piId).map((c) => c.amount), [Math.round(BOOKED * 100)]);
step('card trip ended "away from the drop-off" after reaching it: extended (not the fare so far), but only the booked fare is captured, no extra hold');

const a8 = await R.call('answerExtendedTrip', { rideId: t8.id, approve: true });
assert.equal(a8.state, 'charged');
const ext8 = stripeCalls.filter((c) => c.op === 'create' && c.type === 'extended_trip');
assert.equal(ext8.length, 1);
assert.equal(ext8[0].amount, Math.round(EXTRA * 100));
assert.equal(ext8[0].pm, 'pm_good');
assert.equal(ext8[0].key, `extended_${t8.id}_1`);
ride = await get(`rides/${t8.id}`);
assert.equal(ride.extendedTrip.state, 'charged');
assert.equal(ride.fare.extendedExtra, EXTRA);
assert.equal(ride.fare.finalTotal, LONG);
const w8 = await get(`driverWallets/${driverId}/transactions/extended_${t8.id}`);
assert.equal(w8.amount, EXTRA);
step(`approved: £${EXTRA} charged off session on the trip's card (once, key extended_<ride>_1) and credited to the driver's wallet`);

/* Disputed, then the office decides. */
const ADM = mk('admin');
const adminId = (await createUserWithEmailAndPassword(ADM.auth, 'admin-dc2@test.dev', 'secret123')).user.uid;
await adminSet(`admins/${adminId}`, { isActive: true });
async function extendedCardTrip(extra = {}, hold) {
  const t = await seedTrip(extra, hold);
  await carAt(D, t.id);
  await until(async () => (await get(`rides/${t.id}`)).reachedDropoffAt, 'the car at the drop-off');
  await carAt(PAST, t.id);
  await complete(t.id);
  await until(async () => { const r = await get(`rides/${t.id}`); return r.paymentStatus && r.paymentStatus !== 'authorized' && r.extendedTrip && r; }, 'extended trip settled');
  return t;
}
const t11 = await extendedCardTrip();
assert.equal((await R.call('answerExtendedTrip', { rideId: t11.id, approve: false })).state, 'disputed');
ride = await get(`rides/${t11.id}`);
assert.equal(ride.fare.finalTotal, BOOKED);
assert.equal((await get(`paymentAlerts/extended_trip_disputed_${t11.id}`)).status, 'open');
await refused(R.call('decideExtendedTrip', { rideId: t11.id, charge: true }), /admins only/i, 'functions/permission-denied');
assert.equal((await ADM.call('decideExtendedTrip', { rideId: t11.id, charge: true, note: 'Passenger asked to go on' })).state, 'charged');
ride = await get(`rides/${t11.id}`);
assert.equal(ride.extendedTrip.approvedBy, 'office');
assert.equal(ride.fare.finalTotal, LONG);
assert.equal((await get(`paymentAlerts/extended_trip_disputed_${t11.id}`)).status, 'resolved');
step('disputed: nothing charged, an alert for the office; only an admin can decide; charged on the office\'s word and the alert closed');

const t12 = await extendedCardTrip();
await R.call('answerExtendedTrip', { rideId: t12.id, approve: false });
assert.equal((await ADM.call('decideExtendedTrip', { rideId: t12.id, charge: false })).state, 'waived');
ride = await get(`rides/${t12.id}`);
assert.equal(ride.extendedTrip.state, 'waived');
assert.equal(ride.fare.finalTotal, BOOKED);
await refused(ADM.call('decideExtendedTrip', { rideId: t12.id, charge: true }), /already settled/i, 'functions/failed-precondition');
step('the office can waive it: the booked fare stands, and it cannot be charged afterwards');

/* Nobody answers: the card trip is charged after the time allowed, the cash
   trip goes to the office. The card that refuses goes to the office too. */
const schedule = async (name) => {
  const pub = await fetch(`http://127.0.0.1:8085/v1/projects/${PROJECT}/topics/firebase-schedule-${name}:publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ data: Buffer.from('{}').toString('base64') }] }) });
  assert.ok(pub.ok, 'pubsub publish: ' + pub.status);
};
async function timeUp(rideId) {
  const past = { timestampValue: new Date(Date.now() - 60000).toISOString() };
  const r = await fetch(`${REST}/rides/${rideId}?updateMask.fieldPaths=extendedTrip.decideBy&updateMask.fieldPaths=extendedTrip.dueAt`, {
    method: 'PATCH', headers: H, body: JSON.stringify({ fields: { extendedTrip: { mapValue: { fields: { decideBy: past, dueAt: past } } } } }) });
  if (!r.ok) throw new Error(await r.text());
}
const t13 = await extendedCardTrip();
const t14 = await extendedCardTrip({ paymentMethod: 'cash' });
const t15 = await extendedCardTrip({}, { amount: Math.round(BOOKED * 100), pm: 'pm_decline' });
// The booked fare on t15's held card is captured; only new charges are refused.
await Promise.all([t13, t14, t15].map((t) => timeUp(t.id)));
await schedule('expireSearchingRides');
ride = await until(async () => { const r = await get(`rides/${t13.id}`); return r.extendedTrip.state === 'charged' && r; }, 'trip 13 charged with no answer');
assert.equal(ride.extendedTrip.approvedBy, 'no_answer');
assert.equal(ride.fare.finalTotal, LONG);
ride = await until(async () => { const r = await get(`rides/${t14.id}`); return r.extendedTrip.state === 'unanswered' && r; }, 'trip 14 to the office');
assert.equal(ride.fare.finalTotal, BOOKED);
assert.equal((await get(`paymentAlerts/extended_trip_unanswered_${t14.id}`)).status, 'open');
ride = await until(async () => { const r = await get(`rides/${t15.id}`); return r.extendedTrip.state === 'charge_failed' && r; }, 'trip 15 refused');
assert.equal(ride.fare.finalTotal, BOOKED);
assert.equal((await get(`paymentAlerts/extended_trip_charge_failed_${t15.id}_1`)).status, 'open');
assert.equal(ride.extendedTrip.dueAt, undefined);
step('no answer in time: the card trip is charged, the cash trip goes to the office (nothing to charge), a refused card goes to the office');

const t9 = await seedTrip({ paymentMethod: 'cash' });
await carAt(ASIDE, t9.id);
await sleep(1500);
await complete(t9.id);
ride = await until(async () => { const r = await get(`rides/${t9.id}`); return r.paymentStatus === 'cash' && r; }, 'trip 9 settled');
assert.equal(ride.reachedDropoffAt, undefined);
assert.equal(ride.extendedTrip, undefined);
assert.equal(ride.fare.total, BOOKED);
step('completed far from the drop-off without ever reaching it: not an extended trip, the fare stays');

await adminSet('config/app', { extendedTrips: { enabled: 0 } }, true);
const t10 = await seedTrip({ paymentMethod: 'cash' });
await carAt(D, t10.id);
await until(async () => (await get(`rides/${t10.id}`)).reachedDropoffAt, 'the car at the drop-off');
await carAt(PAST, t10.id);
await complete(t10.id);
ride = await until(async () => { const r = await get(`rides/${t10.id}`); return r.paymentStatus === 'cash' && r; }, 'trip 10 settled');
assert.equal(ride.extendedTrip, undefined);
assert.equal(ride.fare.finalTotal, BOOKED);
await adminSet('config/app', { extendedTrips: { enabled: 1 } }, true);
step('extended trips switched off (extendedTrips.enabled 0): the same trip keeps its fare');

console.log(`\nAll ${steps} destination change checks passed.`);
fake.close();
process.exit(0);
