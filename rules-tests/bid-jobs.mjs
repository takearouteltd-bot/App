// BID JOBs (functions/bidJobs.js, fleet.js): a job that runs out of drivers
// is opened to every available driver further out, highlighted, with
// counter-offers on app jobs when allowed.
// Against the emulators (auth 9099, firestore 8080, functions 5001, pubsub
// 8085), project demo-tar, with the fake Routes on :8999 (ROUTES_API_BASE in
// functions/.env.local): the booking-checks set-up plus pubsub (see README).
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, addDoc, collection, updateDoc, arrayUnion, serverTimestamp, runTransaction } from 'firebase/firestore';
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
const step = (s) => console.log('•', s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 240000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout: ' + what); await sleep(300); }
}
const schedule = async (name) => {
  const pub = await fetch(`http://127.0.0.1:8085/v1/projects/${PROJECT}/topics/firebase-schedule-${name}:publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ data: Buffer.from('{}').toString('base64') }] }) });
  assert.ok(pub.ok, 'pubsub publish: ' + pub.status);
};
const ride = (id) => adminGet(`rides/${id}`);
const claim = (uid) => ({ status: 'accepted', driverId: uid, acceptedAt: serverTimestamp(), walletProcessed: false });

// Normal search radius 3 km; BID JOBs out to 16 km, after 20 s, counters up to 30%.
const BID_ON = { enabled: 1, radiusKm: 16, afterSeconds: 20, allowCounter: 1, maxCounterPercent: 30 };
const A = mk('admin'), O = mk('owner'), D1 = mk('d1'), D2 = mk('d2'), D3 = mk('d3'), R = mk('rider');
const adm = await createUserWithEmailAndPassword(A.auth, 'admin-bj@test.dev', 'secret123');
await adminSet(`admins/${adm.user.uid}`, { isActive: true, role: 'super_admin' });
await adminSet('config/app', { currency: 'GBP', payments: { cashEnabled: 1 }, dispatch: { searchRadiusKm: 3 }, bidJobs: BID_ON });

step('a fleet with drivers 1 and 2; driver 3 works app jobs only');
const fleet = await A.call('createFleet', { name: 'Bid Cars', ownerName: 'B', email: 'owner-bj@test.dev', phone: '07700900401', perDriverMonthly: 50 });
const users = await (await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:query`, { method: 'POST', headers: H, body: '{}' })).json();
const ownerUser = users.userInfo.find((u) => u.email === 'owner-bj@test.dev');
await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: H, body: JSON.stringify({ localId: ownerUser.localId, password: 'owner123' }) });
await signInWithEmailAndPassword(O.auth, 'owner-bj@test.dev', 'owner123');

const PICK = { latitude: 52.3000, longitude: -1.9500, address: 'Unicorn Hill, Redditch' };
const NEAR = { latitude: 52.3050, longitude: -1.9500, address: 'Bates Hill, Redditch' }; // ~0.6 km
const OUT = { latitude: 52.3720, longitude: -1.9500, address: 'Hopwood' }; // ~8 km
const GONE = { latitude: 52.5700, longitude: -1.9500, address: 'Birmingham' }; // ~30 km
const DROP = { latitude: 52.3200, longitude: -1.9300, address: 'Headless Cross, Redditch' };

const ids = {};
for (const [name, who, phone] of [['d1', D1, '+447700900411'], ['d2', D2, '+447700900422'], ['d3', D3, '+447700900433']]) {
  ids[name] = (await createUserWithEmailAndPassword(who.auth, `${name}-bj@test.dev`, 'secret123')).user.uid;
  await adminSet(`drivers/${ids[name]}`, { approved: true, onboardingComplete: true, vehicleType: 'RouteMini', status: 'offline', isOnRide: false, phoneNumber: phone, firstName: name.toUpperCase(), location: GONE, subscription: { status: 'active', paymentMethod: 'wallet_deduction' } });
}
for (const [name, who] of [['d1', D1], ['d2', D2]]) {
  await who.call('requestFleetJoin', { code: fleet.joinCode });
  await O.call('decideFleetDriver', { driverId: ids[name], approve: true, driverType: 'company' });
}
const { d1, d2, d3 } = ids;
const place = (uid, location, status = 'online') => adminSet(`drivers/${uid}`, { status, isOnRide: false, location }, true);

const rider = (await createUserWithEmailAndPassword(R.auth, 'rider-bj@test.dev', 'secret123')).user.uid;
const FARE = { total: 5.4, discount: 0, promoCode: null, vatPercent: 20 };
const book = (extra = {}) => addDoc(collection(R.db, 'rides'), {
  riderId: rider, driverId: null, status: 'searching', rideType: 'RouteMini',
  pickupLocation: PICK, dropoffLocation: DROP,
  fare: FARE, cityId: null, paymentMethod: 'cash',
  waitingPolicy: { freeMinutes: 60, ratePerMinute: 0, maxCharge: 0 },
  timestamps: { createdAt: serverTimestamp() }, ...extra,
}).then((x) => x.id);
const priced = async (id) => until(async () => { const x = await ride(id); return x.pricing === 'checked' ? x : null; }, 'priced');

/* ------------------------------------------------------------ app jobs */

step('a passenger cannot book a job that is already a BID JOB');
await assert.rejects(book({ bidJob: { radiusKm: 99, allowCounter: true, maxCounterPercent: 300 } }));

step('driver 1 nearby declines, driver 3 is 8 km out: opened as a BID JOB out to 16 km');
await place(d1, NEAR); await place(d3, OUT);
const j1 = await book();
let r = await priced(j1);
await sleep(2000);
assert.equal((await ride(j1)).bidJob, undefined, 'not while driver 1 is in range');
await assert.rejects(updateDoc(doc(D1.db, 'rides', j1), { bidJob: { radiusKm: 99 } }), 'drivers cannot open one');
await updateDoc(doc(D1.db, 'rides', j1), { declinedBy: arrayUnion(d1) });
r = await until(async () => { const x = await ride(j1); return x.bidJob ? x : null; }, 'bid job opened');
assert.equal(r.bidJob.reason, 'declined'); assert.equal(r.bidJob.radiusKm, 16);
assert.equal(r.bidJob.allowCounter, true); assert.equal(r.bidJob.maxCounterPercent, 30);
await assert.rejects(updateDoc(doc(D1.db, 'rides', j1), { declinedBy: arrayUnion(d3) }), 'a driver declines for themselves only');

step('counter-offers: above 30% is refused, within it is sent; the passenger takes it at that price');
const offer = (price) => ({ driverId: d3, price, driverName: 'D3', rating: null, ratingCount: 0, vehicle: null, photoUrl: null, status: 'pending', createdAt: serverTimestamp(), sentAtMs: Date.now(), expiresAtMs: Date.now() + 60000 });
await assert.rejects(setDoc(doc(D3.db, 'rides', j1, 'offers', d3), offer(7.5)), 'over the cap (5.40 x 1.3 = 7.02)');
await setDoc(doc(D3.db, 'rides', j1, 'offers', d3), offer(7));
await runTransaction(R.db, async (tx) => {
  const ref = doc(R.db, 'rides', j1);
  const cur = (await tx.get(ref)).data();
  await tx.get(doc(R.db, 'rides', j1, 'offers', d3));
  tx.update(ref, { status: 'accepted', driverId: d3, acceptedAt: serverTimestamp(), walletProcessed: false, offeredFare: 7, fareEstimate: 7, fare: { ...cur.fare, total: 7 }, acceptedOfferId: d3 });
  tx.update(doc(R.db, 'rides', j1, 'offers', d3), { status: 'accepted' });
});
r = await ride(j1);
assert.equal(r.status, 'accepted'); assert.equal(r.driverId, d3); assert.equal(r.fare.total, 7);
await adminSet(`rides/${j1}`, { status: 'cancelled' }, true);
await place(d3, OUT);

step('no counter-offers on an ordinary job (no bidding, not a BID JOB)');
const j2 = await book();
await priced(j2);
await assert.rejects(setDoc(doc(D3.db, 'rides', j2, 'offers', d3), offer(6)));

step('nobody takes it within 20 s: the scheduler opens it as a BID JOB');
await sleep(21000);
await schedule('openBidJobs');
r = await until(async () => { const x = await ride(j2); return x.bidJob ? x : null; }, 'unanswered bid job');
assert.equal(r.bidJob.reason, 'unanswered');
await adminSet(`rides/${j2}`, { status: 'cancelled' }, true);

step('nobody in range at booking: a BID JOB straight away');
await place(d1, GONE, 'offline'); await place(d3, GONE);
const j3 = await book();
r = await until(async () => { const x = await ride(j3); return x.bidJob ? x : null; }, 'nobody bid job');
assert.equal(r.bidJob.reason, 'nobody');
await adminSet(`rides/${j3}`, { status: 'cancelled' }, true);

step('switched off: nothing is opened');
await adminSet('config/app', { bidJobs: { ...BID_ON, enabled: 0 } }, true);
const j4 = await book();
await priced(j4);
await sleep(3000);
assert.equal((await ride(j4)).bidJob, undefined);
await adminSet(`rides/${j4}`, { status: 'cancelled' }, true);
await adminSet('config/app', { bidJobs: BID_ON }, true);
await place(d3, GONE, 'offline');

/* ---------------------------------------------------------- phone jobs */

step('a whole-fleet phone job: driver 1 says no, driver 2 is 8 km out: BID JOB at the office price, no counters');
await place(d1, NEAR); await place(d2, OUT);
const p1 = await O.call('createFleetBooking', { customer: { phone: '07700900499', name: 'Ann' }, pickup: PICK, dropoff: DROP, rideType: 'RouteMini' });
await until(async () => (await adminGet(`fleetJobOffers/${p1.rideId}`)) !== null, 'offered');
const before = await ride(p1.rideId);
await updateDoc(doc(D1.db, 'rides', p1.rideId), { declinedBy: arrayUnion(d1) });
r = await until(async () => { const x = await ride(p1.rideId); return x.bidJob ? x : null; }, 'phone bid job');
assert.equal(r.bidJob.reason, 'declined'); assert.equal(r.bidJob.allowCounter, false);
assert.notEqual(r.dispatch.offeredAt, before.dispatch.offeredAt, 'rung again');
assert.ok(r.declinedBy.includes(d1), 'driver 1 is not asked again');
await until(async () => (await adminGet(`fleetJobOffers/${p1.rideId}`))?.bidJob, 'mirror shows it');
await assert.rejects(setDoc(doc(D2.db, 'rides', p1.rideId, 'offers', d2), { ...offer(9), driverId: d2 }), 'no counters on phone jobs');
await updateDoc(doc(D2.db, 'rides', p1.rideId), claim(d2));
assert.equal((await ride(p1.rideId)).driverId, d2);
await O.call('cancelFleetBooking', { rideId: p1.rideId });
await place(d2, GONE, 'offline');

step('a job sent to driver 1 by name and declined goes back to the office, never a BID JOB');
const p2 = await O.call('createFleetBooking', { customer: { phone: '07700900498', name: 'Bo' }, pickup: PICK, dropoff: DROP, rideType: 'RouteMini', driverId: d1 });
await until(async () => (await adminGet(`fleetJobOffers/${p2.rideId}`)) !== null, 'named offered');
await updateDoc(doc(D1.db, 'rides', p2.rideId), { declinedBy: arrayUnion(d1) });
r = await until(async () => { const x = await ride(p2.rideId); return x.dispatch.mode === 'office' ? x : null; }, 'held');
await sleep(1500);
assert.equal((await ride(p2.rideId)).bidJob, undefined);
await O.call('cancelFleetBooking', { rideId: p2.rideId });

step('to the nearest: driver 1 says no, nobody else: whole fleet, then a BID JOB');
const p3 = await O.call('createFleetBooking', { customer: { phone: '07700900497', name: 'Cy' }, pickup: PICK, dropoff: DROP, rideType: 'RouteMini', dispatchMode: 'nearest' });
await until(async () => (await ride(p3.rideId)).dispatch.driverId === d1, 'nearest is driver 1');
await updateDoc(doc(D1.db, 'rides', p3.rideId), { declinedBy: arrayUnion(d1) });
r = await until(async () => { const x = await ride(p3.rideId); return x.bidJob ? x : null; }, 'nearest bid job');
assert.equal(r.dispatch.queueDone, true); assert.ok(r.declinedBy.includes(d1));
await O.call('cancelFleetBooking', { rideId: p3.rideId });

fake.close();
console.log('\nALL PASSED');
process.exit(0);
