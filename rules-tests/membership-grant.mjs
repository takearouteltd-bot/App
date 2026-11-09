// An admin gives a driver the paid membership (adminSetDriverMembership, fleet.js).
// Emulators only, same set-up as account-delete.mjs (see README).
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, updateDoc } from 'firebase/firestore';
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
const enc = (v) => (typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { integerValue: String(v) }
  : v === null ? { nullValue: null } : typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } } : { stringValue: String(v) });
const adminSet = async (path, data) => {
  const r = await fetch(`${REST}/${path}`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields: enc(data).mapValue.fields }) });
  if (!r.ok) throw new Error(await r.text());
};
const adminGet = async (path) => (await (await fetch(`${REST}/${path}`, { headers: H })).json()).fields || {};
const val = (f) => (f ? Object.values(f)[0] : undefined);
const sub = async (u) => (await adminGet(`drivers/${u}`)).subscription?.mapValue?.fields;
const step = (s) => console.log('•', s);

const A = mk('admin'), D = mk('driver'), E = mk('existing');
const adm = await createUserWithEmailAndPassword(A.auth, 'admin@test.dev', 'secret123');
await adminSet(`admins/${adm.user.uid}`, { isActive: true, role: 'super_admin' });
await adminSet('config/app', { currency: 'GBP' });
const d = (await createUserWithEmailAndPassword(D.auth, 'd@test.dev', 'secret123')).user.uid;
const e = (await createUserWithEmailAndPassword(E.auth, 'e@test.dev', 'secret123')).user.uid;
const OWED = { status: 'active', tier: 'monthly', amount: 25, paymentMethod: 'wallet_deduction', debtAmount: 25, lastPaidAt: null, graceUntil: null };
await adminSet(`drivers/${d}`, { approved: true, onboardingComplete: true, status: 'offline', subscription: OWED });
await adminSet(`drivers/${e}`, { approved: true, status: 'offline' });
const set = (driverId, granted) => A.call('adminSetDriverMembership', { driverId, granted });

step('admins only');
await assert.rejects(D.call('adminSetDriverMembership', { driverId: d, granted: true }));
step('a driver cannot give it to themselves');
await assert.rejects(updateDoc(doc(D.db, 'drivers', d), { 'subscription.paymentMethod': 'admin_granted', 'subscription.debtAmount': 0 }));
await assert.rejects(updateDoc(doc(D.db, 'drivers', d), { subscriptionBeforeGrant: { status: 'active' } }));
step('owing the first month stops them going online');
await assert.rejects(updateDoc(doc(D.db, 'drivers', d), { status: 'online' }));

step('switched on: active, nothing owed, can go online');
assert.equal((await set(d, true)).changed, true);
let s = await sub(d);
assert.equal(val(s.status), 'active'); assert.equal(val(s.paymentMethod), 'admin_granted'); assert.equal(Number(val(s.debtAmount)), 0);
assert.equal(val(s.nextBillingDate), null);
await updateDoc(doc(D.db, 'drivers', d), { status: 'online' });

step('pressing it twice changes nothing');
assert.equal((await set(d, true)).changed, false);

step('switched off: what they had before comes back');
assert.equal((await set(d, false)).changed, true);
s = await sub(d);
assert.equal(val(s.paymentMethod), 'wallet_deduction'); assert.equal(Number(val(s.debtAmount)), 25);
assert.equal((await adminGet(`drivers/${d}`)).subscriptionBeforeGrant, undefined);

step('a driver with no membership before goes back to none');
await set(e, true); assert.equal(val((await sub(e)).paymentMethod), 'admin_granted');
await set(e, false); assert.equal(await sub(e), undefined);

step('refused: not approved, or their fleet pays');
await adminSet(`drivers/${e}`, { approved: false, status: 'offline' });
await assert.rejects(set(e, true), /Approve this driver/);
await adminSet(`drivers/${e}`, { approved: true, status: 'offline', subscription: { status: 'active', paymentMethod: 'fleet' } });
await assert.rejects(set(e, true), /fleet already pays/);
console.log('membership-grant: all passed');
process.exit(0);
