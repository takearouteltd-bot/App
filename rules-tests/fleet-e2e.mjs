// End-to-end run of the fleet functions against the emulators
// (auth 9099, firestore 8080, functions 5001), project demo-tar.
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, collection, updateDoc, setDoc, arrayUnion } from 'firebase/firestore';
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
async function until(fn, what, ms = 90000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout: ' + what); await sleep(500); }
}
// Admin-side writes go through the emulator's REST with "owner" auth.
async function adminSet(path, data, mask = false) {
  const fields = {};
  const enc = (v) => typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
    : v === null ? { nullValue: null } : v instanceof Date ? { timestampValue: v.toISOString() } : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } } : typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } } : { stringValue: String(v) };
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
await assert.rejects(O.call('decideFleetDriver', { driverId: d1.user.uid, approve: true }), /company car or self-employed/);
await O.call('decideFleetDriver', { driverId: d1.user.uid, approve: true, driverType: 'company' });
let d1doc = (await getDoc(doc(D.db, 'drivers', d1.user.uid))).data();
assert.equal(d1doc.fleetId, created.fleetId);
assert.equal(d1doc.subscription.paymentMethod, 'fleet');
assert.equal(d1doc.subscriptionBeforeFleet.paymentMethod, 'wallet_deduction');
assert.equal(d1doc.fleetDriverType, 'company');
const inv = await O.call('inviteFleetDriver', { phone: '07700 900222', driverType: 'company' });
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

step('driver 2 gives it back: sent on to the fleet by itself, without driver 2; office still sees who returned it');
await updateDoc(doc(D2.db, 'rides', b1.rideId), { status: 'dispatching', driverId: null, acceptedAt: null, declinedBy: arrayUnion(d2.user.uid) });
r1 = await until(async () => { const r = (await getDoc(doc(D.db, 'rides', b1.rideId))).data(); return r.dispatch.returnedBy ? r : null; }, 'returnedBy');
assert.equal(r1.dispatch.returnedBy, d2.user.uid);
assert.equal(r1.dispatch.autoResent, true); assert.equal(r1.dispatch.mode, 'all');
assert.ok(r1.dispatch.offeredAt, 'rung again'); assert.ok(r1.declinedBy.includes(d2.user.uid));

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

step('release time: a booking 3 h ahead released 45 min before pickup');
const pick3h = Date.now() + 3 * 3600 * 1000;
const be = await O.call('createFleetBooking', { customer: { phone: '07700900555', name: 'Eve' }, pickup: T5, dropoff: PAD, pickupAt: new Date(pick3h).toISOString(), leadMinutes: 45 });
let re = (await getDoc(doc(O.db, 'rides', be.rideId))).data();
assert.equal(be.status, 'scheduled'); assert.equal(re.dispatch.leadMinutes, 45);
assert.ok(Math.abs(re.dispatchAt.toMillis() - (pick3h - 45 * 60000)) < 2000, 'dispatchAt = pickup - 45 min');

step('office changes the booking before acceptance: new drop-off, time, release time, price, payment and notes');
const fareBefore = re.fare.total;
const pick4h = Date.now() + 4 * 3600 * 1000;
const ed = await O.call('editFleetBooking', { rideId: be.rideId, customer: { phone: '07700900555', name: 'Eve Adams' }, dropoff: { latitude: 51.5033, longitude: -0.1195, address: 'London Eye' }, pickupAt: new Date(pick4h).toISOString(), leadMinutes: 30, collectBy: 'card', notes: 'Two bags' });
re = (await getDoc(doc(O.db, 'rides', be.rideId))).data();
assert.equal(ed.status, 'scheduled'); assert.equal(re.dropoffLocation.address, 'London Eye');
assert.notEqual(re.fare.total, fareBefore, 'priced again'); assert.equal(re.customer.name, 'Eve Adams');
assert.equal(re.dispatch.leadMinutes, 30);
assert.ok(Math.abs(re.dispatchAt.toMillis() - (pick4h - 30 * 60000)) < 2000);
assert.equal(re.collectBy, 'card'); assert.equal(re.notes, 'CARD PAYMENT: take it on your terminal. Two bags');
assert.ok(re.editedBy && re.editedBy.uid);
await O.call('editFleetBooking', { rideId: be.rideId, agreedPrice: 70, notes: 'Two bags, one child seat' });
re = (await getDoc(doc(O.db, 'rides', be.rideId))).data();
assert.equal(re.fare.total, 70); assert.equal(re.fare.agreedPrice, true);
assert.equal(re.notes, 'CARD PAYMENT: take it on your terminal. Two bags, one child seat', 'prefix not doubled');
await O.call('editFleetBooking', { rideId: be.rideId, collectBy: 'cash' });
re = (await getDoc(doc(O.db, 'rides', be.rideId))).data();
assert.equal(re.fare.total, 70, 'agreed price kept'); assert.equal(re.notes, 'Two bags, one child seat');
await assert.rejects(D.call('editFleetBooking', { rideId: be.rideId, notes: 'x' }), /Fleet staff only/);

step('due now after a change: offered afresh; once a driver accepts it can no longer be changed');
await O.call('editFleetBooking', { rideId: be.rideId, pickupAt: null });
re = (await getDoc(doc(O.db, 'rides', be.rideId))).data();
assert.equal(re.status, 'dispatching'); assert.ok(re.dispatch.offeredAt);
await updateDoc(doc(D.db, 'rides', be.rideId), claim(d1.user.uid));
await assert.rejects(O.call('editFleetBooking', { rideId: be.rideId, notes: 'late change' }), /already accepted/);
await O.call('cancelFleetBooking', { rideId: be.rideId });

step('a job for one named driver who gives it back goes to the nearest other free driver');
const bnd = await O.call('createFleetBooking', { customer: { phone: '07700900444', name: 'Nia' }, pickup: T5, dropoff: PAD, driverId: d1.user.uid });
await updateDoc(doc(D.db, 'rides', bnd.rideId), claim(d1.user.uid));
await updateDoc(doc(D.db, 'rides', bnd.rideId), { status: 'dispatching', driverId: null, acceptedAt: null });
let rnd = await until(async () => { const r = (await getDoc(doc(O.db, 'rides', bnd.rideId))).data(); return r.dispatch.mode === 'queue' && r.dispatch.driverId ? r : null; }, 'next driver');
assert.equal(rnd.dispatch.mode, 'queue'); assert.equal(rnd.dispatch.nearest, true);
assert.equal(rnd.dispatch.driverId, d2.user.uid, 'nearest other driver'); assert.ok(rnd.declinedBy.includes(d1.user.uid));
await O.call('cancelFleetBooking', { rideId: bnd.rideId });

step('company driver cannot withdraw (fleet pays them); driver receipt: own trips only');
await assert.rejects(D.call('requestDriverPayout', { amount: 20 }), /paid to Star Cars/);
await assert.rejects(D2.call('emailDriverReceipt', { rideId: b1.rideId, email: 'me@test.dev' }), /not your trip/);
// Resend is not set up in the emulator: getting this far means the checks passed.
await assert.rejects(D.call('emailDriverReceipt', { rideId: b1.rideId, email: 'me@test.dev' }), /not switched on/);

step('admin creates a fleet on a flat monthly plan; a monthly plan needs its price');
await assert.rejects(A.call('createFleet', { name: 'Flat Cars', ownerName: 'F', email: 'flat@test.dev', billingPlan: 'monthly' }), /monthly price/);
const flat = await A.call('createFleet', { name: 'Flat Cars', ownerName: 'F', email: 'flat@test.dev', billingPlan: 'monthly', monthlyFee: 499 });
const flatDoc = (await getDoc(doc(A.db, 'fleets', flat.fleetId))).data();
assert.equal(flatDoc.billingPlan, 'monthly'); assert.equal(flatDoc.monthlyFee, 499); assert.equal(flatDoc.billing.status, 'ok');
assert.equal((await getDoc(doc(A.db, 'fleets', created.fleetId))).data().billingPlan, 'per_driver');

step('pre-booking due in 1 min goes out on its own (scheduler)');
const b3 = await O.call('createFleetBooking', { customer: { phone: '07700900888', name: 'Bob' }, pickup: T5, dropoff: PAD, pickupAt: new Date(Date.now() + 60 * 1000 + 20 * 60 * 1000).toISOString(), leadMinutes: 20 });
assert.equal(b3.status, 'scheduled');

step('an app job taken by a fleet driver is tagged with the fleet (cash here: Stripe is not set up in the emulator)');
await adminSet('rides/appjob', { riderId: 'r1', driverId: null, status: 'searching', rideType: 'RouteMini', paymentMethod: 'cash', fare: { total: 20 }, pickupLocation: T5, dropoffLocation: PAD });
await updateDoc(doc(D.db, 'rides', 'appjob'), claim(d1.user.uid));
await until(async () => (await getDoc(doc(D.db, 'rides', 'appjob'))).data().fleetId === created.fleetId, 'tagFleetRides');
// The wallet credit itself (index.js creditDriverWalletOnRideCompletion)
// cannot run in the emulator: its admin.firestore.FieldValue is missing
// there. Seed the balance it would have written.
await adminSet(`fleetWallets/${created.fleetId}`, { availableBalance: 20, totalEarned: 20 }, true);

step('admin records a payment to the fleet');
await A.call('recordFleetPayout', { fleetId: created.fleetId, amount: 15, reference: 'TX1' });
assert.equal((await getDoc(doc(O.db, 'fleetWallets', created.fleetId))).data().availableBalance, 5);

step('fleet cannot remove driver 2 mid-job; afterwards driver 2 is suspended (company car), membership back, waiting offers return to the office; admin lifts it');
const bOn = await O.call('createFleetBooking', { customer: { phone: '07700900888', name: 'Bob' }, pickup: T5, dropoff: PAD, driverId: d2.user.uid });
await updateDoc(doc(D2.db, 'rides', bOn.rideId), claim(d2.user.uid));
await assert.rejects(O.call('removeFleetDriver', { driverId: d2.user.uid }), /on one of the fleet's jobs/);
await O.call('cancelFleetBooking', { rideId: bOn.rideId });
const bWait = await O.call('createFleetBooking', { customer: { phone: '07700900888', name: 'Bob' }, pickup: T5, dropoff: PAD, driverId: d2.user.uid });
const removed = await O.call('removeFleetDriver', { driverId: d2.user.uid });
const d2doc = (await getDoc(doc(D2.db, 'drivers', d2.user.uid))).data();
assert.equal(d2doc.fleetId, null);
assert.equal(removed.membershipRestored, true);
assert.equal(removed.suspended, true); assert.equal(d2doc.blocked, true, 'company driver removed -> suspended');
assert.equal(d2doc.blockedKind, 'fleet_removed'); assert.equal(d2doc.blockedByFleet, created.fleetId); assert.equal(d2doc.removedFromFleetName, 'Star Cars'); assert.equal(d2doc.status, 'offline');
assert.match(d2doc.blockedReason, /Removed from Star Cars/);
await A.call('setAccountSuspension', { uid: d2.user.uid, suspend: false });
assert.equal((await getDoc(doc(D2.db, 'drivers', d2.user.uid))).data().blocked, false, 'admin lifts it');
assert.equal((await getDoc(doc(D2.db, 'drivers', d2.user.uid))).data().blockedKind, undefined);
assert.equal(d2doc.subscription.status, 'active'); assert.equal(d2doc.subscription.paymentMethod, 'wallet_deduction');
assert.equal(d2doc.subscriptionBeforeFleet, undefined);
const rWait = (await getDoc(doc(O.db, 'rides', bWait.rideId))).data();
assert.equal(rWait.dispatch.driverId, null); assert.equal(rWait.dispatch.returnedBy, d2.user.uid);
await assert.rejects(updateDoc(doc(D2.db, 'rides', bWait.rideId), claim(d2.user.uid)), 'no longer a fleet driver');
await O.call('cancelFleetBooking', { rideId: bWait.rideId });

step('owner adds an operator; operator can book; operator cannot add staff');
const op = await O.call('addFleetOperator', { email: 'op@test.dev', name: 'Op' });
assert.ok(op.uid);
await assert.rejects(D.call('createFleetBooking', { customer: { phone: '07700900777' }, pickup: T5, dropoff: PAD }), 'driver is not staff');

step('a caller who also has the app: card linked, booking linked, active trip flagged');
const RR = mk('rider');
const ru = await createUserWithEmailAndPassword(RR.auth, 'rider@test.dev', 'secret123');
await adminSet(`riders/${ru.user.uid}`, { fullName: 'Priya Patel', phoneNumber: '+447700900456' });
await adminSet('rides/riderlive', { riderId: ru.user.uid, status: 'searching', pickupLocation: { address: 'Kings Cross, London', latitude: 51.53, longitude: -0.12 } });
await adminSet(`riders/${ru.user.uid}`, { currentRideId: 'riderlive' }, true);
const look = await O.call('fleetLookupCaller', { phone: '07700 900456' });
assert.equal(look.appUser, true); assert.equal(look.name, 'Priya Patel'); assert.equal(look.activeRide.status, 'searching');
let card = (await getDoc(doc(O.db, 'fleets', created.fleetId, 'customers', '+447700900456'))).data();
assert.equal(card.appUser, true); assert.equal(card.riderId, ru.user.uid); assert.equal(card.name, 'Priya Patel');
const bApp = await O.call('createFleetBooking', { customer: { phone: '07700900456', name: '' }, pickup: T5, dropoff: PAD });
const rApp = (await getDoc(doc(O.db, 'rides', bApp.rideId))).data();
assert.equal(rApp.customer.riderId, ru.user.uid); assert.equal(rApp.customer.name, 'Priya Patel'); assert.equal(rApp.riderId, null, 'booking stays the fleet\'s');
assert.equal((await O.call('fleetLookupCaller', { phone: '07700 900321' })).appUser, false);

step('zone queues: owner saves zones; bad radius refused');
const fid = created.fleetId;
const HEATHROW = { latitude: 51.4700, longitude: -0.4543, address: 'Heathrow Airport' };
const D3 = mk('driver3'), D4 = mk('driver4');
const d3 = await createUserWithEmailAndPassword(D3.auth, 'd3@test.dev', 'secret123');
const d4 = await createUserWithEmailAndPassword(D4.auth, 'd4@test.dev', 'secret123');
const fresh = () => new Date();
for (const [u, phone] of [[d3.user.uid, '+447700900333'], [d4.user.uid, '+447700900444']]) {
  await adminSet(`drivers/${u}`, { approved: true, onboardingComplete: true, vehicleType: 'RouteMini', status: 'online', phoneNumber: phone, firstName: 'Q', location: PAD, lastUpdated: fresh(), subscription: { status: 'active', paymentMethod: 'wallet_deduction' } });
}
for (const [X, u] of [[D3, d3], [D4, d4]]) {
  await X.call('requestFleetJoin', { code: created.joinCode });
  await O.call('decideFleetDriver', { driverId: u.user.uid, approve: true, driverType: 'company' });
}
// Driver 1 waits at Heathrow first; driver 3 arrives later.
await adminSet(`drivers/${d1.user.uid}`, { status: 'online', isOnRide: false, location: HEATHROW, lastUpdated: fresh() }, true);
await assert.rejects(O.call('saveFleetZones', { zones: [{ name: 'Huge', center: HEATHROW, radiusKm: 99 }] }), 'radius over 30 km');
await assert.rejects(D.call('saveFleetZones', { zones: [] }), 'driver cannot save zones');
const saved = await O.call('saveFleetZones', { zones: [
  { name: 'Heathrow', center: T5, radiusKm: 4 },
  { name: 'Paddington', center: PAD, radiusKm: 1.5 },
], queueOfferSeconds: 20 });
assert.equal(saved.zones.length, 2); assert.equal(saved.queueOfferSeconds, 20);
const zH = saved.zones.find((z) => z.name === 'Heathrow').id;
const zP = saved.zones.find((z) => z.name === 'Paddington').id;
let q = (await getDoc(doc(O.db, 'fleetQueues', fid))).data().zones;
assert.deepEqual(q[zH].map((e) => e.driverId), [d1.user.uid]);
assert.deepEqual(q[zP].map((e) => e.driverId).sort(), [d3.user.uid, d4.user.uid].sort());
assert.ok((await getDoc(doc(D.db, 'fleetQueues', fid))).exists(), 'a fleet driver sees the queue');
await sleep(1100);
await adminSet(`drivers/${d3.user.uid}`, { location: HEATHROW, lastUpdated: fresh() }, true);

step('job by queue from Heathrow rings driver 1 (first in line), then driver 3 after driver 1 says no');
const bq = await O.call('createFleetBooking', { customer: { phone: '07700900999', name: 'Ann Smith' }, pickup: T5, dropoff: PAD, dispatchMode: 'queue' });
let rq = await until(async () => { const r = (await getDoc(doc(O.db, 'rides', bq.rideId))).data(); return r.dispatch.driverId ? r : null; }, 'first queue offer');
assert.equal(rq.dispatch.mode, 'queue'); assert.equal(rq.dispatch.zoneName, 'Heathrow');
assert.equal(rq.dispatch.driverId, d1.user.uid);
await assert.rejects(updateDoc(doc(D3.db, 'rides', bq.rideId), claim(d3.user.uid)), 'not driver 3\'s turn');
await updateDoc(doc(D.db, 'rides', bq.rideId), { declinedBy: arrayUnion(d1.user.uid) });
rq = await until(async () => { const r = (await getDoc(doc(O.db, 'rides', bq.rideId))).data(); return r.dispatch.driverId === d3.user.uid ? r : null; }, 'second queue offer');
q = (await getDoc(doc(O.db, 'fleetQueues', fid))).data().zones;
assert.deepEqual(q[zH].map((e) => e.driverId), [d3.user.uid, d1.user.uid], 'driver 1 went to the back');

step('driver 3 does not answer: after 20 s the scheduler moves on; zone empty, so it goes to the whole fleet');
await sleep(21000);
const pub = await fetch(`http://127.0.0.1:8085/v1/projects/${PROJECT}/topics/firebase-schedule-runFleetQueues:publish`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ data: Buffer.from('{}').toString('base64') }] }) });
assert.ok(pub.ok, 'pubsub publish: ' + pub.status);
rq = await until(async () => { const r = (await getDoc(doc(O.db, 'rides', bq.rideId))).data(); return r.dispatch.queueDone ? r : null; }, 'queue exhausted');
assert.equal(rq.dispatch.driverId, null); assert.ok(rq.dispatch.missed.includes(d3.user.uid));
await assert.rejects(updateDoc(doc(D.db, 'rides', bq.rideId), claim(d1.user.uid)), 'driver 1 said no');
await updateDoc(doc(D4.db, 'rides', bq.rideId), claim(d4.user.uid));
assert.equal((await getDoc(doc(O.db, 'rides', bq.rideId))).data().driverId, d4.user.uid);

step('job by queue from outside every zone goes straight to the fleet');
const FAR = { latitude: 51.75, longitude: -1.25, address: 'Oxford' };
const bf = await O.call('createFleetBooking', { customer: { phone: '07700900999', name: 'Ann Smith' }, pickup: FAR, dropoff: PAD, dispatchMode: 'queue' });
const rf = await until(async () => { const r = (await getDoc(doc(O.db, 'rides', bf.rideId))).data(); return r.dispatch.queueDone ? r : null; }, 'no-zone fallback');
assert.equal(rf.dispatch.driverId, null); assert.equal(rf.dispatch.zoneId, null);
await O.call('cancelFleetBooking', { rideId: bf.rideId });

step('nested zones: nobody free in the small zone, so the larger zone around it is next, then the whole fleet');
const nested = await O.call('saveFleetZones', { zones: [
  { name: 'Inner', center: PAD, radiusKm: 1.5 },
  { name: 'Outer', center: PAD, radiusKm: 10 },
] });
const zOuter = nested.zones.find((z) => z.name === 'Outer').id;
for (const u of [d1.user.uid, d4.user.uid]) await adminSet(`drivers/${u}`, { status: 'offline' }, true);
await adminSet(`drivers/${d3.user.uid}`, { status: 'online', isOnRide: false, location: { latitude: PAD.latitude + 0.04, longitude: PAD.longitude, address: 'Outer only' }, lastUpdated: fresh() }, true);
const bn = await O.call('createFleetBooking', { customer: { phone: '07700900999', name: 'Ann Smith' }, pickup: PAD, dropoff: T5, dispatchMode: 'queue' });
let rn = await until(async () => { const r = (await getDoc(doc(O.db, 'rides', bn.rideId))).data(); return r.dispatch.driverId ? r : null; }, 'offer from the larger zone');
assert.equal(rn.dispatch.driverId, d3.user.uid); assert.equal(rn.dispatch.zoneName, 'Outer'); assert.equal(rn.dispatch.zoneId, zOuter);
await updateDoc(doc(D3.db, 'rides', bn.rideId), { declinedBy: arrayUnion(d3.user.uid) });
rn = await until(async () => { const r = (await getDoc(doc(O.db, 'rides', bn.rideId))).data(); return r.dispatch.queueDone ? r : null; }, 'nested zones exhausted');
assert.equal(rn.dispatch.driverId, null); assert.equal(rn.dispatch.zoneName, 'Inner, Outer');
await O.call('cancelFleetBooking', { rideId: bn.rideId });

step('a driver in the small zone still goes first');
await adminSet(`drivers/${d4.user.uid}`, { status: 'online', isOnRide: false, location: PAD, lastUpdated: fresh() }, true);
const bi = await O.call('createFleetBooking', { customer: { phone: '07700900999', name: 'Ann Smith' }, pickup: PAD, dropoff: T5, dispatchMode: 'queue' });
const ri = await until(async () => { const r = (await getDoc(doc(O.db, 'rides', bi.rideId))).data(); return r.dispatch.driverId ? r : null; }, 'offer from the small zone');
assert.equal(ri.dispatch.driverId, d4.user.uid); assert.equal(ri.dispatch.zoneName, 'Inner');
await O.call('cancelFleetBooking', { rideId: bi.rideId });

step('card on a phone booking is a label: never a card charge');
const bc = await O.call('createFleetBooking', { customer: { phone: '07700900999', name: 'Ann Smith' }, pickup: PAD, dropoff: T5, collectBy: 'card', notes: 'Ring on arrival' });
const rc = (await getDoc(doc(O.db, 'rides', bc.rideId))).data();
assert.equal(rc.collectBy, 'card'); assert.equal(rc.paymentMethod, 'cash'); assert.equal(rc.payment.method, 'cash');
assert.equal(rc.notes, 'CARD PAYMENT: take it on your terminal. Ring on arrival');
await O.call('cancelFleetBooking', { rideId: bc.rideId });
const bd = await O.call('createFleetBooking', { customer: { phone: '07700900999', name: 'Ann Smith' }, pickup: PAD, dropoff: T5, collectBy: 'bitcoin', notes: 'Ring on arrival' });
const rd = (await getDoc(doc(O.db, 'rides', bd.rideId))).data();
assert.equal(rd.collectBy, 'cash'); assert.equal(rd.notes, 'Ring on arrival');
await O.call('cancelFleetBooking', { rideId: bd.rideId });

step('nearest driver first: closest free driver rings, then the next closest, with no zone involved');
await adminSet(`drivers/${d4.user.uid}`, { status: 'online', isOnRide: false, location: PAD, lastUpdated: fresh() }, true);
await adminSet(`drivers/${d3.user.uid}`, { status: 'online', isOnRide: false, location: HEATHROW, lastUpdated: fresh() }, true);
const bNear = await O.call('createFleetBooking', { customer: { phone: '07700900999', name: 'Ann Smith' }, pickup: PAD, dropoff: T5, dispatchMode: 'nearest' });
let rNear = await until(async () => { const r = (await getDoc(doc(O.db, 'rides', bNear.rideId))).data(); return r.dispatch.driverId ? r : null; }, 'nearest offer');
assert.equal(rNear.dispatch.nearest, true); assert.equal(rNear.dispatch.mode, 'queue'); assert.equal(rNear.dispatch.zoneName, null);
assert.equal(rNear.dispatch.driverId, d4.user.uid, 'the driver at the pickup is closest');
await updateDoc(doc(D4.db, 'rides', bNear.rideId), { declinedBy: arrayUnion(d4.user.uid) });
rNear = await until(async () => { const r = (await getDoc(doc(O.db, 'rides', bNear.rideId))).data(); return r.dispatch.driverId && r.dispatch.driverId !== d4.user.uid ? r : null; }, 'next nearest offer');
assert.notEqual(rNear.dispatch.driverId, d4.user.uid);
await O.call('cancelFleetBooking', { rideId: bNear.rideId });

step('office messages a driver: its own only, and not an empty message');
assert.equal(typeof (await O.call('messageFleetDriver', { driverId: d4.user.uid, text: 'Please call the office' })).notified, 'number');
await assert.rejects(O.call('messageFleetDriver', { driverId: d4.user.uid, text: '  ' }));
await assert.rejects(O.call('messageFleetDriver', { driverId: 'someone-else', text: 'Hello' }));
await assert.rejects(D.call('messageFleetDriver', { driverId: d4.user.uid, text: 'Hello' }));

step('office calls: only its own customers and drivers; Twilio is off in the emulator');
await assert.rejects(O.call('fleetCall', { to: 'customer', phone: '07700900123', myPhone: '07700900001' }), /not one of your customers/);
await assert.rejects(O.call('fleetCall', { to: 'driver', driverId: d2.user.uid, myPhone: '07700900001' }), /Not one of your drivers/);
await assert.rejects(O.call('fleetCall', { to: 'customer', phone: '07700900999', myPhone: 'abc' }), /does not look right/);
await assert.rejects(O.call('fleetCall', { to: 'customer', phone: '07700900999', myPhone: '07700900001' }), /not switched on/);
await assert.rejects(O.call('fleetCall', { to: 'driver', driverId: d3.user.uid }), /not switched on/, 'saved phone reused');
await assert.rejects(D.call('fleetCall', { to: 'customer', phone: '07700900999', myPhone: '07700900111' }), /Fleet staff only/);

step('a driver who had no membership before joining has none after leaving (the app asks them to activate one)');
await adminSet(`drivers/${d3.user.uid}`, { subscriptionBeforeFleet: null }, true);
assert.equal((await O.call('removeFleetDriver', { driverId: d3.user.uid })).membershipRestored, false);
assert.equal((await getDoc(doc(D3.db, 'drivers', d3.user.uid))).data().subscription, undefined);
assert.equal((await getDoc(doc(D3.db, 'drivers', d3.user.uid))).data().blocked, true);
await A.call('setAccountSuspension', { uid: d3.user.uid, suspend: false });

step('suspension: fleet cannot suspend mid-job; suspends with a reason; driver offline, no jobs, offers back to office; fleet lifts its own only; admin suspends and lifts; removal ends the fleet\'s own');
await assert.rejects(O.call('suspendFleetDriver', { driverId: d4.user.uid, reason: 'x' }), /on one of your jobs/);
await O.call('cancelFleetBooking', { rideId: bq.rideId });
await adminSet(`drivers/${d4.user.uid}`, { status: 'online', isOnRide: false }, true);
const bS = await O.call('createFleetBooking', { customer: { phone: '07700900999', name: 'Ann Smith' }, pickup: T5, dropoff: PAD, driverId: d4.user.uid });
await O.call('suspendFleetDriver', { driverId: d4.user.uid, reason: 'Repeated no-shows' });
let d4doc = (await getDoc(doc(D4.db, 'drivers', d4.user.uid))).data();
assert.equal(d4doc.blocked, true); assert.equal(d4doc.blockedByFleet, fid); assert.equal(d4doc.status, 'offline'); assert.equal(d4doc.blockedReason, 'Repeated no-shows');
assert.equal((await getDoc(doc(O.db, 'rides', bS.rideId))).data().dispatch.returnedBy, d4.user.uid);
await assert.rejects(updateDoc(doc(D4.db, 'drivers', d4.user.uid), { status: 'online' }), 'suspended driver going online');
await O.call('redispatchFleetBooking', { rideId: bS.rideId, driverId: null });
await assert.rejects(updateDoc(doc(D4.db, 'rides', bS.rideId), claim(d4.user.uid)), 'suspended driver taking a job');
await assert.rejects(updateDoc(doc(D4.db, 'drivers', d4.user.uid), { blockedByFleet: null }), 'driver editing the suspension');
await O.call('suspendFleetDriver', { driverId: d4.user.uid, suspend: false });
assert.equal((await getDoc(doc(D4.db, 'drivers', d4.user.uid))).data().blocked, false);
await A.call('setAccountSuspension', { uid: d4.user.uid, reason: 'Admin check' });
d4doc = (await getDoc(doc(D4.db, 'drivers', d4.user.uid))).data();
assert.equal(d4doc.blocked, true); assert.equal(d4doc.blockedByFleet, null);
await assert.rejects(O.call('suspendFleetDriver', { driverId: d4.user.uid, suspend: false }), /TakeARoute suspended/);
await A.call('setAccountSuspension', { uid: d4.user.uid, suspend: false });
assert.equal((await getDoc(doc(D4.db, 'drivers', d4.user.uid))).data().blocked, false);
await assert.rejects(D.call('setAccountSuspension', { uid: d4.user.uid }), 'driver using admin suspension');
await O.call('cancelFleetBooking', { rideId: bS.rideId });
await O.call('suspendFleetDriver', { driverId: d4.user.uid, reason: 'Leaving' });
await O.call('removeFleetDriver', { driverId: d4.user.uid });
d4doc = (await getDoc(doc(D4.db, 'drivers', d4.user.uid))).data();
assert.equal(d4doc.fleetId, null); assert.equal(d4doc.blocked, true, 'company driver: the fleet suspension becomes a TakeARoute one');
assert.equal(d4doc.blockedByFleet, created.fleetId); assert.equal(d4doc.blockedKind, 'fleet_removed');
await A.call('setAccountSuspension', { uid: d4.user.uid, suspend: false });

step('self-employed driver: joins keeping own membership; fleet cannot remove; app trips stay theirs; not billed to the fleet; admin switches type; driver leaves (not suspended); admin removes a company driver (suspended)');
await adminSet(`drivers/${d3.user.uid}`, { subscription: { status: 'active', paymentMethod: 'wallet_deduction', nextBillingDate: '2026-12-01' }, status: 'online', isOnRide: false }, true);
await assert.rejects(O.call('inviteFleetDriver', { phone: '07700 900333' }), /company car or self-employed/);
await O.call('inviteFleetDriver', { phone: '07700 900333', driverType: 'self' });
assert.equal((await D3.call('answerFleetInvite', { accept: true })).driverType, 'self');
let d3doc = (await getDoc(doc(D3.db, 'drivers', d3.user.uid))).data();
assert.equal(d3doc.fleetId, fid); assert.equal(d3doc.fleetDriverType, 'self');
assert.equal(d3doc.subscription.paymentMethod, 'wallet_deduction'); assert.equal(d3doc.subscriptionBeforeFleet, undefined);
await assert.rejects(updateDoc(doc(D3.db, 'drivers', d3.user.uid), { fleetDriverType: 'company' }), 'driver changing their own type');
await assert.rejects(O.call('removeFleetDriver', { driverId: d3.user.uid }), /only be removed by TakeARoute/);
await adminSet('rides/appjob2', { riderId: 'r1', driverId: null, status: 'searching', rideType: 'RouteMini', paymentMethod: 'cash', fare: { total: 20 }, pickupLocation: T5, dropoffLocation: PAD });
await updateDoc(doc(D3.db, 'rides', 'appjob2'), claim(d3.user.uid));
await adminSet(`drivers/${d1.user.uid}`, { status: 'online', isOnRide: false }, true);
await adminSet('rides/appjob3', { riderId: 'r1', driverId: null, status: 'searching', rideType: 'RouteMini', paymentMethod: 'cash', fare: { total: 20 }, pickupLocation: T5, dropoffLocation: PAD });
await updateDoc(doc(D.db, 'rides', 'appjob3'), claim(d1.user.uid));
// Once the company driver's trip is tagged, the self-employed one (claimed
// first) has had its turn too.
await until(async () => (await getDoc(doc(D.db, 'rides', 'appjob3'))).data().fleetId === fid, 'company trip tagged');
await sleep(5000);
assert.equal((await getDoc(doc(D3.db, 'rides', 'appjob2'))).data().fleetId, undefined, 'self-employed trip not the fleet\'s');
await adminSet('rides/appjob2', { status: 'completed' }, true);
await adminSet('rides/appjob3', { status: 'completed' }, true);
await adminSet('rides/appjob', { status: 'completed' }, true);
await adminSet(`fleets/${fid}`, { nextBillingDate: new Date(Date.now() - 60000) }, true);
const before = (await getDoc(doc(O.db, 'fleetWallets', fid))).data().availableBalance;
const bill = await fetch(`http://127.0.0.1:8085/v1/projects/${PROJECT}/topics/firebase-schedule-billFleets:publish`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ data: Buffer.from('{}').toString('base64') }] }) });
assert.ok(bill.ok, 'pubsub publish: ' + bill.status);
const billed = await until(async () => { const w = (await getDoc(doc(O.db, 'fleetWallets', fid))).data(); return w.availableBalance !== before ? w : null; }, 'billFleets');
assert.equal(billed.availableBalance, before - 50, 'one company driver billed, not the self-employed one');
const memberships = (await getDocs(collection(O.db, 'fleetWallets', fid, 'transactions'))).docs.map((d) => d.data()).filter((t) => t.type === 'membership');
assert.deepEqual(memberships[0].driverIds, [d1.user.uid]);
await assert.rejects(O.call('setFleetDriverType', { driverId: d3.user.uid, driverType: 'company' }), 'fleet changing type later');
await A.call('setFleetDriverType', { driverId: d3.user.uid, driverType: 'company' });
d3doc = (await getDoc(doc(D3.db, 'drivers', d3.user.uid))).data();
assert.equal(d3doc.fleetDriverType, 'company'); assert.equal(d3doc.subscription.paymentMethod, 'fleet'); assert.equal(d3doc.subscriptionBeforeFleet.paymentMethod, 'wallet_deduction');
await A.call('setFleetDriverType', { driverId: d3.user.uid, driverType: 'self' });
d3doc = (await getDoc(doc(D3.db, 'drivers', d3.user.uid))).data();
assert.equal(d3doc.fleetDriverType, 'self'); assert.equal(d3doc.subscription.paymentMethod, 'wallet_deduction'); assert.equal(d3doc.subscription.nextBillingDate, '2026-12-01');
await assert.rejects(D.call('leaveFleet', {}), /Ask your fleet/);
await D3.call('leaveFleet', {});
d3doc = (await getDoc(doc(D3.db, 'drivers', d3.user.uid))).data();
assert.equal(d3doc.fleetId, null); assert.equal(d3doc.fleetDriverType, undefined); assert.equal(d3doc.subscription.paymentMethod, 'wallet_deduction');
await assert.rejects(D.call('adminRemoveFleetDriver', { driverId: d1.user.uid }), 'driver using admin removal');
assert.equal((await A.call('adminRemoveFleetDriver', { driverId: d1.user.uid })).membershipRestored, true);
assert.equal((await getDoc(doc(D.db, 'drivers', d1.user.uid))).data().fleetId, null);
assert.equal((await getDoc(doc(D.db, 'drivers', d1.user.uid))).data().blockedKind, 'fleet_removed', 'admin removal of a company driver suspends too');
assert.equal(d3doc.blocked, false, 'self-employed driver who leaves is not suspended');

step('removed company driver: tied to the fleet; cannot join another; only that fleet reinstates (admin as backup)');
const D5 = mk('driver5'), D6 = mk('driver6'), D7 = mk('driver7');
const other = await A.call('createFleet', { name: 'Other Cars', ownerName: 'X', email: 'other@test.dev', phone: '07700900002' });
const d5 = await createUserWithEmailAndPassword(D5.auth, 'd5@test.dev', 'secret123');
await adminSet(`drivers/${d5.user.uid}`, { approved: true, onboardingComplete: true, onboardingStatus: 'approved', vehicleType: 'RouteMini', status: 'offline', phoneNumber: '+447700900555', firstName: 'Five' });
await D5.call('requestFleetJoin', { code: created.joinCode });
await O.call('decideFleetDriver', { driverId: d5.user.uid, approve: true, driverType: 'company' });
await O.call('removeFleetDriver', { driverId: d5.user.uid });
await assert.rejects(D5.call('requestFleetJoin', { code: other.joinCode }), /only they can reinstate/);
await assert.rejects(O.call('suspendFleetDriver', { driverId: d5.user.uid, suspend: false }), 'suspension lift is not the way back');
assert.equal((await getDoc(doc(D5.db, 'drivers', d5.user.uid))).data().blocked, true);
await assert.rejects(D5.call('reinstateFleetDriver', { driverId: d5.user.uid }), 'driver cannot reinstate themselves');
await O.call('reinstateFleetDriver', { driverId: d5.user.uid });
let d5doc = (await getDoc(doc(D5.db, 'drivers', d5.user.uid))).data();
assert.equal(d5doc.blocked, false); assert.equal(d5doc.fleetId, created.fleetId); assert.equal(d5doc.fleetDriverType, 'company');
assert.equal(d5doc.removedFromFleetId, undefined); assert.equal(d5doc.blockedKind, undefined);
await assert.rejects(O.call('reinstateFleetDriver', { driverId: d5.user.uid }), /not waiting to be reinstated/);

step('fleet approves drivers who apply to it: by request (approves + joins) and by invite (approve after); refused if not signed up, TakeARoute rejected or a document expired');
const d6 = await createUserWithEmailAndPassword(D6.auth, 'd6@test.dev', 'secret123');
await adminSet(`drivers/${d6.user.uid}`, { approved: false, onboardingComplete: false, onboardingStatus: 'pending', vehicleType: 'RouteMini', status: 'offline', phoneNumber: '+447700900666', firstName: 'Six', documentExpiry: { insurance: '2020-01-01' } });
await D6.call('requestFleetJoin', { code: created.joinCode });
await assert.rejects(O.call('decideFleetDriver', { driverId: d6.user.uid, approve: true, driverType: 'self' }), /not finished signing up/);
await adminSet(`drivers/${d6.user.uid}`, { onboardingComplete: true }, true);
await assert.rejects(O.call('decideFleetDriver', { driverId: d6.user.uid, approve: true, driverType: 'self' }), /has expired/);
await adminSet(`drivers/${d6.user.uid}`, { documentExpiry: { insurance: '2030-01-01' } }, true);
const dec = await O.call('decideFleetDriver', { driverId: d6.user.uid, approve: true, driverType: 'self' });
assert.equal(dec.approved, true);
let d6doc = (await getDoc(doc(D6.db, 'drivers', d6.user.uid))).data();
assert.equal(d6doc.approved, true); assert.equal(d6doc.onboardingStatus, 'approved'); assert.equal(d6doc.fleetId, created.fleetId);
assert.equal(d6doc.approvedByFleet.fleetId, created.fleetId); assert.equal(d6doc.approvedByFleet.fleetName, 'Star Cars'); assert.ok(d6doc.approvedByFleet.at);
const d7 = await createUserWithEmailAndPassword(D7.auth, 'd7@test.dev', 'secret123');
await adminSet(`drivers/${d7.user.uid}`, { approved: false, onboardingComplete: true, onboardingStatus: 'rejected', vehicleType: 'RouteMini', status: 'offline', phoneNumber: '+447700900777', firstName: 'Seven' });
await O.call('inviteFleetDriver', { phone: '07700 900777', driverType: 'company' });
assert.equal((await D7.call('answerFleetInvite', { accept: true })).joined, true);
await assert.rejects(O.call('approveFleetDriver', { driverId: d7.user.uid }), /turned this application down/);
await adminSet(`drivers/${d7.user.uid}`, { onboardingStatus: 'pending' }, true);
await assert.rejects(O.call('approveFleetDriver', { driverId: d6.user.uid }), /Already approved/);
await assert.rejects(D7.call('approveFleetDriver', { driverId: d7.user.uid }), 'driver cannot approve themselves');
await O.call('approveFleetDriver', { driverId: d7.user.uid });
assert.equal((await getDoc(doc(D7.db, 'drivers', d7.user.uid))).data().approved, true);

step('paused fleet cannot book');
await adminSet(`fleets/${created.fleetId}`, { status: 'suspended' }, true);
await assert.rejects(O.call('createFleetBooking', { customer: { phone: '07700900777' }, pickup: T5, dropoff: PAD }));

console.log('\nALL FLEET E2E CHECKS PASSED');
process.exit(0);
