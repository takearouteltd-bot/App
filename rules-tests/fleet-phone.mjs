// Fleet office phone (functions/fleetPhone.js) against the emulators, with
// a fake Twilio on :8999. Needs, for this run only:
//   functions/.secret.local  TWILIO_SID=AC + 32 zeros, TWILIO_TOKEN=testtoken,
//                            TWILIO_NUMBER=+441000000000 (+ Stripe dummies)
//   functions/.env.local     TWILIO_API_BASE=http://127.0.0.1:8999
//                            TWILIO_NUMBERS_BASE=http://127.0.0.1:8999
// firebase emulators:exec --config <with auth 9099, pubsub 8085> --only
//   auth,firestore,functions,pubsub --project demo-tar
//   "node rules-tests/fleet-phone.mjs"
import http from 'node:http';
import crypto from 'node:crypto';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import assert from 'node:assert/strict';

const PROJECT = 'demo-tar';
const TOKEN = 'testtoken';
const APP_NUMBER = '+441000000000';
const VOICE = `http://127.0.0.1:5001/${PROJECT}/us-central1/fleetVoice`;

// ---------- fake Twilio
const seen = [];
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    const form = Object.fromEntries(new URLSearchParams(body));
    seen.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), form });
    const p = url.pathname;
    const json = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.method === 'DELETE') { res.writeHead(204); return res.end(); }
    if (p.endsWith('/Keys.json')) return json({ sid: 'SK1', secret: 'keysecret' });
    if (p.endsWith('/Applications.json') || /Applications\/AP1\.json$/.test(p)) return json({ sid: 'AP1' });
    if (p.endsWith('/IncomingPhoneNumbers.json') && req.method === 'GET') return json({ incoming_phone_numbers: [{ sid: 'PN1', phone_number: APP_NUMBER }] });
    if (p.endsWith('/IncomingPhoneNumbers.json')) return json({ sid: 'PN2', phone_number: form.PhoneNumber });
    if (/IncomingPhoneNumbers\/PN\d\.json$/.test(p)) return json({ sid: 'PN1' });
    if (p.endsWith('/AvailablePhoneNumbers/GB/Local.json')) return json({ available_phone_numbers: [{ phone_number: '+441527000111', friendly_name: '01527 000111', locality: 'Redditch' }] });
    if (p.endsWith('/RegulatoryCompliance/Bundles')) return json({ results: [{ sid: 'BU1' }] });
    if (p.endsWith('/Addresses.json')) return json({ addresses: [{ sid: 'AD1' }] });
    if (p.endsWith('/Calls.json')) return json({ sid: 'CAtest' });
    json({ message: 'unexpected ' + p }, 404);
  });
});
await new Promise((r) => fake.listen(8999, '127.0.0.1', r));

// ---------- clients
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
  : v === null ? { nullValue: null } : typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } } : { stringValue: String(v) };
const dec = (v) => { const [k, x] = Object.entries(v)[0]; return k === 'mapValue' ? Object.fromEntries(Object.entries(x.fields || {}).map(([a, b]) => [a, dec(b)])) : k === 'integerValue' ? Number(x) : k === 'nullValue' ? null : x; };
async function adminSet(path, data, mask = false) {
  const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)]));
  const r = await fetch(`${REST}/${path}${mask ? '?' + Object.keys(data).map((k) => 'updateMask.fieldPaths=' + k).join('&') : ''}`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields }) });
  if (!r.ok) throw new Error(await r.text());
}
async function adminGet(path) {
  const r = await fetch(`${REST}/${path}`, { headers: H });
  if (!r.ok) return null;
  return Object.fromEntries(Object.entries((await r.json()).fields || {}).map(([k, v]) => [k, dec(v)]));
}
const authApi = (path, body) => fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) }).then((r) => r.json());
async function setPassword(email, password) {
  const u = (await authApi('accounts:query', {})).userInfo.find((x) => x.email === email);
  await authApi('accounts:update', { localId: u.localId, password });
  return u.localId;
}
// A Twilio webhook, signed the way Twilio signs it.
async function twilio(query, params, sign = true) {
  const url = VOICE + '?' + new URLSearchParams(query).toString();
  const data = Object.keys(params).sort().reduce((a, k) => a + k + params[k], url);
  const sig = crypto.createHmac('sha1', TOKEN).update(Buffer.from(data, 'utf-8')).digest('base64');
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(sign ? { 'X-Twilio-Signature': sig } : {}) }, body: new URLSearchParams(params).toString() });
  return { status: r.status, body: await r.text() };
}
const step = (s) => console.log('•', s);

const A = mk('admin'), O = mk('owner'), OP = mk('operator'), O2 = mk('owner2');
const adm = await createUserWithEmailAndPassword(A.auth, 'admin@test.dev', 'secret123');
await adminSet(`admins/${adm.user.uid}`, { isActive: true, role: 'super_admin' });
await adminSet('config/app', { currency: 'GBP' });
const f = await A.call('createFleet', { name: 'A2B Taxis', ownerName: 'S', email: 'owner@test.dev', phone: '07700900001', billingPlan: 'monthly', monthlyFee: 500 });
const ownerUid = await setPassword('owner@test.dev', 'owner123');
await signInWithEmailAndPassword(O.auth, 'owner@test.dev', 'owner123');
await O.call('addFleetOperator', { email: 'op@test.dev', name: 'Olivia' }).catch(async () => O.call('addFleetOperator', { email: 'op@test.dev', name: 'Olivia', role: 'operator' }));
const opUid = await setPassword('op@test.dev', 'op12345');
await signInWithEmailAndPassword(OP.auth, 'op@test.dev', 'op12345');

step('no line yet: no browser phone; only an admin can set one up');
await assert.rejects(O.call('fleetPhoneToken', {}), /not set up/);
await assert.rejects(O.call('adminFleetPhoneUseAppNumber', { fleetId: f.fleetId }));

step('admin lends the app number to A2B; the number is pointed at fleetVoice');
assert.equal((await A.call('adminFleetPhoneUseAppNumber', { fleetId: f.fleetId })).number, APP_NUMBER);
const routed = seen.find((s) => s.path.endsWith('/IncomingPhoneNumbers/PN1.json'));
assert.equal(routed.form.VoiceUrl, VOICE + '?step=incoming'); assert.equal(routed.form.StatusCallback, VOICE + '?step=status');
let fleet = await adminGet(`fleets/${f.fleetId}`);
assert.equal(fleet.phoneLine.number, APP_NUMBER); assert.equal(fleet.phoneLine.shared, true);

step('owner saves the taxi number; operators cannot; TakeARoute number refused');
await assert.rejects(OP.call('saveFleetPhoneSettings', { ownNumber: '01527 111222' }), /owner/);
await assert.rejects(O.call('saveFleetPhoneSettings', { ownNumber: APP_NUMBER }), /TakeARoute number/);
await O.call('saveFleetPhoneSettings', { ownNumber: '01527 111222', lineType: 'landline' });
fleet = await adminGet(`fleets/${f.fleetId}`);
assert.equal(fleet.phoneLine.ownNumber, '+441527111222'); assert.equal(fleet.phoneLine.number, APP_NUMBER);

step('browser phone token: signed JWT for this operator, voice keys made once');
const tok = await OP.call('fleetPhoneToken', {});
const [h, b, s] = tok.token.split('.');
const payload = JSON.parse(Buffer.from(b, 'base64url').toString());
assert.equal(payload.grants.identity, `fm_${opUid}`); assert.equal(payload.grants.voice.outgoing.application_sid, 'AP1');
assert.equal(payload.iss, 'SK1'); assert.ok(payload.exp > payload.iat);
assert.equal(crypto.createHmac('sha256', 'keysecret').update(`${h}.${b}`).digest('base64url'), s);
await O.call('fleetPhoneToken', {});
assert.equal(seen.filter((x) => x.path.endsWith('/Keys.json')).length, 1, 'key made once');
assert.equal(await adminGet('serverOnly/twilioVoice').then((d) => d.keySid), 'SK1');

step('unsigned or wrongly signed webhooks are refused');
assert.equal((await twilio({ step: 'incoming' }, { From: '+447700900123', To: APP_NUMBER, CallSid: 'CAx' }, false)).status, 403);

step('known caller: both available operators ring with the caller\'s name; logged as ringing');
await adminSet(`fleets/${f.fleetId}/customers/+447700900123`, { phone: '+447700900123', name: 'Ann Smith' });
await O.call('setFleetPhoneAvailable', { available: true });
await OP.call('setFleetPhoneAvailable', { available: true });
let r = await twilio({ step: 'incoming' }, { From: '+447700900123', To: APP_NUMBER, CallSid: 'CA1' });
assert.equal(r.status, 200);
assert.match(r.body, /Thank you for calling A2B Taxis/);
assert.match(r.body, new RegExp(`<Identity>fm_${ownerUid}</Identity>`)); assert.match(r.body, new RegExp(`<Identity>fm_${opUid}</Identity>`));
assert.match(r.body, /<Parameter name="name" value="Ann Smith"\/>/);
assert.match(r.body, /step=after/);
let c1 = await adminGet(`fleets/${f.fleetId}/phoneCalls/CA1`);
assert.equal(c1.status, 'ringing'); assert.equal(c1.known, true); assert.equal(c1.from, '+447700900123');

step('operator picks up: answered by them; then completed with its length');
await twilio({ step: 'answered', fleet: f.fleetId, call: 'CA1' }, { CallSid: 'CAchild', To: `client:fm_${opUid}`, CallStatus: 'in-progress' });
c1 = await adminGet(`fleets/${f.fleetId}/phoneCalls/CA1`);
assert.equal(c1.status, 'answered'); assert.equal(c1.answeredBy, opUid); assert.equal(c1.answeredByName, 'Olivia');
step('while Olivia is on that call, the next call rings only the free operator (Sarfaraz: busy ones are skipped)');
assert.equal((await adminGet(`fleetManagers/${opUid}`)).phoneOnCall.callSid, 'CA1');
r = await twilio({ step: 'incoming' }, { From: '+447700900124', To: APP_NUMBER, CallSid: 'CA1b' });
assert.match(r.body, new RegExp(`<Identity>fm_${ownerUid}</Identity>`)); assert.doesNotMatch(r.body, new RegExp(`fm_${opUid}`));
await twilio({ step: 'status' }, { CallSid: 'CA1b', To: APP_NUMBER, CallStatus: 'completed' });
r = await twilio({ step: 'after', fleet: f.fleetId, round: '1' }, { CallSid: 'CA1', DialCallStatus: 'completed', DialCallDuration: '95' });
assert.equal((await adminGet(`fleetManagers/${opUid}`)).phoneOnCall, undefined, 'free again once the call ends');
assert.match(r.body, /<Hangup\/>/);
c1 = await adminGet(`fleets/${f.fleetId}/phoneCalls/CA1`);
assert.equal(c1.status, 'completed'); assert.equal(c1.seconds, 95);

step('nobody answers: hold music and ring again, missed after 4 rounds');
r = await twilio({ step: 'incoming' }, { From: '+447700900456', To: APP_NUMBER, CallSid: 'CA2' });
assert.match(r.body, /<Dial/);
let round = 1;
for (; round < 4; round++) {
  r = await twilio({ step: 'after', fleet: f.fleetId, round: String(round) }, { CallSid: 'CA2', DialCallStatus: 'no-answer' });
  assert.match(r.body, /Please hold/); assert.match(r.body, /<Play>/); assert.match(r.body, new RegExp(`round=${round + 1}`));
  r = await twilio({ step: 'incoming', fleet: f.fleetId, round: String(round + 1) }, { From: '+447700900456', To: APP_NUMBER, CallSid: 'CA2' });
  assert.match(r.body, /<Dial/); assert.doesNotMatch(r.body, /Thank you for calling/);
}
r = await twilio({ step: 'after', fleet: f.fleetId, round: '4' }, { CallSid: 'CA2', DialCallStatus: 'no-answer' });
assert.match(r.body, /We will call you back/);
const c2 = await adminGet(`fleets/${f.fleetId}/phoneCalls/CA2`);
assert.equal(c2.status, 'missed'); assert.equal(c2.known, false);

step('everyone away: caller holds; hanging up while waiting counts as missed');
await O.call('setFleetPhoneAvailable', { available: false });
await OP.call('setFleetPhoneAvailable', { available: false });
r = await twilio({ step: 'incoming' }, { From: '+447700900789', To: APP_NUMBER, CallSid: 'CA3' });
assert.match(r.body, /All our operators are busy/); assert.doesNotMatch(r.body, /<Dial/);
await twilio({ step: 'status' }, { CallSid: 'CA3', To: APP_NUMBER, CallStatus: 'completed' });
assert.equal((await adminGet(`fleets/${f.fleetId}/phoneCalls/CA3`)).status, 'missed');

step('someone on a live app trip ringing the app number reaches their driver, not the office');
const RD = mk('rider');
const rider = await createUserWithEmailAndPassword(RD.auth, 'rider@test.dev', 'secret123');
await adminSet(`riders/${rider.user.uid}`, { fullName: 'Pat', phoneNumber: '+447700900321', currentRideId: 'trip1' });
await adminSet('drivers/drv1', { phoneNumber: '+447700900999', firstName: 'Dan' });
await adminSet('rides/trip1', { riderId: rider.user.uid, driverId: 'drv1', status: 'arrived' });
r = await twilio({ step: 'incoming' }, { From: '+447700900321', To: APP_NUMBER, CallSid: 'CA4' });
assert.match(r.body, /Connecting you to your trip/); assert.match(r.body, /\+447700900999<\/Dial>/);
assert.equal(await adminGet(`fleets/${f.fleetId}/phoneCalls/CA4`), null, 'not logged for the fleet');

step('forwarding test: we ring the taxi number; it comes back forwarded, caller number shown -> connected');
await assert.rejects(OP.call('testFleetForwarding', {}), /owner/);
await O.call('testFleetForwarding', {});
const test = seen.filter((x) => x.path.endsWith('/Calls.json')).pop();
assert.equal(test.form.To, '+441527111222'); assert.equal(test.form.From, APP_NUMBER);
r = await twilio({ step: 'incoming' }, { From: APP_NUMBER, To: APP_NUMBER, CallSid: 'CA5' });
assert.match(r.body, /connected to TakeARoute/);
fleet = await adminGet(`fleets/${f.fleetId}`);
assert.equal(fleet.phoneLine.forwarding.status, 'connected'); assert.equal(fleet.phoneLine.forwarding.callerIdShown, true);
assert.equal(fleet.phoneLine.forwardingTest, undefined);
step('forwarding test where the network shows the taxi number instead: connected, caller number hidden');
await O.call('testFleetForwarding', {});
await twilio({ step: 'incoming' }, { From: '+441527111222', To: APP_NUMBER, CallSid: 'CA6' });
assert.equal((await adminGet(`fleets/${f.fleetId}`)).phoneLine.forwarding.callerIdShown, false);

step('calling out from the dashboard: own customers and drivers only, shown as the fleet line');
r = await twilio({ step: 'outgoing' }, { CallSid: 'CA7', From: `client:fm_${opUid}`, To: '07700 900123' });
assert.match(r.body, new RegExp(`<Dial callerId="\\${APP_NUMBER}"`)); assert.match(r.body, /\+447700900123<\/Dial>/);
assert.equal((await adminGet(`fleets/${f.fleetId}/phoneCalls/CA7`)).direction, 'out');
assert.equal((await adminGet(`fleetManagers/${opUid}`)).phoneOnCall.callSid, 'CA7', 'busy while calling out');
await twilio({ step: 'outDone', fleet: f.fleetId, uid: opUid }, { CallSid: 'CA7', DialCallStatus: 'completed', DialCallDuration: '30' });
assert.equal((await adminGet(`fleetManagers/${opUid}`)).phoneOnCall, undefined);
assert.equal((await adminGet(`fleets/${f.fleetId}/phoneCalls/CA7`)).seconds, 30);
r = await twilio({ step: 'outgoing' }, { CallSid: 'CA8', From: `client:fm_${opUid}`, To: '+447700900555' });
assert.match(r.body, /Only your own customers and drivers/); assert.doesNotMatch(r.body, /<Dial/);
r = await twilio({ step: 'outgoing' }, { CallSid: 'CA9', From: 'client:fm_nobody', To: '+447700900123' });
assert.match(r.body, /can&apos;t call from here/);

step('call log for the office, newest first');
const log = await OP.call('listFleetPhoneCalls', {});
assert.equal(log.calls.length, 5, "CA1, CA1b, CA2, CA3 in and CA7 out; refused and test calls are not logged"); assert.ok(log.calls[0].startedAt >= log.calls[log.calls.length - 1].startedAt);

step('monthly phone totals per fleet: minutes rounded up per call, hold included, missed counted, never twice');
await twilio({ step: 'status' }, { CallSid: 'CA1', To: APP_NUMBER, CallStatus: 'completed', CallDuration: '120' });
await twilio({ step: 'status' }, { CallSid: 'CA1', To: APP_NUMBER, CallStatus: 'completed', CallDuration: '120' });
await twilio({ step: 'status' }, { CallSid: 'CA2', To: APP_NUMBER, CallStatus: 'completed', CallDuration: '130' });
const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
const usage = (await adminGet(`fleets/${f.fleetId}`)).phoneUsage[month];
assert.deepEqual({ calls: usage.calls, inMinutes: usage.inMinutes, outMinutes: usage.outMinutes, missed: usage.missed }, { calls: 5, inMinutes: 5, outMinutes: 1, missed: 3 });

step('a second fleet cannot borrow the app number; admin searches and buys it a number; release returns it');
const f2 = await A.call('createFleet', { name: 'Time Taxis', ownerName: 'T', email: 'owner2@test.dev', phone: '07700900002' });
await assert.rejects(A.call('adminFleetPhoneUseAppNumber', { fleetId: f2.fleetId }), /already uses/);
const found = await A.call('adminFleetPhoneSearch', { areaCode: '01527' });
assert.equal(found.numbers[0].number, '+441527000111');
assert.equal(seen.filter((x) => x.path.endsWith('/AvailablePhoneNumbers/GB/Local.json')).pop().query.Contains, '+441527*');
await A.call('adminFleetPhoneBuy', { fleetId: f2.fleetId, number: '+441527000111' });
const buy = seen.filter((x) => x.path.endsWith('/IncomingPhoneNumbers.json') && x.method === 'POST').pop();
assert.equal(buy.form.BundleSid, 'BU1'); assert.equal(buy.form.AddressSid, 'AD1'); assert.equal(buy.form.VoiceUrl, VOICE + '?step=incoming');
let f2doc = await adminGet(`fleets/${f2.fleetId}`);
assert.equal(f2doc.phoneLine.number, '+441527000111'); assert.equal(f2doc.phoneLine.shared, false);
await assert.rejects(A.call('adminFleetPhoneBuy', { fleetId: f2.fleetId, number: '+441527000222' }), /already has a line/);
r = await twilio({ step: 'incoming' }, { From: '+447700900123', To: '+441527000111', CallSid: 'CB1' });
assert.match(r.body, /Thank you for calling Time Taxis/);
assert.match(r.body, /busy/, 'no Time Taxis operator available, A2B operators are not rung');
await A.call('adminFleetPhoneRelease', { fleetId: f2.fleetId });
assert.ok(seen.some((x) => x.method === 'DELETE' && x.path.endsWith('/IncomingPhoneNumbers/PN2.json')));
assert.equal((await adminGet(`fleets/${f2.fleetId}`)).phoneLine, undefined);
r = await twilio({ step: 'incoming' }, { From: '+447700900123', To: '+441527000111', CallSid: 'CB2' });
assert.match(r.body, /not in use/);

console.log('ALL PHONE CHECKS PASSED');
fake.close();
process.exit(0);
