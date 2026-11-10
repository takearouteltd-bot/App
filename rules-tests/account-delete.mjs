// "Delete my account" (deleteMyAccount) against the emulators (auth 9099,
// firestore 8080, functions 5001), project demo-tar. Run like fleet-e2e.mjs
// (see README).
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
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
const REST = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const H = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const enc = (v) => typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : v === null ? { nullValue: null } : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } } : typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } } : { stringValue: String(v) };
async function adminSet(path, data, mask = false) {
  const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)]));
  const r = await fetch(`${REST}/${path}${mask ? '?' + Object.keys(data).map((k) => 'updateMask.fieldPaths=' + k).join('&') : ''}`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields }) });
  if (!r.ok) throw new Error(await r.text());
}
const exists = async (path) => (await fetch(`${REST}/${path}`, { headers: H })).ok;
const adminGet = async (path) => (await (await fetch(`${REST}/${path}`, { headers: H })).json()).fields || {};
const step = (s) => console.log('•', s);

const A = mk('admin'), O = mk('owner'), D = mk('driver'), R = mk('rider');
const adm = await createUserWithEmailAndPassword(A.auth, 'admin@test.dev', 'secret123');
await adminSet(`admins/${adm.user.uid}`, { isActive: true, role: 'super_admin' });
await adminSet('config/app', { currency: 'GBP' });
const created = await A.call('createFleet', { name: 'Time Taxis', ownerName: 'S', email: 'owner@test.dev', phone: '07700900001' });
const users = await (await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:query`, { method: 'POST', headers: H, body: '{}' })).json();
const ownerUser = users.userInfo.find((u) => u.email === 'owner@test.dev');
await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: H, body: JSON.stringify({ localId: ownerUser.localId, password: 'owner123' }) });
await signInWithEmailAndPassword(O.auth, 'owner@test.dev', 'owner123');

step('company driver in Time Taxis, also a passenger, with wallet, payout, push token, location');
const d = await createUserWithEmailAndPassword(D.auth, 'd@test.dev', 'secret123');
const uid = d.user.uid;
await adminSet(`drivers/${uid}`, { approved: true, onboardingComplete: true, vehicleType: 'RouteMini', status: 'online', phoneNumber: '+447700900111', firstName: 'Drv', subscription: { status: 'active', paymentMethod: 'wallet_deduction' } });
await adminSet(`riders/${uid}`, { fullName: 'Drv Rider', phoneNumber: '+447700900111' });
await adminSet(`driverPrivate/${uid}`, { accountDetails: { sortCode: '123456', accountNumber: '12345678' }, nin: 'AB123456C' });
await adminSet(`driverFiles/${uid}`, { motUrl: 'https://x/m' });
await adminSet(`riders/${uid}/savedPlaces/home`, { label: 'Home' });
await adminSet(`pushTokens/${uid}`, { tokens: ['x'] });
await adminSet(`driverLocations/${uid}`, { lat: 1 });
await adminSet(`driverWallets/${uid}`, { availableBalance: 12.5 });
await adminSet('driverPayouts/p1', { driverId: uid, amount: 5, status: 'pending_admin', bankDetails: { accountNumber: '12345678' } });
await adminSet('rides/r1', { riderId: uid, status: 'scheduled' });
await adminSet('fleetInvites/+447700900111', { phone: '+447700900111', fleetId: 'other', fleetName: 'Other Cars' });
await D.call('requestFleetJoin', { code: created.joinCode });
await O.call('decideFleetDriver', { driverId: uid, approve: true, driverType: 'company' });

step('refused: fleet staff');
await assert.rejects(O.call('deleteMyAccount', {}), /staff login/);
step('refused: trip booked');
await assert.rejects(D.call('deleteMyAccount', {}), /trip booked or in progress/);
await adminSet('rides/r1', { status: 'completed' }, true);
step('refused: money in wallet');
await assert.rejects(D.call('deleteMyAccount', {}), /12\.50 in your wallet/);
await adminSet(`driverWallets/${uid}`, { availableBalance: 0 }, true);
step('refused: withdrawal pending');
await assert.rejects(D.call('deleteMyAccount', {}), /withdrawal is still being paid/);
await adminSet('driverPayouts/p1', { status: 'completed' }, true);
await adminSet(`driverWallets/${uid}`, { availableBalance: -4 }, true);

step('deleted: records and sign-in gone; ride, payout amount and fleet invite kept');
assert.deepEqual(await D.call('deleteMyAccount', {}), { ok: true });
for (const p of [`drivers/${uid}`, `driverPrivate/${uid}`, `driverFiles/${uid}`, `riderPublic/${uid}`, `riders/${uid}`, `riders/${uid}/savedPlaces/home`, `pushTokens/${uid}`, `driverLocations/${uid}`, `driverWallets/${uid}`]) {
  assert.equal(await exists(p), false, p + ' still there');
}
assert.equal(await exists('rides/r1'), true);
assert.equal(await exists(`paymentAlerts/account_deleted_owing_${uid}`), true, 'what was owed is left for an admin');
const p1 = await adminGet('driverPayouts/p1');
assert.equal(p1.bankDetails, undefined); assert.equal(p1.amount.integerValue, '5');
assert.equal(await exists('fleetInvites/+447700900111'), true);
await assert.rejects(signInWithEmailAndPassword(mk('again').auth, 'd@test.dev', 'secret123'));
step('the same login can sign up again from scratch');
const again = await createUserWithEmailAndPassword(mk('again2').auth, 'd@test.dev', 'secret123');
assert.notEqual(again.user.uid, uid);

step('a passenger-only account deletes too');
const r = await createUserWithEmailAndPassword(R.auth, 'r@test.dev', 'secret123');
await adminSet(`riders/${r.user.uid}`, { fullName: 'Pat' });
await R.call('deleteMyAccount', {});
assert.equal(await exists(`riders/${r.user.uid}`), false);
console.log('ALL PASS');
process.exit(0);
