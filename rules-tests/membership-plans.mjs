// Driver membership plans: weekly or monthly, plan switch at renewal,
// auto-renew off ends the membership, buying again, purchase records
// (functions/index.js activateDriverMembership, updateDriverMembership,
// collectMembership, renewDriverMemberships; firestore.rules).
// Same set-up as booking-checks (auth, firestore, functions, pubsub; dummy
// Stripe secrets in functions/.secret.local), no fakes needed: no card is
// saved, so only the wallet is used.
import { createRequire } from 'node:module';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, collection, updateDoc } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import assert from 'node:assert/strict';

const PROJECT = 'demo-tar';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || PROJECT;
const admin = require('firebase-admin');
const { Timestamp } = require('firebase-admin/firestore');
admin.initializeApp({ projectId: PROJECT });
const adb = admin.firestore();

const mk = (name) => {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'fake', authDomain: 'x' }, name);
  const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const fn = getFunctions(app, 'us-central1'); connectFunctionsEmulator(fn, '127.0.0.1', 5001);
  return { auth, db, call: (n, d) => httpsCallable(fn, n, { timeout: 300000 })(d).then((r) => r.data) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 240000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout: ' + what); await sleep(500); }
}
const step = (s) => console.log('•', s);
const DAY = 864e5;
const near = (a, b, slack = 10 * 60000) => Math.abs(a - b) < slack;

const D = mk('driver'), E = mk('driver2');
const d = (await createUserWithEmailAndPassword(D.auth, 'plan-d@test.dev', 'secret123')).user.uid;
const e = (await createUserWithEmailAndPassword(E.auth, 'plan-e@test.dev', 'secret123')).user.uid;
const setPrices = (weeklyPrice) => adb.doc('config/app').set({ currency: 'GBP', subscription: { monthlyPrice: 40, weeklyPrice, graceDays: 3 } }, { merge: true });
await setPrices(25);
for (const id of [d, e]) {
  await adb.doc(`drivers/${id}`).set({ approved: true, status: 'offline', fullName: 'Plan Driver' });
}
await adb.doc(`driverWallets/${d}`).set({ availableBalance: 100 });
await adb.doc(`driverWallets/${e}`).set({ availableBalance: 0 });

const sub = async (id = d) => (await adb.doc(`drivers/${id}`).get()).data().subscription || {};
const balance = async () => (await adb.doc(`driverWallets/${d}`).get()).data().availableBalance;
const purchases = async () => (await getDocs(collection(D.db, 'driverWallets', d, 'transactions'))).docs
  .map((x) => x.data()).filter((t) => t.type === 'subscription_deduction');
const runDaily = async () => {
  const r = await fetch(`http://127.0.0.1:8085/v1/projects/${PROJECT}/topics/firebase-schedule-renewDriverMemberships:publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ data: Buffer.from('{}').toString('base64') }] }) });
  assert.ok(r.ok, 'pubsub publish: ' + r.status);
};

step('a driver cannot write their own plan or auto-renew');
await assert.rejects(updateDoc(doc(D.db, 'drivers', d), { subscription: { status: 'active', tier: 'weekly', autoRenew: true } }));

step('start on the weekly plan: the server price (25) comes off the wallet, a week ahead');
let r = await D.call('activateDriverMembership', { tier: 'weekly', amount: 1 });
assert.equal(r.paid, true); assert.equal(r.method, 'wallet'); assert.equal(r.amount, 25);
let s = await sub();
assert.equal(s.status, 'active'); assert.equal(s.tier, 'weekly'); assert.equal(s.autoRenew, true); assert.equal(s.debtAmount, 0);
assert.ok(near(s.nextBillingDate.toMillis(), Date.now() + 7 * DAY), 'renews in a week');
assert.equal(await balance(), 75);
let p = await purchases();
assert.equal(p.length, 1); assert.equal(p[0].plan, 'weekly'); assert.equal(p[0].amount, -25); assert.equal(p[0].description, 'Weekly membership');
assert.equal(p[0].periodEnd.toMillis(), s.nextBillingDate.toMillis());
assert.equal(p[0].periodStart.toMillis(), s.nextBillingDate.toMillis() - 7 * DAY);

step('active and paid: they can go online, and back off');
await updateDoc(doc(D.db, 'drivers', d), { status: 'online' });
await updateDoc(doc(D.db, 'drivers', d), { status: 'offline' });

step('switch to monthly: waits for the next renewal');
await D.call('updateDriverMembership', { tier: 'monthly' });
s = await sub(); assert.equal(s.tier, 'weekly'); assert.equal(s.nextTier, 'monthly');
await D.call('updateDriverMembership', { tier: 'weekly' });
assert.equal((await sub()).nextTier, undefined, 'switching back clears it');
await D.call('updateDriverMembership', { tier: 'monthly' });
await assert.rejects(D.call('updateDriverMembership', { tier: 'yearly' }), /weekly or monthly/);

step('renewal: monthly price (40) taken, a month on, switch applied');
const due = Date.now() - 60000;
await adb.doc(`drivers/${d}`).update({ 'subscription.nextBillingDate': Timestamp.fromMillis(due) });
await runDaily();
s = await until(async () => { const x = await sub(); return x.tier === 'monthly' && x.debtAmount === 0 ? x : null; }, 'renewed monthly');
assert.equal(s.nextTier, undefined); assert.equal(s.amount, 40);
const monthOn = new Date(due); monthOn.setMonth(monthOn.getMonth() + 1);
assert.ok(near(s.nextBillingDate.toMillis(), monthOn.getTime(), 2 * DAY), 'about a month on');
assert.equal(await balance(), 35);
p = await purchases();
assert.equal(p.length, 2); assert.ok(p.some((t) => t.plan === 'monthly' && t.amount === -40));

step('auto-renew off: reminder the day before, nothing charged at the end, membership ends');
await D.call('updateDriverMembership', { autoRenew: false });
assert.equal((await sub()).autoRenew, false);
const soon = Date.now() + 12 * 3600e3;
await adb.doc(`drivers/${d}`).update({ 'subscription.nextBillingDate': Timestamp.fromMillis(soon) });
await runDaily();
await until(async () => (await sub()).endReminderFor === soon, 'reminder sent');
assert.equal((await sub()).status, 'active');
await adb.doc(`drivers/${d}`).update({ 'subscription.nextBillingDate': Timestamp.fromMillis(Date.now() - 60000) });
await runDaily();
s = await until(async () => { const x = await sub(); return x.status === 'expired' ? x : null; }, 'membership ended');
assert.equal(s.debtAmount, 0); assert.ok(s.endedAt);
assert.equal(await balance(), 35, 'nothing taken');
assert.equal((await purchases()).length, 2);

step('ended: cannot go online');
await assert.rejects(updateDoc(doc(D.db, 'drivers', d), { status: 'online' }));

step('buy again, weekly: paid now from the wallet, active a week');
r = await D.call('activateDriverMembership', { tier: 'weekly' });
assert.equal(r.paid, true); assert.equal(r.amount, 25);
s = await sub();
assert.equal(s.status, 'active'); assert.equal(s.tier, 'weekly'); assert.equal(s.endedAt, null);
assert.ok(near(s.nextBillingDate.toMillis(), Date.now() + 7 * DAY));
assert.equal(await balance(), 10);
await updateDoc(doc(D.db, 'drivers', d), { status: 'online' });
await updateDoc(doc(D.db, 'drivers', d), { status: 'offline' });

step('ended and the wallet is short: nothing owed, still ended');
await adb.doc(`drivers/${d}`).update({ 'subscription.status': 'expired' });
r = await D.call('activateDriverMembership', { tier: 'monthly' });
assert.equal(r.paid, false); assert.equal(r.stillExpired, true); assert.equal(r.reason, 'no_card');
s = await sub(); assert.equal(s.status, 'expired'); assert.equal(s.debtAmount, 0); assert.equal(s.tier, 'monthly');

step('first period unpaid: switching plan re-prices it straight away');
r = await E.call('activateDriverMembership', { tier: 'monthly' });
assert.equal(r.paid, false);
s = await sub(e); assert.equal(s.debtAmount, 40); assert.equal(s.tier, 'monthly');
await E.call('updateDriverMembership', { tier: 'weekly' });
s = await sub(e); assert.equal(s.debtAmount, 25); assert.equal(s.tier, 'weekly'); assert.equal(s.nextTier, undefined);
assert.ok(near(s.nextBillingDate.toMillis(), Date.now() + 7 * DAY));

step('weekly plan withdrawn (price 0): cannot be picked');
await setPrices(0);
await assert.rejects(E.call('updateDriverMembership', { tier: 'weekly' }), /not available/);
await adb.doc(`drivers/${d}`).update({ 'subscription.status': 'expired' });
await assert.rejects(D.call('activateDriverMembership', { tier: 'weekly' }), /not available/);

step('paid by a fleet: nothing to change');
await adb.doc(`drivers/${e}`).update({ 'subscription.paymentMethod': 'fleet' });
await assert.rejects(E.call('updateDriverMembership', { autoRenew: false }), /paid for you/);

console.log('membership-plans: all passed');
process.exit(0);
