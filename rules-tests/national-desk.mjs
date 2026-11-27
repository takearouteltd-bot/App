// The national booking desk (functions/fleet.js isNationalDesk): a fleet a
// TakeARoute admin flags nationalDesk. Every job it books is on the network
// from the start, by name to any driver or to everyone, and says it came from
// the "National booking centre" (fleetName, bookedVia). Its staff see every
// online driver on nationalBoard/{fleetId}, never the driver records. Also:
// the price kept on a phone customer's journey (rememberCustomer,
// keepJourneyPrices). Against the emulators like network.mjs
// (ROUTES_API_BASE fake on :8999).
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, query, where, setDoc, collection, updateDoc, arrayUnion, serverTimestamp } from 'firebase/firestore';
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



const A = mk('admin'), ON = mk('ownerN'), OB = mk('ownerB'), DI = mk('di'), DB = mk('db');
const adm = await createUserWithEmailAndPassword(A.auth, 'admin-nat@test.dev', 'secret123');
await adminSet(`admins/${adm.user.uid}`, { isActive: true, role: 'super_admin' });
await adminSet('config/app', { currency: 'GBP', payments: { cashEnabled: 1 }, dispatch: { searchRadiusKm: 3, requestTimeoutSeconds: 6 }, bidJobs: { enabled: 0 } });

const PICK = { latitude: 52.3000, longitude: -1.9500, address: 'Unicorn Hill, Redditch' };
const NEAR = { latitude: 52.3050, longitude: -1.9500, address: 'Bates Hill, Redditch' }; // ~0.6 km
const MID = { latitude: 52.3110, longitude: -1.9500, address: 'Plymouth Road, Redditch' }; // ~1.2 km
const DROP = { latitude: 52.3200, longitude: -1.9300, address: 'Headless Cross, Redditch' };

step('the national desk and Other Cars (company driver B); driver I has no fleet');
const users = async () => (await (await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:query`, { method: 'POST', headers: H, body: '{}' })).json()).userInfo;
async function makeFleet(name, email, phone, who) {
  const f = await A.call('createFleet', { name, ownerName: 'O', email, phone, perDriverMonthly: 50 });
  const u = (await users()).find((x) => x.email === email);
  await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: H, body: JSON.stringify({ localId: u.localId, password: 'owner123' }) });
  await signInWithEmailAndPassword(who.auth, email, 'owner123');
  return f;
}
const desk = await makeFleet('TakeARoute National', 'desk-nat@test.dev', '07700900601', ON);
const other = await makeFleet('Other Cars', 'other-nat@test.dev', '07700900602', OB);
const ids = {};
for (const [name, who, phone] of [['di', DI, '+447700900611'], ['db', DB, '+447700900612']]) {
  ids[name] = (await createUserWithEmailAndPassword(who.auth, `${name}-nat@test.dev`, 'secret123')).user.uid;
  await adminSet(`drivers/${ids[name]}`, { approved: true, onboardingComplete: true, vehicleType: 'RouteMini', status: 'offline', isOnRide: false, phoneNumber: phone, firstName: name.toUpperCase(), registrationNumber: `AB12 ${name.toUpperCase()}`, location: MID, subscription: { status: 'active', paymentMethod: 'wallet_deduction' } });
}
const { di, db: dbx } = ids;
await DB.call('requestFleetJoin', { code: other.joinCode });
await OB.call('decideFleetDriver', { driverId: dbx, approve: true, driverType: 'company' });
const place = (uid, location, status = 'online') => adminSet(`drivers/${uid}`, { status, isOnRide: false, location }, true);
await place(di, NEAR); await place(dbx, MID);

step('only an admin can make a fleet the national desk');
await assert.rejects(updateDoc(doc(ON.db, 'fleets', desk.fleetId), { nationalDesk: true }), 'the owner cannot');
await assert.rejects(getDoc(doc(ON.db, 'nationalBoard', desk.fleetId)), 'no board for an ordinary fleet');
await updateDoc(doc(A.db, 'fleets', desk.fleetId), { nationalDesk: true });

step('the board: every online driver, of any fleet or none, nothing private');
await schedule('refreshNationalBoards');
const board = await until(async () => { const s = await getDoc(doc(ON.db, 'nationalBoard', desk.fleetId)).catch(() => null); return s?.exists() && s.data().drivers?.length >= 2 ? s.data() : null; }, 'board written', 60000);
const bi = board.drivers.find((d) => d.id === di);
const bb = board.drivers.find((d) => d.id === dbx);
assert.ok(bi && bb, 'both drivers on the board');
assert.equal(bi.name, 'DI'); assert.equal(bi.fleetName, null, 'independent'); assert.equal(bb.fleetName, 'Other Cars');
assert.equal(bi.approved, true); assert.equal(bi.status, 'online'); assert.equal(bi.registrationNumber, 'AB12 DI');
assert.equal(bi.location.latitude, NEAR.latitude);
for (const k of ['phoneNumber', 'phone', 'subscription', 'documentExpiry', 'email']) assert.equal(bi[k], undefined, `no ${k} on the board`);
await assert.rejects(getDoc(doc(OB.db, 'nationalBoard', desk.fleetId)), 'another fleet cannot read it');
await assert.rejects(getDoc(doc(DI.db, 'nationalBoard', desk.fleetId)), 'nor can a driver');
await assert.rejects(getDocs(query(collection(ON.db, 'drivers'), where('status', '==', 'online'))), 'the desk still cannot list driver records');

step('a desk job: on the network straight away, from the National booking centre');
const book = (who, extra = {}) => who.call('createFleetBooking', { customer: { phone: '07700900699', name: 'Nina' }, pickup: PICK, dropoff: DROP, rideType: 'RouteMini', ...extra });
const job = await book(ON);
let r = await ride(job.rideId);
assert.equal(r.dispatch.network, true, 'always on the network'); assert.equal(r.dispatch.mode, 'all');
assert.equal(r.fleetName, 'National booking centre'); assert.equal(r.bookedVia, 'national');
const offer = await until(async () => { const s = await getDoc(doc(DI.db, 'fleetJobOffers', job.rideId)).catch(() => null); return s?.exists() ? s.data() : null; }, 'driver I sees it');
assert.equal(offer.network, true); assert.equal(offer.fleetName, 'National booking centre'); assert.equal(offer.bookedVia, 'national');
assert.equal(offer.customer.phone, undefined, 'no customer number');
await updateDoc(doc(DI.db, 'rides', job.rideId), claim(di));
r = await until(async () => { const x = await ride(job.rideId); return x.networkDriver ? x : null; }, 'tagged');
assert.equal(r.networkDriver.outside, true); assert.equal(r.networkDriver.fleetId, null);
await adminSet(`rides/${job.rideId}`, { status: 'completed' }, true);

step('by name to another fleet\'s driver; nearest first; account jobs refused');
const named = await book(ON, { driverId: dbx });
r = await ride(named.rideId);
assert.equal(r.dispatch.mode, 'driver'); assert.equal(r.dispatch.driverId, dbx); assert.equal(r.dispatch.network, true);
await until(async () => (await getDoc(doc(DB.db, 'fleetJobOffers', named.rideId)).catch(() => null))?.exists(), 'driver B sees it');
await assert.rejects(updateDoc(doc(DI.db, 'rides', named.rideId), claim(di)), 'only the driver chosen can take it');
await updateDoc(doc(DB.db, 'rides', named.rideId), claim(dbx));
await adminSet(`rides/${named.rideId}`, { status: 'completed' }, true);
await place(di, NEAR); await place(dbx, MID);
const nearest = await book(ON, { dispatchMode: 'queue' });
r = await until(async () => { const x = await ride(nearest.rideId); return x.dispatch?.driverId ? x : null; }, 'nearest offer');
assert.equal(r.dispatch.nearest, true); assert.equal(r.dispatch.network, true); assert.equal(r.dispatch.driverId, di, 'nearest of anyone, no zones needed');
await ON.call('cancelFleetBooking', { rideId: nearest.rideId });
await setDoc(doc(ON.db, 'fleets', desk.fleetId, 'accounts', 'acme'), { company: 'Acme Ltd', active: true });
await assert.rejects(book(ON, { collectBy: 'account', accountId: 'acme' }), /Only cash jobs and card/);

step('an ordinary fleet is as before: its own drivers, its own name');
const own = await book(OB, { customer: { phone: '07700900698', name: 'Omar' } });
r = await ride(own.rideId);
assert.equal(r.dispatch.network, false); assert.equal(r.fleetName, 'Other Cars'); assert.equal(r.bookedVia, undefined);
await OB.call('cancelFleetBooking', { rideId: own.rideId });

step('the price is kept on the customer\'s journey: booked, done, and taken back on a cancel');
const card = async () => (await getDoc(doc(ON.db, 'fleets', desk.fleetId, 'customers', '+447700900697'))).data() || {};
const journey = (c) => (c.journeys || []).find((j) => j.from.address === PICK.address && j.to.address === DROP.address);
const first = await book(ON, { customer: { phone: '07700900697', name: 'Pat' }, agreedPrice: 12 });
let p = journey(await card()).prices.RouteMini;
assert.equal(p.total, 12); assert.equal(p.agreed, true); assert.equal(p.done, false); assert.equal(p.rideId, first.rideId);
await adminSet(`rides/${first.rideId}`, { status: 'completed' }, true);
p = await until(async () => { const x = journey(await card()).prices.RouteMini; return x.done ? x : null; }, 'done');
assert.equal(p.total, 12);
const second = await book(ON, { customer: { phone: '07700900697', name: 'Pat' }, agreedPrice: 15 });
p = journey(await card()).prices.RouteMini;
assert.equal(p.total, 15); assert.equal(p.rideId, second.rideId); assert.equal(p.prev.total, 12, 'the last one kept');
await ON.call('cancelFleetBooking', { rideId: second.rideId });
p = await until(async () => { const x = journey(await card()).prices.RouteMini; return x.rideId === first.rideId ? x : null; }, 'taken back');
assert.equal(p.total, 12); assert.equal(p.done, true);
const withStop = await book(ON, { customer: { phone: '07700900697', name: 'Pat' }, stops: [MID], agreedPrice: 30 });
assert.equal(journey(await card()).prices.RouteMini.total, 12, 'a journey with a stop does not change the A to B price');
await ON.call('cancelFleetBooking', { rideId: withStop.rideId });

step('no longer the national desk: its board goes');
await updateDoc(doc(A.db, 'fleets', desk.fleetId), { nationalDesk: false });
await schedule('refreshNationalBoards');
await until(async () => (await adminGet(`nationalBoard/${desk.fleetId}`)) === null, 'board removed', 60000);

fake.close();
console.log('\nALL PASSED');
process.exit(0);
