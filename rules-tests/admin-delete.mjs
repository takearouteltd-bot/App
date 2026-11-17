// An admin deletes a driver or a passenger (adminDeleteAccount) against the
// emulators (auth 9099, firestore 8080, functions 5001), project demo-tar.
// Run like account-delete.mjs (see README), on a fresh emulator.
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, getDocs, collection } from 'firebase/firestore';
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
// Firestore REST values back to plain JS.
const dec = (v) => v == null ? v : 'stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue
  : 'booleanValue' in v ? v.booleanValue : 'nullValue' in v ? null : 'timestampValue' in v ? v.timestampValue
  : 'arrayValue' in v ? (v.arrayValue.values || []).map(dec) : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)])) : v;
const plain = async (path) => Object.fromEntries(Object.entries(await adminGet(path)).map(([k, v]) => [k, dec(v)]));
const step = (s) => console.log('•', s);

const A = mk('admin'), O = mk('owner'), D = mk('driver'), R = mk('rider');
const adm = await createUserWithEmailAndPassword(A.auth, 'admin@test.dev', 'secret123');
await adminSet(`admins/${adm.user.uid}`, { isActive: true, role: 'super_admin', name: 'Ops Admin', email: 'admin@test.dev' });
await adminSet('config/app', { currency: 'GBP' });
const created = await A.call('createFleet', { name: 'Time Taxis', ownerName: 'S', email: 'owner@test.dev', phone: '07700900001' });
const users = await (await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:query`, { method: 'POST', headers: H, body: '{}' })).json();
const ownerUser = users.userInfo.find((u) => u.email === 'owner@test.dev');
await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: H, body: JSON.stringify({ localId: ownerUser.localId, password: 'owner123' }) });
await signInWithEmailAndPassword(O.auth, 'owner@test.dev', 'owner123');

step('fleet driver with private details, documents, wallet, membership paid from the wallet, trips');
const d = await createUserWithEmailAndPassword(D.auth, 'drv@test.dev', 'secret123');
const uid = d.user.uid;
await adminSet(`drivers/${uid}`, {
  approved: true, onboardingComplete: true, onboardingStatus: 'approved', vehicleType: 'RouteMini', status: 'online',
  firstName: 'Dan', lastName: 'Driver', makeModel: 'Toyota Prius', registrationNumber: 'AB12 CDE', vehicleColor: 'Silver',
  rating: 4.8, ratingCount: 25, pcoLicenceNumber: 'PCO-998877', subscription: { status: 'active', paymentMethod: 'wallet_deduction' },
});
await adminSet(`driverPrivate/${uid}`, {
  phoneNumber: '07700900222', email: 'dan@private.dev', accountDetails: { sortCode: '123456', accountNumber: '12345678' },
  nin: 'AB123456C', dob: '1980-01-02', address: '1 High Street, Redditch', emergencyContact: { name: 'Em', phone: '07700900333' },
});
await adminSet(`driverFiles/${uid}`, { motUrl: 'https://x/mot.jpg', driverLicenseFrontUrl: 'https://x/lic.jpg' });
await adminSet(`pushTokens/${uid}`, { tokens: ['x'] });
await adminSet(`driverLocations/${uid}`, { lat: 1 });
await adminSet(`driverWallets/${uid}`, { availableBalance: 12.5 });
await adminSet(`driverWallets/${uid}/transactions/sub1`, { type: 'subscription_deduction', amount: -10, plan: 'monthly' });
await adminSet('driverPayouts/p1', { driverId: uid, amount: 5, status: 'pending_admin', bankDetails: { accountNumber: '12345678' } });
await adminSet('rides/done1', { driverId: uid, riderId: 'someone', status: 'completed', fare: { total: 9 } });
await adminSet('rides/gone1', { driverId: uid, riderId: 'someone', status: 'cancelled' });
await adminSet('rides/live1', { driverId: uid, riderId: 'someone', status: 'ongoing' });
await D.call('requestFleetJoin', { code: created.joinCode });
await O.call('decideFleetDriver', { driverId: uid, approve: true, driverType: 'company' });

const why = { uid, role: 'driver', reason: 'No longer works for Time Taxis' };

step('refused: not an admin (the driver, fleet staff)');
await assert.rejects(D.call('adminDeleteAccount', why), /Admins only/);
await assert.rejects(O.call('adminDeleteAccount', why), /Admins only/);
step('refused: no reason, wrong role, unknown account, fleet staff login, own login');
await assert.rejects(A.call('adminDeleteAccount', { ...why, reason: '' }), /reason/);
await assert.rejects(A.call('adminDeleteAccount', { ...why, role: 'boss' }), /driver or a passenger/);
await assert.rejects(A.call('adminDeleteAccount', { ...why, role: 'rider' }), /No such passenger/);
await assert.rejects(A.call('adminDeleteAccount', { ...why, uid: 'nobody' }), /No such driver/);
await adminSet(`drivers/${ownerUser.localId}`, { firstName: 'Owner drives too' });
await assert.rejects(A.call('adminDeleteAccount', { ...why, uid: ownerUser.localId }), /fleet staff or a TakeARoute admin/);
await assert.rejects(A.call('adminDeleteAccount', { ...why, uid: adm.user.uid }), /your own admin login/);

step('refused during a live trip, even with force');
await assert.rejects(A.call('adminDeleteAccount', why), /trip booked or in progress/);
await assert.rejects(A.call('adminDeleteAccount', { ...why, force: true }), /trip booked or in progress/);
await adminSet('rides/live1', { status: 'completed' }, true);

step('money in the wallet: refused, but an admin may override it');
const err = await A.call('adminDeleteAccount', why).catch((e) => e);
assert.match(err.message, /12\.50 in their wallet/);
assert.deepEqual(err.details, { reason: 'wallet_balance', canForce: true });
step('a withdrawal on its way is never overridden');
await assert.rejects(A.call('adminDeleteAccount', { ...why, force: true }), /withdrawal to their bank is still being paid/);
await adminSet('driverPayouts/p1', { status: 'completed' }, true);
assert.equal(await exists(`archivedAccounts/${uid}`), false, 'nothing archived by a refused delete');

step('deleted with force: records and sign-in gone; rides, payout amount and membership payment kept');
const res = await A.call('adminDeleteAccount', { ...why, force: true });
assert.deepEqual(res, { ok: true, archived: true, forced: ['wallet_balance'] });
for (const p of [`drivers/${uid}`, `driverPrivate/${uid}`, `driverFiles/${uid}`, `riderPublic/${uid}`, `pushTokens/${uid}`, `driverLocations/${uid}`, `driverWallets/${uid}`]) {
  assert.equal(await exists(p), false, p + ' still there');
}
for (const id of ['done1', 'gone1', 'live1']) {
  const ride = await plain(`rides/${id}`);
  assert.equal(ride.driverId, uid, `${id} kept, still keyed by the driver`);
}
const p1 = await plain('driverPayouts/p1');
assert.equal(p1.bankDetails, undefined); assert.equal(p1.amount, 5);
const alert = await plain(`paymentAlerts/account_deleted_in_credit_${uid}`);
assert.equal(alert.amount, 12.5); assert.equal(alert.status, 'open');
const mp = await plain('membershipPayments/wallet_sub1');
assert.equal(mp.driverId, uid); assert.equal(mp.accountDeleted, true); assert.equal(mp.amount, 10);
assert.ok(mp.phoneHash, 'linked by a phone hash');
assert.ok(!JSON.stringify(mp).includes('7700900222'), 'no number on the membership payment');
await assert.rejects(signInWithEmailAndPassword(mk('again').auth, 'drv@test.dev', 'secret123'));

step('archive record: who they were, and nothing more');
const arc = await plain(`archivedAccounts/${uid}`);
assert.equal(arc.uid, uid); assert.equal(arc.role, 'driver'); assert.deepEqual(arc.roles, ['driver']);
assert.equal(arc.name, 'Dan Driver'); assert.equal(arc.phone, '+447700900222'); assert.equal(arc.email, 'dan@private.dev');
assert.deepEqual(arc.vehicle, { makeModel: 'Toyota Prius', registration: 'AB12 CDE', type: 'RouteMini', colour: 'Silver' });
assert.equal(arc.fleetId, created.fleetId); assert.equal(arc.fleetName, 'Time Taxis'); assert.equal(arc.driverType, 'company');
assert.deepEqual(arc.approval, { approved: true, onboardingStatus: 'approved', onboardingComplete: true, blocked: false });
assert.equal(arc.rating, 4.8); assert.equal(arc.ratingCount, 25);
assert.deepEqual(arc.trips, { asDriver: 3, completedAsDriver: 2, asRider: 0, completedAsRider: 0 });
assert.equal(arc.walletBalance, 12.5); assert.deepEqual(arc.forced, ['wallet_balance']);
assert.deepEqual(arc.deletedBy, { uid: adm.user.uid, name: 'Ops Admin', email: 'admin@test.dev' });
assert.equal(arc.reason, why.reason); assert.equal(arc.status, 'deleted');
assert.ok(arc.createdAt && arc.deletedAt);
const text = JSON.stringify(arc);
for (const bad of ['123456', '12345678', 'AB123456C', '1980', 'High Street', 'Em', '07700900333', 'https://', 'PCO-998877', 'done1', 'sortCode', 'nin', 'dob', 'address']) {
  assert.ok(!text.includes(bad), `archive must not hold ${bad}`);
}
assert.deepEqual(Object.keys(arc).sort(), ['approval', 'createdAt', 'deletedAt', 'deletedBy', 'driverType', 'email', 'fleetId', 'fleetName', 'forced',
  'name', 'phone', 'rating', 'ratingCount', 'reason', 'riderBlocked', 'role', 'roles', 'status', 'trips', 'uid', 'vehicle', 'walletBalance'].sort());

step('archive readable by the admin, not by a passenger or fleet staff');
assert.equal((await getDoc(doc(A.db, `archivedAccounts/${uid}`))).data().name, 'Dan Driver');
assert.equal((await getDocs(collection(A.db, 'archivedAccounts'))).size, 1);
await assert.rejects(getDoc(doc(O.db, `archivedAccounts/${uid}`)));
await assert.rejects(setDoc(doc(A.db, `archivedAccounts/${uid}`), { name: 'x' }));

step('a passenger: refused while a trip is booked, then deleted with an archive record');
const r = await createUserWithEmailAndPassword(R.auth, 'pat@test.dev', 'secret123');
const rid = r.user.uid;
await adminSet(`riders/${rid}`, { fullName: 'Pat Passenger', phoneNumber: '+447700900444', rating: 5, ratingCount: 3 });
await adminSet(`riders/${rid}/savedPlaces/home`, { label: 'Home', address: '2 Low Road' });
await adminSet('rides/pat1', { riderId: rid, status: 'completed' });
await adminSet('rides/pat2', { riderId: rid, status: 'scheduled' });
const whyR = { uid: rid, role: 'rider', reason: 'Abusive to drivers' };
await assert.rejects(R.call('adminDeleteAccount', whyR), /Admins only/);
await assert.rejects(A.call('adminDeleteAccount', { ...whyR, force: true }), /trip booked or in progress/);
await adminSet('rides/pat2', { status: 'cancelled' }, true);
assert.deepEqual(await A.call('adminDeleteAccount', whyR), { ok: true, archived: true, forced: [] });
assert.equal(await exists(`riders/${rid}`), false);
assert.equal(await exists(`riders/${rid}/savedPlaces/home`), false);
assert.equal((await plain('rides/pat1')).riderId, rid);
const arcR = await plain(`archivedAccounts/${rid}`);
assert.equal(arcR.role, 'rider'); assert.equal(arcR.name, 'Pat Passenger'); assert.equal(arcR.phone, '+447700900444');
assert.equal(arcR.email, 'pat@test.dev'); assert.equal(arcR.vehicle, null); assert.equal(arcR.approval, null);
assert.equal(arcR.rating, 5); assert.deepEqual(arcR.trips, { asDriver: 0, completedAsDriver: 0, asRider: 2, completedAsRider: 1 });
assert.equal(arcR.walletBalance, null); assert.equal(arcR.reason, 'Abusive to drivers');
assert.ok(!JSON.stringify(arcR).includes('Low Road'), 'saved places are not archived');

step('self-delete still works and leaves no archive record');
const s = await createUserWithEmailAndPassword(mk('self').auth, 'self@test.dev', 'secret123');
const S = mk('self2'); await signInWithEmailAndPassword(S.auth, 'self@test.dev', 'secret123');
await adminSet(`riders/${s.user.uid}`, { fullName: 'Sam Self' });
assert.deepEqual(await S.call('deleteMyAccount', {}), { ok: true });
assert.equal(await exists(`riders/${s.user.uid}`), false);
assert.equal(await exists(`archivedAccounts/${s.user.uid}`), false);
console.log('ALL PASS');
process.exit(0);
