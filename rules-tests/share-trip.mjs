// "Share my trip" (functions/fleetWeb.js shareTripLink and webTrack): only
// the ride's passenger makes the link, only while a driver is on the way or
// on the trip, the same link every time; the page shows the driver's first
// name, car, plate and position, the pickup and drop-off and a rough
// arrival time, never a phone number, the fare or a cancel button; nothing
// but the status once the trip is over; the link stops a day after the last
// share once the trip is over. Rules for tripShares are in fleet.test.mjs.
// Run on fresh emulators: `rules-tests/ci-suite.sh share-trip` (auth,
// firestore, functions; dummy Stripe secrets only, no fakes, Twilio off).
// CI: .github/workflows/tests.yml.
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import assert from 'node:assert/strict';

/* ------------------------------ harness ------------------------------ */
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
const adminGet = async (path) => (await (await fetch(`${REST}/${path}`, { headers: H })).json()).fields || {};
const val = (f) => f && (f.stringValue ?? (f.integerValue !== undefined ? Number(f.integerValue) : undefined) ?? f.booleanValue ?? f.doubleValue ?? null);
let steps = 0;
const step = (s) => { steps += 1; console.log('•', s); };
async function refusedWith(promise, code) {
  try {
    await promise;
  } catch (e) {
    assert.equal(e.code, `functions/${code}`, e.message);
    return e;
  }
  throw new Error(`expected ${code}`);
}

/* ------------------------------ set-up ------------------------------ */
const P = { latitude: 52.3, longitude: -1.9, address: '1 Pickup Street, Redditch' };
const D = { latitude: 52.35, longitude: -1.9, address: '2 Drop-off Road, Redditch' };
// A point m metres north of the pickup (south when negative).
const north = (m) => ({ latitude: P.latitude + m / 111195, longitude: P.longitude });

const R = mk('rider'), R2 = mk('rider2'), DR = mk('driver'), ANON = mk('anon');
const rider = (await createUserWithEmailAndPassword(R.auth, 'rider-st@test.dev', 'secret123')).user.uid;
const other = (await createUserWithEmailAndPassword(R2.auth, 'other-st@test.dev', 'secret123')).user.uid;
const driverId = (await createUserWithEmailAndPassword(DR.auth, 'driver-st@test.dev', 'secret123')).user.uid;
await adminSet(`riders/${rider}`, { fullName: 'Alex Rider', phone: '+447700900111', email: 'rider-st@test.dev' });
await adminSet(`drivers/${driverId}`, {
  approved: true, status: 'on_ride', isOnRide: true, firstName: 'Sam', fullName: 'Sam Driver',
  vehicleColor: 'Blue', makeModel: 'Toyota Prius', registrationNumber: 'ab12cde', phone: '+447700900222',
  location: north(-1000), lastUpdated: new Date(),
});
const ride = (status, extra = {}) => ({
  riderId: rider, driverId, status, rideType: 'RouteMini', source: 'app', pickupLocation: P, dropoffLocation: D,
  stops: [], paymentMethod: 'cash', fare: { total: 12.5 }, fareEstimate: 12.5, walletProcessed: false, ...extra,
});
await adminSet('rides/st1', ride('accepted'));
await adminSet('rides/stdone', ride('completed'));
// A taxi firm's phone job: tracked by the office's own texted link.
await adminSet('rides/stphone', { source: 'phone', fleetId: 'f1', riderId: null, driverId, status: 'accepted', pickupLocation: P, dropoffLocation: D });

/* ------------------------------ who may share ------------------------------ */
await refusedWith(ANON.call('shareTripLink', { rideId: 'st1' }), 'unauthenticated');
await refusedWith(R2.call('shareTripLink', { rideId: 'st1' }), 'permission-denied');
await refusedWith(DR.call('shareTripLink', { rideId: 'st1' }), 'permission-denied');
await refusedWith(R.call('shareTripLink', { rideId: 'nope' }), 'permission-denied');
await refusedWith(R.call('shareTripLink', { rideId: 'stphone' }), 'permission-denied');
await refusedWith(R.call('shareTripLink', { rideId: 'stdone' }), 'failed-precondition');
await refusedWith(R.call('shareTripLink', { rideId: '' }), 'invalid-argument');
step('only the passenger of a live app ride makes a link: not another passenger, the driver, a phone job or a finished trip');

const first = await R.call('shareTripLink', { rideId: 'st1' });
assert.match(first.url, /\/t\/s[A-Za-z0-9_-]{22}$/);
assert.equal(first.url.split('/t/')[1], first.token);
const again = await R.call('shareTripLink', { rideId: 'st1' });
assert.equal(again.url, first.url, 'asking again gives the same link');
const rec = await adminGet('tripShares/st1');
assert.equal(val(rec.token), first.token);
assert.equal(val(rec.riderId), rider);
assert.equal(val(rec.shares), 2);
assert.ok(!val((await adminGet('rides/st1')).trackToken), 'the link is not put on the ride, which nearby drivers can read');
step('the same link each time, kept in tripShares, not on the ride');

/* ------------------------------ what the page shows ------------------------------ */
let t = await ANON.call('webTrack', { trackToken: first.token });
assert.equal(t.shared, true);
assert.equal(t.status, 'accepted');
assert.equal(t.sharedBy, 'Alex');
assert.equal(t.driver.name, 'Sam');
assert.equal(t.driver.car, 'Blue Toyota Prius');
assert.equal(t.driver.registration, 'AB12CDE');
assert.ok(Math.abs(t.driver.position.latitude - north(-1000).latitude) < 1e-9);
assert.equal(t.pickup.address, P.address);
assert.equal(t.dropoff.address, D.address);
// 1 km to the pickup: 1.4 km by road at 30 km/h, about 3 minutes.
assert.equal(t.etaMinutes, 3);
assert.equal(t.fare, null);
assert.equal(t.cash, null);
assert.equal(t.phone, '');
assert.equal(t.canCancel, false);
const raw = JSON.stringify(t);
for (const secret of ['+447700900111', '+447700900222', 'rider-st@test.dev', 'Driver', 'Rider']) {
  assert.ok(!raw.includes(secret), `the shared page must not carry ${secret}`);
}
step('the page: driver first name, car, plate, position, pickup, drop-off and a rough time; no phone, email, fare or surname');

// A follow-on job: the driver is still on someone else's trip.
await adminSet('rides/st1', { followOn: { afterRideId: 'other-trip', etaMinutes: 9 } }, true);
t = await ANON.call('webTrack', { trackToken: first.token });
assert.equal(t.driver.name, 'Sam');
assert.equal(t.driver.position, null, 'not the car on the other passenger\'s trip');
assert.equal(t.etaMinutes, null);
await adminSet('rides/st1', { followOn: { afterRideId: 'other-trip', etaMinutes: 9, startedAt: new Date() } }, true);
t = await ANON.call('webTrack', { trackToken: first.token });
assert.ok(t.driver.position, 'shown once they head to this pickup');
step('a follow-on job: no position until the driver heads to this pickup');

await adminSet('rides/st1', { status: 'ongoing' }, true);
await adminSet(`drivers/${driverId}`, { location: { latitude: D.latitude - 2000 / 111195, longitude: D.longitude } }, true);
t = await R2.call('webTrack', { trackToken: first.token });
assert.equal(t.status, 'ongoing');
assert.ok(t.driver && t.driver.position, 'the car is shown on the trip');
// 2 km to the drop-off: about 6 minutes.
assert.equal(t.etaMinutes, 6);
step('on the trip: the car and the time to the drop-off');

await adminSet('rides/st1', { status: 'completed' }, true);
t = await ANON.call('webTrack', { trackToken: first.token });
assert.equal(t.status, 'completed');
assert.equal(t.driver, null, 'no position once the trip is over');
assert.equal(t.pickup, null);
assert.equal(t.dropoff, null);
assert.equal(t.etaMinutes, null);
await refusedWith(R.call('shareTripLink', { rideId: 'st1' }), 'failed-precondition');
step('trip over: the status only, and no new shares');

await adminSet('tripShares/st1', { expiresAt: Date.now() - 1000 }, true);
await refusedWith(ANON.call('webTrack', { trackToken: first.token }), 'not-found');
// While the trip is somehow still going, an old link keeps working.
await adminSet('rides/st1', { status: 'ongoing' }, true);
t = await ANON.call('webTrack', { trackToken: first.token });
assert.equal(t.status, 'ongoing');
await adminSet('rides/st1', { status: 'completed' }, true);
step('a day after the last share, once the trip is over, the link stops working');

await refusedWith(ANON.call('webTrack', { trackToken: 's' + 'x'.repeat(22) }), 'not-found');
await refusedWith(ANON.call('webTrack', { trackToken: 's' + 'x'.repeat(21) }), 'not-found');
await refusedWith(ANON.call('webTrack', { trackToken: first.token.slice(1) + 'A' }), 'not-found');
step('made-up links find nothing');

console.log(`ALL ${steps} SHARE TRIP STEPS PASSED`);
process.exit(0);
