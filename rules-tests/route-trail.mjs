// Route history for disputes (functions/routeTrail.js): every position the
// driver's phone saves while on a job is appended by the server to
// rides/{id}/trail, split into the leg to the pickup and the trip itself;
// drift at the kerb, other drivers, finished jobs and drivers off a job add
// nothing; admins read it, the driver cannot read or write it.
// Run on fresh emulators: `rules-tests/ci-suite.sh route-trail` (auth,
// firestore, functions; dummy Stripe secrets only, no fakes). CI:
// .github/workflows/tests.yml.
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, collection, doc, getDocs, setDoc } from 'firebase/firestore';
import assert from 'node:assert/strict';

/* ------------------------------ harness ------------------------------ */
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
async function adminSet(path, data, mask = false) {
  const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)]));
  const q = mask ? '?' + Object.keys(data).map((k) => 'updateMask.fieldPaths=' + k).join('&') : '';
  const r = await fetch(`${REST}/${path}${q}`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields }) });
  if (!r.ok) throw new Error(await r.text());
}
const val = (f) => {
  if (!f) return undefined;
  if ('integerValue' in f) return Number(f.integerValue);
  if ('doubleValue' in f) return f.doubleValue;
  if ('nullValue' in f) return null;
  if ('mapValue' in f) return Object.fromEntries(Object.entries(f.mapValue.fields || {}).map(([k, x]) => [k, val(x)]));
  if ('arrayValue' in f) return (f.arrayValue.values || []).map(val);
  return f.stringValue ?? f.booleanValue ?? f.timestampValue;
};
/** Every trail chunk of a ride, as the server wrote them. */
async function trail(rideId) {
  const body = await (await fetch(`${REST}/rides/${rideId}/trail`, { headers: H })).json();
  return (body.documents || []).map((d) => ({
    id: d.name.split('/').pop(),
    ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, x]) => [k, val(x)])),
  }));
}
const allPoints = async (rideId) => (await trail(rideId)).flatMap((c) => c.points.map((p) => ({ ...p, leg: c.leg }))).sort((a, b) => a.t - b.t);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, what, tries = 240) {
  for (let i = 0; i < tries; i++) {
    const got = await check();
    if (got) return got;
    await sleep(250);
  }
  throw new Error('Timed out waiting for ' + what);
}
let steps = 0;
const step = (s) => { steps += 1; console.log('•', s); };
async function refused(promise) {
  try {
    await promise;
  } catch (e) {
    assert.equal(e.code, 'permission-denied', e.message);
    return;
  }
  throw new Error('expected a refusal');
}

/* ------------------------------ set-up ------------------------------ */
const P = { latitude: 52.3, longitude: -1.9, address: 'Pickup Street, Redditch' };
const D = { latitude: 52.35, longitude: -1.9, address: 'Drop-off Road, Redditch' };
// A point m metres north of the pickup (south when negative).
const north = (m) => ({ latitude: P.latitude + m / 111195, longitude: P.longitude });

const DR = mk('driver'), OD = mk('other'), ADM = mk('admin');
const driverId = (await createUserWithEmailAndPassword(DR.auth, 'driver-rt@test.dev', 'secret123')).user.uid;
const otherId = (await createUserWithEmailAndPassword(OD.auth, 'other-rt@test.dev', 'secret123')).user.uid;
const adminId = (await createUserWithEmailAndPassword(ADM.auth, 'admin-rt@test.dev', 'secret123')).user.uid;
await adminSet(`admins/${adminId}`, { isActive: true });
await adminSet('config/app', { currency: 'GBP' });

const ride = (status, extra = {}) => ({
  riderId: 'rider-rt', driverId, status, rideType: 'RouteMini', source: 'app',
  pickupLocation: P, dropoffLocation: D, stops: [], paymentMethod: 'cash', walletProcessed: false, ...extra,
});
await adminSet('rides/rt1', ride('accepted'));

let clock = Date.now() - 3600 * 1000;
/** The driver's phone saving a position, as utils/driverLocation.js does. */
const save = (uid, point, rideId, onRide = true, speedKph = 30) => {
  clock += 10000;
  return adminSet(`drivers/${uid}`, {
    approved: true, status: onRide ? 'on_ride' : 'online', isOnRide: onRide, currentRideId: onRide ? rideId : null,
    location: { latitude: point.latitude, longitude: point.longitude }, speedKph, heading: 0,
    lastUpdated: new Date(clock),
  });
};
const count = async (rideId) => (await allPoints(rideId)).length;
const waitFor = (rideId, n, what) => until(async () => (await count(rideId)) >= n, what);

/* ------------------------------ the leg to the pickup ------------------------------ */
// Created online and free first (the trigger runs on updates).
await save(driverId, north(-2000), null, false);
await save(otherId, north(-2000), null, false);
await sleep(1500);
assert.equal(await count('rt1'), 0);
step('online and free: no trail');

await save(driverId, north(-2000), 'rt1');
await waitFor('rt1', 1, 'the first point when the job starts');
await save(driverId, north(-1500), 'rt1');
await waitFor('rt1', 2, 'a second point');
let pts = await allPoints('rt1');
assert.deepEqual(pts.map((p) => [p.leg, p.s]), [['pickup', 'a'], ['pickup', 'a']]);
assert.equal(pts[0].kph, 30);
assert.ok(Math.abs(pts[1].lat - north(-1500).latitude) < 1e-6);
step('accepting the job keeps its first position, even unmoved; the drive to the pickup goes on the pickup leg');

await save(driverId, north(-1497), 'rt1'); // 3 m: drift
await save(driverId, north(-1497), 'rt1'); // a heartbeat, same place
await save(driverId, north(-1497), 'rt1', true, null);
await save(driverId, north(-1000), 'rt1', true, null); // speed unknown
await waitFor('rt1', 3, 'the next real move');
await sleep(1500);
pts = await allPoints('rt1');
assert.equal(pts.length, 3);
assert.equal(pts[2].kph, null);
step('3 m of drift and unmoved heartbeats are skipped; an unknown speed is kept as null');

await adminSet('rides/rt1', { status: 'arrived' }, true);
await save(driverId, north(0), 'rt1');
await waitFor('rt1', 4, 'a point while waiting');
pts = await allPoints('rt1');
assert.deepEqual([pts[3].leg, pts[3].s], ['pickup', 'w']);
step('at the pickup (arrived): still the pickup leg, marked as waiting');

/* ------------------------------ the trip ------------------------------ */
await adminSet('rides/rt1', { status: 'ongoing' }, true);
for (const m of [400, 900, 1600, 2400]) await save(driverId, north(m), 'rt1');
await waitFor('rt1', 8, 'the trip points');
pts = await allPoints('rt1');
assert.deepEqual(pts.slice(4).map((p) => [p.leg, p.s]), Array(4).fill(['trip', 'o']));
const chunks = await trail('rt1');
assert.ok(chunks.every((c) => /^(pickup|trip)-\d{9}$/.test(c.id) && c.driverId === driverId && c.from && c.expireAt));
const keepDays = (Date.parse(chunks[0].expireAt) - Date.parse(chunks[0].from)) / 86400000;
assert.equal(keepDays, 180);
step('passenger on board (ongoing): the trip leg; chunks named by leg and ten minutes, with the TTL date 180 days on');

/* ------------------------------ what adds nothing ------------------------------ */
// Another driver whose phone claims the same job.
await save(otherId, north(3000), 'rt1');
await save(otherId, north(3500), 'rt1');
// A job that is over.
await adminSet('rides/rt2', ride('completed', { walletProcessed: true, paymentStatus: 'cash' }));
await save(driverId, north(2600), 'rt2');
await save(driverId, north(2900), 'rt2');
// Off the job.
await save(driverId, north(3200), null, false);
await save(driverId, north(3600), null, false);
await sleep(3000);
assert.equal(await count('rt1'), 8);
assert.equal(await count('rt2'), 0);
step("another driver's phone, a completed job and a driver off the job add nothing");

/* ------------------------------ who reads it ------------------------------ */
const seen = await getDocs(collection(ADM.db, 'rides', 'rt1', 'trail'));
assert.equal(seen.docs.reduce((n, d) => n + d.data().points.length, 0), 8);
await refused(getDocs(collection(DR.db, 'rides', 'rt1', 'trail')));
await refused(getDocs(collection(OD.db, 'rides', 'rt1', 'trail')));
await refused(setDoc(doc(DR.db, 'rides', 'rt1', 'trail', 'trip-000000001'), { points: [] }));
step('an admin reads the trail; the driver and other drivers can neither read nor write it');

console.log(`\nAll ${steps} route trail checks passed.`);
process.exit(0);
