// A driver's lowest fare (drivers.minJobFare; functions/index.js
// belowMinFare): jobs that pay less are not offered to them, in app job
// dispatch (one at a time, appDriverPool, which BID JOBs use too) and in a
// fleet's automatic dispatch (fleet.js wantsJob: nearest, the whole fleet,
// the TakeARoute network); the office can still send them one by name. A
// minimum at or under the fare, or none, changes nothing. Follow-on offers
// (followOn.js canTake) and the zone queue use the same rule. Rules for the
// field (none, or 0 to 200) are in fleet.test.mjs.
// Run on fresh emulators: `rules-tests/ci-suite.sh min-fare` (auth,
// firestore, functions, pubsub; the fake Routes on :8999 via
// ROUTES_API_BASE). CI: .github/workflows/tests.yml.
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import assert from 'node:assert/strict';
import http from 'node:http';

// Fake Google Routes: 1 mile, 5 minutes.
const fake = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ routes: [{ distanceMeters: 1609, duration: '300s' }] }));
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
const enc = (v) => typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : v === null ? { nullValue: null } : v instanceof Date ? { timestampValue: v.toISOString() } : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } } : typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } } : { stringValue: String(v) };
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
  const r = await fetch(`${REST}/${path}${mask ? '?' + Object.keys(data).map((k) => 'updateMask.fieldPaths=' + k).join('&') : ''}`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields }) });
  if (!r.ok) throw new Error(await r.text());
}
const adminGet = async (path) => {
  const r = await (await fetch(`${REST}/${path}`, { headers: H })).json();
  return r.fields ? Object.fromEntries(Object.entries(r.fields).map(([k, v]) => [k, dec(v)])) : null;
};
let steps = 0;
const step = (s) => { steps += 1; console.log('•', s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 240000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout: ' + what); await sleep(300); }
}
const ride = (id) => adminGet(`rides/${id}`);

/* ------------------------------ set-up ------------------------------ */
// Long offer times, so nobody's offer runs out mid-step; no BID JOBs.
const A = mk('admin'), O = mk('owner'), D1 = mk('d1'), D2 = mk('d2'), D3 = mk('d3'), R = mk('rider');
const adm = await createUserWithEmailAndPassword(A.auth, 'admin-mf@test.dev', 'secret123');
await adminSet(`admins/${adm.user.uid}`, { isActive: true, role: 'super_admin' });
await adminSet('config/app', { currency: 'GBP', payments: { cashEnabled: 1 }, dispatch: { searchRadiusKm: 5, requestTimeoutSeconds: 60 }, bidJobs: { enabled: 0 } });

const fleet = await A.call('createFleet', { name: 'Min Cars', ownerName: 'M', email: 'owner-mf@test.dev', phone: '07700900501', perDriverMonthly: 50 });
const users = await (await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:query`, { method: 'POST', headers: H, body: '{}' })).json();
const ownerUser = users.userInfo.find((u) => u.email === 'owner-mf@test.dev');
await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: H, body: JSON.stringify({ localId: ownerUser.localId, password: 'owner123' }) });
await signInWithEmailAndPassword(O.auth, 'owner-mf@test.dev', 'owner123');
// The network is switched on for this fleet by an admin.
await adminSet(`fleets/${fleet.fleetId}`, { networkAllowed: true }, true);

const PICK = { latitude: 52.3000, longitude: -1.9500, address: 'Unicorn Hill, Redditch' };
const NEAR = { latitude: 52.3050, longitude: -1.9500, address: 'Bates Hill, Redditch' }; // ~0.6 km
const MID = { latitude: 52.3110, longitude: -1.9500, address: 'Plymouth Road, Redditch' }; // ~1.2 km
const EDGE = { latitude: 52.3200, longitude: -1.9500, address: 'Mount Pleasant, Redditch' }; // ~2.2 km
const DROP = { latitude: 52.3200, longitude: -1.9300, address: 'Headless Cross, Redditch' };

// Drivers 1 and 2 drive for the fleet; driver 3 is independent.
const ids = {};
for (const [name, who, phone, at] of [['d1', D1, '+447700900511', NEAR], ['d2', D2, '+447700900522', MID], ['d3', D3, '+447700900533', EDGE]]) {
  ids[name] = (await createUserWithEmailAndPassword(who.auth, `${name}-mf@test.dev`, 'secret123')).user.uid;
  await adminSet(`drivers/${ids[name]}`, { approved: true, onboardingComplete: true, vehicleType: 'RouteMini', status: 'offline', isOnRide: false, phoneNumber: phone, firstName: name.toUpperCase(), location: at, subscription: { status: 'active', paymentMethod: 'wallet_deduction' } });
}
for (const [name, who] of [['d1', D1], ['d2', D2]]) {
  await who.call('requestFleetJoin', { code: fleet.joinCode });
  await O.call('decideFleetDriver', { driverId: ids[name], approve: true, driverType: 'company' });
}
const { d1, d2, d3 } = ids;
for (const uid of [d1, d2, d3]) await adminSet(`drivers/${uid}`, { status: 'online' }, true);
const minFare = (uid, v) => adminSet(`drivers/${uid}`, { minJobFare: v }, true);

const rider = (await createUserWithEmailAndPassword(R.auth, 'rider-mf@test.dev', 'secret123')).user.uid;
// 1 mile at the default first-mile price: 5.40 with VAT.
const FARE = { total: 5.4, discount: 0, promoCode: null, vatPercent: 20 };
const book = () => addDoc(collection(R.db, 'rides'), {
  riderId: rider, driverId: null, status: 'searching', rideType: 'RouteMini',
  pickupLocation: PICK, dropoffLocation: DROP, fare: FARE, cityId: null, paymentMethod: 'cash',
  waitingPolicy: { freeMinutes: 60, ratePerMinute: 0, maxCharge: 0 },
  timestamps: { createdAt: serverTimestamp() },
}).then((x) => x.id);
const askedFirst = async (id) => (await until(async () => { const x = await ride(id); return x.offer?.driverId ? x : null; }, 'first offer')).offer.driverId;
const cancelApp = (id) => adminSet(`rides/${id}`, { status: 'cancelled' }, true);
const phoneJob = (extra) => O.call('createFleetBooking', { customer: { phone: '07700900599', name: 'Ann' }, pickup: PICK, dropoff: DROP, rideType: 'RouteMini', agreedPrice: 12, ...extra });

/* ------------------------------ app jobs ------------------------------ */
await minFare(d1, 10);
let j = await book();
assert.equal(await askedFirst(j), d2, 'driver 1 (nearest) wants £10 or more: the £5.40 job goes to driver 2');
assert.equal((await ride(j)).fareEstimate, 5.4);
await cancelApp(j);
step('an app job under a driver\'s lowest fare skips them: the next nearest is asked');

await minFare(d1, 5);
j = await book();
assert.equal(await askedFirst(j), d1, 'a £5 minimum takes a £5.40 job');
await cancelApp(j);
await minFare(d1, null);
j = await book();
assert.equal(await askedFirst(j), d1, 'no minimum: any job');
await cancelApp(j);
step('a minimum at or under the fare, or none, changes nothing');

await minFare(d1, 30); await minFare(d2, 30); await minFare(d3, 30);
j = await book();
await sleep(4000);
let r = await ride(j);
assert.equal(r.status, 'searching');
assert.ok(!r.offer?.driverId, 'nobody is asked when every driver wants more');
await cancelApp(j);
step('everyone wants more: nobody is offered it');

/* ------------------------------ fleet phone jobs ------------------------------ */
// A £12 phone job; driver 1 wants £15, driver 2 £10.
await minFare(d1, 15); await minFare(d2, 10); await minFare(d3, null);
let p = await phoneJob({ dispatchMode: 'nearest' });
r = await until(async () => { const x = await ride(p.rideId); return x.dispatch?.driverId ? x : null; }, 'nearest phone offer');
assert.equal(r.fareEstimate, 12);
assert.equal(r.dispatch.driverId, d2, 'nearest: driver 1 wants more, so driver 2');
await O.call('cancelFleetBooking', { rideId: p.rideId });
step('a fleet job to the nearest skips a driver whose lowest fare is higher');

await minFare(d2, 20);
p = await phoneJob({ dispatchMode: 'network' });
r = await until(async () => { const x = await ride(p.rideId); return x.dispatch?.driverId ? x : null; }, 'network offer');
assert.equal(r.dispatch.driverId, d3, 'on the network: both fleet drivers want more, so the independent driver 3');
await O.call('cancelFleetBooking', { rideId: p.rideId });
step('a job out to the TakeARoute network skips them too');

p = await phoneJob({ driverId: d1 });
await sleep(3000);
r = await ride(p.rideId);
assert.equal(r.dispatch.driverId, d1, 'sent by name: the office chose driver 1');
assert.equal(r.status, 'dispatching');
assert.notEqual(r.dispatch.mode, 'office', 'not held back for the office');
await O.call('cancelFleetBooking', { rideId: p.rideId });
step('the office can still send a job by name to a driver whose lowest fare is higher');

fake.close();
console.log(`ALL ${steps} MIN FARE STEPS PASSED`);
process.exit(0);
