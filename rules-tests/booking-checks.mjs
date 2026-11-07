// New app bookings are checked by the server (checkNewRide in
// functions/index.js): working cities and promo codes (checkPromoCode, uses
// left, once per passenger). Also: a driver cannot change their own car type
// after approval, and rejecting a payout still works with the new push.
// Against the emulators (auth 9099, firestore 8080, functions 5001), project
// demo-tar. Run like fleet-e2e.mjs (see README).
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, addDoc, collection, doc, updateDoc } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import assert from 'node:assert/strict';

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

// Waits for the onCreate check to settle: cancelled, or still searching with
// the city stamped (checked) after a few seconds.
async function settled(id, wantCancelled) {
  for (let i = 0; i < 40; i++) {
    const r = await adminGet(`rides/${id}`);
    if (val(r.status) === 'cancelled') return r;
    if (!wantCancelled && i > 20) return r;
    await sleep(250);
  }
  return adminGet(`rides/${id}`);
}

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
  fare: { total: 10, discount: 0, promoCode: null, ...fare }, cityId: null, paymentMethod: 'cash',
}).then((r) => r.id);

step('no cities switched on: a booking anywhere goes ahead');
let id = await book(R, rider, LONDON);
let r = await settled(id, false);
assert.equal(val(r.status), 'searching');
await adminSet(`rides/${id}`, { status: 'completed' }, true);

step('with Redditch switched on: a London pickup is refused with a reason; a Redditch one gets its city');
await adminSet('cities/redditch', { name: 'Redditch', latitude: 52.3069, longitude: -1.9492, radiusKm: 15, active: true });
await adminSet('cities/off', { name: 'Leeds', latitude: 51.5, longitude: -0.12, radiusKm: 50, active: false });
id = await book(R, rider, LONDON);
r = await settled(id, true);
assert.equal(val(r.status), 'cancelled'); assert.equal(val(r.cancelledBy), 'system');
assert.equal(val(r.cancelReason), 'outside_service_area'); assert.match(val(r.cancelMessage), /We currently cover Redditch\./);
id = await book(R, rider, REDDITCH);
r = await settled(id, false);
assert.equal(val(r.status), 'searching'); assert.equal(val(r.cityId), 'redditch');
await adminSet(`rides/${id}`, { status: 'completed' }, true);

step('promo check: unknown, off, expired, valid');
await adminSet('promoCodes/WELCOME10', { code: 'WELCOME10', percent: 10, active: true, maxUses: 2, expiresAt: null });
await adminSet('promoCodes/OLD5', { code: 'OLD5', percent: 5, active: true, expiresAt: '2020-01-01' });
await adminSet('promoCodes/OFF5', { code: 'OFF5', percent: 5, active: false });
assert.deepEqual(await R.call('checkPromoCode', { code: 'nope1' }), { ok: false, message: 'This code is not valid.' });
assert.equal((await R.call('checkPromoCode', { code: 'off5' })).ok, false);
assert.equal((await R.call('checkPromoCode', { code: 'old5' })).message, 'This code has expired.');
assert.deepEqual(await R.call('checkPromoCode', { code: 'welcome10' }), { ok: true, code: 'WELCOME10', percent: 10 });

step('booking with the code uses it once; the same passenger cannot use it again');
const promoFare = { promoCode: 'WELCOME10', discount: 0.1 };
id = await book(R, rider, REDDITCH, promoFare);
r = await settled(id, false);
assert.equal(val(r.status), 'searching');
assert.equal(val((await adminGet('promoCodes/WELCOME10')).used), '1');
assert.equal(val((await adminGet(`promoCodes/WELCOME10/uses/${rider}`)).rideId), id);
await adminSet(`rides/${id}`, { status: 'completed' }, true);
assert.equal((await R.call('checkPromoCode', { code: 'WELCOME10' })).message, 'You have already used this code.');
id = await book(R, rider, REDDITCH, promoFare);
r = await settled(id, true);
assert.equal(val(r.cancelReason), 'promo_invalid'); assert.match(val(r.cancelMessage), /already used this code/);

step('a cancelled booking gives the use back to that passenger (not counted twice)');
const one = await book(R2, rider2, REDDITCH, promoFare);
await settled(one, false);
assert.equal(val((await adminGet('promoCodes/WELCOME10')).used), '2');
await adminSet(`rides/${one}`, { status: 'cancelled' }, true);
assert.equal((await R2.call('checkPromoCode', { code: 'WELCOME10' })).ok, false, 'limit of 2 reached');
await adminSet('promoCodes/WELCOME10', { maxUses: 3 }, true);
assert.equal((await R2.call('checkPromoCode', { code: 'WELCOME10' })).ok, true);
id = await book(R2, rider2, REDDITCH, promoFare);
r = await settled(id, false);
assert.equal(val(r.status), 'searching');
assert.equal(val((await adminGet('promoCodes/WELCOME10')).used), '2');
await adminSet(`rides/${id}`, { status: 'completed' }, true);

step('a tampered discount is refused');
await adminSet('promoCodes/BIG', { code: 'BIG', percent: 5, active: true });
id = await book(R2, rider2, REDDITCH, { promoCode: 'BIG', discount: 0.9 });
r = await settled(id, true);
assert.match(val(r.cancelMessage), /discount on this code has changed/);

step('limit reached: refused at booking too');
await adminSet('promoCodes/ONE', { code: 'ONE', percent: 5, active: true, maxUses: 1, used: 1 });
id = await book(R, rider, REDDITCH, { promoCode: 'ONE', discount: 0.05 });
r = await settled(id, true);
assert.match(val(r.cancelMessage), /fully used/);

step('a driver cannot change their own car type after approval; an admin can');
const drv = (await createUserWithEmailAndPassword(D.auth, 'driver-bc@test.dev', 'secret123')).user.uid;
await adminSet(`drivers/${drv}`, { approved: true, onboardingComplete: true, vehicleType: 'RouteMini', status: 'offline' });
await assert.rejects(updateDoc(doc(D.db, 'drivers', drv), { vehicleType: 'RouteExecutive' }));
await updateDoc(doc(D.db, 'drivers', drv), { status: 'offline' });
await updateDoc(doc(A.db, 'drivers', drv), { vehicleType: 'RouteXL' });
assert.equal(val((await adminGet(`drivers/${drv}`)).vehicleType), 'RouteXL');

step('rejecting a payout returns the money and still succeeds with the push');
await adminSet(`driverWallets/${drv}`, { availableBalance: 0 });
await adminSet('driverPayouts/bc1', { driverId: drv, amount: 25, status: 'pending_admin' });
assert.equal((await A.call('rejectDriverPayout', { payoutId: 'bc1', reason: 'Bank details do not match' })).success, true);
assert.equal(val((await adminGet(`driverWallets/${drv}`)).availableBalance), '25');
assert.equal(val((await adminGet('driverPayouts/bc1')).status), 'rejected');

await del('cities/redditch');
console.log('ALL BOOKING CHECKS PASSED');
process.exit(0);
