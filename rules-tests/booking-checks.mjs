// New app bookings are checked by the server (checkNewRide in
// functions/index.js): working cities, the price against Google's route
// (a fake on :8999: put ROUTES_API_BASE=http://127.0.0.1:8999 in
// functions/.env.local for the run), payment method and bidding, and promo
// codes (checkPromoCode, uses left, once per passenger). Also: a driver cannot change their own car type
// after approval, and rejecting a payout still works with the new push.
// Against the emulators (auth 9099, firestore 8080, functions 5001), project
// demo-tar. Run like fleet-e2e.mjs (see README).
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, addDoc, collection, doc, updateDoc } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import assert from 'node:assert/strict';
import http from 'node:http';

// Fake Google Routes: 1 mile, 5 minutes, unless switched off.
let routesDown = false;
const fake = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    if (routesDown) { res.writeHead(500); return res.end('{}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ routes: [{ distanceMeters: 1609, duration: '300s' }] }));
  });
});
await new Promise((r) => fake.listen(8999, '127.0.0.1', r));

const PROJECT = 'demo-tar';
const mk = (name) => {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'fake', authDomain: 'x' }, name);
  const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const fn = getFunctions(app, 'us-central1'); connectFunctionsEmulator(fn, '127.0.0.1', 5001);
  return { auth, db, call: (n, d) => httpsCallable(fn, n)(d).then((r) => r.data) };
};
const REST = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const H = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const enc = (v) => typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : v === null ? { nullValue: null } : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } } : typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } } : { stringValue: String(v) };
async function adminSet(path, data, mask = false) {
  const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)]));
  const r = await fetch(`${REST}/${path}${mask ? '?' + Object.keys(data).map((k) => 'updateMask.fieldPaths=' + k).join('&') : ''}`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields }) });
  if (!r.ok) throw new Error(await r.text());
}
const del = (path) => fetch(`${REST}/${path}`, { method: 'DELETE', headers: H });
const adminGet = async (path) => (await (await fetch(`${REST}/${path}`, { headers: H })).json()).fields || {};
const val = (f) => f && (f.stringValue ?? f.integerValue ?? f.booleanValue ?? f.doubleValue ?? null);
const step = (s) => console.log('•', s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Waits for the onCreate check to settle: cancelled, or price-checked.
async function settled(id) {
  // The emulator runs every trigger of the previous step first, one by one.
  for (let i = 0; i < 240; i++) {
    const r = await adminGet(`rides/${id}`);
    if (val(r.status) === 'cancelled' || val(r.pricing) === 'checked') return r;
    await sleep(250);
  }
  return adminGet(`rides/${id}`);
}
// 1 mile, 5 min, default first-mile pricing: Normal's first mile 4.50 (no
// base fare, no time charge) before VAT, 5.40 with it; with 10% off, 4.86.
// Priority's first mile is 5.50: 6.60 with VAT.
const FULL = 5.4;

const A = mk('admin'), R = mk('rider'), R2 = mk('rider2'), D = mk('driver');
const adm = await createUserWithEmailAndPassword(A.auth, 'admin-bc@test.dev', 'secret123');
await adminSet(`admins/${adm.user.uid}`, { isActive: true, role: 'super_admin' });
await adminSet('config/app', { currency: 'GBP' });
const rider = (await createUserWithEmailAndPassword(R.auth, 'rider-bc@test.dev', 'secret123')).user.uid;
const rider2 = (await createUserWithEmailAndPassword(R2.auth, 'rider2-bc@test.dev', 'secret123')).user.uid;
const REDDITCH = { latitude: 52.3069, longitude: -1.9492, address: 'Redditch' };
const LONDON = { latitude: 51.5072, longitude: -0.1276, address: 'London' };
const book = (who, uid, pickup, fare = {}) => addDoc(collection(who.db, 'rides'), {
  riderId: uid, driverId: null, status: 'searching', rideType: 'RouteMini',
  pickupLocation: pickup, dropoffLocation: { latitude: 52.31, longitude: -1.94, address: 'Town' },
  fare: { total: FULL, discount: 0, promoCode: null, vatPercent: 20, ...fare }, cityId: null, paymentMethod: 'card',
  waitingPolicy: { freeMinutes: 60, ratePerMinute: 0, maxCharge: 0 },
}).then((r) => r.id);

step('no cities switched on: a booking anywhere goes ahead');
let id = await book(R, rider, LONDON);
let r = await settled(id);
assert.equal(val(r.status), 'searching');
await adminSet(`rides/${id}`, { status: 'completed' }, true);

step('with Redditch switched on: a London pickup is refused with a reason; a Redditch one gets its city');
await adminSet('cities/redditch', { name: 'Redditch', latitude: 52.3069, longitude: -1.9492, radiusKm: 15, active: true });
await adminSet('cities/off', { name: 'Leeds', latitude: 51.5, longitude: -0.12, radiusKm: 50, active: false });
id = await book(R, rider, LONDON);
r = await settled(id);
assert.equal(val(r.status), 'cancelled'); assert.equal(val(r.cancelledBy), 'system');
assert.equal(val(r.cancelReason), 'outside_service_area'); assert.match(val(r.cancelMessage), /We currently cover Redditch\./);
id = await book(R, rider, REDDITCH);
r = await settled(id);
assert.equal(val(r.status), 'searching'); assert.equal(val(r.cityId), 'redditch');
await adminSet(`rides/${id}`, { status: 'completed' }, true);

step('All of the UK on: a London pickup outside every city goes ahead with no city; Dublin and Calais are refused');
await adminSet('config/serviceArea', { wholeUk: true });
id = await book(R, rider, LONDON);
r = await settled(id);
assert.equal(val(r.status), 'searching'); assert.equal(val(r.cityId), null);
await adminSet(`rides/${id}`, { status: 'completed' }, true);
id = await book(R, rider, REDDITCH);
r = await settled(id);
assert.equal(val(r.status), 'searching'); assert.equal(val(r.cityId), 'redditch');
await adminSet(`rides/${id}`, { status: 'completed' }, true);
for (const place of [{ latitude: 53.35, longitude: -6.26, address: 'Dublin' }, { latitude: 50.95, longitude: 1.86, address: 'Calais' }]) {
  id = await book(R, rider, place);
  r = await settled(id);
  assert.equal(val(r.status), 'cancelled', place.address);
  assert.equal(val(r.cancelReason), 'outside_service_area'); assert.match(val(r.cancelMessage), /We currently cover the UK\./);
}
await adminSet('config/serviceArea', { wholeUk: false });

step('promo check: unknown, off, expired, valid');
await adminSet('promoCodes/WELCOME10', { code: 'WELCOME10', percent: 10, active: true, maxUses: 2, expiresAt: null });
await adminSet('promoCodes/OLD5', { code: 'OLD5', percent: 5, active: true, expiresAt: '2020-01-01' });
await adminSet('promoCodes/OFF5', { code: 'OFF5', percent: 5, active: false });
assert.deepEqual(await R.call('checkPromoCode', { code: 'nope1' }), { ok: false, message: 'This code is not valid.' });
assert.equal((await R.call('checkPromoCode', { code: 'off5' })).ok, false);
assert.equal((await R.call('checkPromoCode', { code: 'old5' })).message, 'This code has expired.');
assert.deepEqual(await R.call('checkPromoCode', { code: 'welcome10' }), { ok: true, code: 'WELCOME10', percent: 10 });

step('booking with the code uses it once; the same passenger cannot use it again');
const promoFare = { promoCode: 'WELCOME10', discount: 0.1, total: 4.86 };
id = await book(R, rider, REDDITCH, promoFare);
r = await settled(id);
assert.equal(val(r.status), 'searching');
assert.equal(val((await adminGet('promoCodes/WELCOME10')).used), '1');
assert.equal(val((await adminGet(`promoCodes/WELCOME10/uses/${rider}`)).rideId), id);
await adminSet(`rides/${id}`, { status: 'completed' }, true);
assert.equal((await R.call('checkPromoCode', { code: 'WELCOME10' })).message, 'You have already used this code.');
id = await book(R, rider, REDDITCH, promoFare);
r = await settled(id);
assert.equal(val(r.cancelReason), 'promo_invalid'); assert.match(val(r.cancelMessage), /already used this code/);

step('a cancelled booking gives the use back to that passenger (not counted twice)');
const one = await book(R2, rider2, REDDITCH, promoFare);
await settled(one);
assert.equal(val((await adminGet('promoCodes/WELCOME10')).used), '2');
await adminSet(`rides/${one}`, { status: 'cancelled' }, true);
assert.equal((await R2.call('checkPromoCode', { code: 'WELCOME10' })).ok, false, 'limit of 2 reached');
await adminSet('promoCodes/WELCOME10', { maxUses: 3 }, true);
assert.equal((await R2.call('checkPromoCode', { code: 'WELCOME10' })).ok, true);
id = await book(R2, rider2, REDDITCH, promoFare);
r = await settled(id);
assert.equal(val(r.status), 'searching');
assert.equal(val((await adminGet('promoCodes/WELCOME10')).used), '2');
await adminSet(`rides/${id}`, { status: 'completed' }, true);

step('a tampered discount is refused');
await adminSet('promoCodes/BIG', { code: 'BIG', percent: 5, active: true });
id = await book(R2, rider2, REDDITCH, { promoCode: 'BIG', discount: 0.9, total: 0.54 });
r = await settled(id);
assert.equal(val(r.status), 'cancelled'); // a 90% discount the code does not give: refused

step('limit reached: refused at booking too');
await adminSet('promoCodes/ONE', { code: 'ONE', percent: 5, active: true, maxUses: 1, used: 1 });
id = await book(R, rider, REDDITCH, { promoCode: 'ONE', discount: 0.05, total: 5.13 });
r = await settled(id);
assert.match(val(r.cancelMessage), /fully used/);

step('price: an honest booking is checked, the hold matches, the waiting terms are the real ones');
id = await book(R, rider, REDDITCH);
r = await settled(id);
assert.equal(val(r.pricing), 'checked'); assert.equal(Number(val(r.fareEstimate)), FULL);
assert.equal(Number(val(r.priceCheck.mapValue.fields.expectedTotal)), FULL);
assert.equal(Number(val(r.waitingPolicy.mapValue.fields.ratePerMinute)), 0.25);
await adminSet(`rides/${id}`, { status: 'completed' }, true);

step('price: a booking written at £1 is refused');
id = await book(R, rider, REDDITCH, { total: 1 });
r = await settled(id);
assert.equal(val(r.status), 'cancelled'); assert.equal(val(r.cancelReason), 'price_changed');
assert.match(val(r.cancelMessage), /price for this trip has changed/);

step('price: cash while cash is off, and bidding while bidding is off, are refused');
id = await addDoc(collection(R.db, 'rides'), { riderId: rider, status: 'searching', rideType: 'RouteMini', pickupLocation: REDDITCH, dropoffLocation: REDDITCH, fare: { total: FULL }, paymentMethod: 'cash' }).then((x) => x.id);
assert.equal(val((await settled(id)).cancelReason), 'bad_payment');
id = await addDoc(collection(R.db, 'rides'), { riderId: rider, status: 'searching', rideType: 'RouteMini', pickupLocation: REDDITCH, dropoffLocation: REDDITCH, fare: { total: 2 }, bidding: true, offeredFare: 2, paymentMethod: 'card' }).then((x) => x.id);
assert.equal(val((await settled(id)).cancelReason), 'bidding_off');

step('price: with bidding on, an offer at the lowest allowed (80%) goes through; below it does not');
await adminSet('config/app', { bidding: { enabled: 1, minOfferPercent: 80 } }, true);
id = await addDoc(collection(R.db, 'rides'), { riderId: rider, status: 'searching', rideType: 'RouteMini', pickupLocation: REDDITCH, dropoffLocation: REDDITCH, fare: { total: 4.32 }, bidding: true, offeredFare: 4.32, paymentMethod: 'card' }).then((x) => x.id);
r = await settled(id);
assert.equal(val(r.pricing), 'checked'); assert.equal(Number(val(r.fareEstimate)), 4.32);
await adminSet(`rides/${id}`, { status: 'completed' }, true);
id = await addDoc(collection(R.db, 'rides'), { riderId: rider, status: 'searching', rideType: 'RouteMini', pickupLocation: REDDITCH, dropoffLocation: REDDITCH, fare: { total: 3 }, bidding: true, offeredFare: 3, paymentMethod: 'card' }).then((x) => x.id);
assert.equal(val((await settled(id)).cancelReason), 'price_changed');
await adminSet('config/app', { bidding: { enabled: 0 } }, true);

step('job categories: Priority is priced on its own; a Priority job at the Normal price is refused');
id = await addDoc(collection(R.db, 'rides'), { riderId: rider, status: 'searching', rideType: 'RoutePriority', pickupLocation: REDDITCH, dropoffLocation: REDDITCH, fare: { total: 6.6 }, paymentMethod: 'card' }).then((x) => x.id);
r = await settled(id);
assert.equal(val(r.pricing), 'checked'); assert.equal(Number(val(r.priceCheck.mapValue.fields.expectedTotal)), 6.6);
await adminSet(`rides/${id}`, { status: 'completed' }, true);
id = await addDoc(collection(R.db, 'rides'), { riderId: rider, status: 'searching', rideType: 'RoutePriority', pickupLocation: REDDITCH, dropoffLocation: REDDITCH, fare: { total: FULL }, paymentMethod: 'card' }).then((x) => x.id);
assert.equal(val((await settled(id)).cancelReason), 'price_changed');
id = await addDoc(collection(R.db, 'rides'), { riderId: rider, status: 'searching', rideType: 'RouteUrgent', pickupLocation: REDDITCH, dropoffLocation: REDDITCH, fare: { total: 7.8 }, paymentMethod: 'card' }).then((x) => x.id);
r = await settled(id);
assert.equal(val(r.pricing), 'checked'); assert.equal(Number(val(r.priceCheck.mapValue.fields.expectedTotal)), 7.8);
await adminSet(`rides/${id}`, { status: 'completed' }, true);

step('price: an unknown car type is refused; Google down falls back to straight-line and lets an honest booking through');
id = await book(R, rider, REDDITCH, {});
await settled(id); await adminSet(`rides/${id}`, { status: 'completed' }, true);
id = await addDoc(collection(R.db, 'rides'), { riderId: rider, status: 'searching', rideType: 'RouteSpaceship', pickupLocation: REDDITCH, dropoffLocation: REDDITCH, fare: { total: FULL }, paymentMethod: 'card' }).then((x) => x.id);
assert.equal(val((await settled(id)).cancelReason), 'bad_ride_type');
routesDown = true;
id = await book(R, rider, REDDITCH);
r = await settled(id);
assert.equal(val(r.pricing), 'checked'); assert.equal(val(r.priceCheck.mapValue.fields.source), 'straight_line');
await adminSet(`rides/${id}`, { status: 'completed' }, true);
routesDown = false;

step('a driver cannot change their own car type after approval; an admin can');
const drv = (await createUserWithEmailAndPassword(D.auth, 'driver-bc@test.dev', 'secret123')).user.uid;
await adminSet(`drivers/${drv}`, { approved: true, onboardingComplete: true, vehicleType: 'RouteMini', status: 'offline' });
await assert.rejects(updateDoc(doc(D.db, 'drivers', drv), { vehicleType: 'RouteExecutive' }));
await updateDoc(doc(D.db, 'drivers', drv), { status: 'offline' });
await updateDoc(doc(A.db, 'drivers', drv), { vehicleType: 'RouteXL' });
assert.equal(val((await adminGet(`drivers/${drv}`)).vehicleType), 'RouteXL');
// ...but they choose their own job types.
await updateDoc(doc(D.db, 'drivers', drv), { jobTypes: ['RouteXL', 'RouteMini'] });
assert.equal((await adminGet(`drivers/${drv}`)).jobTypes.arrayValue.values.length, 2);

step('rejecting a payout returns the money and still succeeds with the push');
await adminSet(`driverWallets/${drv}`, { availableBalance: 0 });
await adminSet('driverPayouts/bc1', { driverId: drv, amount: 25, status: 'pending_admin' });
assert.equal((await A.call('rejectDriverPayout', { payoutId: 'bc1', reason: 'Bank details do not match' })).success, true);
assert.equal(val((await adminGet(`driverWallets/${drv}`)).availableBalance), '25');
assert.equal(val((await adminGet('driverPayouts/bc1')).status), 'rejected');

await del('cities/redditch');
fake.close();
console.log('ALL BOOKING CHECKS PASSED');
process.exit(0);
