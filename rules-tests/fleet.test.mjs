import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import { collection, doc, setDoc, updateDoc, getDoc, getDocs, arrayUnion, limit, orderBy, query, Timestamp, where } from 'firebase/firestore';

let env;
const RULES = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

const driver = (fleetId, extra = {}) => ({ approved: true, vehicleType: 'RouteMini', status: 'online', ...(fleetId ? { fleetId } : {}), ...extra });
const phoneJob = (extra = {}) => ({
  source: 'phone', fleetId: 'f1', riderId: null, driverId: null, status: 'dispatching', rideType: 'RouteMini',
  dispatch: { driverId: null }, declinedBy: [], walletProcessed: false, ...extra,
});

const cFuture = () => Timestamp.fromMillis(Date.now() + 3600 * 1000);
const cPast = () => Timestamp.fromMillis(Date.now() - 3600 * 1000);
const cAppJob = (extra = {}) => ({
  riderId: 'r1', driverId: null, status: 'searching', rideType: 'RouteMini', walletProcessed: false, pricing: 'checked',
  declinedBy: [], fare: { total: 10 }, fareEstimate: 10, ...extra,
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
    await setDoc(doc(db, 'fleets/f1/blockedNumbers/+447700900999'), { phone: '+447700900999', reason: 'x' });
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
    await setDoc(doc(db, 'drivers/cfree'), { approved: true, vehicleType: 'RouteMini', status: 'online', fleetId: 'f1' });
    await setDoc(doc(db, 'drivers/cblocked'), { approved: true, vehicleType: 'RouteMini', status: 'online', fleetId: 'f1', cancelBlockedUntil: cFuture() });
    await setDoc(doc(db, 'drivers/coff'), { approved: true, vehicleType: 'RouteMini', status: 'offline', cancelBlockedUntil: cFuture() });
    await setDoc(doc(db, 'drivers/cexpired'), { approved: true, vehicleType: 'RouteMini', status: 'offline', cancelBlockedUntil: cPast() });
    await setDoc(doc(db, 'drivers/cbusy'), { approved: true, vehicleType: 'RouteMini', status: 'on_ride', cancelBlockedUntil: cFuture() });
    await setDoc(doc(db, 'rides/cphone'), phoneJob());
    await setDoc(doc(db, 'rides/capp'), cAppJob());
    await setDoc(doc(db, 'rides/ctook'), cAppJob({ status: 'accepted', driverId: 'cfree' }));
    await setDoc(doc(db, 'driverCancellations/c1'), { fleetId: 'f1', driverId: 'cfree', at: new Date(), rideId: 'x' });
    await setDoc(doc(db, 'driverCancellations/c2'), { fleetId: null, driverId: 'dind', at: new Date(), rideId: 'y' });
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

test('staff create a contact card for a new number, nothing more', async () => {
  const card = { phone: '+447700900123', name: 'Kim', notes: '', places: [], createdAt: new Date(), createdBy: 'op1' };
  await assertSucceeds(setDoc(doc(as('op1'), 'fleets/f1/customers/+447700900123'), card));
  await assertFails(setDoc(doc(as('op1'), 'fleets/f1/customers/+447700900124'), { ...card, phone: '+447700900124', bookings: 50 }));
  await assertFails(setDoc(doc(as('op1'), 'fleets/f1/customers/abc'), { ...card, phone: 'abc' }));
  await assertFails(setDoc(doc(as('op1'), 'fleets/f1/customers/+447700900125'), { ...card, phone: '+440000' }));
  await assertFails(setDoc(doc(as('own2'), 'fleets/f1/customers/+447700900126'), { ...card, phone: '+447700900126' }));
});
test('staff keep saved places on a card', async () => {
  await assertSucceeds(updateDoc(doc(as('op1'), 'fleets/f1/customers/+447700900000'), { places: [{ label: 'Home', address: '1 High St', latitude: 51, longitude: 0 }] }));
  await assertSucceeds(updateDoc(doc(as('op1'), 'fleets/f1/customers/+447700900000'), { notes: 'Ring on arrival' }));
});

test('zone queues: staff and the fleet\'s drivers read, nobody writes', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'fleetQueues/f1'), { zones: { z1: [{ driverId: 'd1' }] } });
  });
  await assertSucceeds(getDoc(doc(as('op1'), 'fleetQueues/f1')));
  await assertSucceeds(getDoc(doc(as('d2'), 'fleetQueues/f1')));
  await assertFails(getDoc(doc(as('dx'), 'fleetQueues/f1')));
  await assertFails(getDoc(doc(as('dind'), 'fleetQueues/f1')));
  await assertFails(getDoc(doc(as('own2'), 'fleetQueues/f1')));
  await assertFails(setDoc(doc(as('own1'), 'fleetQueues/f1'), { zones: {} }));
  await assertFails(updateDoc(doc(as('d1'), 'fleetQueues/f1'), { zones: { z1: [{ driverId: 'd1' }] } }));
});
test('owner cannot write zones directly (saveFleetZones checks them)', () =>
  assertFails(updateDoc(doc(as('own1'), 'fleets/f1'), { zones: [], zoneCount: 0 })));

/* Gaps found in the live test (2026-11-01): the app filtered these, the rules did not. */
const searching = (extra = {}) => ({ riderId: 'r1', driverId: null, status: 'searching', rideType: 'RouteMini', walletProcessed: false, pricing: 'checked', ...extra });
test('a job the server has not price-checked cannot be taken; a passenger cannot mark their own booking checked', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'rides/unchecked'), searching({ pricing: null }));
  });
  await assertFails(updateDoc(doc(as('d1'), 'rides/unchecked'), claim('d1')));
  await assertFails(setDoc(doc(as('r1'), 'rides/mine'), { riderId: 'r1', status: 'searching', pricing: 'checked' }));
  await assertFails(setDoc(doc(as('r1'), 'rides/mine2'), { riderId: 'r1', status: 'searching', priceCheck: { expectedTotal: 1 } }));
  await assertSucceeds(setDoc(doc(as('r1'), 'rides/mine3'), { riderId: 'r1', status: 'searching' }));
});
test('female-only job needs a verified female driver', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'rides/fem'), searching({ femaleDriverOnly: true }));
    await setDoc(doc(db, 'drivers/dfem'), driver(null, { femaleVerified: true }));
  });
  await assertFails(updateDoc(doc(as('dind'), 'rides/fem'), claim('dind')));
  await assertSucceeds(updateDoc(doc(as('dfem'), 'rides/fem'), claim('dfem')));
});
test('driver the passenger blocked cannot take their job', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'rides/blk'), searching({ blockedDriverIds: ['dind'] }));
  });
  await assertFails(updateDoc(doc(as('dind'), 'rides/blk'), claim('dind')));
  await assertSucceeds(updateDoc(doc(as('d1'), 'rides/blk'), claim('d1')));
});
test('blocked driver cannot take app or fleet jobs', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'rides/open'), searching());
    await updateDoc(doc(db, 'drivers/d1'), { blocked: true });
  });
  await assertFails(updateDoc(doc(as('d1'), 'rides/open'), claim('d1')));
  await assertFails(updateDoc(doc(as('d1'), 'rides/broad'), claim('d1')));
});
test('blocked driver cannot go online, but can finish a trip', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'drivers/dblk'), driver(null, { blocked: true, status: 'offline' }));
    await setDoc(doc(db, 'drivers/dblk2'), driver(null, { blocked: true, status: 'on_ride', isOnRide: true }));
  });
  await assertFails(updateDoc(doc(as('dblk'), 'drivers/dblk'), { status: 'online' }));
  await assertSucceeds(updateDoc(doc(as('dblk2'), 'drivers/dblk2'), { status: 'online', isOnRide: false, currentRideId: null }));
});
test('staff save their own phone for calls, nothing else', async () => {
  await assertSucceeds(updateDoc(doc(as('op1'), 'fleetManagers/op1'), { phone: '+447700900555' }));
  await assertFails(updateDoc(doc(as('op1'), 'fleetManagers/op1'), { phone: '0770' }));
  await assertFails(updateDoc(doc(as('op1'), 'fleetManagers/own1'), { phone: '+447700900555' }));
  await assertFails(updateDoc(doc(as('op1'), 'fleetManagers/op1'), { phone: '+447700900555', role: 'owner' }));
});
test('driver cannot touch who suspended them', async () => {
  await assertFails(updateDoc(doc(as('d1'), 'drivers/d1'), { blockedByFleet: 'f1' }));
  await assertFails(updateDoc(doc(as('d1'), 'drivers/d1'), { blockedReason: '' }));
  await assertFails(setDoc(doc(as('dnew2'), 'drivers/dnew2'), { approved: false, blockedByFleet: 'f1' }));
});

const owes = { status: 'active', paymentMethod: 'wallet_deduction', debtAmount: 299, lastPaidAt: null };
const member = async (subscription, status = 'offline') => env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'drivers/d1'), { subscription, status }));
test('driver who has not paid their first month cannot go online', async () => {
  await member(owes);
  await assertFails(updateDoc(doc(as('d1'), 'drivers/d1'), { status: 'online' }));
});
test('driver who has paid can go online', async () => {
  await member({ ...owes, debtAmount: 0, lastPaidAt: new Date() });
  await assertSucceeds(updateDoc(doc(as('d1'), 'drivers/d1'), { status: 'online' }));
});
test('a renewal owed in its grace period does not stop going online', async () => {
  await member({ ...owes, status: 'past_due', lastPaidAt: new Date() });
  await assertSucceeds(updateDoc(doc(as('d1'), 'drivers/d1'), { status: 'online' }));
});
test('company driver whose fleet pays can go online', async () => {
  await member({ ...owes, paymentMethod: 'fleet' });
  await assertSucceeds(updateDoc(doc(as('d1'), 'drivers/d1'), { status: 'online' }));
});
test('unpaid driver can still finish a trip in progress', async () => {
  await member(owes, 'on_ride');
  await assertSucceeds(updateDoc(doc(as('d1'), 'drivers/d1'), { status: 'online' }));
});

test('fleet staff see their blocked numbers', () => assertSucceeds(getDoc(doc(as('op1'), 'fleets/f1/blockedNumbers/+447700900999'))));
test('another fleet cannot see them', () => assertFails(getDoc(doc(as('own2'), 'fleets/f1/blockedNumbers/+447700900999'))));
test('staff cannot block or unblock directly (the server does it)', () => assertFails(setDoc(doc(as('own1'), 'fleets/f1/blockedNumbers/+447700900111'), { phone: '+447700900111' })));

// Driver cancel penalty (functions/driverPenalty.js).
const cGiveBack = { status: 'searching', driverId: null, acceptedAt: null, lastDriverCancelAt: new Date() };
test('a driver cannot set or clear their own time penalty', async () => {
  await assertFails(updateDoc(doc(as('cfree'), 'drivers/cfree'), { cancelBlockedUntil: cPast() }));
  await assertFails(updateDoc(doc(as('coff'), 'drivers/coff'), { cancelBlockedUntil: null }));
});
test('a new driver doc cannot arrive already holding the field', async () => {
  await assertFails(setDoc(doc(as('new1'), 'drivers/new1'), { approved: false, blocked: false, femaleVerified: false, cancelBlockedUntil: cPast() }));
});
test('going online: refused during a penalty, fine once it ends, and a trip in progress can still close', async () => {
  await assertFails(updateDoc(doc(as('coff'), 'drivers/coff'), { status: 'online' }));
  await assertSucceeds(updateDoc(doc(as('cexpired'), 'drivers/cexpired'), { status: 'online' }));
  await assertSucceeds(updateDoc(doc(as('cbusy'), 'drivers/cbusy'), { status: 'online' }));
});
test('claiming a phone job: refused during a penalty, allowed without one', async () => {
  await assertFails(updateDoc(doc(as('cblocked'), 'rides/cphone'), claim('cblocked')));
  await assertSucceeds(updateDoc(doc(as('cfree'), 'rides/cphone'), claim('cfree')));
});
test('claiming an app job: refused during a penalty, allowed without one', async () => {
  await assertFails(updateDoc(doc(as('cblocked'), 'rides/capp'), claim('cblocked')));
  await assertSucceeds(updateDoc(doc(as('cfree'), 'rides/capp'), claim('cfree')));
});
test('giving a job back still works, but a driver cannot pass it off as a server release', async () => {
  await assertFails(updateDoc(doc(as('cfree'), 'rides/ctook'), { ...cGiveBack, serverReleasedAt: new Date() }));
  await assertSucceeds(updateDoc(doc(as('cfree'), 'rides/ctook'), cGiveBack));
});
test('driverCancellations: admin, the driver and that fleet read; nobody writes', async () => {
  await assertSucceeds(getDoc(doc(as('adm'), 'driverCancellations/c1')));
  await assertSucceeds(getDoc(doc(as('adm'), 'driverCancellations/c2')));
  await assertSucceeds(getDoc(doc(as('cfree'), 'driverCancellations/c1')));
  await assertSucceeds(getDoc(doc(as('op1'), 'driverCancellations/c1')));
  await assertFails(getDoc(doc(as('op2'), 'driverCancellations/c1')));
  await assertFails(getDoc(doc(as('op1'), 'driverCancellations/c2')));
  await assertFails(getDoc(doc(as('r1'), 'driverCancellations/c1')));
  await assertFails(setDoc(doc(as('adm'), 'driverCancellations/c9'), { fleetId: 'f1' }));
  await assertFails(updateDoc(doc(as('cfree'), 'driverCancellations/c1'), { penalty: null }));
});
test('the fleet panel query works for its own fleet only', async () => {
  const q = (db, fleetId) => query(collection(db, 'driverCancellations'), where('fleetId', '==', fleetId), orderBy('at', 'desc'), limit(200));
  await assertSucceeds(getDocs(q(as('op1'), 'f1')));
  await assertFails(getDocs(q(as('op2'), 'f1')));
});
test('the admin panel query works', async () => {
  await assertSucceeds(getDocs(query(collection(as('adm'), 'driverCancellations'), orderBy('at', 'desc'), limit(200))));
  await assertFails(getDocs(query(collection(as('op1'), 'driverCancellations'), orderBy('at', 'desc'), limit(200))));
});
