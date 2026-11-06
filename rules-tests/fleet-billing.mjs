// Fleet billing (functions/fleetBilling.js) against the Firestore emulator,
// with a fake Stripe. Run from App/:
//   firebase emulators:exec --only firestore --project demo-tar "node rules-tests/fleet-billing.mjs"
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-tar';
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { Timestamp } = require('firebase-admin/firestore');
admin.initializeApp({ projectId: 'demo-tar' });
const db = admin.firestore();

// Fake Stripe: records calls; cards ending 0002 decline.
const calls = [];
let piSeq = 0;
const stripe = {
  customers: {
    create: async (p) => { calls.push(['customers.create', p]); return { id: 'cus_test' }; },
    update: async (id, p) => { calls.push(['customers.update', id, p]); return { id }; },
  },
  paymentMethods: {
    retrieve: async (id) => ({ id, card: { brand: 'visa', last4: id.endsWith('0002') ? '0002' : '4242', exp_month: 12, exp_year: 2030 } }),
  },
  paymentIntents: {
    create: async (p, o) => {
      calls.push(['paymentIntents.create', p, o]);
      if (String(p.payment_method).endsWith('0002')) { const e = new Error('Your card was declined.'); e.type = 'StripeCardError'; throw e; }
      return { id: `pi_${++piSeq}`, status: 'succeeded', amount: p.amount, amount_received: p.amount, metadata: p.metadata };
    },
  },
  checkout: {
    sessions: {
      create: async (p) => { calls.push(['checkout.create', p]); return { id: 'cs_test_1', url: 'https://checkout.stripe.test/cs_test_1' }; },
      retrieve: async (id) => sessions[id],
    },
  },
};
const sessions = {};
const cfg = { subscription: { monthlyPrice: 299, graceDays: 3 } };
const billing = require('../functions/fleetBilling.js')({
  functions, db, stripe, STRIPE_SECRETS: ['STRIPE_SECRET_KEY'],
  loadAppConfig: async () => cfg,
  toMillis: (t) => (t && t.toMillis ? t.toMillis() : null),
});
const step = (s) => console.log('•', s);
const fleet = async (id) => (await db.doc(`fleets/${id}`).get()).data();
const wallet = async (id) => (await db.doc(`fleetWallets/${id}`).get()).data();

step('plan price: per driver (own price or the global one) and flat monthly');
assert.deepEqual(billing.billFor({ perDriverMonthly: 50 }, 3, cfg).amount, 150);
assert.deepEqual(billing.billFor({ perDriverMonthly: null }, 2, cfg).amount, 598);
assert.deepEqual(billing.billFor({ billingPlan: 'monthly', monthlyFee: 499 }, 40, cfg).amount, 499);
assert.deepEqual(billing.billFor({ billingPlan: 'monthly', monthlyFee: 499 }, 0, cfg).amount, 499);

step('wallet covers the bill: no card charge, nothing owed');
await db.doc('fleets/f1').set({ name: 'Star Cars', currency: 'GBP', status: 'active', billing: { status: 'ok' } });
await db.doc('fleetWallets/f1').set({ availableBalance: 20 });
assert.equal(await billing.chargeShortfall('f1'), 'nothing_owed');
assert.equal(calls.filter((c) => c[0] === 'paymentIntents.create').length, 0);

step('wallet short and no card: past due with a 3-day grace period');
await db.doc('fleetWallets/f1').set({ availableBalance: -150 });
assert.equal(await billing.chargeShortfall('f1'), 'no_card');
let f = await fleet('f1');
assert.equal(f.billing.status, 'past_due'); assert.equal(f.billing.owed, 150); assert.equal(f.billing.lastError, 'no_card');
const grace = f.billing.graceUntil.toMillis();
assert.ok(Math.abs(grace - (Date.now() + 3 * 864e5)) < 60000);
await billing.chargeShortfall('f1');
assert.equal((await fleet('f1')).billing.graceUntil.toMillis(), grace, 'grace not restarted');

step('owner opens Checkout to pay: amount is what is owed; card saved for later');
const ctxOwner = { auth: { uid: 'owner1' } };
await db.doc('fleetManagers/owner1').set({ fleetId: 'f1', role: 'owner', isActive: true, email: 'o@test.dev' });
await db.doc('fleetManagers/op1').set({ fleetId: 'f1', role: 'operator', isActive: true });
await assert.rejects(billing.functions.fleetBillingCheckout.run({ kind: 'pay', returnUrl: 'https://evil.example/' }, ctxOwner), /return address/);
await assert.rejects(billing.functions.fleetBillingCheckout.run({ kind: 'pay', returnUrl: 'https://admin.takearoute.ltd/earnings' }, { auth: { uid: 'op1' } }), /Only the fleet owner/);
const co = await billing.functions.fleetBillingCheckout.run({ kind: 'pay', returnUrl: 'https://admin.takearoute.ltd/earnings?x=1' }, ctxOwner);
assert.equal(co.url, 'https://checkout.stripe.test/cs_test_1');
const made = calls.filter((c) => c[0] === 'checkout.create').pop()[1];
assert.equal(made.mode, 'payment'); assert.equal(made.line_items[0].price_data.unit_amount, 15000);
assert.equal(made.payment_intent_data.setup_future_usage, 'off_session');
assert.equal(made.success_url, 'https://admin.takearoute.ltd/earnings?billing=done&session={CHECKOUT_SESSION_ID}');
assert.equal((await fleet('f1')).billing.stripeCustomerId, 'cus_test');

step('grace runs out unpaid: the daily run pauses the fleet');
await db.doc('fleets/f1').update({ 'billing.graceUntil': Timestamp.fromMillis(Date.now() - 1000) });
await billing.functions.enforceFleetBilling.run({});
f = await fleet('f1');
assert.equal(f.status, 'suspended'); assert.equal(f.suspendedReason, 'unpaid');

step('payment confirmed on return (paused fleet can still pay): wallet credited once, fleet back on, card saved');
sessions.cs_test_1 = { id: 'cs_test_1', mode: 'payment', customer: 'cus_test', metadata: { fleetId: 'f1', type: 'fleet_billing' },
  payment_intent: { id: 'pi_checkout', status: 'succeeded', amount: 15000, amount_received: 15000, payment_method: 'pm_4242', metadata: { type: 'fleet_billing', fleetId: 'f1' } } };
await assert.rejects(billing.functions.confirmFleetCheckout.run({ sessionId: 'cs_test_1' }, { auth: { uid: 'nobody' } }), /Only the fleet owner/);
const conf = await billing.functions.confirmFleetCheckout.run({ sessionId: 'cs_test_1' }, ctxOwner);
assert.equal(conf.paid, true); assert.equal(conf.status, 'active'); assert.equal(conf.billingStatus, 'ok'); assert.equal(conf.owed, 0);
f = await fleet('f1');
assert.equal(f.suspendedReason, undefined); assert.equal(f.billing.card.last4, '4242'); assert.equal(f.billing.paymentMethodId, 'pm_4242');
assert.equal((await wallet('f1')).availableBalance, 0);
step('the webhook for the same payment does not credit it twice');
assert.equal(await billing.handleWebhookPayment(sessions.cs_test_1.payment_intent), true);
await billing.functions.confirmFleetCheckout.run({ sessionId: 'cs_test_1' }, ctxOwner);
assert.equal((await wallet('f1')).availableBalance, 0, 'credited once');
assert.equal(await billing.handleWebhookPayment({ id: 'pi_ride', status: 'succeeded', metadata: { rideId: 'r1' } }), false, 'ride payments untouched');

step('next bill with a card on file: the card pays the shortfall at once');
await db.doc('fleetWallets/f1').update({ availableBalance: admin.firestore.FieldValue.increment(-499) });
assert.equal(await billing.chargeShortfall('f1'), 'paid');
const pi = calls.filter((c) => c[0] === 'paymentIntents.create').pop();
assert.equal(pi[1].amount, 49900); assert.equal(pi[1].off_session, true); assert.equal(pi[1].customer, 'cus_test');
assert.ok(pi[2].idempotencyKey.startsWith('fleet-bill-f1-'));
assert.equal((await wallet('f1')).availableBalance, 0); assert.equal((await fleet('f1')).billing.status, 'ok');

step('declined card: past due with the reason, then paused after grace');
await db.doc('fleets/f1').update({ 'billing.paymentMethodId': 'pm_0002' });
await db.doc('fleetWallets/f1').update({ availableBalance: -100 });
assert.equal(await billing.chargeShortfall('f1'), 'failed');
f = await fleet('f1');
assert.equal(f.billing.status, 'past_due'); assert.match(f.billing.lastError, /declined/);
step('owner adds a new card: it is charged straight away and the fleet is clear');
sessions.cs_setup = { id: 'cs_setup', mode: 'setup', customer: 'cus_test', metadata: { fleetId: 'f1' }, setup_intent: { status: 'succeeded', payment_method: 'pm_new_4242' } };
const conf2 = await billing.functions.confirmFleetCheckout.run({ sessionId: 'cs_setup' }, ctxOwner);
assert.equal(conf2.paid, true); assert.equal(conf2.billingStatus, 'ok');
assert.equal((await fleet('f1')).billing.paymentMethodId, 'pm_new_4242');
assert.equal((await wallet('f1')).availableBalance, 0);

step('a fleet paused by an admin (not for money) is not switched back on by a payment');
await db.doc('fleets/f2').set({ name: 'Other', status: 'suspended', billing: { status: 'ok' } });
await db.doc('fleetWallets/f2').set({ availableBalance: 0 });
await billing.settleBillingState('f2');
assert.equal((await fleet('f2')).status, 'suspended');

step('a checkout from another fleet is refused');
sessions.cs_other = { id: 'cs_other', mode: 'payment', metadata: { fleetId: 'f2' } };
await assert.rejects(billing.functions.confirmFleetCheckout.run({ sessionId: 'cs_other' }, ctxOwner), /Not your checkout/);

console.log('\nALL FLEET BILLING CHECKS PASSED');
process.exit(0);
