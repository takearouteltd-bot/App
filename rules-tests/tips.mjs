// Passenger tips (functions/tips.js, tipDriver), through the real rules and
// functions. Run like driver-cancel.mjs (see README): STRIPE_API_BASE=
// http://127.0.0.1:8999 in functions/.env.local and dummy Stripe secrets in
// functions/.secret.local. Fake Stripe on :8999.
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import assert from 'node:assert/strict';
import http from 'node:http';

// Fake Stripe: PaymentIntents only. Card pm_decline is declined.
const charges = [];
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const params = new URLSearchParams(body);
    if (req.method === 'POST' && req.url.startsWith('/v1/payment_intents')) {
      const charge = {
        amount: Number(params.get('amount')),
        currency: params.get('currency'),
        customer: params.get('customer'),
        pm: params.get('payment_method'),
        type: params.get('metadata[type]'),
        key: req.headers['idempotency-key'],
      };
      charges.push(charge);
      if (charge.pm === 'pm_decline') {
        res.writeHead(402, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { type: 'card_error', code: 'card_declined', message: 'Your card was declined.' } }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ id: `pi_tip_${charges.length}`, object: 'payment_intent', amount: charge.amount, status: 'succeeded' }));
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: 'not faked' } }));
  });
});
await new Promise((r) => fake.listen(8999, '127.0.0.1', r));

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
const adminGet = async (path) => (await (await fetch(`${REST}/${path}`, { headers: H })).json()).fields || null;
const val = (f) => {
  if (!f) return undefined;
  if ('integerValue' in f) return Number(f.integerValue);
  if ('doubleValue' in f) return f.doubleValue;
  if ('nullValue' in f) return null;
  if ('mapValue' in f) return Object.fromEntries(Object.entries(f.mapValue.fields || {}).map(([k, x]) => [k, val(x)]));
  return f.stringValue ?? f.booleanValue ?? f.timestampValue;
};
const field = async (path, name) => val((await adminGet(path))?.[name]);
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

const R = mk('rider'), O = mk('other'), D = mk('driver');
const rider = (await createUserWithEmailAndPassword(R.auth, 'rider-tip@test.dev', 'secret123')).user.uid;
const other = (await createUserWithEmailAndPassword(O.auth, 'other-tip@test.dev', 'secret123')).user.uid;
const driverId = (await createUserWithEmailAndPassword(D.auth, 'driver-tip@test.dev', 'secret123')).user.uid;

const TIPS = { enabled: 1, preset1: 1, preset2: 2, preset3: 5, maxAmount: 20, windowHours: 24 };
await adminSet('config/app', { currency: 'GBP', tips: TIPS });
await adminSet(`riders/${rider}`, { stripeCustomerId: 'cus_rider', defaultPaymentMethodId: 'pm_good' });
await adminSet(`riders/${other}`, { stripeCustomerId: 'cus_other', defaultPaymentMethodId: 'pm_other' });
await adminSet(`drivers/${driverId}`, { approved: true, firstName: 'Dan', status: 'online' });
await adminSet(`driverWallets/${driverId}`, { availableBalance: 10, totalEarned: 10, currency: 'GBP' });

let n = 0;
async function seedRide(extra = {}) {
  n += 1;
  const id = `tipride${n}`;
  await adminSet(`rides/${id}`, {
    riderId: rider, driverId, status: 'completed', completedAt: new Date(), rideType: 'RouteMini',
    paymentMethod: 'card', currency: 'gbp', fare: { total: 12 }, walletProcessed: true, ...extra,
  });
  return id;
}

/* ------------------------------ a tip is paid ------------------------------ */
const r1 = await seedRide();
const paid = await R.call('tipDriver', { rideId: r1, amount: 2 });
assert.deepEqual(paid, { paid: true, amount: 2 });
const tip1 = await field(`rides/${r1}`, 'tip');
assert.equal(tip1.status, 'paid');
assert.equal(tip1.amount, 2);
assert.equal(tip1.paidTo, 'driver');
assert.ok(tip1.paymentIntentId.startsWith('pi_tip_'));
assert.equal(await field(`driverWallets/${driverId}`, 'availableBalance'), 12);
assert.equal(await field(`driverWallets/${driverId}`, 'totalTips'), 2);
assert.equal(await field(`driverWallets/${driverId}/transactions/tip_${r1}`, 'type'), 'tip');
assert.equal(charges.length, 1);
assert.equal(charges[0].amount, 200);
assert.equal(charges[0].customer, 'cus_rider');
assert.equal(charges[0].pm, 'pm_good');
assert.equal(charges[0].type, 'tip');
assert.ok(String(charges[0].key).startsWith(`tip_${r1}_200_`));
step('passenger tips £2 on a card trip: card charged once, all of it in the driver\'s wallet');

await refused(R.call('tipDriver', { rideId: r1, amount: 2 }), /already tipped/i, 'functions/failed-precondition');
assert.equal(charges.length, 1);
assert.equal(await field(`driverWallets/${driverId}`, 'availableBalance'), 12);
step('a second tip on the same trip is refused, nothing charged');

/* ------------------------------ refusals ------------------------------ */
const r2 = await seedRide({ paymentMethod: 'cash' });
await refused(R.call('tipDriver', { rideId: r2, amount: 25 }), /from/i, 'functions/invalid-argument');
await refused(R.call('tipDriver', { rideId: r2, amount: 0.2 }), /from/i, 'functions/invalid-argument');
await refused(O.call('tipDriver', { rideId: r2, amount: 2 }), /not your trip/i, 'functions/failed-precondition');
step('above the most, below 50p, or somebody else\'s trip: refused');

const r3 = await seedRide({ completedAt: new Date(Date.now() - 30 * 3600 * 1000) });
await refused(R.call('tipDriver', { rideId: r3, amount: 2 }), /too late/i, 'functions/failed-precondition');
const r4 = await seedRide({ status: 'in_progress', completedAt: null });
await refused(R.call('tipDriver', { rideId: r4, amount: 2 }), /finished/i, 'functions/failed-precondition');
assert.equal(charges.length, 1);
step('after the tipping window, or before the trip ends: refused');

await adminSet(`riders/${rider}`, { defaultPaymentMethodId: null }, true);
const noCard = await refused(R.call('tipDriver', { rideId: r2, amount: 2 }), /add a card/i, 'functions/failed-precondition');
assert.equal(noCard.details?.reason, 'no_card');
step('no saved card: asked to add one (reason no_card)');

await adminSet(`riders/${rider}`, { defaultPaymentMethodId: 'pm_decline' }, true);
await refused(R.call('tipDriver', { rideId: r2, amount: 2 }), /declined/i, 'functions/failed-precondition');
assert.equal(await field(`rides/${r2}`, 'tip'), undefined);
assert.equal(await field(`driverWallets/${driverId}`, 'availableBalance'), 12);
step('declined card: nothing recorded, the trip can be tipped again');

await adminSet(`riders/${rider}`, { defaultPaymentMethodId: 'pm_good' }, true);
await R.call('tipDriver', { rideId: r2, amount: 5 });
assert.equal((await field(`rides/${r2}`, 'tip')).status, 'paid');
assert.equal(await field(`driverWallets/${driverId}`, 'availableBalance'), 17);
step('cash trip tipped by card after another card: paid');

/* ------------------------------ company driver ------------------------------ */
await adminSet('fleetWallets/fleetTip', { availableBalance: 0, totalEarned: 0 });
const r5 = await seedRide({ fleetId: 'fleetTip', fleetName: 'Tip Cars' });
await R.call('tipDriver', { rideId: r5, amount: 1 });
assert.equal((await field(`rides/${r5}`, 'tip')).paidTo, 'fleet');
assert.equal(await field('fleetWallets/fleetTip', 'availableBalance'), 1);
assert.equal(await field(`fleetWallets/fleetTip/transactions/tip_${r5}`, 'type'), 'driver_tip');
assert.equal(await field(`driverWallets/${driverId}`, 'availableBalance'), 17);
step('company driver\'s app trip: the tip goes to the fleet wallet as driver_tip, like their card fares');

/* ------------------------------ switched off ------------------------------ */
await adminSet('config/app', { tips: { ...TIPS, enabled: 0 } }, true);
const r6 = await seedRide();
await refused(R.call('tipDriver', { rideId: r6, amount: 2 }), /switched off/i, 'functions/failed-precondition');
await adminSet('config/app', { tips: TIPS }, true);
step('tips switched off on the dashboard: refused');

/* ------------------------------ rules ------------------------------ */
await refused(updateDoc(doc(R.db, 'rides', r6), { tip: { status: 'paid', amount: 50 } }), null, 'permission-denied');
await refused(updateDoc(doc(D.db, 'rides', r6), { tip: { status: 'paid', amount: 50 } }), null, 'permission-denied');
await refused(setDoc(doc(R.db, 'rides', 'tipcreate'), {
  riderId: rider, status: 'searching', source: 'app', driverId: null, tip: { status: 'paid', amount: 5 },
}), null, 'permission-denied');
await refused(updateDoc(doc(D.db, 'driverWallets', driverId), { availableBalance: 999 }), null, 'permission-denied');
step('nobody can write a tip or credit a wallet from the app');

console.log(`\nAll ${steps} tip checks passed.`);
fake.close();
process.exit(0);
