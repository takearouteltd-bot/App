// TakeARoute pays the promo discount to the driver (creditPromoTopUp, index.js).
// Emulators only, same set-up as account-delete.mjs (see README).
import assert from 'node:assert/strict';

const PROJECT = 'demo-tar';
const REST = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const H = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const enc = (v) => (typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { doubleValue: v }
  : v === null ? { nullValue: null } : typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } } : { stringValue: String(v) });
const adminSet = async (path, data) => {
  const r = await fetch(`${REST}/${path}`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields: enc(data).mapValue.fields }) });
  if (!r.ok) throw new Error(await r.text());
};
const patch = async (path, data) => {
  const mask = Object.keys(data).map((k) => `updateMask.fieldPaths=${k}`).join('&');
  const r = await fetch(`${REST}/${path}?${mask}`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields: enc(data).mapValue.fields }) });
  if (!r.ok) throw new Error(await r.text());
};
const adminGet = async (path) => (await (await fetch(`${REST}/${path}`, { headers: H })).json()).fields || {};
const num = (f) => (f ? Number(Object.values(f)[0]) : undefined);
const list = async (path) => (await (await fetch(`${REST}/${path}`, { headers: H })).json()).documents || [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, what) => {
  for (let i = 0; i < 240; i++) { if (await fn()) return; await sleep(500); }
  throw new Error('timed out: ' + what);
};
const step = (s) => console.log('•', s);
const P = { lat: 51.5, lng: -0.1 };
const ride = (id, fare, extra = {}) => adminSet(`rides/${id}`, Object.assign({
  status: 'in_progress', riderId: 'r1', driverId: 'd1', paymentMethod: 'cash', currency: 'GBP',
  pickupLocation: P, dropoffLocation: P, fare,
}, extra));
const complete = (id) => patch(`rides/${id}`, { status: 'completed' });

await adminSet('config/app', { currency: 'GBP' });
await adminSet('drivers/d1', { approved: true, status: 'online' });

step('cash trip, 20% promo: the discount and its VAT go to the driver');
await ride('c1', { subtotal: 12.5, discount: 0.2, discountAmount: 2.5, vatPercent: 20, total: 12, promoCode: 'SAVE20' });
await complete('c1');
await until(async () => num((await adminGet('rides/c1')).earnings?.mapValue?.fields?.promoTopUp) === 3, 'c1 top-up');
assert.equal(num((await adminGet('driverWallets/d1')).availableBalance), 3);
const tx = await list('driverWallets/d1/transactions');
assert.equal(tx.length, 1);
assert.equal(tx[0].fields.type.stringValue, 'promo_top_up');

step('a second change to the ride does not pay it again');
await patch('rides/c1', { rating: 5 });
await sleep(4000);
assert.equal(num((await adminGet('driverWallets/d1')).availableBalance), 3);

step('100% promo card trip: nothing charged, driver still paid the fare');
await ride('f1', { subtotal: 10, discount: 1, discountAmount: 10, vatPercent: 20, total: 0, promoCode: 'FREE' }, { paymentMethod: 'card' });
await complete('f1');
await until(async () => (await adminGet('rides/f1')).paymentStatus?.stringValue === 'no_charge', 'f1 no_charge');
await until(async () => num((await adminGet('driverWallets/d1')).availableBalance) === 15, 'f1 top-up');

step('fleet driver: it goes to the fleet wallet');
await ride('k1', { subtotal: 10, discount: 0.1, discountAmount: 1, vatPercent: 20, total: 10.8, promoCode: 'TEN' }, { fleetId: 'fl1' });
await complete('k1');
await until(async () => num((await adminGet('fleetWallets/fl1')).availableBalance) === 1.2, 'k1 fleet top-up');
assert.equal(num((await adminGet('driverWallets/d1')).availableBalance), 15);

step('no promo, or an agreed price: nothing extra');
await ride('n1', { subtotal: 10, vatPercent: 20, total: 12 });
await ride('n2', { subtotal: 10, discount: 0.2, discountAmount: 2, vatPercent: 20, total: 11, agreedPrice: 11, promoCode: 'SAVE20' });
await complete('n1'); await complete('n2');
await until(async () => (await adminGet('rides/n2')).paymentStatus?.stringValue === 'cash', 'n2 cash');
await sleep(4000);
assert.equal(num((await adminGet('driverWallets/d1')).availableBalance), 15);
assert.equal((await adminGet('rides/n1')).promoTopUpProcessed, undefined);

console.log('promo-topup: all passed');
process.exit(0);
