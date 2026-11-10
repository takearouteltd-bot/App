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
const del = (path) => fetch(`${REST}/${path}`, { method: 'DELETE', headers: H });
const adminGet = async (path) => (await (await fetch(`${REST}/${path}`, { headers: H })).json()).fields || {};
const val = (f) => f && (f.stringValue ?? f.integerValue ?? f.booleanValue ?? f.doubleValue ?? null);
const step = (s) => console.log('•', s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


// The fleet portal's driver numbers (fleetDriverPhones in functions/fleet.js):
// from the private record, else the app account, else the sign-in (drivers
// who signed up with their phone number). Run like booking-checks.mjs (see
// README); needs no fakes.
const O = mk('owner');
const owner = (await createUserWithEmailAndPassword(O.auth, 'owner-fp@test.dev', 'secret123')).user.uid;
await adminSet('fleets/fp1', { name: 'Phones Fleet', status: 'active', ownerUid: owner });
await adminSet(`fleetManagers/${owner}`, { fleetId: 'fp1', role: 'owner', isActive: true });

step('three drivers: number on the private record, on the app account, only on the sign-in');
await adminSet('drivers/fpPrivate', { fleetId: 'fp1', firstName: 'Priv' });
await adminSet('driverPrivate/fpPrivate', { phoneNumber: '+447700900001' });
await adminSet('drivers/fpUser', { fleetId: 'fp1', firstName: 'User' });
await adminSet('users/fpUser', { phoneNumber: '+447700900002' });
const signup = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts`, {
  method: 'POST', headers: H, body: JSON.stringify({ localId: 'fpAuth', phoneNumber: '+447700900003' }),
});
assert.ok(signup.ok, await signup.text());
await adminSet('drivers/fpAuth', { fleetId: 'fp1', firstName: 'Auth' });
await adminSet('drivers/fpNone', { fleetId: 'fp1', firstName: 'None' });
await adminSet('drivers/fpOther', { fleetId: 'other', firstName: 'Other' });
await adminSet('driverPrivate/fpOther', { phoneNumber: '+447700900009' });

const { phones } = await O.call('fleetDriverPhones', {});
assert.deepEqual(phones, { fpPrivate: '+447700900001', fpUser: '+447700900002', fpAuth: '+447700900003' });
console.log('ALL FLEET PHONE CHECKS PASSED');
process.exit(0);
