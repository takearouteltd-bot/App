// Passengers booking a ride for later (functions/bookLater.js), through the
// real rules and functions: switched off, the dashboard's time window, the
// usual price check, how many may be booked ahead, free cancel before it is
// sent out, no card hold until it is sent out (fleet.js
// dispatchScheduledRides -> "searching"), the hold then and the offer to the
// nearest driver, the hold reused when a driver accepts, a declined card at
// that point and a new card carrying on, nobody taking it (cancelled once
// the pickup time has passed, hold released), and a booking the server never
// checked never sent out.
// Run like driver-cancel.mjs plus the Pub/Sub emulator (see README):
// ROUTES_API_BASE and STRIPE_API_BASE=http://127.0.0.1:8999 in
// functions/.env.local, dummy Stripe secrets. Fake Routes and Stripe on :8999.
// In CI: gh workflow run tests.yml --ref book-for-later -f suites=book-later
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, addDoc, collection, doc, serverTimestamp, Timestamp, updateDoc } from 'firebase/firestore';
import assert from 'node:assert/strict';
import http from 'node:http';

// Fake Google Routes (1 mile, 5 minutes) and Stripe PaymentIntents. Card
// pm_decline is declined.
const stripe = [];
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    const params = new URLSearchParams(body);
    const m = req.url.match(/^\/v1\/payment_intents(?:\/([^/?]+))?(?:\/(capture|cancel))?/);
    if (m && !m[1] && req.method === 'POST') {
      const call = { op: 'create', amount: Number(params.get('amount')), pm: params.get('payment_method'),
        rideId: params.get('metadata[rideId]'), at: params.get('metadata[at]'), id: `pi_bl_${stripe.length + 1}` };
      stripe.push(call);
      if (call.pm === 'pm_decline') {
        res.writeHead(402);
        return res.end(JSON.stringify({ error: { type: 'card_error', code: 'card_declined', decline_code: 'insufficient_funds', message: 'Your card was declined.' } }));
      }
      return res.end(JSON.stringify({ id: call.id, object: 'payment_intent', amount: call.amount, status: 'requires_capture' }));
    }
    if (m && m[1]) {
      if (m[2]) stripe.push({ op: m[2], id: m[1] });
      return res.end(JSON.stringify({ id: m[1], object: 'payment_intent', amount: 540, status: m[2] === 'cancel' ? 'canceled' : 'requires_capture' }));
    }
    return res.end(JSON.stringify({ routes: [{ distanceMeters: 1609, duration: '300s' }] }));
  });
});
await new Promise((r) => fake.listen(8999, '127.0.0.1', r));

const PROJECT = 'demo-tar';
const mk = (name) => {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'fake', authDomain: 'x' }, name);
  const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8080);
  return { auth, db };
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
const dec = (f) => {
  if (!f) return undefined;
  const [[k, v]] = Object.entries(f);
  if (k === 'mapValue') return Object.fromEntries(Object.entries(v.fields || {}).map(([a, b]) => [a, dec(b)]));
  if (k === 'arrayValue') return (v.values || []).map(dec);
  if (k === 'integerValue' || k === 'doubleValue') return Number(v);
  if (k === 'nullValue') return null;
  return v;
};
async function adminSet(path, data, mask = false) {
  const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)]));
  const q = mask ? '?' + Object.keys(data).map((k) => 'updateMask.fieldPaths=' + k).join('&') : '';
  const r = await fetch(`${REST}/${path}${q}`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields }) });
  if (!r.ok) throw new Error(await r.text());
}
const adminGet = async (path) => {
  const r = await (await fetch(`${REST}/${path}`, { headers: H })).json();
  return r.fields ? Object.fromEntries(Object.entries(r.fields).map(([k, v]) => [k, dec(v)])) : null;
};
const ms = (t) => (t ? Date.parse(t) : 0);
const sleep = (n) => new Promise((r) => setTimeout(r, n));
async function until(fn, what, limit = 180000) {
  const end = Date.now() + limit;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timeout: ' + what);
    await sleep(300);
  }
}
const schedule = async (name) => {
  const pub = await fetch(`http://127.0.0.1:8085/v1/projects/${PROJECT}/topics/firebase-schedule-${name}:publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ data: Buffer.from('{}').toString('base64') }] }) });
  assert.ok(pub.ok, 'pubsub publish: ' + pub.status);
};
let steps = 0;
const step = (s) => { steps += 1; console.log('•', s); };
const ride = (id) => adminGet(`rides/${id}`);
const creates = (id) => stripe.filter((c) => c.op === 'create' && c.rideId === id);

const PICKUP = { latitude: 52.3069, longitude: -1.9492, address: 'Redditch Station, Redditch' };
const DROP = { latitude: 52.31, longitude: -1.94, address: 'Town' };
const NEAR = { latitude: 52.3100, longitude: -1.9492 };
// 1 mile, 5 min, default first-mile pricing: 4.50 before VAT, 5.40 with it.
const FULL = 5.4;
const BOOK_LATER = { enabled: 1, minMinutes: 30, maxDays: 7, leadMinutes: 20, maxOpen: 2 };
const setConfig = (bookLater, dispatch = {}) => adminSet('config/app', {
  currency: 'GBP', bookLater, dispatch: { searchRadiusKm: 10, requestTimeoutSeconds: 120, searchTimeoutMinutes: 15, ...dispatch },
  bidJobs: { enabled: 0 },
});

const A = mk('admin'), R = mk('rider'), D = mk('driver');
const adm = await createUserWithEmailAndPassword(A.auth, 'admin-bl@test.dev', 'secret123');
await adminSet(`admins/${adm.user.uid}`, { isActive: true, role: 'super_admin' });
const rider = (await createUserWithEmailAndPassword(R.auth, 'rider-bl@test.dev', 'secret123')).user.uid;
const driverId = (await createUserWithEmailAndPassword(D.auth, 'driver-bl@test.dev', 'secret123')).user.uid;
await adminSet(`riders/${rider}`, { firstName: 'Rita', stripeCustomerId: 'cus_bl', defaultPaymentMethodId: 'pm_ok' });
const driverOnline = (online = true) => adminSet(`drivers/${driverId}`, {
  approved: true, onboardingComplete: true, vehicleType: 'RouteMini', status: online ? 'online' : 'offline', isOnRide: false,
  firstName: 'Dan', location: NEAR, lastUpdated: new Date(), subscription: { status: 'active', paymentMethod: 'wallet_deduction' },
});
await driverOnline();

const ahead = (minutes) => Timestamp.fromMillis(Date.now() + minutes * 60000);
const book = (pickupAt, fare = {}) => addDoc(collection(R.db, 'rides'), {
  riderId: rider, driverId: null, status: 'scheduled', pickupAt, rideType: 'RouteMini',
  pickupLocation: PICKUP, dropoffLocation: DROP, stops: [], cityId: null, bidding: false,
  fare: { total: FULL, subtotal: 4.5, vat: 0.9, discount: 0, promoCode: null, vatPercent: 20, stopCharge: 0, ...fare },
  fareEstimate: FULL, paymentMethod: 'card', currency: 'GBP',
  waitingPolicy: { freeMinutes: 5, ratePerMinute: 0.25, maxCharge: 10 },
  timestamps: { createdAt: serverTimestamp() },
}).then((r) => r.id);
// The onCreate check: refused, or checked with its send-out time.
const settled = (id) => until(async () => {
  const r = await ride(id);
  return r && (r.status === 'cancelled' || r.bookedAhead) ? r : null;
}, `booking ${id} checked`);
const sendOut = async (id) => {
  await adminSet(`rides/${id}`, { dispatchAt: new Date(Date.now() - 1000) }, true);
  await schedule('dispatchScheduledRides');
  return until(async () => { const r = await ride(id); return r.status === 'searching' ? r : null; }, `${id} sent out`);
};
const cancelByRider = (id) => updateDoc(doc(R.db, 'rides', id), { status: 'cancelled', cancelledBy: 'rider', cancelledAt: serverTimestamp() });

step('switched off: a booking for later is refused with a reason');
await setConfig({ ...BOOK_LATER, enabled: 0 });
let id = await book(ahead(120));
let r = await settled(id);
assert.equal(r.status, 'cancelled'); assert.equal(r.cancelledBy, 'system'); assert.equal(r.cancelReason, 'book_later_off');
assert.match(r.cancelMessage, /isn't available/);

step('switched on: too soon or too far ahead for the dashboard is refused, though the rules let it in');
await setConfig(BOOK_LATER);
r = await settled(await book(ahead(15)));
assert.equal(r.cancelReason, 'bad_pickup_time'); assert.match(r.cancelMessage, /from 30 minutes to 7 days ahead/);
r = await settled(await book(ahead(8 * 24 * 60)));
assert.equal(r.cancelReason, 'bad_pickup_time');

step('the usual price check: an under-priced booking for later is refused');
r = await settled(await book(ahead(120), { total: 1, subtotal: 0.83, vat: 0.17 }));
assert.equal(r.cancelReason, 'price_changed');

step('an honest booking: checked, fare fixed, sent out leadMinutes before the pickup, no card hold, not the current ride');
const pickup1 = ahead(120);
const b1 = await book(pickup1);
r = await settled(b1);
assert.equal(r.status, 'scheduled'); assert.equal(r.pricing, 'checked'); assert.equal(Number(r.fareEstimate), FULL);
assert.equal(r.bookedAhead.leadMinutes, 20); assert.ok(r.bookedAhead.checkedAt);
assert.ok(Math.abs(ms(r.dispatchAt) - (pickup1.toMillis() - 20 * 60000)) < 2000, 'dispatchAt = pickup - 20 min');
assert.equal(r.paymentIntentId, undefined); assert.equal(r.paymentStatus, undefined);
assert.ok(r.cancellationPolicy && r.waitingPolicy, 'terms saved at booking');
await sleep(2000);
assert.equal(creates(b1).length, 0, 'no hold at booking');
assert.ok(!(await adminGet(`riders/${rider}`)).currentRideId);

step('at most maxOpen booked ahead at once');
const b2 = await book(ahead(180));
assert.equal((await settled(b2)).status, 'scheduled');
r = await settled(await book(ahead(240)));
assert.equal(r.cancelReason, 'too_many_booked'); assert.match(r.cancelMessage, /up to 2 rides/);

step('cancelled before it is sent out: free, nothing on the card');
await cancelByRider(b2);
await until(async () => (await ride(b2)).status === 'cancelled', 'b2 cancelled');
await sleep(2000);
assert.equal(stripe.filter((c) => c.rideId === b2).length, 0);
assert.equal((await ride(b2)).cancellationFee, undefined);

step('its time comes: searching, the card held then, the nearest driver asked, the current ride');
r = await sendOut(b1);
assert.ok(r.bookedAhead.dispatchedAt);
r = await until(async () => { const x = await ride(b1); return x.paymentIntentId && x.offer?.driverId ? x : null; }, 'b1 held and offered');
assert.equal(r.paymentStatus, 'authorized'); assert.equal(r.offer.driverId, driverId); assert.equal(r.offer.state, 'asking');
assert.equal(creates(b1).length, 1); assert.equal(creates(b1)[0].amount, 540); assert.equal(creates(b1)[0].at, 'booking');
assert.equal((await adminGet(`riders/${rider}`)).currentRideId, b1);

step('the driver accepts: the hold from the send-out is used, not a second one');
await updateDoc(doc(D.db, 'rides', b1), { status: 'accepted', driverId, acceptedAt: serverTimestamp(), walletProcessed: false });
await until(async () => (await adminGet(`payments/${r.paymentIntentId}`))?.driverId === driverId, 'hold reused for the driver');
assert.equal(creates(b1).length, 1);
await cancelByRider(b1);
await until(() => stripe.some((c) => c.op === 'cancel' && c.id === r.paymentIntentId), 'b1 hold released');

step('a declined card when it is sent out: it waits, nobody is asked; a new card carries on');
await adminSet(`riders/${rider}`, { defaultPaymentMethodId: 'pm_decline', currentRideId: null }, true);
await driverOnline();
const b4 = await book(ahead(120));
await settled(b4);
await sendOut(b4);
r = await until(async () => { const x = await ride(b4); return x.paymentStatus === 'auth_failed' ? x : null; }, 'b4 declined');
assert.equal(r.status, 'searching'); assert.ok(!r.offer?.driverId, 'no driver asked');
assert.equal(r.paymentFailure.atBooking, true);
await adminSet(`riders/${rider}`, { defaultPaymentMethodId: 'pm_ok' }, true);
r = await until(async () => { const x = await ride(b4); return x.paymentStatus === 'authorized' && x.offer?.driverId ? x : null; }, 'b4 resumed');
assert.equal(r.offer.driverId, driverId);
await cancelByRider(b4);
await until(() => stripe.some((c) => c.op === 'cancel' && c.id === r.paymentIntentId), 'b4 hold released');

step('nobody takes it: kept looking until the pickup time, then cancelled with no charge');
await driverOnline(false);
await setConfig(BOOK_LATER, { searchTimeoutMinutes: 1 });
const b5 = await book(ahead(120));
const b6 = await book(ahead(150));
await settled(b5); await settled(b6);
await sendOut(b5); await sendOut(b6);
const held5 = await until(async () => (await ride(b5)).paymentIntentId, 'b5 held');
await until(async () => (await ride(b6)).paymentIntentId, 'b6 held');
const old = new Date(Date.now() - 2 * 3600 * 1000);
await adminSet(`rides/${b5}`, { timestamps: { createdAt: old }, dispatchAt: new Date(Date.now() - 25 * 60000), pickupAt: new Date(Date.now() - 60000) }, true);
await adminSet(`rides/${b6}`, { timestamps: { createdAt: old }, dispatchAt: new Date(Date.now() - 25 * 60000), pickupAt: new Date(Date.now() + 30 * 60000) }, true);
await schedule('expireSearchingRides');
r = await until(async () => { const x = await ride(b5); return x.status === 'cancelled' ? x : null; }, 'b5 expired');
assert.equal(r.cancelledBy, 'timeout'); assert.equal(r.cancelReason, 'no_driver_found');
await until(() => stripe.some((c) => c.op === 'cancel' && c.id === held5), 'b5 hold released');
assert.equal((await ride(b6)).status, 'searching', 'pickup still ahead: keeps looking');
await cancelByRider(b6);

step('a "scheduled" app ride the server never checked is never sent out');
await adminSet('rides/unchecked', { riderId: rider, source: 'app', status: 'scheduled', pricing: 'checked', dispatchAt: new Date(Date.now() - 60000),
  pickupAt: new Date(Date.now() + 10 * 60000), pickupLocation: PICKUP, dropoffLocation: DROP, rideType: 'RouteMini', paymentMethod: 'card' });
await schedule('dispatchScheduledRides');
await sleep(5000);
assert.equal((await ride('unchecked')).status, 'scheduled');

console.log(`\n${steps} steps passed`);
fake.close();
process.exit(0);
