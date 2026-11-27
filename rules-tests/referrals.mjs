// Invite a friend (functions/referrals.js) and ride credit at charge time
// (chargeOnRideCompletion, index.js), through the real rules and functions.
// Same set-up as tips.mjs (see README): STRIPE_API_BASE=http://127.0.0.1:8999
// in functions/.env.local and dummy Stripe secrets in functions/.secret.local.
// Fake Stripe on :8999. In CI: rules-tests/ci-suite.sh referrals.
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import assert from 'node:assert/strict';
import http from 'node:http';

/* ------------------------------ fake Stripe ------------------------------ */
// PaymentIntents: holds are seeded here by id with the card's fingerprint;
// capture of pi_fail_* is declined. Payment methods: each customer's cards.
const intents = {};
const customerCards = {};
const captures = [];
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const params = new URLSearchParams(body);
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/v1/payment_methods') {
      const cards = customerCards[url.searchParams.get('customer')] || [];
      return json(res, 200, { object: 'list', data: cards.map((fp, i) => ({ id: `pm_${fp}_${i}`, card: { fingerprint: fp, last4: '4242', brand: 'visa' } })), has_more: false });
    }
    const m = url.pathname.match(/^\/v1\/payment_intents\/([^/]+)(?:\/(capture|cancel))?$/);
    if (!m) return json(res, 404, { error: { message: 'not faked' } });
    const [, id, op] = m;
    const pi = intents[id];
    if (!pi) return json(res, 404, { error: { type: 'invalid_request_error', message: 'No such payment_intent' } });
    if (!op) return json(res, 200, pi);
    if (op === 'capture') {
      const amount = Number(params.get('amount_to_capture'));
      captures.push({ id, amount });
      if (id.startsWith('pi_fail')) return json(res, 402, { error: { type: 'card_error', code: 'card_declined', message: 'Your card was declined.' } });
      pi.status = 'succeeded';
      pi.amount_received = amount;
    }
    if (op === 'cancel') pi.status = 'canceled';
    return json(res, 200, pi);
  });
});
await new Promise((r) => fake.listen(8999, '127.0.0.1', r));

/* ------------------------------ harness ------------------------------ */
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
const get = async (path) => {
  const fields = (await (await fetch(`${REST}/${path}`, { headers: H })).json()).fields;
  return fields ? Object.fromEntries(Object.entries(fields).map(([k, x]) => [k, val(x)])) : null;
};
const authApi = (path, payload) => fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/${path}`,
  { method: 'POST', headers: H, body: JSON.stringify(payload) }).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, what, tries = 720) {
  for (let i = 0; i < tries; i++) {
    const got = await check();
    if (got) return got;
    await sleep(250);
  }
  throw new Error('Timed out waiting for ' + what);
}
let steps = 0;
const step = (s) => { steps += 1; console.log('•', s); };
async function refused(promise, pattern, code) {
  try {
    await promise;
  } catch (e) {
    if (code) assert.equal(e.code, code, e.message);
    if (pattern) assert.match(e.message, pattern);
    return e;
  }
  throw new Error('expected a refusal');
}

/* ------------------------------ people ------------------------------ */
// A passenger signed in with a phone number: an email login for the test,
// with the number set on the account as a phone sign-in would.
let phoneN = 100;
async function passenger(name, { phone = true, rider = {} } = {}) {
  const c = mk(name);
  const uid = (await createUserWithEmailAndPassword(c.auth, `${name}@ref.dev`, 'secret123')).user.uid;
  phoneN += 1;
  const number = `+4477009${String(phoneN).padStart(5, '0')}`;
  if (phone) await authApi('accounts:update', { localId: uid, phoneNumber: number });
  await adminSet(`riders/${uid}`, { fullName: name, stripeCustomerId: `cus_${name}`, defaultPaymentMethodId: `pm_${name}`, ...rider });
  return { ...c, uid, number };
}

const CFG = { enabled: 1, newRiderReward: 5, referrerReward: 3, monthlyCap: 1, minTripFare: 8, accountAgeDays: 30 };
await adminSet('config/app', { currency: 'GBP', referrals: { ...CFG, enabled: 0 } });

const A = await passenger('amy');
const B = await passenger('ben');
const Dv = mk('driver');
const driverId = (await createUserWithEmailAndPassword(Dv.auth, 'drv@ref.dev', 'secret123')).user.uid;
await adminSet(`drivers/${driverId}`, { approved: true, firstName: 'Dan', status: 'online' });
const Adm = mk('admin');
const adminId = (await createUserWithEmailAndPassword(Adm.auth, 'admin@ref.dev', 'secret123')).user.uid;
await adminSet(`admins/${adminId}`, { isActive: true, role: 'admin' });
customerCards.cus_amy = ['fp_amy'];

let rideN = 0;
// A card trip as the hold leaves it, then completed by the driver.
async function cardTrip(rider, total, fp, { piPrefix = 'pi_ok', method = 'card' } = {}) {
  rideN += 1;
  const id = `refride${rideN}`;
  const pi = `${piPrefix}_${rideN}`;
  const hold = Math.round(total * 100);
  intents[pi] = { id: pi, object: 'payment_intent', amount: hold, customer: `cus_${rider.uid}`, status: 'requires_capture',
    payment_method: { id: `pm_${fp}`, card: { fingerprint: fp, last4: '4242', brand: 'visa' } } };
  if (method === 'card') {
    await adminSet(`payments/${pi}`, { rideId: id, riderId: rider.uid, driverId, amount: hold, currency: 'gbp', status: 'authorized' });
  }
  await adminSet(`rides/${id}`, {
    riderId: rider.uid, driverId, status: 'ongoing', source: 'app', rideType: 'RouteMini', paymentMethod: method,
    currency: 'GBP', fare: { total, currency: 'GBP' }, fareEstimate: total, walletProcessed: false,
    ...(method === 'card' ? { paymentIntentId: pi, paymentStatus: 'authorized' } : {}),
    pickupLocation: { latitude: 51.5, longitude: -0.1, address: 'A' }, dropoffLocation: { latitude: 51.51, longitude: -0.11, address: 'B' },
  });
  await adminSet(`rides/${id}`, { status: 'completed', completedAt: new Date() }, true);
  const want = method === 'card' ? ['captured', 'failed'] : ['cash'];
  await until(async () => want.includes((await get(`rides/${id}`))?.paymentStatus), `${id} settled`);
  return id;
}
const credit = async (uid) => (await get(`riderCredit/${uid}`))?.balanceMinor ?? 0;
const status = async (uid) => (await get(`referrals/${uid}`))?.status;

/* ------------------------------ switched off ------------------------------ */
await refused(A.call('myReferralCode', {}), /isn't running/i, 'functions/failed-precondition');
await refused(B.call('applyReferralCode', { code: 'ABCDEFG' }), /isn't running/i, 'functions/failed-precondition');
step('switched off (the default): no codes made, none taken');
await adminSet('config/app', { referrals: CFG }, true);

/* ------------------------------ the code ------------------------------ */
const { code } = await A.call('myReferralCode', {});
assert.match(code, /^[A-HJ-NP-Z2-9]{7}$/);
assert.equal((await A.call('myReferralCode', {})).code, code);
assert.equal((await get(`referralCodes/${code}`)).uid, A.uid);
assert.equal((await getDoc(doc(A.db, 'referralProfiles', A.uid))).data().code, code);
step('a passenger gets one 7-character code, the same every time');

/* ------------------------------ entering it ------------------------------ */
await refused(A.call('applyReferralCode', { code }), /own code/i, 'functions/failed-precondition');
const F = await passenger('fay', { phone: false });
const noPhone = await refused(F.call('applyReferralCode', { code }), /phone number/i, 'functions/failed-precondition');
assert.equal(noPhone.details?.reason, 'no_phone');
await refused(B.call('applyReferralCode', { code: 'ZZZZZZZ' }), /isn't right/i, 'functions/failed-precondition');
step('own code, no phone sign-in, or a wrong code: refused');

const national = '0' + A.number.slice(3);
const G = await passenger('gus', { rider: { phoneNumber: national } });
await refused(G.call('applyReferralCode', { code }), /can't be used/i, 'functions/failed-precondition');
const Hh = await passenger('hal');
await adminSet(`pushTokens/${A.uid}`, { tokens: ['ExponentPushToken[shared]'] });
await adminSet(`pushTokens/${Hh.uid}`, { tokens: ['ExponentPushToken[shared]'] });
await refused(Hh.call('applyReferralCode', { code }), /can't be used/i, 'functions/failed-precondition');
step('the referrer\'s own number (07… or +44…) or the same phone (push token): refused as the same person');

const J = await passenger('jo');
await adminSet('rides/jo_done', { riderId: J.uid, status: 'completed', paymentMethod: 'cash' });
await refused(J.call('applyReferralCode', { code }), /first trip/i, 'functions/failed-precondition');
await adminSet('config/app', { referrals: { ...CFG, accountAgeDays: 0 } }, true);
const old = await passenger('olly');
await sleep(1100);
await refused(old.call('applyReferralCode', { code }), /new accounts/i, 'functions/failed-precondition');
await adminSet('config/app', { referrals: CFG }, true);
step('a passenger who already took a trip, or whose account is older than the setting: refused');

const X = await passenger('xan');
for (let i = 0; i < 9; i++) await refused(X.call('applyReferralCode', { code: `BAD${i}XYZ` }), /isn't right/i);
await refused(X.call('applyReferralCode', { code: 'BAD9XYZ' }), /isn't right/i);
await refused(X.call('applyReferralCode', { code }), /too many tries/i, 'functions/resource-exhausted');
step('ten wrong codes and the passenger is stopped, even with the right one');

const ok = await B.call('applyReferralCode', { code: code.toLowerCase() });
assert.equal(ok.ok, true);
assert.equal(ok.reward, 5);
const pending = await get(`referrals/${B.uid}`);
assert.equal(pending.status, 'pending');
assert.equal(pending.referrerId, A.uid);
assert.equal((await get(`referralProfiles/${A.uid}`)).invited, 1);
await refused(B.call('applyReferralCode', { code }), /already used/i, 'functions/already-exists');
step('a new passenger enters the code (any case): pending, once only');

/* ------------------------------ rules ------------------------------ */
assert.equal((await getDoc(doc(B.db, 'referrals', B.uid))).data().status, 'pending');
assert.equal((await getDoc(doc(A.db, 'referrals', B.uid))).data().referrerId, A.uid);
await refused(getDoc(doc(X.db, 'referrals', B.uid)), null, 'permission-denied');
await refused(getDoc(doc(B.db, 'referralProfiles', A.uid)), null, 'permission-denied');
await refused(getDoc(doc(B.db, 'referralCodes', code)), null, 'permission-denied');
await refused(getDoc(doc(A.db, 'referralPhones', 'x')), null, 'permission-denied');
await refused(getDoc(doc(A.db, 'referralCards', 'x')), null, 'permission-denied');
await refused(updateDoc(doc(B.db, 'referrals', B.uid), { status: 'rewarded' }), null, 'permission-denied');
await refused(setDoc(doc(B.db, 'riderCredit', B.uid), { balanceMinor: 99999, currency: 'GBP' }), null, 'permission-denied');
await refused(setDoc(doc(B.db, 'referralCodes', 'MINE123'), { uid: B.uid }), null, 'permission-denied');
await refused(setDoc(doc(B.db, 'referralProfiles', B.uid), { code: 'MINE123' }), null, 'permission-denied');
await refused(setDoc(doc(B.db, 'rides', 'credit_create'), {
  riderId: B.uid, status: 'searching', source: 'app', driverId: null, fare: { total: 10, creditApplied: 10 },
}), null, 'permission-denied');
await refused(getDoc(doc(X.db, 'riderCredit', B.uid)), null, 'permission-denied');
step('rules: only the server writes codes, referrals, credit or a ride\'s credit; each passenger reads their own');

/* ------------------------------ the reward ------------------------------ */
await cardTrip(B, 12, 'fp_ben', { method: 'cash' });
await cardTrip(B, 6, 'fp_ben');
await sleep(4000);
assert.equal(await status(B.uid), 'pending');
assert.equal(await credit(B.uid), 0);
step('a cash trip, or a card trip under the minimum fare: no reward yet');

const paidTrip = await cardTrip(B, 12, 'fp_ben');
await until(async () => (await status(B.uid)) === 'rewarded', 'reward');
const rewarded = await get(`referrals/${B.uid}`);
assert.equal(rewarded.rideId, paidTrip);
assert.equal(rewarded.refereeRewardMinor, 500);
assert.equal(rewarded.referrerRewardMinor, 300);
assert.equal(await credit(B.uid), 500);
assert.equal(await credit(A.uid), 300);
assert.equal((await get(`riderCredit/${B.uid}/entries/referral_${B.uid}_welcome`)).amountMinor, 500);
assert.equal((await get(`riderCredit/${A.uid}/entries/referral_${B.uid}_referrer`)).amountMinor, 300);
assert.equal((await getDoc(doc(B.db, 'riderCredit', B.uid))).data().balanceMinor, 500);
step('first card trip over the minimum: both get their credit, once');

/* ------------------------------ spending it ------------------------------ */
const spent = await cardTrip(B, 12, 'fp_ben');
const r = await get(`rides/${spent}`);
assert.equal(r.fare.creditApplied, 5);
assert.equal(r.fare.cardTotal, 7);
assert.equal(r.fare.finalTotal, 12);
assert.deepEqual(captures.at(-1), { id: r.paymentIntentId, amount: 700 });
assert.equal(await credit(B.uid), 0);
assert.equal((await get(`riderCredit/${B.uid}/entries/ride_${spent}`)).amountMinor, -500);
await until(async () => (await get(`rides/${spent}`))?.earnings?.driverEarning === 12, 'driver paid');
assert.equal(await credit(A.uid), 300);
assert.equal(await status(B.uid), 'rewarded');
step('the next card trip: £5 off the card (£7 charged), the driver still credited the full £12; no second reward');

const small = await cardTrip(A, 3, 'fp_amy');
assert.deepEqual(captures.at(-1), { id: (await get(`rides/${small}`)).paymentIntentId, amount: 50 });
assert.equal((await get(`rides/${small}`)).fare.creditApplied, 2.5);
assert.equal(await credit(A.uid), 50);
step('credit never takes the whole charge: 50p is left on the card, the rest of the credit kept');

/* ------------------------------ abuse ------------------------------ */
const K = await passenger('kim');
await K.call('applyReferralCode', { code });
await cardTrip(K, 12, 'fp_ben');
await until(async () => (await status(K.uid)) === 'blocked', 'K blocked');
assert.equal((await get(`referrals/${K.uid}`)).reason, 'card_already_used');
assert.equal(await credit(K.uid), 0);

const L = await passenger('lee');
await L.call('applyReferralCode', { code });
await cardTrip(L, 12, 'fp_amy');
await until(async () => (await status(L.uid)) === 'blocked', 'L blocked');
assert.equal((await get(`referrals/${L.uid}`)).reason, 'same_card_as_referrer');
assert.equal(await credit(A.uid), 50);
step('a card that already earned an invite, or one of the referrer\'s own cards: blocked, nobody credited');

const M = await passenger('max');
await M.call('applyReferralCode', { code });
await cardTrip(M, 12, 'fp_max');
await until(async () => (await status(M.uid)) === 'rewarded', 'M rewarded');
const capped = await get(`referrals/${M.uid}`);
assert.equal(capped.referrerRewardMinor, 0);
assert.equal(capped.referrerNote, 'monthly_cap');
assert.equal(await credit(M.uid), 500);
assert.equal(await credit(A.uid), 50);
step('over the referrer\'s monthly cap: the new passenger is rewarded, the referrer is not');

/* ------------------------------ a failed charge ------------------------------ */
const failed = await cardTrip(M, 12, 'fp_max', { piPrefix: 'pi_fail' });
assert.equal((await get(`rides/${failed}`)).paymentStatus, 'failed');
await until(async () => (await credit(M.uid)) === 500, 'credit back');
assert.equal((await get(`riderCredit/${M.uid}/entries/ride_${failed}`)).restored, true);
step('a card trip whose charge fails gives the ride credit back');

/* ------------------------------ void ------------------------------ */
await refused(A.call('adminVoidReferral', { refereeId: M.uid, reason: 'test' }), /admin/i, 'functions/permission-denied');
await refused(Adm.call('adminVoidReferral', { refereeId: M.uid }), /reason/i, 'functions/invalid-argument');
const voided = await Adm.call('adminVoidReferral', { refereeId: M.uid, reason: 'Same household' });
assert.deepEqual(voided.takenBackMinor, { referee: 500, referrer: 0 });
assert.equal(await status(M.uid), 'void');
assert.equal(await credit(M.uid), 0);
assert.equal((await get(`referrals/${M.uid}`)).voidedBy, adminId);
step('an admin voids a referral: unspent credit from it taken back, only by an admin, with a reason');

const P = await passenger('pat');
await P.call('applyReferralCode', { code });
await Adm.call('adminVoidReferral', { refereeId: P.uid, reason: 'Fraud' });
await cardTrip(P, 12, 'fp_pat');
await sleep(4000);
assert.equal(await status(P.uid), 'void');
assert.equal(await credit(P.uid), 0);
step('a pending referral voided before the trip earns nothing');

const Q = await passenger('quin');
await Q.call('applyReferralCode', { code });
await adminSet('config/app', { referrals: { ...CFG, enabled: 0 } }, true);
await cardTrip(Q, 12, 'fp_quin');
await sleep(4000);
assert.equal(await status(Q.uid), 'pending');
await adminSet('config/app', { referrals: CFG }, true);
step('switched off after the code was entered: nothing paid, the referral waits');

console.log(`\nAll ${steps} referral checks passed.`);
fake.close();
process.exit(0);
