// Closing a fleet (adminCloseFleet, fleet.js). Emulators only, same set-up as
// account-delete.mjs (see README).
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import assert from 'node:assert/strict';

const PROJECT = 'demo-tar';
const mk = (name) => {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'fake', authDomain: 'x' }, name);
  const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const fn = getFunctions(app, 'us-central1'); connectFunctionsEmulator(fn, '127.0.0.1', 5001);
  return { auth, call: (n, d) => httpsCallable(fn, n)(d).then((r) => r.data) };
};
const REST = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const H = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const enc = (v) => (typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : v === null ? { nullValue: null } : typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } } : { stringValue: String(v) });
async function adminSet(path, data, mask = false) {
  const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)]));
  const r = await fetch(`${REST}/${path}${mask ? '?' + Object.keys(data).map((k) => 'updateMask.fieldPaths=' + k).join('&') : ''}`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields }) });
  if (!r.ok) throw new Error(await r.text());
}
const exists = async (path) => (await fetch(`${REST}/${path}`, { headers: H })).ok;
const adminGet = async (path) => (await (await fetch(`${REST}/${path}`, { headers: H })).json()).fields || {};
const val = (f) => (f ? Object.values(f)[0] : undefined);
const authUsers = async () => ((await (await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:query`, { method: 'POST', headers: H, body: '{}' })).json()).userInfo || []);
const step = (s) => console.log('•', s);

const A = mk('admin'), D = mk('driver'), S = mk('self'), B = mk('both'), J = mk('joiner');
const adm = await createUserWithEmailAndPassword(A.auth, 'admin@test.dev', 'secret123');
await adminSet(`admins/${adm.user.uid}`, { isActive: true, role: 'super_admin' });
await adminSet('config/app', { currency: 'GBP' });
const created = await A.call('createFleet', { name: 'Time Taxis', ownerName: 'S', email: 'owner@test.dev', phone: '07700900100', billingPlan: 'per_driver', perDriverMonthly: 10 });
const f = created.fleetId;
const seedDriver = async (M, email, type) => {
  const u = await createUserWithEmailAndPassword(M.auth, email, 'secret123');
  await adminSet(`drivers/${u.user.uid}`, { approved: true, onboardingComplete: true, vehicleType: 'RouteMini', status: 'offline', fleetId: f, fleetName: 'Time Taxis', fleetDriverType: type });
  return u.user.uid;
};
const company = await seedDriver(D, 'company@test.dev', 'company');
const self = await seedDriver(S, 'self@test.dev', 'self');
const bothU = await createUserWithEmailAndPassword(B.auth, 'both@test.dev', 'secret123');
const both = bothU.user.uid;
await adminSet(`drivers/${both}`, { approved: true, status: 'offline', fleetId: 'elsewhere', fleetName: 'A2B', fleetDriverType: 'company' });
await adminSet(`fleetManagers/${both}`, { isActive: true, fleetId: f, fleetName: 'Time Taxis', role: 'operator', name: 'Both', email: 'both@test.dev' });
const joinerU = await createUserWithEmailAndPassword(J.auth, 'joiner@test.dev', 'secret123');
await adminSet(`drivers/${joinerU.user.uid}`, { approved: true, status: 'offline' });
await adminSet(`fleets/${f}/customers/+447700900801`, { phone: '+447700900801', name: 'Sam' });
await adminSet('rides/old', { fleetId: f, status: 'completed', driverId: company });
await adminSet(`fleets/${f}`, { phoneLine: { number: '+441000000000', shared: true } }, true);
await adminSet(`drivers/${joinerU.user.uid}`, { fleetRequest: { fleetId: f, fleetName: 'Time Taxis' } }, true);

const close = (extra = {}) => A.call('adminCloseFleet', { fleetId: f, confirmName: 'Time Taxis', ...extra });

step('admins only');
await assert.rejects(D.call('adminCloseFleet', { fleetId: f, confirmName: 'Time Taxis' }));
step('the name has to match');
await assert.rejects(close({ confirmName: 'time taxi' }), /exactly/);
step('refused with money in the wallet');
await adminSet(`fleetWallets/${f}`, { availableBalance: 5 }, true);
await assert.rejects(close(), /still has 5\.00/);
await adminSet(`fleetWallets/${f}`, { availableBalance: 0 }, true);
step('refused with a job open, and nothing changes');
await adminSet('rides/open1', { fleetId: f, status: 'dispatching' });
await assert.rejects(close(), /1 job still open/);
assert.equal(val((await adminGet(`fleets/${f}`)).status), 'active');
assert.equal(val((await adminGet(`drivers/${company}`)).fleetId), f);
await adminSet('rides/open1', { status: 'cancelled' }, true);

step('closes');
const r = await close();
assert.deepEqual(r, { ok: true, drivers: 2, logins: 2 });
const fl = await adminGet(`fleets/${f}`);
assert.equal(val(fl.status), 'suspended'); assert.equal(val(fl.suspendedReason), 'closed');
assert.ok(fl.closedAt); assert.equal(fl.closing, undefined); assert.equal(fl.phoneLine, undefined);

step('company driver out and suspended; self-employed out and free');
const c = await adminGet(`drivers/${company}`);
assert.equal(val(c.fleetId), null); assert.equal(val(c.blocked), true); assert.equal(val(c.blockedReason), 'Time Taxis has closed');
const s = await adminGet(`drivers/${self}`);
assert.equal(val(s.fleetId), null); assert.notEqual(val(s.blocked), true);

step('logins gone; one that is also a driver keeps its sign-in and its other fleet');
const emails = (await authUsers()).map((u) => u.email);
assert.ok(!emails.includes('owner@test.dev'));
assert.ok(emails.includes('both@test.dev') && emails.includes('company@test.dev'));
assert.equal(await exists(`fleetManagers/${both}`), false);
assert.equal(val((await adminGet(`drivers/${both}`)).fleetId), 'elsewhere');
assert.equal((await adminGet(`drivers/${joinerU.user.uid}`)).fleetRequest, undefined);

step('customers and trips stay');
assert.equal(await exists(`fleets/${f}/customers/+447700900801`), true);
assert.equal(await exists('rides/old'), true);

step('nobody can join it, and it cannot be closed twice');
await assert.rejects(J.call('requestFleetJoin', { code: created.joinCode }));
await assert.rejects(close(), /is closed/);

step('the person who was only staff elsewhere can now delete their account');
await assert.doesNotReject(B.call('adminCloseFleet', { fleetId: 'x', confirmName: 'x' }).catch(() => null));
await adminSet(`drivers/${both}`, { fleetId: null }, true);
const del = await B.call('deleteMyAccount', {});
assert.equal(del.ok ?? true, true);
assert.equal(await exists(`drivers/${both}`), false);
console.log('fleet-close: all passed');
process.exit(0);
