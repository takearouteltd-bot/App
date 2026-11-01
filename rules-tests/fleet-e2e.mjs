// End-to-end run of the fleet functions against the emulators
// (auth 9099, firestore 8080, functions 5001), project demo-tar.
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, updateDoc, setDoc, arrayUnion } from 'firebase/firestore';
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout: ' + what); await sleep(500); }
}
// Admin-side writes go through the emulator's REST with "owner" auth.
async function adminSet(path, data, mask = false) {
  const fields = {};
  const enc = (v) => typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
    : v === null ? { nullValue: null } : typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } } : { stringValue: String(v) };
  Object.entries(data).forEach(([k, v]) => (fields[k] = enc(v)));
  const r = await fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/${path}${mask ? '?' + Object.keys(data).map((k) => 'updateMask.fieldPaths=' + k).join('&') : ''}`, {
    method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
  if (!r.ok) throw new Error(await r.text());
}

const A = mk('admin'), O = mk('owner'), D = mk('driver'), D2 = mk('driver2');
const step = (s) => console.log('•', s);

// Admin account
const adm = await createUserWithEmailAndPassword(A.auth, 'admin@test.dev', 'secret123');
await adminSet(`admins/${adm.user.uid}`, { isActive: true, role: 'super_admin' });
await adminSet('config/app', { currency: 'GBP', fares: { baseFare: 3, ratePerMile: 2.2, ratePerMinute: 0.25, minimumFare: 6, vatPercent: 20 } });

step('admin creates a fleet');
const created = await A.call('createFleet', { name: 'Star Cars', ownerName: 'Sajid', email: 'owner@test.dev', phone: '07700900001', perDriverMonthly: 50 });
assert.ok(created.fleetId && /^[A-Z0-9]{6}$/.test(created.joinCode) && created.passwordLink);
// Owner sets a password the emulator way.
await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'GET' });
const users = await (await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:query`, { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: '{}' })).json();
const ownerUser = users.userInfo.find((u) => u.email === 'owner@test.dev');
await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ localId: ownerUser.localId, password: 'owner123' }) });
await signInWithEmailAndPassword(O.auth, 'owner@test.dev', 'owner123');

step('two approved drivers; one joins by code, one by phone invite');
const d1 = await createUserWithEmailAndPassword(D.auth, 'd1@test.dev', 'secret123');
const d2 = await createUserWithEmailAndPassword(D2.auth, 'd2@test.dev', 'secret123');
for (const [u, phone] of [[d1.user.uid, '+447700900111'], [d2.user.uid, '+447700900222']]) {
  await adminSet(`drivers/${u}`, { approved: true, onboardingComplete: true, vehicleType: 'RouteMini', status: 'online', phoneNumber: phone, firstName: 'Drv', location: { latitude: 51.47, longitude: -0.45 }, subscription: { status: 'active', paymentMethod: 'wallet_deduction' } });
}
assert.equal((await D.call('requestFleetJoin', { code: created.joinCode })).fleetName, 'Star Cars');
await O.call('decideFleetDriver', { driverId: d1.user.uid, approve: true });
let d1doc = (await getDoc(doc(D.db, 'drivers', d1.user.uid))).data();
assert.equal(d1doc.fleetId, created.fleetId);
assert.equal(d1doc.subscription.paymentMethod, 'fleet');
assert.equal(d1doc.subscriptionBeforeFleet.paymentMethod, 'wallet_deduction');
const inv = await O.call('inviteFleetDriver', { phone: '07700 900222' });
assert.equal(inv.existingAccount, true);
assert.equal((await getDoc(doc(D2.db, 'drivers', d2.user.uid))).data().fleetInvite.fleetId, created.fleetId);
assert.equal((await D2.call('answerFleetInvite', { accept: true })).joined, true);
assert.equal((await getDoc(doc(D2.db, 'drivers', d2.user.uid))).data().fleetId, created.fleetId);

step('quote (real Google Routes call): Heathrow T5 to Paddington');
const T5 = { latitude: 51.4719, longitude: -0.4877, address: 'Heathrow Terminal 5' };
const PAD = { latitude: 51.5154, longitude: -0.1755, address: 'Paddington Station' };
const quote = await O.call('quoteFleetBooking', { pickup: T5, dropoff: PAD });
console.log('   ', quote.distanceKm, 'km', quote.durationMinutes, 'min', quote.fares);
assert.ok(quote.distanceKm > 15 && quote.fares.RouteExecutive > quote.fares.RouteMini);

step('address search');
const places = await O.call('fleetPlaceSearch', { input: 'Paddington station' });
assert.ok(places.results.length > 0, 'no places');
const placeDetail = await O.call('fleetPlaceDetails', { placeId: places.results[0].placeId });
console.log('   ', places.results[0].main, '→', placeDetail.address);

step('phone booking sent to driver 1 by name');
const b1 = await O.call('createFleetBooking', { customer: { phone: '07700 900999', name: 'Ann Smith' }, pickup: T5, dropoff: PAD, rideType: 'RouteMini', driverId: d1.user.uid, notes: 'Flight BA123' });
assert.equal(b1.status, 'dispatching');
let r1 = (await getDoc(doc(D.db, 'rides', b1.rideId))).data();
assert.equal(r1.source, 'phone'); assert.equal(r1.riderId, null); assert.equal(r1.dispatch.driverId, d1.user.uid);
assert.equal(r1.customer.phone, '+447700900999');
const cust = (await getDoc(doc(O.db, 'fleets', created.fleetId, 'customers', '+447700900999'))).data();
assert.equal(cust.name, 'Ann Smith'); assert.equal(cust.bookings, 1); assert.ok(cust.addresses.length >= 2);

step('driver 2 cannot take it; driver 1 declines; office resends to the fleet; driver 2 takes it');
const claim = (uid) => ({ status: 'accepted', driverId: uid, acceptedAt: new Date(), walletProcessed: false });
await assert.rejects(updateDoc(doc(D2.db, 'rides', b1.rideId), claim(d2.user.uid)));
await updateDoc(doc(D.db, 'rides', b1.rideId), { declinedBy: arrayUnion(d1.user.uid) });
await O.call('redispatchFleetBooking', { rideId: b1.rideId, driverId: null });
r1 = (await getDoc(doc(D.db, 'rides', b1.rideId))).data();
assert.equal(r1.dispatch.driverId, null); assert.deepEqual(r1.declinedBy, []); assert.equal(r1.dispatch.rounds, 2);
await updateDoc(doc(D2.db, 'rides', b1.rideId), claim(d2.user.uid));

step('driver 2 gives it back: office is told, not re-broadcast');
await updateDoc(doc(D2.db, 'rides', b1.rideId), { status: 'dispatching', driverId: null, acceptedAt: null, declinedBy: arrayUnion(d2.user.uid) });
r1 = await until(async () => { const r = (await getDoc(doc(D.db, 'rides', b1.rideId))).data(); return r.dispatch.returnedBy ? r : null; }, 'returnedBy');
assert.equal(r1.dispatch.returnedBy, d2.user.uid);

step('driver 1 takes it from the fleet broadcast, does the trip, completes in cash');
await O.call('redispatchFleetBooking', { rideId: b1.rideId, driverId: d1.user.uid });
await updateDoc(doc(D.db, 'rides', b1.rideId), claim(d1.user.uid));
await updateDoc(doc(D.db, 'rides', b1.rideId), { status: 'arrived', arrivedAt: new Date() });
await updateDoc(doc(D.db, 'rides', b1.rideId), { status: 'ongoing', startedAt: new Date() });
await updateDoc(doc(D.db, 'rides', b1.rideId), { status: 'completed', completedAt: new Date(), cashCollected: true });

step('pre-booking 2 hours ahead, then "send now", then office cancels');
const later = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
const b2 = await O.call('createFleetBooking', { customer: { phone: '+447700900999', name: '' }, pickup: PAD, dropoff: T5, rideType: 'RoutePlus', pickupAt: later, agreedPrice: 65 });
assert.equal(b2.status, 'scheduled'); assert.equal(b2.fare, 65);
let r2 = (await getDoc(doc(O.db, 'rides', b2.rideId))).data();
assert.equal(r2.fare.agreedPrice, true); assert.equal(r2.customer.name, '');
assert.equal((await getDoc(doc(O.db, 'fleets', created.fleetId, 'customers', '+447700900999'))).data().name, 'Ann Smith', 'name kept');
await assert.rejects(updateDoc(doc(D.db, 'rides', b2.rideId), claim(d1.user.uid)), 'cannot take a scheduled job');
await O.call('redispatchFleetBooking', { rideId: b2.rideId });
assert.equal((await getDoc(doc(O.db, 'rides', b2.rideId))).data().status, 'dispatching');
await O.call('cancelFleetBooking', { rideId: b2.rideId });
assert.equal((await getDoc(doc(O.db, 'rides', b2.rideId))).data().cancelledBy, 'operator');

step('pre-booking due in 1 min goes out on its own (scheduler)');
const b3 = await O.call('createFleetBooking', { customer: { phone: '07700900888', name: 'Bob' }, pickup: T5, dropoff: PAD, pickupAt: new Date(Date.now() + 60 * 1000 + 20 * 60 * 1000).toISOString(), leadMinutes: 20 });
assert.equal(b3.status, 'scheduled');

step('an app job taken by a fleet driver is tagged with the fleet; card earnings go to the fleet wallet');
await adminSet('rides/appjob', { riderId: 'r1', driverId: null, status: 'searching', rideType: 'RouteMini', paymentMethod: 'card', fare: { total: 20 }, pickupLocation: T5, dropoffLocation: PAD });
await updateDoc(doc(D.db, 'rides', 'appjob'), claim(d1.user.uid));
await until(async () => (await getDoc(doc(D.db, 'rides', 'appjob'))).data().fleetId === created.fleetId, 'tagFleetRides');
// The wallet credit itself (index.js creditDriverWalletOnRideCompletion)
// cannot run in the emulator: its admin.firestore.FieldValue is missing
// there. Seed the balance it would have written.
await adminSet(`fleetWallets/${created.fleetId}`, { availableBalance: 20, totalEarned: 20 }, true);

step('admin records a payment to the fleet');
await A.call('recordFleetPayout', { fleetId: created.fleetId, amount: 15, reference: 'TX1' });
assert.equal((await getDoc(doc(O.db, 'fleetWallets', created.fleetId))).data().availableBalance, 5);

step('fleet removes driver 2: independent again, membership inactive');
await O.call('removeFleetDriver', { driverId: d2.user.uid });
const d2doc = (await getDoc(doc(D2.db, 'drivers', d2.user.uid))).data();
assert.equal(d2doc.fleetId, null); assert.equal(d2doc.subscription.status, 'inactive');

step('owner adds an operator; operator can book; operator cannot add staff');
const op = await O.call('addFleetOperator', { email: 'op@test.dev', name: 'Op' });
assert.ok(op.uid);
await assert.rejects(D.call('createFleetBooking', { customer: { phone: '07700900777' }, pickup: T5, dropoff: PAD }), 'driver is not staff');

step('paused fleet cannot book');
await adminSet(`fleets/${created.fleetId}`, { status: 'suspended' }, true);
await assert.rejects(O.call('createFleetBooking', { customer: { phone: '07700900777' }, pickup: T5, dropoff: PAD }));

console.log('\nALL FLEET E2E CHECKS PASSED');
process.exit(0);
