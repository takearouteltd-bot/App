import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import { doc, setDoc, updateDoc, getDoc, arrayUnion } from 'firebase/firestore';

let env;
const RULES = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

const driver = (fleetId, extra = {}) => ({ approved: true, vehicleType: 'RouteMini', status: 'online', ...(fleetId ? { fleetId } : {}), ...extra });
const phoneJob = (extra = {}) => ({
  source: 'phone', fleetId: 'f1', riderId: null, driverId: null, status: 'dispatching', rideType: 'RouteMini',
  dispatch: { driverId: null }, declinedBy: [], walletProcessed: false, ...extra,
});

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-tar', firestore: { rules: RULES, host: '127.0.0.1', port: 8080 } });
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'admins/adm'), { isActive: true });
    await setDoc(doc(db, 'fleetManagers/own1'), { fleetId: 'f1', role: 'owner', isActive: true });
    await setDoc(doc(db, 'fleetManagers/op1'), { fleetId: 'f1', role: 'operator', isActive: true });
    await setDoc(doc(db, 'fleetManagers/own2'), { fleetId: 'f2', role: 'owner', isActive: true });
    await setDoc(doc(db, 'fleetManagers/gone'), { fleetId: 'f1', role: 'owner', isActive: false });
    await setDoc(doc(db, 'fleets/f1'), { name: 'A Cars', joinCode: 'ABC123', dispatchLeadMinutes: 20, phone: '' });
    await setDoc(doc(db, 'fleets/f2'), { name: 'B Cars', joinCode: 'XYZ789' });
    await setDoc(doc(db, 'fleets/f1/customers/+447700900000'), { name: 'Ann', phone: '+447700900000', bookings: 1 });
    await setDoc(doc(db, 'fleetWallets/f1'), { availableBalance: 10 });
    await setDoc(doc(db, 'fleetWallets/f1/transactions/t1'), { amount: 10 });
    await setDoc(doc(db, 'drivers/d1'), driver('f1', { onboardingComplete: true }));
    await setDoc(doc(db, 'drivers/d2'), driver('f1'));
    await setDoc(doc(db, 'drivers/dx'), driver('f2'));
    await setDoc(doc(db, 'drivers/dind'), driver(null));
    await setDoc(doc(db, 'rides/broad'), phoneJob());
    await setDoc(doc(db, 'rides/target'), phoneJob({ dispatch: { driverId: 'd2' } }));
    await setDoc(doc(db, 'rides/sched'), phoneJob({ status: 'scheduled' }));
    await setDoc(doc(db, 'rides/took'), phoneJob({ status: 'accepted', driverId: 'd1' }));
    await setDoc(doc(db, 'rides/app'), { riderId: 'r1', driverId: 'd1', status: 'accepted', rideType: 'RouteMini' });
  });
});
after(async () => { await env.cleanup(); });

const as = (uid) => env.authenticatedContext(uid).firestore();
const claim = (uid) => ({ status: 'accepted', driverId: uid, acceptedAt: new Date(), walletProcessed: false });

test('fleet driver takes a broadcast phone job', () => assertSucceeds(updateDoc(doc(as('d1'), 'rides/broad'), claim('d1'))));
test('other fleet driver cannot take it', () => assertFails(updateDoc(doc(as('dx'), 'rides/broad'), claim('dx'))));
test('independent driver cannot take it', () => assertFails(updateDoc(doc(as('dind'), 'rides/broad'), claim('dind'))));
test('only the chosen driver takes a targeted job', async () => {
  await assertFails(updateDoc(doc(as('d1'), 'rides/target'), claim('d1')));
  await assertSucceeds(updateDoc(doc(as('d2'), 'rides/target'), claim('d2')));
});
test('scheduled job cannot be taken early', () => assertFails(updateDoc(doc(as('d1'), 'rides/sched'), claim('d1'))));
test('driver who declined cannot then take it', async () => {
  await assertSucceeds(updateDoc(doc(as('d1'), 'rides/broad'), { declinedBy: arrayUnion('d1') }));
  await assertFails(updateDoc(doc(as('d1'), 'rides/broad'), claim('d1')));
});
test('decline cannot add someone else', () => assertFails(updateDoc(doc(as('d1'), 'rides/broad'), { declinedBy: ['d1', 'd2'] })));
test('claim cannot change the fare', () => assertFails(updateDoc(doc(as('d1'), 'rides/broad'), { ...claim('d1'), fare: { total: 999 } })));
test('phone job given back goes to dispatching, not searching', async () => {
  const back = (status) => ({ status, driverId: null, acceptedAt: null, declinedBy: ['d1'] });
  await assertFails(updateDoc(doc(as('d1'), 'rides/took'), back('searching')));
  await assertSucceeds(updateDoc(doc(as('d1'), 'rides/took'), back('dispatching')));
});
test('app job given back still goes to searching', () =>
  assertSucceeds(updateDoc(doc(as('d1'), 'rides/app'), { status: 'searching', driverId: null, acceptedAt: null })));

test('driver cannot put themselves in a fleet', async () => {
  await assertFails(updateDoc(doc(as('dind'), 'drivers/dind'), { fleetId: 'f1' }));
  await assertFails(updateDoc(doc(as('d1'), 'drivers/d1'), { fleetId: null }));
  await assertFails(updateDoc(doc(as('dind'), 'drivers/dind'), { fleetRequest: { fleetId: 'f1' } }));
});
test('new driver record cannot start in a fleet', () =>
  assertFails(setDoc(doc(as('dnew'), 'drivers/dnew'), { approved: false, fleetId: 'f1' })));
test('driver can still update ordinary fields', () =>
  assertSucceeds(updateDoc(doc(as('dind'), 'drivers/dind'), { status: 'offline' })));

test('staff read their own fleet, wallet and customers only', async () => {
  for (const uid of ['own1', 'op1']) {
    await assertSucceeds(getDoc(doc(as(uid), 'fleets/f1')));
    await assertSucceeds(getDoc(doc(as(uid), 'fleetWallets/f1')));
    await assertSucceeds(getDoc(doc(as(uid), 'fleetWallets/f1/transactions/t1')));
    await assertSucceeds(getDoc(doc(as(uid), 'fleets/f1/customers/+447700900000')));
  }
  await assertFails(getDoc(doc(as('own2'), 'fleets/f1')));
  await assertFails(getDoc(doc(as('own2'), 'fleetWallets/f1')));
  await assertFails(getDoc(doc(as('own2'), 'fleets/f1/customers/+447700900000')));
  await assertFails(getDoc(doc(as('gone'), 'fleets/f1')));
  await assertFails(getDoc(doc(as('d1'), 'fleetWallets/f1')));
});
test('owner edits contact and lead time, nothing else', async () => {
  await assertSucceeds(updateDoc(doc(as('own1'), 'fleets/f1'), { phone: '+441234', dispatchLeadMinutes: 30 }));
  await assertFails(updateDoc(doc(as('own1'), 'fleets/f1'), { dispatchLeadMinutes: 500 }));
  await assertFails(updateDoc(doc(as('own1'), 'fleets/f1'), { joinCode: 'MINE' }));
  await assertFails(updateDoc(doc(as('op1'), 'fleets/f1'), { phone: '+44' }));
});
test('staff can rename a customer but not change bookings', async () => {
  await assertSucceeds(updateDoc(doc(as('op1'), 'fleets/f1/customers/+447700900000'), { name: 'Ann B' }));
  await assertFails(updateDoc(doc(as('op1'), 'fleets/f1/customers/+447700900000'), { bookings: 99 }));
});
test('nobody but admins writes wallets or staff records', async () => {
  await assertFails(updateDoc(doc(as('own1'), 'fleetWallets/f1'), { availableBalance: 1e6 }));
  await assertFails(setDoc(doc(as('own1'), 'fleetManagers/new'), { fleetId: 'f1', isActive: true, role: 'owner' }));
  await assertFails(updateDoc(doc(as('op1'), 'fleetManagers/op1'), { role: 'owner' }));
  await assertSucceeds(updateDoc(doc(as('adm'), 'fleetWallets/f1'), { availableBalance: 5 }));
});
test('staff see their colleagues, not other fleets', async () => {
  await assertSucceeds(getDoc(doc(as('op1'), 'fleetManagers/own1')));
  await assertFails(getDoc(doc(as('op1'), 'fleetManagers/own2')));
});
