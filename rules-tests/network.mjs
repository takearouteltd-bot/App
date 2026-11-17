// The TakeARoute network (functions/fleet.js onNetwork): a fleet's operator
// sends a cash or card-machine phone job out to every TakeARoute driver,
// nearest first, then as a BID JOB. A driver outside the booking fleet keeps
// the fare; another fleet's company driver settles with their own fleet.
// Against the emulators like bid-jobs.mjs (ROUTES_API_BASE fake on :8999).
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


const A = mk('admin'), OA = mk('ownerA'), OB = mk('ownerB'), DA = mk('da'), DI = mk('di'), DB = mk('db'), DS = mk('ds');
const adm = await createUserWithEmailAndPassword(A.auth, 'admin-net@test.dev', 'secret123');
await adminSet(`admins/${adm.user.uid}`, { isActive: true, role: 'super_admin' });
await adminSet('config/app', { currency: 'GBP', payments: { cashEnabled: 1 }, dispatch: { searchRadiusKm: 3, requestTimeoutSeconds: 6 }, bidJobs: { enabled: 1, radiusKm: 16, afterSeconds: 20, allowCounter: 0, maxCounterPercent: 0, ringEverySeconds: 10 } });

const PICK = { latitude: 52.3000, longitude: -1.9500, address: 'Unicorn Hill, Redditch' };
const NEAR = { latitude: 52.3050, longitude: -1.9500, address: 'Bates Hill, Redditch' }; // ~0.6 km
const MID = { latitude: 52.3110, longitude: -1.9500, address: 'Plymouth Road, Redditch' }; // ~1.2 km
const EDGE = { latitude: 52.3200, longitude: -1.9500, address: 'Mount Pleasant, Redditch' }; // ~2.2 km
const GONE = { latitude: 52.5700, longitude: -1.9500, address: 'Birmingham' }; // ~30 km
const DROP = { latitude: 52.3200, longitude: -1.9300, address: 'Headless Cross, Redditch' };

step('two fleets: Home Cars (driver A) and Other Cars (company driver B, self-employed driver S); driver I has no fleet');
const users = async () => (await (await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:query`, { method: 'POST', headers: H, body: '{}' })).json()).userInfo;
async function makeFleet(name, email, phone, who) {
  const f = await A.call('createFleet', { name, ownerName: 'O', email, phone, perDriverMonthly: 50 });
  const u = (await users()).find((x) => x.email === email);
  await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: H, body: JSON.stringify({ localId: u.localId, password: 'owner123' }) });
  await signInWithEmailAndPassword(who.auth, email, 'owner123');
  return f;
}
const home = await makeFleet('Home Cars', 'home-net@test.dev', '07700900501', OA);
const other = await makeFleet('Other Cars', 'other-net@test.dev', '07700900502', OB);
const ids = {};
for (const [name, who, phone] of [['da', DA, '+447700900511'], ['di', DI, '+447700900512'], ['db', DB, '+447700900513'], ['ds', DS, '+447700900514']]) {
  ids[name] = (await createUserWithEmailAndPassword(who.auth, `${name}-net@test.dev`, 'secret123')).user.uid;
  await adminSet(`drivers/${ids[name]}`, { approved: true, onboardingComplete: true, vehicleType: 'RouteMini', status: 'offline', isOnRide: false, phoneNumber: phone, firstName: name.toUpperCase(), location: GONE, subscription: { status: 'active', paymentMethod: 'wallet_deduction' } });
}
const { da, di, db: dbx, ds } = ids;
await DA.call('requestFleetJoin', { code: home.joinCode });
await OA.call('decideFleetDriver', { driverId: da, approve: true, driverType: 'company' });
await DB.call('requestFleetJoin', { code: other.joinCode });
await OB.call('decideFleetDriver', { driverId: dbx, approve: true, driverType: 'company' });
await DS.call('requestFleetJoin', { code: other.joinCode });
await OB.call('decideFleetDriver', { driverId: ds, approve: true, driverType: 'self' });
await OB.call('setFleetDriverCommission', { driverId: dbx, percent: 10 });
const place = (uid, location, status = 'online') => adminSet(`drivers/${uid}`, { status, isOnRide: false, location }, true);
const book = (extra = {}) => OA.call('createFleetBooking', { customer: { phone: '07700900599', name: 'Nina' }, pickup: PICK, dropoff: DROP, rideType: 'RouteMini', ...extra });

step('not switched on for the fleet: the network is refused');
await assert.rejects(book({ dispatchMode: 'network' }), /not switched on/);
await assert.rejects(updateDoc(doc(OA.db, 'fleets', home.fleetId), { networkAllowed: true }), 'the fleet cannot switch it on itself');
await updateDoc(doc(A.db, 'fleets', home.fleetId), { networkAllowed: true });

step('account jobs stay with the fleet; a normal job is not seen outside it');
await setDoc(doc(OA.db, 'fleets', home.fleetId, 'accounts', 'acme'), { company: 'Acme Ltd', active: true });
await assert.rejects(book({ dispatchMode: 'network', collectBy: 'account', accountId: 'acme' }), /Only cash jobs and card/);
const own = await book();
await until(async () => (await adminGet(`fleetJobOffers/${own.rideId}`)) !== null, 'mirrored');
await assert.rejects(getDoc(doc(DI.db, 'fleetJobOffers', own.rideId)), 'not on the network: outside drivers cannot see it');
await assert.rejects(updateDoc(doc(DI.db, 'rides', own.rideId), claim(di)), 'nor take it');
await OA.call('cancelFleetBooking', { rideId: own.rideId });

step('sent to the network: everyone, nearest first (driver I, no fleet), card on the driver\'s machine allowed');
await place(di, NEAR); await place(dbx, MID); await place(ds, EDGE);
const job = await book({ dispatchMode: 'network', collectBy: 'card' });
let r = await until(async () => { const x = await ride(job.rideId); return x.dispatch?.driverId ? x : null; }, 'first network offer');
assert.equal(r.dispatch.network, true); assert.equal(r.dispatch.driverId, di, 'nearest driver of any fleet');
assert.equal(r.dispatch.offerSeconds, 6, 'the app offer time');
const offer = await until(async () => { const s = await getDoc(doc(DI.db, 'fleetJobOffers', job.rideId)).catch(() => null); return s?.exists() ? s.data() : null; }, 'driver I sees it');
assert.equal(offer.network, true); assert.equal(offer.customer.phone, undefined, 'no customer number');
const listed = await getDocs(query(collection(DB.db, 'fleetJobOffers'), where('network', '==', true)));
assert.ok(listed.docs.some((d) => d.id === job.rideId), 'any approved driver can list network jobs');
await assert.rejects(updateDoc(doc(DB.db, 'rides', job.rideId), claim(dbx)), 'only the driver being asked can take it');

step('I says no, B (another fleet\'s company driver) lets it run out, S says no: then a BID JOB to all of them');
await updateDoc(doc(DI.db, 'rides', job.rideId), { declinedBy: arrayUnion(di) });
await until(async () => (await ride(job.rideId)).dispatch.driverId === dbx, 'next: driver B', 60000);
await until(async () => (await ride(job.rideId)).dispatch.driverId === ds, 'no answer: driver S', 60000);
await updateDoc(doc(DS.db, 'rides', job.rideId), { declinedBy: arrayUnion(ds) });
r = await until(async () => { const x = await ride(job.rideId); return x.bidJob ? x : null; }, 'network BID JOB', 60000);
assert.deepEqual(r.declinedBy, [], 'everyone asked again'); assert.equal(r.dispatch.network, true);

step('B takes it: tagged as another fleet\'s company driver');
await updateDoc(doc(DB.db, 'rides', job.rideId), claim(dbx));
r = await until(async () => { const x = await ride(job.rideId); return x.networkDriver ? x : null; }, 'tagged');
assert.equal(r.networkDriver.outside, true); assert.equal(r.networkDriver.fleetId, other.fleetId);
await assert.rejects(getDoc(doc(OB.db, 'rides', job.rideId)), 'Other Cars cannot read Home Cars\' booking (the customer\'s number)');

step('done: it goes in Other Cars\' books (10% commission owed by B), not Home Cars\'');
await adminSet(`rides/${job.rideId}`, { status: 'completed' }, true);
const acct = await until(() => adminGet(`fleets/${other.fleetId}/driverAccounts/${dbx}`).then((a) => (a?.owedPence ? a : null)), 'Other Cars balance');
assert.equal(acct.owedPence, -54, 'B owes Other Cars 10% of the £5.40 fare (they hold the money)');
const listedB = await until(() => adminGet(`fleets/${other.fleetId}/networkJobs/${job.rideId}`), 'listed for Other Cars');
assert.equal(listedB.bookedBy.fleetName, 'Home Cars'); assert.equal(listedB.settlement.commissionPence, 54); assert.equal(listedB.customer, undefined, 'no customer');
assert.equal(await adminGet(`fleets/${home.fleetId}/driverAccounts/${dbx}`), null, 'nothing on Home Cars\' books');
assert.ok((await getDoc(doc(OB.db, 'fleets', other.fleetId, 'networkJobs', job.rideId))).exists(), 'Other Cars sees it');
assert.ok((await getDocs(query(collection(DB.db, 'fleets', other.fleetId, 'networkJobs'), where('driverId', '==', dbx)))).size === 1, 'and B on their statement');
await assert.rejects(getDoc(doc(OA.db, 'fleets', other.fleetId, 'networkJobs', job.rideId)), 'Home Cars cannot read Other Cars\' books');

step('driver I (no fleet) takes one: their own fare, nobody\'s books');
await place(dbx, GONE, 'offline'); await place(ds, GONE, 'offline'); await place(di, NEAR);
const job2 = await OA.call('createFleetBooking', { customer: { phone: '07700900598', name: 'Omar' }, pickup: PICK, dropoff: DROP, rideType: 'RouteMini' });
await OA.call('redispatchFleetBooking', { rideId: job2.rideId, mode: 'network' });
await until(async () => (await ride(job2.rideId)).dispatch.driverId === di, 'resent to the network: driver I');
await updateDoc(doc(DI.db, 'rides', job2.rideId), claim(di));
r = await until(async () => { const x = await ride(job2.rideId); return x.networkDriver ? x : null; }, 'tagged I');
assert.equal(r.networkDriver.fleetId, null);
await adminSet(`rides/${job2.rideId}`, { status: 'completed' }, true);
await sleep(4000);
assert.equal((await ride(job2.rideId)).settlement, undefined, 'no commission to anyone');
assert.equal(await adminGet(`fleets/${home.fleetId}/driverAccounts/${di}`), null);

step('Home Cars\' own driver takes a network job: settles with Home Cars as usual');
await place(di, GONE, 'offline'); await place(da, NEAR);
const job3 = await book({ dispatchMode: 'network' });
await until(async () => (await ride(job3.rideId)).dispatch.driverId === da, 'offered to driver A');
await updateDoc(doc(DA.db, 'rides', job3.rideId), claim(da));
await sleep(3000);
assert.equal((await ride(job3.rideId)).networkDriver, undefined, 'not an outside driver');
await adminSet(`rides/${job3.rideId}`, { status: 'completed' }, true);
await until(async () => (await ride(job3.rideId)).settlement, 'settled with Home Cars');

step('a network job cannot be switched to an account job while it is out');
const job4 = await book({ dispatchMode: 'network' });
await assert.rejects(OA.call('editFleetBooking', { rideId: job4.rideId, collectBy: 'account', accountId: 'acme' }), /out to the TakeARoute network/);
await OA.call('cancelFleetBooking', { rideId: job4.rideId });

fake.close();
console.log('\nALL PASSED');
process.exit(0);
