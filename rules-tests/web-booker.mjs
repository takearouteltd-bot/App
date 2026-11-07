// A taxi firm's web booker (functions/fleetWeb.js) against the emulators,
// with a fake Twilio, Google and Stripe on :8999. Needs, for this run only:
//   functions/.secret.local  Stripe dummies, TWILIO_SID=AC + 32 zeros,
//                            TWILIO_TOKEN=testtoken,
//                            TWILIO_NUMBER=+441000000000
//   functions/.env.local     TWILIO_API_BASE, PLACES_API_BASE,
//                            ROUTES_API_BASE and STRIPE_API_BASE all
//                            http://127.0.0.1:8999
// firebase emulators:exec --config <with auth 9099, pubsub 8085> --only
//   auth,firestore,functions,pubsub --project demo-tar
//   "node rules-tests/web-booker.mjs"
import http from 'node:http';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import assert from 'node:assert/strict';

const PROJECT = 'demo-tar';

// ---------- fake Twilio, Google and Stripe
const texts = []; // {To, From, Body}
const stripeCalls = [];
const sessions = {}; // id -> {amount, paid, expired, pi}
let n = 0;
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const form = (req.headers['content-type'] || '').includes('json') ? {} : Object.fromEntries(new URLSearchParams(body));
    const json = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (p.endsWith('/Messages.json')) { texts.push(form); return json({ sid: 'SM' + (++n) }); }
    if (p === '/v1/places:autocomplete') return json({ suggestions: [{ placePrediction: { placeId: 'PL1', structuredFormat: { mainText: { text: 'Redditch Station' }, secondaryText: { text: 'Redditch' } } } }] });
    if (p === '/v1/places/PL1') return json({ location: { latitude: 52.305, longitude: -1.945 }, formattedAddress: 'Station Approach, Redditch B97 4AA, UK', displayName: { text: 'Redditch Station' } });
    if (p === '/directions/v2:computeRoutes') return json({ routes: [{ distanceMeters: 1609, duration: '300s' }] });
    // Stripe
    if (p === '/v1/checkout/sessions' && req.method === 'POST') {
      stripeCalls.push({ p, form });
      const id = 'cs_test_' + (++n);
      sessions[id] = { amount: Number(form['line_items[0][price_data][unit_amount]']), meta: form['metadata[webRideId]'], capture: form['payment_intent_data[capture_method]'] };
      return json({ id, object: 'checkout.session', url: `https://checkout.stripe.test/${id}`, status: 'open', payment_intent: null });
    }
    let m = p.match(/^\/v1\/checkout\/sessions\/(cs_test_\d+)$/);
    if (m) {
      const s = sessions[m[1]];
      if (s.paid && !s.pi) s.pi = { id: 'pi_' + m[1], object: 'payment_intent', status: 'requires_capture', amount: s.amount };
      return json({ id: m[1], object: 'checkout.session', status: s.expired ? 'expired' : s.paid ? 'complete' : 'open', payment_intent: s.pi || null });
    }
    m = p.match(/^\/v1\/payment_intents\/(pi_[\w]+)\/(capture|cancel)$/);
    if (m) {
      stripeCalls.push({ p, form });
      const amount = Number(form.amount_to_capture || 0);
      return json({ id: m[1], object: 'payment_intent', status: m[2] === 'capture' ? 'succeeded' : 'canceled', amount_received: amount, ...(m[2] === 'capture' && form['expand[0]'] === 'latest_charge.balance_transaction' ? { latest_charge: { id: 'ch_1', balance_transaction: { id: 'txn_1', fee: 37 } } } : {}) });
    }
    json({ error: { message: 'unexpected ' + p } }, 404);
  });
});
await new Promise((r) => fake.listen(8999, '127.0.0.1', r));

// ---------- clients and admin helpers
const mk = (name) => {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'fake', authDomain: 'x' }, name);
  const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const fn = getFunctions(app, 'us-central1'); connectFunctionsEmulator(fn, '127.0.0.1', 5001);
  return { auth, db, call: (name2, d) => httpsCallable(fn, name2)(d).then((r) => r.data) };
};
const REST = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const H = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const enc = (v) => typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : v === null ? { nullValue: null } : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } } : typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } } : { stringValue: String(v) };
const dec = (v) => { const [k, x] = Object.entries(v)[0]; return k === 'mapValue' ? Object.fromEntries(Object.entries(x.fields || {}).map(([a, b]) => [a, dec(b)])) : k === 'arrayValue' ? (x.values || []).map(dec) : k === 'integerValue' ? Number(x) : k === 'doubleValue' ? Number(x) : k === 'nullValue' ? null : x; };
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
const step = (s) => console.log('•', s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what) {
  for (let i = 0; i < 60; i++) {
    const v = await fn();
    if (v) return v;
    await sleep(250);
  }
  throw new Error('timed out waiting for ' + what);
}
const lastText = () => texts[texts.length - 1];

const A = mk('admin'), O = mk('owner'), C = mk('customer');
const adm = await createUserWithEmailAndPassword(A.auth, 'webadmin@test.dev', 'secret123');
await adminSet(`admins/${adm.user.uid}`, { isActive: true, role: 'super_admin' });
await adminSet('config/app', { currency: 'GBP' });
const f = await A.call('createFleet', { name: 'Time Taxis', ownerName: 'T', email: 'webowner@test.dev', phone: '07700900009', billingPlan: 'monthly', monthlyFee: 100 });
const owner = (await authApi('accounts:query', {})).userInfo.find((x) => x.email === 'webowner@test.dev');
await authApi('accounts:update', { localId: owner.localId, password: 'owner123' });
await signInWithEmailAndPassword(O.auth, 'webowner@test.dev', 'owner123');
const PICK = { latitude: 52.3069, longitude: -1.9492, address: '12 Station Road, Redditch' };
const DROP = { latitude: 52.31, longitude: -1.94, address: 'Town Hall, Redditch' };

step('the page is closed until the owner switches it on; the address is the owner\'s choice');
await assert.rejects(C.call('webBookerInfo', { slug: 'time-taxis' }), /not available/);
const saved = await O.call('saveFleetWebBooking', { enabled: true, slug: 'Time Taxis!', payDriver: true, payOnline: true, types: ['RouteMini', 'RouteXL'] });
assert.equal(saved.slug, 'time-taxis'); assert.equal(saved.url, 'https://admin.takearoute.ltd/b/time-taxis');
const info = await C.call('webBookerInfo', { slug: 'time-taxis' });
assert.equal(info.fleetName, 'Time Taxis'); assert.equal(info.payOnline, true);
assert.deepEqual(info.types.map((t) => t.id), ['RouteMini', 'RouteXL']);

step('another firm cannot take the same address');
const f2 = await A.call('createFleet', { name: 'Other Cars', ownerName: 'U', email: 'webowner2@test.dev', phone: '07700900010' });
const o2 = (await authApi('accounts:query', {})).userInfo.find((x) => x.email === 'webowner2@test.dev');
await authApi('accounts:update', { localId: o2.localId, password: 'owner123' });
const O2 = mk('owner2');
await signInWithEmailAndPassword(O2.auth, 'webowner2@test.dev', 'owner123');
await assert.rejects(O2.call('saveFleetWebBooking', { enabled: true, slug: 'time-taxis' }), /already uses that page address/);
assert.ok(f2.fleetId);

step('sign-in: UK mobiles only; a texted code; a wrong code is refused');
await assert.rejects(C.call('webSendCode', { slug: 'time-taxis', phone: '01527 123456' }), /UK mobile/);
await C.call('webSendCode', { slug: 'time-taxis', phone: '07700 900555' });
assert.equal(lastText().To, '+447700900555'); assert.equal(lastText().From, 'Time Taxis');
const code = lastText().Body.match(/code is (\d{6})/)[1];
await assert.rejects(C.call('webVerifyCode', { slug: 'time-taxis', phone: '07700900555', code: code === '000000' ? '111111' : '000000' }), /wrong/);
const { token } = await C.call('webVerifyCode', { slug: 'time-taxis', phone: '07700900555', code });
assert.equal(token.length, 32);
await assert.rejects(C.call('webVerifyCode', { slug: 'time-taxis', phone: '07700900555', code }), /expired/);

step('three codes an hour per phone');
await C.call('webSendCode', { slug: 'time-taxis', phone: '07700900555' });
await C.call('webSendCode', { slug: 'time-taxis', phone: '07700900555' });
await assert.rejects(C.call('webSendCode', { slug: 'time-taxis', phone: '07700900555' }), /a few codes already/);

step('address search and fares for each car the firm offers');
const places = await C.call('webPlaces', { token, input: 'redditch st' });
assert.equal(places.results[0].placeId, 'PL1');
const q = await C.call('webQuote', { token, pickup: PICK, dropoff: DROP });
assert.deepEqual(q.fares.map((x) => [x.id, x.fare]), [['RouteMini', 7.74], ['RouteXL', 11.61]]);
await assert.rejects(C.call('webQuote', { token: 'x'.repeat(32), pickup: PICK, dropoff: DROP }), /confirm your mobile/);

step('pay the driver: booked straight away as a web job, texted with a tracking link');
const b1 = await C.call('webBook', { token, pickup: PICK, dropoff: DROP, passengers: 2, rideType: 'RouteMini', name: 'Sam', pay: 'driver' });
assert.equal(b1.status, 'dispatching');
let ride = await adminGet(`rides/${b1.rideId}`);
assert.equal(ride.channel, 'web'); assert.equal(ride.source, 'phone'); assert.equal(ride.bookedBy.via, 'web');
assert.equal(ride.collectBy, 'cash'); assert.equal(ride.paymentMethod, 'cash'); assert.equal(ride.fleetId, f.fleetId);
assert.match(ride.notes, /^2 passengers/); assert.equal(ride.customer.phone, '+447700900555'); assert.equal(ride.customer.name, 'Sam');
assert.match(lastText().Body, /^Time Taxis: taxi booked, as soon as possible from 12 Station Road\. Fare about £7\.74/);
assert.match(lastText().Body, new RegExp(`/t/${b1.trackToken}$`));
await assert.rejects(C.call('webBook', { token, pickup: PICK, dropoff: DROP, passengers: 5, rideType: 'RouteMini', pay: 'driver' }), /up to 4 passengers/);

step('tracking shows the booking; the customer can cancel before a driver accepts');
let t = await C.call('webTrack', { trackToken: b1.trackToken });
assert.equal(t.status, 'dispatching'); assert.equal(t.canCancel, true); assert.equal(t.fleetName, 'Time Taxis'); assert.equal(t.driver, null);
await C.call('webCancel', { trackToken: b1.trackToken });
assert.equal((await adminGet(`rides/${b1.rideId}`)).status, 'cancelled');
await until(async () => /booking is cancelled/.test(lastText().Body), 'cancel text');

step('pay by card: a Stripe page with a hold (manual capture); the job waits for it');
const b2 = await C.call('webBook', { token, pickup: PICK, dropoff: DROP, passengers: 5, rideType: 'RouteXL', pay: 'card' });
assert.match(b2.checkoutUrl, /^https:\/\/checkout\.stripe\.test\/cs_test_/);
const csId = b2.checkoutUrl.split('/').pop();
assert.equal(sessions[csId].capture, 'manual'); assert.equal(sessions[csId].amount, 1161); assert.equal(sessions[csId].meta, b2.rideId);
ride = await adminGet(`rides/${b2.rideId}`);
assert.equal(ride.status, 'payment_pending'); assert.equal(ride.collectBy, 'online'); assert.equal(ride.paymentMethod, 'card');
assert.match(ride.notes, /^PAID ONLINE: do not take payment\. 5 passengers/);
const textsBefore = texts.length;
assert.equal((await C.call('webConfirmPayment', { token, rideId: b2.rideId })).status, 'payment_pending', 'not paid yet');

step('back from Stripe with the card held: sent to drivers and texted');
sessions[csId].paid = true;
const confirmed = await C.call('webConfirmPayment', { token, rideId: b2.rideId });
assert.equal(confirmed.status, 'dispatching');
ride = await adminGet(`rides/${b2.rideId}`);
assert.equal(ride.webPayment.status, 'authorised'); assert.equal(ride.webPayment.intentId, `pi_${csId}`); assert.equal(ride.webPayment.amount, 11.61);
assert.equal(texts.length, textsBefore + 1); assert.match(lastText().Body, /Paid by card: £11\.61/);
assert.equal((await C.call('webConfirmPayment', { token, rideId: b2.rideId })).status, 'dispatching', 'safe to call twice');
assert.equal(texts.length, textsBefore + 1, 'no second text');

step('the office cannot change a paid booking');
await assert.rejects(O.call('editFleetBooking', { rideId: b2.rideId, notes: 'x' }), /paid for this booking online/);

step('a driver accepts: the customer is texted and the tracking page shows driver, car and position');
await adminSet('drivers/webdrv', { firstName: 'Priya', makeModel: 'Toyota Prius', vehicleColor: 'Silver', registrationNumber: 'ab12 cde', fleetId: f.fleetId, approved: true, location: { latitude: 52.3, longitude: -1.95 } });
await adminSet(`rides/${b2.rideId}`, { status: 'accepted', driverId: 'webdrv' }, true);
await until(async () => /Priya is on the way in a Silver Toyota Prius AB12 CDE/.test(lastText().Body), 'accepted text');
t = await C.call('webTrack', { trackToken: b2.trackToken });
assert.equal(t.driver.name, 'Priya'); assert.equal(t.driver.registration, 'AB12 CDE'); assert.deepEqual(t.driver.position, { latitude: 52.3, longitude: -1.95 });
assert.equal(t.canCancel, false);
await assert.rejects(C.call('webCancel', { trackToken: b2.trackToken }), /driver is already on the way/);
await adminSet(`rides/${b2.rideId}`, { status: 'arrived' }, true);
await until(async () => /your driver is outside/.test(lastText().Body), 'arrived text');

step('trip completed: the fare is taken from the hold and credited to the firm\'s wallet, once');
await adminSet(`rides/${b2.rideId}`, { status: 'ongoing' }, true);
await adminSet(`rides/${b2.rideId}`, { status: 'completed' }, true);
ride = await until(async () => { const r = await adminGet(`rides/${b2.rideId}`); return r.webPayment.status === 'captured' && r; }, 'capture');
assert.equal(ride.webPayment.capturedAmount, 11.61);
const capture = stripeCalls.find((c) => c.p.endsWith(`pi_${csId}/capture`));
assert.equal(capture.form.amount_to_capture, '1161');
const wallet = await adminGet(`fleetWallets/${f.fleetId}`);
assert.equal(wallet.totalWebCardFares, 11.61);
assert.equal(wallet.totalCardFees, 0.37); assert.equal(Math.round(wallet.availableBalance * 100) / 100, 11.24, 'the firm pays the Stripe fee');
const ftx = await adminGet(`fleetWallets/${f.fleetId}/transactions/webfee_${b2.rideId}`);
assert.equal(ftx.type, 'card_fee'); assert.equal(ftx.amount, -0.37); assert.equal(ftx.estimated, false);
const wtx = await adminGet(`fleetWallets/${f.fleetId}/transactions/web_${b2.rideId}`);
assert.equal(wtx.type, 'web_card_fare'); assert.equal(wtx.amount, 11.61); assert.equal(wtx.driverId, 'webdrv');
assert.equal(stripeCalls.filter((c) => c.p.endsWith('/capture')).length, 1);

step('a paid booking cancelled by the office releases the hold and tells the customer');
const b3 = await C.call('webBook', { token, pickup: PICK, dropoff: DROP, passengers: 1, rideType: 'RouteMini', pay: 'card' });
const cs3 = b3.checkoutUrl.split('/').pop();
sessions[cs3].paid = true;
await C.call('webConfirmPayment', { token, rideId: b3.rideId });
await O.call('cancelFleetBooking', { rideId: b3.rideId });
ride = await until(async () => { const r = await adminGet(`rides/${b3.rideId}`); return r.webPayment.status === 'released' && r; }, 'release');
assert.ok(stripeCalls.find((c) => c.p.endsWith(`pi_${cs3}/cancel`)));
await until(async () => /sorry, your booking was cancelled\. The hold on your card has been released/.test(lastText().Body), 'office cancel text');

step('a card booking that is never paid lapses and is not sent to drivers');
const b4 = await C.call('webBook', { token, pickup: PICK, dropoff: DROP, passengers: 1, rideType: 'RouteMini', pay: 'card' });
sessions[b4.checkoutUrl.split('/').pop()].expired = true;
assert.equal((await C.call('webConfirmPayment', { token, rideId: b4.rideId })).status, 'cancelled');
ride = await adminGet(`rides/${b4.rideId}`);
assert.equal(ride.cancelReason, 'not_paid'); assert.equal(ride.webPayment.status, 'failed');

step('the customer\'s page lists their bookings; card only for the next 5 days');
const me = await C.call('webSession', { token });
assert.equal(me.phoneEnding, '555'); assert.equal(me.name, 'Sam');
assert.equal(me.bookings.length, 4); assert.equal(me.bookings[0].id, b4.rideId);
assert.ok(me.saved.some((a) => /12 Station Road/.test(a.address)));
const far = new Date(Date.now() + 8 * 86400000).toISOString();
await assert.rejects(C.call('webBook', { token, pickup: PICK, dropoff: DROP, pickupAt: far, passengers: 1, rideType: 'RouteMini', pay: 'card' }), /next 5 days/);

step('a blocked number cannot get a code or book; unblocked, it can again');
await O.call('blockFleetNumber', { phone: '07700 900555', reason: 'no-shows' });
await assert.rejects(C.call('webBook', { token, pickup: PICK, dropoff: DROP, passengers: 1, rideType: 'RouteMini', pay: 'driver' }), /can't take online bookings from this number/);
await assert.rejects(C.call('webSendCode', { slug: 'time-taxis', phone: '07700900555' }), /can't take online bookings from this number/);
await O.call('unblockFleetNumber', { phone: '+447700900555' });
await C.call('webBook', { token, pickup: PICK, dropoff: DROP, passengers: 1, rideType: 'RouteMini', pay: 'driver' }).catch((e) => assert.doesNotMatch(e.message, /this number/));

step('switched off: the page closes');
await O.call('saveFleetWebBooking', { enabled: false });
await assert.rejects(C.call('webBookerInfo', { slug: 'time-taxis' }), /not available/);

fake.close();
console.log('ALL WEB BOOKER CHECKS PASSED');
process.exit(0);
