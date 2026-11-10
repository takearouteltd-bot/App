// The admin's no-show fee, and the penalty when a driver cancels a job
// (functions/driverPenalty.js), through the real rules and functions.
// Run like booking-checks.mjs (see README), with ROUTES_API_BASE and
// STRIPE_API_BASE=http://127.0.0.1:8999 in functions/.env.local.
// Fake Google Routes and Stripe on :8999.
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, addDoc, arrayUnion, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import assert from 'node:assert/strict';
import http from 'node:http';

const stripeCalls = [];
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const m = req.url.match(/^\/v1\/payment_intents\/([^/?]+)(?:\/(capture|cancel))?/);
    if (m) {
      const params = new URLSearchParams(body);
      if (m[2]) stripeCalls.push({ id: m[1], op: m[2], amount: Number(params.get('amount_to_capture')) || null });
      return res.end(JSON.stringify({ id: m[1], object: 'payment_intent', amount: 5000, status: m[2] === 'capture' ? 'succeeded' : 'requires_capture' }));
    }
    return res.end(JSON.stringify({ routes: [{ distanceMeters: 1609, duration: '300s' }] }));
  });
});
await new Promise((r) => fake.listen(8999, '127.0.0.1', r));

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
const adminGet = async (path) => (await (await fetch(`${REST}/${path}`, { headers: H })).json()).fields || null;
const list = async (path) => ((await (await fetch(`${REST}/${path}?pageSize=300`, { headers: H })).json()).documents || []);
const val = (f) => {
  if (!f) return undefined;
  if ('integerValue' in f) return Number(f.integerValue);
  if ('doubleValue' in f) return f.doubleValue;
  if ('nullValue' in f) return null;
  if ('mapValue' in f) return Object.fromEntries(Object.entries(f.mapValue.fields || {}).map(([k, x]) => [k, val(x)]));
  return f.stringValue ?? f.booleanValue ?? f.timestampValue;
};
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

const PICKUP = { latitude: 52.3069, longitude: -1.9492, address: 'Redditch Station, Redditch' };
const DROP = { latitude: 52.31, longitude: -1.94, address: 'Town' };
const NEAR = { latitude: 52.3100, longitude: -1.9492 }; // about 0.34 km
const FAR = { latitude: 52.5, longitude: -1.9492 }; // about 21 km

const A = mk('admin'), R = mk('rider'), D = mk('driver'), P = mk('payout');
const adm = await createUserWithEmailAndPassword(A.auth, 'admin-dc@test.dev', 'secret123');
await adminSet(`admins/${adm.user.uid}`, { isActive: true, role: 'super_admin' });
const rider = (await createUserWithEmailAndPassword(R.auth, 'rider-dc@test.dev', 'secret123')).user.uid;
const driverId = (await createUserWithEmailAndPassword(D.auth, 'driver-dc@test.dev', 'secret123')).user.uid;
const payoutDriver = (await createUserWithEmailAndPassword(P.auth, 'pay-dc@test.dev', 'secret123')).user.uid;

const setCancellation = (c) => adminSet('config/app', { currency: 'GBP', cancellation: {
  fee: 3, freeMinutes: 1, arrivedFee: 0, noShowWaitMinutes: 5, driverSharePercent: 100,
  driverPenaltyMode: 0, driverPenaltyAmount: 0, driverPenaltyMinutes: 0, driverPenaltyRadiusKm: 0, ...c,
} });
const walletOf = async (uid = driverId) => val((await adminGet(`driverWallets/${uid}`))?.availableBalance);
const seedDriver = (location, extra = {}) => adminSet(`drivers/${driverId}`, {
  approved: true, firstName: 'Dan', lastName: 'Driver', vehicleType: 'RouteMini', status: 'on_ride', isOnRide: true,
  location: location || null, lastUpdated: new Date(), cancelBlockedUntil: null, ...extra,
});
let n = 0;
async function seedJob(extra = {}) {
  n += 1;
  const id = `job${n}`;
  const acceptedAt = new Date(Date.now() - 60000);
  await adminSet(`rides/${id}`, {
    riderId: rider, driverId, status: 'accepted', acceptedAt, rideType: 'RouteMini', paymentMethod: 'card', currency: 'gbp',
    pickupLocation: PICKUP, dropoffLocation: DROP, fare: { total: 10 }, declinedBy: [], walletProcessed: false, pricing: 'checked', ...extra,
  });
  await adminSet(`drivers/${driverId}`, { currentRideId: id, isOnRide: true }, true);
  return { id, acceptedAt };
}
const cancelJob = (id, status = 'searching') => updateDoc(doc(D.db, 'rides', id), {
  status, driverId: null, acceptedAt: null, declinedBy: arrayUnion(driverId), lastDriverCancelAt: serverTimestamp(),
});
const recordOf = async (id, acceptedAt) => {
  const f = await adminGet(`driverCancellations/${id}_${driverId}_${acceptedAt.getTime()}`);
  return f && Object.fromEntries(Object.entries(f).map(([k, v]) => [k, val(v)]));
};
const waitRecord = ({ id, acceptedAt }) => until(() => recordOf(id, acceptedAt), `cancel record for ${id}`);

await adminSet(`driverWallets/${driverId}`, { availableBalance: 20, totalEarned: 20, currency: 'GBP' });

/* ------------------------------ driver penalty ------------------------------ */
await setCancellation({});
await seedDriver(NEAR);
step('penalty off: nothing is charged, but the cancel is on record');
let job = await seedJob();
await cancelJob(job.id);
let rec = await waitRecord(job);
assert.equal(rec.penalty.applied, false); assert.equal(rec.penalty.reason, 'off');
assert.equal(rec.driverName, 'Dan Driver'); assert.equal(rec.source, 'app');
assert.equal(await walletOf(), 20);

step('money, inside the radius: the amount comes off the wallet, with a transaction');
await setCancellation({ driverPenaltyMode: 1, driverPenaltyAmount: 5, driverPenaltyRadiusKm: 2 });
job = await seedJob();
await cancelJob(job.id);
rec = await waitRecord(job);
assert.equal(rec.penalty.applied, true); assert.equal(rec.penalty.type, 'money'); assert.equal(rec.penalty.amount, 5);
assert.equal(rec.penalty.reason, 'within_radius');
assert.ok(rec.distanceKm > 0.2 && rec.distanceKm < 0.5, String(rec.distanceKm));
assert.equal(await walletOf(), 15);
const tx = (await list(`driverWallets/${driverId}/transactions`)).filter((d) => val(d.fields.rideId) === job.id);
assert.equal(tx.length, 1); assert.equal(val(tx[0].fields.type), 'cancel_penalty'); assert.equal(val(tx[0].fields.amount), -5);

step('the same cancel delivered again does not charge twice');
const dupe = { id: job.id, acceptedAt: job.acceptedAt };
await adminSet(`rides/${job.id}`, { status: 'accepted', driverId, acceptedAt: job.acceptedAt }, true);
await sleep(1500);
await cancelJob(job.id);
await sleep(4000);
assert.equal(await walletOf(), 15);
assert.equal((await list(`driverWallets/${driverId}/transactions`)).filter((d) => val(d.fields.rideId) === dupe.id).length, 1);

step('money, outside the radius: free');
await seedDriver(FAR);
job = await seedJob();
await cancelJob(job.id);
rec = await waitRecord(job);
assert.equal(rec.penalty.applied, false); assert.equal(rec.penalty.reason, 'outside_radius');
assert.ok(rec.distanceKm > 15); assert.equal(await walletOf(), 15);

step('how the job was booked is kept on the record');
job = await seedJob({ source: 'phone', bookedBy: { via: 'bot' } });
await cancelJob(job.id, 'dispatching');
rec = await waitRecord(job);
assert.equal(rec.via, 'bot');
await seedDriver(FAR);

step('radius 0: every cancel is penalised, however far away');
await setCancellation({ driverPenaltyMode: 1, driverPenaltyAmount: 2.5, driverPenaltyRadiusKm: 0 });
job = await seedJob();
await cancelJob(job.id);
rec = await waitRecord(job);
assert.equal(rec.penalty.applied, true); assert.equal(rec.penalty.reason, 'every_cancel');
assert.equal(await walletOf(), 12.5);

step('old location with a radius set: no penalty, recorded as unknown');
await setCancellation({ driverPenaltyMode: 1, driverPenaltyAmount: 5, driverPenaltyRadiusKm: 2 });
await seedDriver(NEAR, { lastUpdated: new Date(Date.now() - 3600 * 1000) });
job = await seedJob();
await cancelJob(job.id);
rec = await waitRecord(job);
assert.equal(rec.penalty.applied, false); assert.equal(rec.penalty.reason, 'location_unknown');
assert.equal(rec.distanceKm, null); assert.equal(rec.locationKnown, false); assert.equal(await walletOf(), 12.5);

step('no location at all: same');
await seedDriver(null);
job = await seedJob();
await cancelJob(job.id);
rec = await waitRecord(job);
assert.equal(rec.penalty.reason, 'location_unknown'); assert.equal(await walletOf(), 12.5);

step('our own release after a failed card hold is not penalised and not recorded');
await seedDriver(NEAR);
job = await seedJob();
await adminSet(`rides/${job.id}`, { status: 'searching', driverId: null, acceptedAt: null, paymentStatus: 'auth_failed', lastDriverCancelAt: new Date(), serverReleasedAt: new Date() }, true);
await sleep(4000);
assert.equal(await recordOf(job.id, job.acceptedAt), null);
assert.equal(await walletOf(), 12.5);

step('time: off the road, cannot go online, and can again once it ends');
await setCancellation({ driverPenaltyMode: 2, driverPenaltyMinutes: 30, driverPenaltyRadiusKm: 0 });
await seedDriver(NEAR);
job = await seedJob();
await cancelJob(job.id);
rec = await waitRecord(job);
assert.equal(rec.penalty.applied, true); assert.equal(rec.penalty.type, 'time'); assert.equal(rec.penalty.minutes, 30);
const blocked = await adminGet(`drivers/${driverId}`);
assert.equal(val(blocked.status), 'offline'); assert.equal(val(blocked.isOnRide), false);
const left = new Date(val(blocked.cancelBlockedUntil)).getTime() - Date.now();
assert.ok(left > 28 * 60000 && left <= 30 * 60000, String(left));
assert.equal(await walletOf(), 12.5);
await assert.rejects(updateDoc(doc(D.db, 'drivers', driverId), { status: 'online' }));
await adminSet(`drivers/${driverId}`, { cancelBlockedUntil: new Date(Date.now() - 1000) }, true);
await updateDoc(doc(D.db, 'drivers', driverId), { status: 'online' });

step('a fleet job: back to the fleet, penalty applies, on that fleet\'s record');
await setCancellation({ driverPenaltyMode: 1, driverPenaltyAmount: 1.5, driverPenaltyRadiusKm: 2 });
await seedDriver(NEAR, { fleetId: 'f1', fleetDriverType: 'company' });
job = await seedJob({ source: 'phone', fleetId: 'f1', riderId: null, paymentMethod: 'cash', customer: { name: 'Ann', phone: '+447700900000' }, dispatch: { driverId, mode: 'driver' } });
await cancelJob(job.id, 'dispatching');
rec = await waitRecord(job);
assert.equal(rec.fleetId, 'f1'); assert.equal(rec.source, 'phone'); assert.equal(rec.penalty.applied, true);
assert.equal(val((await adminGet(`rides/${job.id}`)).status), 'dispatching');

step('a company driver\'s money penalty goes on their fleet statement, not their wallet');
assert.equal(rec.penalty.chargedTo, 'fleet_statement');
assert.equal(await walletOf(), 12.5);
assert.equal(val((await adminGet(`fleets/f1/driverAccounts/${driverId}`)).owedPence), -150);
const onStatement = (await list('fleets/f1/driverPayments')).filter((d) => val(d.fields.rideId) === job.id);
assert.equal(onStatement.length, 1);
assert.equal(val(onStatement[0].fields.direction), 'penalty');
assert.equal(val(onStatement[0].fields.amountPence), 150);

step('a self-employed fleet driver\'s money penalty comes off their own wallet');
await seedDriver(NEAR, { fleetId: 'f1', fleetDriverType: 'self' });
job = await seedJob();
await cancelJob(job.id);
rec = await waitRecord(job);
assert.equal(rec.penalty.chargedTo, 'wallet');
assert.equal(await walletOf(), 11);
assert.equal(val((await adminGet(`fleets/f1/driverAccounts/${driverId}`)).owedPence), -150);

step('a wallet below zero cannot be withdrawn');
await adminSet(`driverWallets/${payoutDriver}`, { availableBalance: -5, totalEarned: 0, currency: 'GBP' });
await adminSet(`drivers/${payoutDriver}`, { approved: true, accountDetails: { sortCode: '123456', accountNumber: '12345678' } });
await assert.rejects(P.call('requestDriverPayout', { amount: 10 }), /Insufficient balance/);

/* ------------------------------ no-show fee ------------------------------ */
await seedDriver(NEAR, { fleetId: null });
const settledBooking = (id) => until(async () => {
  const r = await adminGet(`rides/${id}`);
  return r && val(r.pricing) === 'checked' ? r : null;
}, 'booking check');
const book = (policy) => addDoc(collection(R.db, 'rides'), {
  riderId: rider, driverId: null, status: 'searching', rideType: 'RouteMini', pickupLocation: PICKUP, dropoffLocation: DROP,
  fare: { total: 7.74, discount: 0, promoCode: null, vatPercent: 20 }, cityId: null, paymentMethod: 'card',
  waitingPolicy: { freeMinutes: 60, ratePerMinute: 0, maxCharge: 0 }, cancellationPolicy: policy,
}).then((r) => r.id);
async function toArrived(id, pi, extra = {}) {
  await adminSet(`payments/${pi}`, { status: 'authorized', rideId: id, amount: 5000 });
  await adminSet(`rides/${id}`, { status: 'arrived', driverId, acceptedAt: new Date(Date.now() - 900000), arrivedAt: new Date(Date.now() - 600000), paymentIntentId: pi, ...extra }, true);
}
const noShow = (id) => updateDoc(doc(D.db, 'rides', id), { status: 'cancelled', cancelledBy: 'driver', cancelReason: 'passenger_no_show', cancelledAt: serverTimestamp() });

step('the fee the admin set is the one saved on the booking, even if the phone sent another');
await setCancellation({ arrivedFee: 7.5, noShowWaitMinutes: 0, driverSharePercent: 80 });
let id = await book({ arrivedFee: 0, noShowWaitMinutes: 99, driverSharePercent: 0 });
let ride = await settledBooking(id);
assert.equal(val(ride.cancellationPolicy).arrivedFee, 7.5);
assert.equal(val(ride.cancellationPolicy).noShowWaitMinutes, 0);

step('no-show: exactly that fee is captured and the driver gets their share');
let before = await walletOf();
await toArrived(id, 'pi_ns1');
await noShow(id);
await until(() => stripeCalls.find((c) => c.id === 'pi_ns1'), 'capture');
assert.deepEqual(stripeCalls.filter((c) => c.id === 'pi_ns1'), [{ id: 'pi_ns1', op: 'capture', amount: 750 }]);
await until(async () => val((await adminGet(`rides/${id}`)).cancellationFeePaid) === true, 'driver share');
ride = await adminGet(`rides/${id}`);
assert.equal(val(ride.cancellationFee), 7.5); assert.equal(val(ride.cancellationFeeDriverShare), 6);
assert.equal(await walletOf(), before + 6);

step('a new value from the admin is charged on the next booking');
await setCancellation({ arrivedFee: 9, noShowWaitMinutes: 0, driverSharePercent: 100 });
id = await book({});
await settledBooking(id);
await toArrived(id, 'pi_ns2');
await noShow(id);
await until(() => stripeCalls.find((c) => c.id === 'pi_ns2'), 'capture');
assert.equal(stripeCalls.find((c) => c.id === 'pi_ns2').amount, 900);

step('before the wait is up: the hold is released, no fee');
await setCancellation({ arrivedFee: 9, noShowWaitMinutes: 30 });
id = await book({});
await settledBooking(id);
await toArrived(id, 'pi_ns3');
await noShow(id);
await until(() => stripeCalls.find((c) => c.id === 'pi_ns3'), 'release');
assert.deepEqual(stripeCalls.filter((c) => c.id === 'pi_ns3'), [{ id: 'pi_ns3', op: 'cancel', amount: null }]);

step('fee left at 0 (today\'s live setting): no fee');
await setCancellation({ arrivedFee: 0, noShowWaitMinutes: 0 });
id = await book({});
await settledBooking(id);
await toArrived(id, 'pi_ns4');
await noShow(id);
await until(() => stripeCalls.find((c) => c.id === 'pi_ns4'), 'release');
assert.equal(stripeCalls.find((c) => c.id === 'pi_ns4').op, 'cancel');

step('cash and phone jobs are not charged');
await setCancellation({ arrivedFee: 9, noShowWaitMinutes: 0 });
n += 1;
await adminSet(`rides/cash${n}`, { riderId: rider, driverId, status: 'arrived', paymentMethod: 'cash', rideType: 'RouteMini', paymentIntentId: 'pi_cash', arrivedAt: new Date(Date.now() - 600000), acceptedAt: new Date(Date.now() - 900000), pickupLocation: PICKUP, dropoffLocation: DROP, cancellationPolicy: { arrivedFee: 9, noShowWaitMinutes: 0 }, fare: { total: 10 } });
await adminSet(`payments/pi_cash`, { status: 'authorized' });
await noShow(`cash${n}`);
await adminSet(`rides/phone${n}`, { source: 'phone', fleetId: 'f1', riderId: null, driverId, status: 'arrived', paymentMethod: 'cash', collectBy: 'cash', rideType: 'RouteMini', arrivedAt: new Date(Date.now() - 600000), acceptedAt: new Date(Date.now() - 900000), pickupLocation: PICKUP, dropoffLocation: DROP, cancellationPolicy: { fee: 0, freeMinutes: 0, arrivedFee: 0, noShowWaitMinutes: 5 }, fare: { total: 10 } });
await noShow(`phone${n}`);
await sleep(3000);
assert.equal(stripeCalls.filter((c) => c.op === 'capture' && c.id === 'pi_cash').length, 0);

console.log(`\nAll ${steps} steps passed`);
fake.close();
process.exit(0);
