// Booked jobs allocated to a driver (functions/fleet.js syncFleetAllocation,
// declineFleetAllocation, redispatchFleetBooking keepTime, jobs held for the
// office) and follow-on jobs (functions/followOn.js).
// Against the emulators (auth 9099, firestore 8080, functions 5001), project
// demo-tar, with the fake Routes on :8999 (ROUTES_API_BASE in
// functions/.env.local), like booking-checks.mjs (see README).
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, addDoc, collection, updateDoc, arrayUnion, serverTimestamp, writeBatch } from 'firebase/firestore';
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
  if (k === 'integerValue') return Number(v);
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
const ride = (id) => adminGet(`rides/${id}`);
const claim = (uid) => ({ status: 'accepted', driverId: uid, acceptedAt: serverTimestamp(), walletProcessed: false });

const A = mk('admin'), O = mk('owner'), D1 = mk('d1'), D2 = mk('d2'), D3 = mk('d3'), R = mk('rider');
const adm = await createUserWithEmailAndPassword(A.auth, 'admin-af@test.dev', 'secret123');
await adminSet(`admins/${adm.user.uid}`, { isActive: true, role: 'super_admin' });
await adminSet('config/app', { currency: 'GBP', payments: { cashEnabled: 1 } });

step('a fleet with two drivers; a third driver works app jobs only');
const fleet = await A.call('createFleet', { name: 'Mid Cars', ownerName: 'M', email: 'owner-af@test.dev', phone: '07700900301', perDriverMonthly: 50 });
const users = await (await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:query`, { method: 'POST', headers: H, body: '{}' })).json();
const ownerUser = users.userInfo.find((u) => u.email === 'owner-af@test.dev');
await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: H, body: JSON.stringify({ localId: ownerUser.localId, password: 'owner123' }) });
await signInWithEmailAndPassword(O.auth, 'owner-af@test.dev', 'owner123');

const HOME = { latitude: 52.3000, longitude: -1.9500, address: 'Unicorn Hill, Redditch' };
const DROP = { latitude: 52.3090, longitude: -1.9500, address: 'Church Green, Redditch' };
const NEAR_DROP = { latitude: 52.3120, longitude: -1.9500, address: 'Evesham Street, Redditch' };
const TOWN = { latitude: 52.3200, longitude: -1.9300, address: 'Headless Cross, Redditch' };
const FAR = { latitude: 52.4000, longitude: -1.9500, address: 'Birmingham Road, Alvechurch' };

const ids = {};
for (const [name, who, phone] of [['d1', D1, '+447700900311'], ['d2', D2, '+447700900322'], ['d3', D3, '+447700900333']]) {
  ids[name] = (await createUserWithEmailAndPassword(who.auth, `${name}-af@test.dev`, 'secret123')).user.uid;
  await adminSet(`drivers/${ids[name]}`, { approved: true, onboardingComplete: true, vehicleType: 'RouteMini', status: 'offline', phoneNumber: phone, firstName: name.toUpperCase(), location: HOME, subscription: { status: 'active', paymentMethod: 'wallet_deduction' } });
}
for (const [name, who] of [['d1', D1], ['d2', D2]]) {
  await who.call('requestFleetJoin', { code: fleet.joinCode });
  await O.call('decideFleetDriver', { driverId: ids[name], approve: true, driverType: 'company' });
}
const { d1, d2, d3 } = ids;

/* ------------------------------------------------------- allocations */

step('a booked job given to driver 1: in their Booked jobs, without the customer number; driver 2 cannot read it');
const in3h = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
const bk = await O.call('createFleetBooking', { customer: { phone: '07700900399', name: 'Ann' }, pickup: TOWN, dropoff: DROP, rideType: 'RouteMini', pickupAt: in3h, driverId: d1, notes: 'Wheelchair in boot' });
assert.equal(bk.status, 'scheduled');
let alloc = await until(async () => (await getDoc(doc(D1.db, 'fleetAllocations', bk.rideId)).catch(() => null))?.data(), 'allocation for d1');
assert.equal(alloc.driverId, d1); assert.equal(alloc.customerName, 'Ann'); assert.equal(alloc.notes, 'Wheelchair in boot');
assert.equal(JSON.stringify(alloc).includes('900399'), false, 'no customer number');
await assert.rejects(getDoc(doc(D2.db, 'fleetAllocations', bk.rideId)), 'driver 2 cannot read it');
const dispatchAt = (await ride(bk.rideId)).dispatchAt;

step('the office moves it to driver 2 keeping the time: still booked, same release time, now in driver 2\'s list');
await O.call('redispatchFleetBooking', { rideId: bk.rideId, driverId: d2, keepTime: true });
let r = await ride(bk.rideId);
assert.equal(r.status, 'scheduled'); assert.equal(r.dispatchAt, dispatchAt); assert.equal(r.dispatch.driverId, d2); assert.equal(r.dispatch.mode, 'driver');
alloc = await until(async () => { const a = await adminGet(`fleetAllocations/${bk.rideId}`); return a?.driverId === d2 ? a : null; }, 'allocation moved');

step('driver 1 cannot hand back a job that is not theirs; driver 2 says they can\'t do it: held for the office');
await assert.rejects(D1.call('declineFleetAllocation', { rideId: bk.rideId }), /no longer yours/);
await D2.call('declineFleetAllocation', { rideId: bk.rideId });
r = await ride(bk.rideId);
assert.equal(r.status, 'scheduled'); assert.equal(r.dispatch.mode, 'office'); assert.equal(r.dispatch.driverId, null);
assert.equal(r.dispatch.returnedBy, d2); assert.equal(r.dispatch.heldReason, 'cannot_do');
await until(async () => (await adminGet(`fleetAllocations/${bk.rideId}`)) === null, 'allocation removed');

step('given to driver 1 again, then sent now: it rings driver 1 only, and leaves Booked jobs');
await O.call('redispatchFleetBooking', { rideId: bk.rideId, driverId: d1, keepTime: true });
r = await ride(bk.rideId);
assert.equal(r.dispatch.mode, 'driver'); assert.equal(r.dispatch.heldReason, undefined); assert.equal(r.dispatch.returnedBy, undefined);
await O.call('redispatchFleetBooking', { rideId: bk.rideId, driverId: d1 });
assert.equal((await ride(bk.rideId)).status, 'dispatching');
await until(async () => (await adminGet(`fleetJobOffers/${bk.rideId}`)) !== null, 'offer shown');
await until(async () => (await adminGet(`fleetAllocations/${bk.rideId}`)) === null, 'allocation gone once sent');

step('driver 1 says no: back to the office, not offered to driver 2');
await updateDoc(doc(D1.db, 'rides', bk.rideId), { declinedBy: arrayUnion(d1) });
r = await until(async () => { const x = await ride(bk.rideId); return x.dispatch.mode === 'office' ? x : null; }, 'held after no');
assert.equal(r.dispatch.heldReason, 'declined'); assert.equal(r.dispatch.returnedBy, d1);
await until(async () => (await adminGet(`fleetJobOffers/${bk.rideId}`)) === null, 'offer withdrawn');
await assert.rejects(updateDoc(doc(D2.db, 'rides', bk.rideId), claim(d2)), 'nobody can take a held job');

step('sent to driver 2, who accepts and gives it back: held for the office again, not passed on');
await O.call('redispatchFleetBooking', { rideId: bk.rideId, driverId: d2 });
await updateDoc(doc(D2.db, 'rides', bk.rideId), claim(d2));
await updateDoc(doc(D2.db, 'rides', bk.rideId), { status: 'dispatching', driverId: null, acceptedAt: null, declinedBy: arrayUnion(d2), lastDriverCancelAt: serverTimestamp() });
r = await until(async () => { const x = await ride(bk.rideId); return x.dispatch.mode === 'office' ? x : null; }, 'held after give-back');
assert.equal(r.dispatch.heldReason, 'gave_back'); assert.equal(r.dispatch.returnedBy, d2); assert.equal(r.dispatch.driverId, null);
await sleep(1500);
assert.equal(await adminGet(`fleetJobOffers/${bk.rideId}`), null, 'not offered to anyone');
await O.call('cancelFleetBooking', { rideId: bk.rideId });

step('a whole-fleet job given back still goes on to the fleet by itself');
const all = await O.call('createFleetBooking', { customer: { phone: '07700900398', name: 'Bo' }, pickup: TOWN, dropoff: DROP, rideType: 'RouteMini' });
await updateDoc(doc(D1.db, 'rides', all.rideId), claim(d1));
await updateDoc(doc(D1.db, 'rides', all.rideId), { status: 'dispatching', driverId: null, acceptedAt: null, declinedBy: arrayUnion(d1), lastDriverCancelAt: serverTimestamp() });
r = await until(async () => { const x = await ride(all.rideId); return x.dispatch.autoResent ? x : null; }, 'auto resent');
assert.equal(r.dispatch.mode, 'all');
await O.call('cancelFleetBooking', { rideId: all.rideId });

/* ---------------------------------------------------- follow-on jobs */

// Driver 3 has a passenger on board, about 1 km from dropping off just
// south of the new pickup.
const onTrip = async (uid, tripId) => {
  await adminSet(`rides/${tripId}`, { riderId: 'someone', driverId: uid, status: 'ongoing', rideType: 'RouteMini', paymentMethod: 'cash', pickupLocation: HOME, dropoffLocation: DROP, stops: [], stopsCompleted: 0, fare: { total: 8 } });
  await adminSet(`drivers/${uid}`, { status: 'on_ride', isOnRide: true, currentRideId: tripId, location: HOME, followOnJobs: true }, true);
};
const rider = (await createUserWithEmailAndPassword(R.auth, 'rider-af@test.dev', 'secret123')).user.uid;
const book = (pickup) => addDoc(collection(R.db, 'rides'), {
  riderId: rider, driverId: null, status: 'searching', rideType: 'RouteMini',
  pickupLocation: pickup, dropoffLocation: TOWN,
  fare: { total: 5.4, discount: 0, promoCode: null, vatPercent: 20 }, cityId: null, paymentMethod: 'cash',
  waitingPolicy: { freeMinutes: 60, ratePerMinute: 0, maxCharge: 0 },
}).then((x) => x.id);

step('an app booking by driver 3\'s drop-off, nobody free: offered to driver 3 as a follow-on job');
await onTrip(d3, 'trip1');
const foj = await book(NEAR_DROP);
let offer = await until(async () => (await getDoc(doc(D3.db, 'followOnOffers', d3))).data(), 'follow-on offer');
assert.equal(offer.rideId, foj); assert.equal(offer.afterRideId, 'trip1');
assert.ok(offer.etaMinutes >= 1 && offer.etaMinutes <= 10, `eta ${offer.etaMinutes}`);
await assert.rejects(getDoc(doc(D1.db, 'followOnOffers', d3)), 'only driver 3 sees it');

step('driver 3 accepts: the job is theirs, next after this trip');
const acc = await D3.call('answerFollowOnJob', { rideId: foj, answer: 'accept' });
assert.equal(acc.rideId, foj);
r = await ride(foj);
assert.equal(r.status, 'accepted'); assert.equal(r.driverId, d3); assert.equal(r.followOn.afterRideId, 'trip1'); assert.equal(r.followOn.startedAt, null);
assert.equal((await adminGet(`drivers/${d3}`)).nextRideId, foj);
assert.equal(await adminGet(`followOnOffers/${d3}`), null, 'offer cleared');
await assert.rejects(D3.call('answerFollowOnJob', { rideId: foj, answer: 'accept' }), /run out/);

step('driver 3 completes the trip: the follow-on job becomes their current job');
const b = writeBatch(D3.db);
b.update(doc(D3.db, 'rides', 'trip1'), { status: 'completed', completedAt: serverTimestamp() });
b.update(doc(D3.db, 'drivers', d3), { isOnRide: false, currentRideId: null, status: 'online' });
await b.commit();
let me = await until(async () => { const x = await adminGet(`drivers/${d3}`); return x.currentRideId === foj ? x : null; }, 'switched to follow-on');
assert.equal(me.isOnRide, true); assert.equal(me.status, 'on_ride'); assert.equal(me.nextRideId, undefined);
assert.ok((await ride(foj)).followOn.startedAt, 'started');

step('a free driver right at the pickup gets the chance instead: no follow-on offer');
await adminSet(`rides/${foj}`, { status: 'completed' }, true);
await onTrip(d3, 'trip2');
await adminSet(`drivers/${d1}`, { status: 'online', isOnRide: false, location: NEAR_DROP }, true);
const near = await book(NEAR_DROP);
await until(async () => (await ride(near)).pricing === 'checked', 'priced');
await sleep(2500);
assert.equal(await adminGet(`followOnOffers/${d3}`), null, 'free driver is quicker');
await adminSet(`rides/${near}`, { status: 'cancelled' }, true);
await adminSet(`drivers/${d1}`, { status: 'offline', location: HOME }, true);

step('driver 3 says no thanks: tried, offer gone');
const no = await book(NEAR_DROP);
offer = await until(async () => (await getDoc(doc(D3.db, 'followOnOffers', d3))).data(), 'second offer');
assert.equal(offer.rideId, no);
await D3.call('answerFollowOnJob', { rideId: no, answer: 'decline' });
assert.equal(await adminGet(`followOnOffers/${d3}`), null);
assert.ok((await ride(no)).followOnTried.includes(d3));
assert.equal((await ride(no)).status, 'searching');
await adminSet(`rides/${no}`, { status: 'cancelled' }, true);

step('accepted, then given back before starting: back to searching, off the driver');
const drop = await book(NEAR_DROP);
await until(async () => (await getDoc(doc(D3.db, 'followOnOffers', d3))).data()?.rideId === drop, 'third offer');
await D3.call('answerFollowOnJob', { rideId: drop, answer: 'accept' });
await D3.call('answerFollowOnJob', { rideId: drop, answer: 'drop' });
r = await ride(drop);
assert.equal(r.status, 'searching'); assert.equal(r.driverId, null); assert.ok(r.declinedBy.includes(d3)); assert.equal(r.followOn, undefined);
assert.equal((await adminGet(`drivers/${d3}`)).nextRideId, undefined);
await adminSet(`rides/${drop}`, { status: 'cancelled' }, true);

step('a passenger cancels a follow-on job before it starts: off the driver');
const gone = await book(NEAR_DROP);
await until(async () => (await getDoc(doc(D3.db, 'followOnOffers', d3))).data()?.rideId === gone, 'fourth offer');
await D3.call('answerFollowOnJob', { rideId: gone, answer: 'accept' });
await updateDoc(doc(R.db, 'rides', gone), { status: 'cancelled', cancelledBy: 'rider', cancelReason: 'changed_mind', cancelledAt: serverTimestamp() }).catch(async () => {
  await adminSet(`rides/${gone}`, { status: 'cancelled', cancelledBy: 'rider' }, true);
});
await until(async () => (await adminGet(`drivers/${d3}`)).nextRideId === undefined, 'next job cleared');

step('follow-on jobs switched off: no offer');
await updateDoc(doc(D3.db, 'drivers', d3), { followOnJobs: false });
const off = await book(NEAR_DROP);
await until(async () => (await ride(off)).pricing === 'checked', 'priced');
await sleep(2500);
assert.equal(await adminGet(`followOnOffers/${d3}`), null);
await adminSet(`rides/${off}`, { status: 'cancelled' }, true);
await adminSet(`rides/trip2`, { status: 'completed' }, true);

step('a phone job sent to driver 1 by name while they are on a trip: offered as their next job, whatever the distance');
await onTrip(d1, 'trip3');
const named = await O.call('createFleetBooking', { customer: { phone: '07700900397', name: 'Cy' }, pickup: FAR, dropoff: DROP, rideType: 'RouteMini', driverId: d1 });
offer = await until(async () => (await getDoc(doc(D1.db, 'followOnOffers', d1))).data(), 'named follow-on');
assert.equal(offer.rideId, named.rideId); assert.equal(offer.forMe, true);
assert.equal(JSON.stringify(offer).includes('900397'), false, 'no customer number');
await D1.call('answerFollowOnJob', { rideId: named.rideId, answer: 'accept' });
r = await ride(named.rideId);
assert.equal(r.status, 'accepted'); assert.equal(r.driverId, d1); assert.equal(r.followOn.afterRideId, 'trip3');
await until(async () => (await adminGet(`fleetJobOffers/${named.rideId}`)) === null, 'fleet offer gone');

step('the office cancels it before it starts: off driver 1');
await O.call('cancelFleetBooking', { rideId: named.rideId });
await until(async () => (await adminGet(`drivers/${d1}`)).nextRideId === undefined, 'cleared');

step('a named phone job the busy driver turns down goes back to the office');
const named2 = await O.call('createFleetBooking', { customer: { phone: '07700900396', name: 'Di' }, pickup: FAR, dropoff: DROP, rideType: 'RouteMini', driverId: d1 });
await until(async () => (await getDoc(doc(D1.db, 'followOnOffers', d1))).data()?.rideId === named2.rideId, 'named follow-on 2');
await D1.call('answerFollowOnJob', { rideId: named2.rideId, answer: 'decline' });
r = await until(async () => { const x = await ride(named2.rideId); return x.dispatch.mode === 'office' ? x : null; }, 'held');
assert.equal(r.dispatch.heldReason, 'declined');
await O.call('cancelFleetBooking', { rideId: named2.rideId });

fake.close();
console.log('\nALL PASSED');
process.exit(0);
