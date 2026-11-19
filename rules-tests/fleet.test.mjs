import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import { collection, doc, setDoc, updateDoc, getDoc, getDocs, arrayUnion, limit, orderBy, query, serverTimestamp, Timestamp, where, addDoc, deleteField, deleteDoc } from 'firebase/firestore';

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
const claim = (uid) => ({ status: 'accepted', driverId: uid, acceptedAt: serverTimestamp(), walletProcessed: false });

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
test('ended or paused membership cannot go online; active can; a trip still finishes', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'drivers/mexp'), driver(null, { status: 'offline', subscription: { status: 'expired', tier: 'weekly', autoRenew: false } }));
    await setDoc(doc(db, 'drivers/msus'), driver(null, { status: 'offline', subscription: { status: 'suspended' } }));
    await setDoc(doc(db, 'drivers/mok'), driver(null, { status: 'offline', subscription: { status: 'active', tier: 'weekly', lastPaidAt: Timestamp.now(), debtAmount: 0 } }));
    await setDoc(doc(db, 'drivers/mtrip'), driver(null, { status: 'on_ride', isOnRide: true, subscription: { status: 'expired' } }));
  });
  await assertFails(updateDoc(doc(as('mexp'), 'drivers/mexp'), { status: 'online' }));
  await assertFails(updateDoc(doc(as('msus'), 'drivers/msus'), { status: 'online' }));
  await assertSucceeds(updateDoc(doc(as('mok'), 'drivers/mok'), { status: 'online' }));
  await assertSucceeds(updateDoc(doc(as('mtrip'), 'drivers/mtrip'), { status: 'online', isOnRide: false, currentRideId: null }));
  await assertFails(updateDoc(doc(as('mok'), 'drivers/mok'), { 'subscription.autoRenew': false }));
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

/* ==================== Privacy (2026-11-10) ==================== */
const seed = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));
const stranger = 'stranger1';
const seedPrivate = () => seed(async (db) => {
  await setDoc(doc(db, 'drivers/priv'), { fullName: 'Pat Driver', selfieUrl: 'https://x/selfie', makeModel: 'Prius', registrationNumber: 'AB12CDE', rating: 4.9, approved: true, status: 'online', onboardingComplete: true, fleetId: 'f1' });
  await setDoc(doc(db, 'driverPrivate/priv'), { accountDetails: { sortCode: '123456', accountNumber: '12345678' }, nin: 'AB123456C', dob: '01/01/1990', address: '1 Home St', phoneNumber: '+447700900100', emergencyContact: { name: 'Sam' }, payoutAccountId: 'acct_1', payoutAccountFingerprint: '123456:12345678' });
  await setDoc(doc(db, 'driverFiles/priv'), { motUrl: 'https://x/mot', pcoLicenseUrl: 'https://x/pco', rightToWorkShareCode: 'W12345678' });
  await setDoc(doc(db, 'drivers/applicant'), { fullName: 'New Person', approved: false, onboardingComplete: true, fleetRequest: { fleetId: 'f1', fleetName: 'A Cars' } });
  await setDoc(doc(db, 'driverFiles/applicant'), { motUrl: 'https://x/mot2', rightToWorkShareCode: 'W2' });
  await setDoc(doc(db, 'driverPrivate/applicant'), { nin: 'CD123456D' });
  await setDoc(doc(db, 'drivers/draft'), { approved: false, onboardingComplete: false, status: 'offline' });
  await setDoc(doc(db, 'riders/pass1'), { fullName: 'Ann Passenger', phoneNumber: '+447700900200', email: 'ann@example.com', rating: 4.5, emergencyContact: { name: 'Bo', phone: '+447700900201' }, stripeCustomerId: 'cus_1' });
  await setDoc(doc(db, 'riderPublic/pass1'), { fullName: 'Ann Passenger', profileImage: 'https://x/p', rating: 4.5 });
  await setDoc(doc(db, 'rides/phonejob'), phoneJob({ status: 'accepted', driverId: 'd1', customer: { name: 'Kim', phone: '+447700900300' } }));
  await setDoc(doc(db, 'rides/waiting'), phoneJob({ customer: { name: 'Lee', phone: '+447700900301' } }));
  await setDoc(doc(db, 'fleetJobOffers/waiting'), { fleetId: 'f1', status: 'dispatching', source: 'phone', customer: { name: 'Lee' }, dispatch: { driverId: null, mode: 'all' }, rideType: 'RouteMini' });
  await setDoc(doc(db, 'rides/appjob'), cAppJob({ riderId: 'pass1' }));
});
beforeEach(seedPrivate);

test('privacy: a stranger cannot read a driver\'s private details or documents', async () => {
  await assertFails(getDoc(doc(as(stranger), 'driverPrivate/priv')));
  await assertFails(getDoc(doc(as(stranger), 'driverFiles/priv')));
  await assertFails(getDocs(collection(as(stranger), 'driverPrivate')));
  await assertFails(getDocs(collection(as(stranger), 'driverFiles')));
  await assertFails(getDoc(doc(as('r1'), 'driverPrivate/priv')));
  await assertFails(getDoc(doc(as('d1'), 'driverPrivate/priv')));
});
test('privacy: another fleet cannot read documents, and even a driver\'s own fleet cannot read their bank details', async () => {
  await assertFails(getDoc(doc(as('own2'), 'driverFiles/priv')));
  await assertFails(getDoc(doc(as('own1'), 'driverPrivate/priv')));
  await assertFails(getDoc(doc(as('op1'), 'driverPrivate/applicant')));
});
test('privacy: the driver and admins read the private details; admin lists them', async () => {
  await assertSucceeds(getDoc(doc(as('priv'), 'driverPrivate/priv')));
  await assertSucceeds(getDoc(doc(as('priv'), 'driverFiles/priv')));
  await assertSucceeds(getDoc(doc(as('adm'), 'driverPrivate/priv')));
  await assertSucceeds(getDoc(doc(as('adm'), 'driverFiles/priv')));
  await assertSucceeds(getDocs(collection(as('adm'), 'driverPrivate')));
  await assertSucceeds(getDocs(collection(as('adm'), 'driverFiles')));
});
test('privacy: fleet staff read documents of their own driver and an applicant, not others', async () => {
  await assertSucceeds(getDoc(doc(as('own1'), 'driverFiles/priv')));
  await assertSucceeds(getDoc(doc(as('op1'), 'driverFiles/applicant')));
  await assertFails(getDoc(doc(as('own2'), 'driverFiles/applicant')));
  await assertFails(getDoc(doc(as('gone'), 'driverFiles/priv')));
});
test('privacy: passengers read their driver\'s public record, not the private one', async () => {
  const s = await assertSucceeds(getDoc(doc(as('pass1'), 'drivers/priv')));
  if (s.data().nin || s.data().accountDetails) throw new Error('private fields on the public record');
  await assertFails(getDoc(doc(as('pass1'), 'driverPrivate/priv')));
});
test('privacy: nobody but admins and fleet staff can list the driver records', async () => {
  await assertFails(getDocs(collection(as(stranger), 'drivers')));
  await assertFails(getDocs(collection(as('pass1'), 'drivers')));
  await assertSucceeds(getDocs(collection(as('adm'), 'drivers')));
  await assertSucceeds(getDocs(query(collection(as('op1'), 'drivers'), where('fleetId', '==', 'f1'))));
  await assertSucceeds(getDocs(query(collection(as('own1'), 'drivers'), where('fleetRequest.fleetId', '==', 'f1'))));
  await assertSucceeds(getDocs(query(collection(as('own1'), 'drivers'), where('removedFromFleetId', '==', 'f1'))));
  await assertFails(getDocs(query(collection(as('own2'), 'drivers'), where('fleetId', '==', 'f1'))));
  await assertFails(getDocs(query(collection(as(stranger), 'drivers'), where('fleetId', '==', 'f1'))));
});
test('privacy: a passenger\'s record is theirs and admins\' only; drivers get the public card', async () => {
  await assertFails(getDoc(doc(as(stranger), 'riders/pass1')));
  await assertFails(getDoc(doc(as('d1'), 'riders/pass1')));
  await assertFails(getDocs(collection(as('d1'), 'riders')));
  await assertSucceeds(getDoc(doc(as('pass1'), 'riders/pass1')));
  await assertSucceeds(getDoc(doc(as('adm'), 'riders/pass1')));
  const card = await assertSucceeds(getDoc(doc(as('d1'), 'riderPublic/pass1')));
  if (card.data().phoneNumber) throw new Error('phone on the public card');
  await assertFails(getDoc(doc(as(stranger), 'riderPublic/pass1')));
  await assertFails(getDocs(collection(as('d1'), 'riderPublic')));
  await assertFails(setDoc(doc(as('pass1'), 'riderPublic/pass1'), { fullName: 'x' }));
});
test('privacy: a ride is only readable by its people, and a phone job\'s number stays with them', async () => {
  await assertFails(getDoc(doc(as(stranger), 'rides/phonejob')));
  await assertFails(getDoc(doc(as('d2'), 'rides/phonejob')));
  await assertFails(getDoc(doc(as('dx'), 'rides/phonejob')));
  await assertSucceeds(getDoc(doc(as('d1'), 'rides/phonejob')));
  await assertSucceeds(getDoc(doc(as('op1'), 'rides/phonejob')));
  await assertFails(getDoc(doc(as('own2'), 'rides/phonejob')));
  await assertSucceeds(getDoc(doc(as('adm'), 'rides/phonejob')));
  await assertSucceeds(getDoc(doc(as('pass1'), 'rides/appjob')));
  await assertFails(getDoc(doc(as(stranger), 'rides/appjob')));
});
test('privacy: rides cannot be listed wholesale, and the app queries still work', async () => {
  await assertFails(getDocs(collection(as(stranger), 'rides')));
  await assertFails(getDocs(collection(as('dind'), 'rides')));
  await assertFails(getDocs(query(collection(as('dind'), 'rides'), where('fleetId', '==', 'f1'))));
  await assertFails(getDocs(query(collection(as(stranger), 'rides'), where('status', '==', 'searching'))));
  await assertSucceeds(getDocs(collection(as('adm'), 'rides')));
  await assertSucceeds(getDocs(query(collection(as('pass1'), 'rides'), where('riderId', '==', 'pass1'))));
  await assertSucceeds(getDocs(query(collection(as('d1'), 'rides'), where('driverId', '==', 'd1'))));
  await assertSucceeds(getDocs(query(collection(as('d1'), 'rides'), where('driverId', '==', 'd1'), where('status', '==', 'accepted'))));
  await assertSucceeds(getDocs(query(collection(as('d1'), 'rides'), where('status', '==', 'searching'))));
  await assertSucceeds(getDocs(query(collection(as('op1'), 'rides'), where('fleetId', '==', 'f1'))));
  await assertFails(getDocs(query(collection(as('own2'), 'rides'), where('fleetId', '==', 'f1'))));
  await assertSucceeds(getDocs(query(collection(as('d1'), 'rides'), where('fleetId', '==', 'f1'), where('driverId', '==', 'd1'))));
});
test('privacy: a fleet\'s drivers see the job on offer without the number, others do not', async () => {
  const list = await assertSucceeds(getDocs(query(collection(as('d1'), 'fleetJobOffers'), where('fleetId', '==', 'f1'))));
  if (JSON.stringify(list.docs.map((d) => d.data())).includes('+44')) throw new Error('number on the offer');
  await assertSucceeds(getDoc(doc(as('d2'), 'fleetJobOffers/waiting')));
  await assertFails(getDocs(query(collection(as('dx'), 'fleetJobOffers'), where('fleetId', '==', 'f1'))));
  await assertFails(getDocs(collection(as('dind'), 'fleetJobOffers')));
  await assertFails(getDoc(doc(as(stranger), 'fleetJobOffers/waiting')));
  await assertFails(setDoc(doc(as('d1'), 'fleetJobOffers/waiting'), { fleetId: 'f1' }));
  await assertFails(getDoc(doc(as('d1'), 'rides/waiting')));
  await assertFails(getDoc(doc(as('d2'), 'rides/waiting')));
  await assertSucceeds(updateDoc(doc(as('d1'), 'rides/waiting'), claim('d1')));
});
test('privacy: private fields cannot be written onto the public driver record', async () => {
  await assertFails(updateDoc(doc(as('draft'), 'drivers/draft'), { accountDetails: { sortCode: '1' } }));
  await assertFails(updateDoc(doc(as('draft'), 'drivers/draft'), { nin: 'AB123456C' }));
  await assertFails(updateDoc(doc(as('draft'), 'drivers/draft'), { phoneNumber: '+447700900000' }));
  await assertFails(updateDoc(doc(as('draft'), 'drivers/draft'), { motUrl: 'https://x' }));
  await assertFails(setDoc(doc(as('dnew3'), 'drivers/dnew3'), { approved: false, phoneNumber: '+447700900000' }));
  await assertSucceeds(updateDoc(doc(as('draft'), 'drivers/draft'), { fullName: 'Draft Person', makeModel: 'Golf' }));
});
test('privacy: a driver files private details while applying, then only their emergency contact', async () => {
  await assertSucceeds(setDoc(doc(as('draft'), 'driverPrivate/draft'), { nin: 'AB123456C', dob: '01/01/1990' }, { merge: true }));
  await assertSucceeds(setDoc(doc(as('draft'), 'driverFiles/draft'), { motUrl: 'https://x/m', rightToWorkShareCode: 'W9' }, { merge: true }));
  await assertSucceeds(setDoc(doc(as('newbie'), 'driverPrivate/newbie'), { nin: 'AB123456C' }));
  await assertFails(setDoc(doc(as('draft'), 'driverPrivate/draft'), { payoutAccountId: 'acct_evil' }, { merge: true }));
  await assertFails(updateDoc(doc(as('priv'), 'driverPrivate/priv'), { accountDetails: { sortCode: '999999', accountNumber: '99999999' } }));
  await assertFails(updateDoc(doc(as('priv'), 'driverFiles/priv'), { motUrl: 'https://x/new' }));
  await assertSucceeds(updateDoc(doc(as('priv'), 'driverPrivate/priv'), { emergencyContact: { name: 'New' } }));
  await assertFails(setDoc(doc(as(stranger), 'driverPrivate/priv'), { nin: 'x' }, { merge: true }));
  await assertSucceeds(updateDoc(doc(as('adm'), 'driverPrivate/priv'), { accountDetails: { sortCode: '111111', accountNumber: '11111111' } }));
  await assertFails(deleteDoc(doc(as('priv'), 'driverPrivate/priv')));
});
test('rating cannot be overwritten by anyone', async () => {
  await assertFails(updateDoc(doc(as('dind'), 'drivers/priv'), { rating: 1 }));
  await assertFails(updateDoc(doc(as(stranger), 'riders/pass1'), { rating: 1 }));
  await assertFails(updateDoc(doc(as('pass1'), 'riders/pass1'), { rating: 5 }));
});
test('promo codes cannot be listed or read by users', async () => {
  await seed((db) => setDoc(doc(db, 'promoCodes/SAVE'), { percent: 10 }));
  await assertFails(getDocs(collection(as('pass1'), 'promoCodes')));
  await assertFails(getDoc(doc(as('pass1'), 'promoCodes/SAVE')));
  await assertSucceeds(getDocs(collection(as('adm'), 'promoCodes')));
});
test('a report goes in under the reporter\'s own id, not routed to a fleet by hand', async () => {
  const r = { description: 'x', status: 'open' };
  await assertSucceeds(addDoc(collection(as('pass1'), 'reports'), { ...r, reporterId: 'pass1' }));
  await assertFails(addDoc(collection(as('pass1'), 'reports'), { ...r, reporterId: 'someone_else' }));
  await assertFails(addDoc(collection(as('pass1'), 'reports'), r));
  await assertFails(addDoc(collection(as('pass1'), 'reports'), { ...r, reporterId: 'pass1', fleetId: 'f1' }));
});
test('handing in the application is one-way: no switching it off to edit protected details', async () => {
  await assertFails(updateDoc(doc(as('d1'), 'drivers/d1'), { onboardingComplete: false }));
  await assertFails(updateDoc(doc(as('d1'), 'drivers/d1'), { onboardingComplete: false, vehicleType: 'RouteExecutive' }));
  await assertFails(updateDoc(doc(as('d1'), 'drivers/d1'), { vehicleType: 'RouteExecutive' }));
  await assertSucceeds(updateDoc(doc(as('draft'), 'drivers/draft'), { onboardingComplete: true, onboardingStatus: 'pending' }));
  await assertSucceeds(updateDoc(doc(as('adm'), 'drivers/d1'), { onboardingComplete: false }));
});
const booking = (extra = {}) => ({ riderId: 'pass1', driverId: null, status: 'searching', rideType: 'RouteMini', ...extra });
test('a passenger can only create an ordinary app booking', async () => {
  const db = as('pass1');
  await assertSucceeds(addDoc(collection(db, 'rides'), booking()));
  await assertSucceeds(addDoc(collection(db, 'rides'), booking({ source: 'app' })));
  await assertFails(addDoc(collection(db, 'rides'), booking({ source: 'phone' })));
  await assertFails(addDoc(collection(db, 'rides'), booking({ status: 'dispatching', source: 'phone', fleetId: 'f1' })));
  await assertFails(addDoc(collection(db, 'rides'), booking({ fleetId: 'f1' })));
  await assertFails(addDoc(collection(db, 'rides'), booking({ status: 'accepted', driverId: 'd1' })));
  await assertFails(addDoc(collection(db, 'rides'), booking({ driverId: 'd1' })));
  await assertFails(addDoc(collection(db, 'rides'), booking({ pricing: 'checked' })));
});
/* Audit 19 Nov 2026: a booking cannot arrive with the server's payment or
   money fields, and after the price check only the price may move. */
test('a booking cannot carry a card hold, payment state or the driver\'s money', async () => {
  const db = as('pass1');
  for (const extra of [
    { paymentStatus: 'authorized' }, { paymentIntentId: 'pi_someone_else' },
    { paymentStatus: 'authorized', paymentIntentId: 'pi_x' }, { paymentFailure: { at: 1 } },
    { earnings: { driverEarning: 100 } }, { walletProcessed: true }, { promoTopUpProcessed: true },
    { fare: { total: 10, cashExtra: 10 } }, { fare: { total: 10, finalTotal: 1 } },
    { fare: { total: 10, agreedPrice: 1 } }, { fare: { total: 10, extendedExtra: 5 } },
  ]) {
    await assertFails(addDoc(collection(db, 'rides'), booking(extra)), JSON.stringify(extra));
  }
  await assertSucceeds(addDoc(collection(db, 'rides'), booking({ fare: { total: 10, discount: 0, promoCode: null } })));
});
test('raising an offer: bidding rides only, upwards only, and only the price keys of the fare', async () => {
  const fare = { total: 10, subtotal: 8.33, vat: 1.67, vatPercent: 20, promoCode: null, discount: 0, discountAmount: 0 };
  const priced = (price) => ({ ...fare, total: price, subtotal: Math.round(price / 1.2 * 100) / 100, vat: Math.round((price - price / 1.2) * 100) / 100, agreedPrice: price, recommendedTotal: 10 });
  await seed(async (db) => {
    await setDoc(doc(db, 'rides/bid'), searching({ riderId: 'pass1', bidding: true, offeredFare: 10, fareEstimate: 10, fare }));
    await setDoc(doc(db, 'rides/plain'), searching({ riderId: 'pass1', bidding: false, offeredFare: null, fareEstimate: 10, fare }));
    await setDoc(doc(db, 'rides/nooffer'), searching({ riderId: 'pass1', bidding: true, fareEstimate: 10, fare }));
    await setDoc(doc(db, 'rides/unchecked'), searching({ riderId: 'pass1', bidding: true, offeredFare: 10, fareEstimate: 10, fare, pricing: 'pending' }));
  });
  const raise = (id, price, fareOver = {}) => updateDoc(doc(as('pass1'), 'rides', id),
    { offeredFare: price, fareEstimate: price, fare: { ...priced(price), ...fareOver } });
  await assertSucceeds(raise('bid', 12));
  await assertFails(raise('bid', 11), 'lower than the offer now on it');
  await assertFails(raise('bid', 13, { discountAmount: 5000 }), 'the promo money');
  await assertFails(raise('bid', 13, { cashExtra: 13 }), 'the cash part');
  await assertFails(raise('bid', 13, { vatPercent: 0 }), 'the VAT rate');
  await assertFails(raise('bid', 13, { promoCode: 'FREE', discount: 1 }), 'a promo');
  await assertFails(raise('plain', 1), 'not a bidding ride');
  await assertFails(raise('nooffer', 1), 'a booking that left the offer out');
  await assertFails(raise('unchecked', 12), 'before the server checked the price');
  await assertFails(updateDoc(doc(as('stranger'), 'rides/bid'),
    { offeredFare: 20, fareEstimate: 20, fare: priced(20) }), 'only the passenger');
});
test('taking a counter-offer cannot rewrite the rest of the fare', async () => {
  const fare = { total: 10, subtotal: 8.33, vat: 1.67, vatPercent: 20, promoCode: null, discount: 0, discountAmount: 0 };
  await seed(async (db) => {
    await setDoc(doc(db, 'drivers/cfree'), driver(null));
    await setDoc(doc(db, 'rides/co'), searching({ riderId: 'pass1', bidding: true, offeredFare: 10, fareEstimate: 10, fare }));
    await setDoc(doc(db, 'rides/co/offers/cfree'), { driverId: 'cfree', price: 9, status: 'pending' });
  });
  const take = (fareOver) => updateDoc(doc(as('pass1'), 'rides/co'), {
    status: 'accepted', driverId: 'cfree', acceptedAt: serverTimestamp(), walletProcessed: false,
    offeredFare: 9, fareEstimate: 9, acceptedOfferId: 'cfree',
    fare: { ...fare, total: 9, subtotal: 7.5, vat: 1.5, agreedPrice: 9, recommendedTotal: 10, ...fareOver },
  });
  await assertFails(take({ discountAmount: 5000 }));
  await assertFails(take({ cashExtra: 9 }));
  await assertSucceeds(take({}));
});
test('a suspended passenger cannot book', async () => {
  await seed((db) => setDoc(doc(db, 'riders/susp'), { fullName: 'S', blocked: true }));
  await assertFails(addDoc(collection(as('susp'), 'rides'), booking({ riderId: 'susp' })));
});
const passengerCancel = (extra = {}) => ({ status: 'cancelled', cancelledBy: 'rider', cancelledAt: serverTimestamp(), ...extra });
const job = (extra) => seed((db) => setDoc(doc(db, 'rides/j1'), cAppJob({ riderId: 'pass1', status: 'accepted', driverId: 'cfree', ...extra })));
test('cancel times are the server\'s, and the phone cannot backdate them', async () => {
  await job({ status: 'accepted' });
  await assertFails(updateDoc(doc(as('pass1'), 'rides/j1'), { status: 'cancelled', cancelledBy: 'rider', cancelledAt: cPast() }));
  await assertSucceeds(updateDoc(doc(as('pass1'), 'rides/j1'), passengerCancel()));
});
test('arriving and starting use the server time', async () => {
  await job({ status: 'accepted' });
  await assertFails(updateDoc(doc(as('cfree'), 'rides/j1'), { status: 'arrived', arrivedAt: cPast() }));
  await assertSucceeds(updateDoc(doc(as('cfree'), 'rides/j1'), { status: 'arrived', arrivedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as('cfree'), 'rides/j1'), { status: 'ongoing', startedAt: cPast() }));
  await assertSucceeds(updateDoc(doc(as('cfree'), 'rides/j1'), { status: 'ongoing', startedAt: serverTimestamp() }));
});
test('claiming a job cannot backdate the acceptance', async () => {
  await assertFails(updateDoc(doc(as('d1'), 'rides/broad'), { ...claim('d1'), acceptedAt: cPast() }));
});
test('ended-early is only for a trip in progress, and a trip in progress must use it', async () => {
  await job({ status: 'arrived' });
  await assertFails(updateDoc(doc(as('pass1'), 'rides/j1'), passengerCancel({ endedEarly: true })));
  await job({ status: 'ongoing' });
  await assertFails(updateDoc(doc(as('pass1'), 'rides/j1'), passengerCancel()));
  await assertSucceeds(updateDoc(doc(as('pass1'), 'rides/j1'), passengerCancel({ endedEarly: true, cancelReason: 'rider_ended_early' })));
});
test('a driver ending a trip mid-way must flag it; a no-show must not', async () => {
  await job({ status: 'ongoing' });
  await assertFails(updateDoc(doc(as('cfree'), 'rides/j1'), { status: 'cancelled', cancelledBy: 'driver', cancelledAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(as('cfree'), 'rides/j1'), { status: 'cancelled', cancelledBy: 'driver', cancelReason: 'driver_ended_mid_trip', endedEarly: true, cancelledAt: serverTimestamp() }));
  await job({ status: 'arrived' });
  await assertSucceeds(updateDoc(doc(as('cfree'), 'rides/j1'), { status: 'cancelled', cancelledBy: 'driver', cancelReason: 'passenger_no_show', cancelledAt: serverTimestamp() }));
});

test('a job held for the office cannot be taken by anyone', async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'rides/held'), phoneJob({ dispatch: { driverId: null, mode: 'office' } })));
  await assertFails(updateDoc(doc(as('d1'), 'rides/held'), claim('d1')));
});
test('booked jobs and follow-on offers: only their driver (and the fleet) read them; nobody writes them', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'fleetAllocations/b1'), { driverId: 'd1', fleetId: 'f1', rideId: 'b1' });
    await setDoc(doc(ctx.firestore(), 'followOnOffers/d1'), { driverId: 'd1', rideId: 'x' });
  });
  await assertSucceeds(getDoc(doc(as('d1'), 'fleetAllocations/b1')));
  await assertSucceeds(getDocs(query(collection(as('d1'), 'fleetAllocations'), where('driverId', '==', 'd1'))));
  await assertSucceeds(getDoc(doc(as('own1'), 'fleetAllocations/b1')));
  await assertFails(getDoc(doc(as('d2'), 'fleetAllocations/b1')));
  await assertFails(getDoc(doc(as('own2'), 'fleetAllocations/b1')));
  await assertFails(setDoc(doc(as('d1'), 'fleetAllocations/b2'), { driverId: 'd1', fleetId: 'f1' }));
  await assertSucceeds(getDoc(doc(as('d1'), 'followOnOffers/d1')));
  await assertFails(getDoc(doc(as('d2'), 'followOnOffers/d1')));
  await assertFails(setDoc(doc(as('d1'), 'followOnOffers/d1'), { driverId: 'd1', rideId: 'y' }));
});
test('app errors: anyone writes one of the right shape, as themselves; only admins read', async () => {
  const e = (extra = {}) => ({ message: 'TypeError: x', stack: 'at y', componentStack: '', screen: 'FareEstimation', kind: 'render', fatal: false, version: '1.0.32', build: 29, platform: 'android', uid: 'pass1', at: serverTimestamp(), ...extra });
  await assertSucceeds(addDoc(collection(as('pass1'), 'appErrors'), e()));
  await assertSucceeds(addDoc(collection(env.unauthenticatedContext().firestore(), 'appErrors'), e({ uid: null })));
  await assertFails(addDoc(collection(as('pass1'), 'appErrors'), e({ uid: 'someone' })));
  await assertFails(addDoc(collection(as('pass1'), 'appErrors'), e({ extra: 1 })));
  await assertFails(addDoc(collection(as('pass1'), 'appErrors'), e({ message: 'x'.repeat(501) })));
  await assertFails(getDocs(collection(as('pass1'), 'appErrors')));
  await assertSucceeds(getDocs(collection(as('adm'), 'appErrors')));
});

/* Booking for someone else (utils/bookingFor.js): only their name on the ride,
   their mobile in rides/{id}/contact/passenger for the booker and admins. */
test('booking for someone else: their name on the ride, shape checked', async () => {
  const db = as('pass1');
  const ride = (pf) => booking({ passengerFor: pf });
  await assertSucceeds(addDoc(collection(db, 'rides'), ride({ name: 'Sarah Ahmed', hasPhone: true })));
  await assertSucceeds(addDoc(collection(db, 'rides'), ride({ name: 'Mum', hasPhone: false })));
  await assertFails(addDoc(collection(db, 'rides'), ride({ name: 'Sarah', hasPhone: true, phone: '+447700900123' })));
  await assertFails(addDoc(collection(db, 'rides'), ride({ name: '  ', hasPhone: false })));
  await assertFails(addDoc(collection(db, 'rides'), ride({ name: 'x'.repeat(61), hasPhone: false })));
  await assertFails(addDoc(collection(db, 'rides'), ride({ name: 'Sarah', hasPhone: 'yes' })));
  await assertFails(addDoc(collection(db, 'rides'), ride('Sarah')));
});
test('booking for someone else: their mobile is private to the booker', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'rides/forx'), cAppJob({ riderId: 'pass1', passengerFor: { name: 'Sarah', hasPhone: true } }));
    await setDoc(doc(db, 'rides/plain'), cAppJob({ riderId: 'pass1' }));
  });
  const contact = (uid, id = 'forx', c = 'passenger') => doc(as(uid), `rides/${id}/contact/${c}`);
  await assertFails(setDoc(contact('r1'), { phone: '+447700900123' }));
  await assertFails(setDoc(contact('pass1'), { phone: '07700900123' }));
  await assertFails(setDoc(contact('pass1', 'forx', 'other'), { phone: '+447700900123' }));
  await assertFails(setDoc(contact('pass1', 'plain'), { phone: '+447700900123' }));
  await assertFails(setDoc(contact('pass1'), { phone: '+447700900123', name: 'x' }));
  await assertSucceeds(setDoc(contact('pass1'), { phone: '+447700900123' }));
  await assertFails(setDoc(contact('pass1'), { phone: '+447700900456' }));
  await assertSucceeds(getDoc(contact('pass1')));
  await assertSucceeds(getDoc(contact('adm')));
  await assertFails(getDoc(contact('cfree')));
  // Even the driver who takes the job cannot read it.
  await seed((db) => updateDoc(doc(db, 'rides/forx'), { status: 'accepted', driverId: 'cfree' }));
  await assertFails(getDoc(contact('cfree')));
  // Nobody changes who it is for afterwards.
  await assertFails(updateDoc(doc(as('pass1'), 'rides/forx'), { passengerFor: { name: 'Someone', hasPhone: false } }));
  await assertFails(updateDoc(doc(as('cfree'), 'rides/forx'), { passengerFor: { name: 'Someone', hasPhone: false } }));
});
test('phone number owners: no app access, and a driver cannot clear a number clash', async () => {
  await seed((db) => setDoc(doc(db, 'phoneOwners/+447700900123'), { uid: 'd1', verified: false }));
  for (const uid of ['d1', 'dind', 'adm']) {
    await assertFails(getDoc(doc(as(uid), 'phoneOwners/+447700900123')));
    await assertFails(setDoc(doc(as(uid), 'phoneOwners/+447700900456'), { uid }));
    await assertFails(deleteDoc(doc(as(uid), 'phoneOwners/+447700900123')));
  }
  await seed((db) => updateDoc(doc(db, 'drivers/dind'), { phoneConflict: { phone: '+447700900123' } }));
  await assertFails(updateDoc(doc(as('dind'), 'drivers/dind'), { phoneConflict: deleteField() }));
});
test('archived accounts: admins read them, nobody writes them from a browser', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'archivedAccounts/gone1'), { uid: 'gone1', role: 'driver', name: 'Old Driver', reason: 'left' });
    await setDoc(doc(db, 'admins/oldadm'), { isActive: false });
  });
  await assertSucceeds(getDoc(doc(as('adm'), 'archivedAccounts/gone1')));
  await assertSucceeds(getDocs(collection(as('adm'), 'archivedAccounts')));
  // Not even an admin may write or remove one: only adminDeleteAccount does.
  await assertFails(setDoc(doc(as('adm'), 'archivedAccounts/new1'), { uid: 'new1' }));
  await assertFails(updateDoc(doc(as('adm'), 'archivedAccounts/gone1'), { reason: 'x' }));
  await assertFails(deleteDoc(doc(as('adm'), 'archivedAccounts/gone1')));
  // Drivers, passengers, fleet staff, a switched-off admin and the person themselves: no access.
  for (const uid of ['d1', 'r1', 'own1', 'op1', 'oldadm', 'gone1']) {
    await assertFails(getDoc(doc(as(uid), 'archivedAccounts/gone1')));
    await assertFails(getDocs(collection(as(uid), 'archivedAccounts')));
    await assertFails(setDoc(doc(as(uid), 'archivedAccounts/gone1'), { name: 'x' }));
  }
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'archivedAccounts/gone1')));
});

/* App jobs one driver at a time (functions/appOffers.js). */
test('one at a time: only the driver being asked takes the job; others can still decline', async () => {
  await seed((db) => setDoc(doc(db, 'rides/cseq'), cAppJob({ offer: { driverId: 'cfree', n: 1, state: 'asking' } })));
  await assertFails(updateDoc(doc(as('dind'), 'rides/cseq'), claim('dind')));
  await assertSucceeds(updateDoc(doc(as('dind'), 'rides/cseq'), { declinedBy: arrayUnion('dind') }));
  await assertSucceeds(updateDoc(doc(as('cfree'), 'rides/cseq'), claim('cfree')));
});
test('one at a time: a BID JOB, or a job nobody is being asked about, is open to any driver', async () => {
  await seed((db) => setDoc(doc(db, 'rides/cbid'), cAppJob({ offer: { driverId: 'cfree', n: 3, state: 'open' }, bidJob: { radiusKm: 16 } })));
  await seed((db) => setDoc(doc(db, 'rides/cwait'), cAppJob({ offer: { driverId: null, n: 1, state: 'waiting' } })));
  await assertSucceeds(updateDoc(doc(as('dind'), 'rides/cbid'), claim('dind')));
  await assertSucceeds(updateDoc(doc(as('dind'), 'rides/cwait'), claim('dind')));
});
test('one at a time: a passenger cannot book with an offer, or who was asked or missed it, already on', async () => {
  const mine = { riderId: 'r1', status: 'searching' };
  await assertFails(setDoc(doc(as('r1'), 'rides/seq1'), { ...mine, offer: { driverId: 'cfree', n: 1, state: 'asking' } }));
  await assertFails(setDoc(doc(as('r1'), 'rides/seq2'), { ...mine, askedDrivers: ['dind', 'd1'] }));
  await assertFails(setDoc(doc(as('r1'), 'rides/seq3'), { ...mine, missedBy: [] }));
  await assertFails(setDoc(doc(as('r1'), 'rides/seq4'), { ...mine, gaveBackBy: [] }));
  await assertSucceeds(setDoc(doc(as('r1'), 'rides/seq5'), mine));
});
test('one at a time: nobody but the server moves the offer on or records a miss', async () => {
  await seed((db) => setDoc(doc(db, 'rides/cseq2'), cAppJob({ offer: { driverId: 'cfree', n: 1, state: 'asking' } })));
  await assertFails(updateDoc(doc(as('dind'), 'rides/cseq2'), { 'offer.driverId': 'dind' }));
  await assertFails(updateDoc(doc(as('cfree'), 'rides/cseq2'), { missedBy: ['dind'] }));
  await assertFails(updateDoc(doc(as('r1'), 'rides/cseq2'), { offer: { driverId: null } }));
});

/* Changing the destination mid-trip and extended trips
   (functions/destinationChange.js): only the server moves the drop-off or
   the fare, records a request, the car reaching the drop-off, the cash due
   or the card holds. */
const onTrip = (extra = {}) => ({
  riderId: 'r1', driverId: 'cfree', status: 'ongoing', rideType: 'RouteMini', paymentMethod: 'card',
  pickupLocation: { latitude: 52.3, longitude: -1.9, address: 'A' },
  dropoffLocation: { latitude: 52.31, longitude: -1.94, address: 'B' },
  stops: [{ latitude: 52.305, longitude: -1.92, address: 'S1' }], stopsCompleted: 0,
  fare: { total: 10 }, fareEstimate: 10, ...extra,
});
const serverTripFields = () => ({
  dropoffLocation: { latitude: 52.4, longitude: -1.8, address: 'Somewhere else' },
  fare: { total: 99 },
  fareEstimate: 99,
  destinationChange: { n: 1, state: 'accepted' },
  destinationChanges: [{ n: 1, outcome: 'accepted' }],
  originalDropoffLocation: { latitude: 1, longitude: 1 },
  fareBasis: { distanceKm: 99 },
  bookedBasis: { distanceKm: 1 },
  extraHolds: [{ id: 'pi_x', amount: 100 }],
  cashExtraDue: 5,
  holdRaise: { how: 'cash' },
  reachedDropoffAt: serverTimestamp(),
  reachedDropoffPoint: { latitude: 52.31, longitude: -1.94 },
  extendedTrip: { flagged: false },
});
test('destination change: neither the passenger nor the driver can move the drop-off, the fare or the change records mid-trip', async () => {
  await seed((db) => setDoc(doc(db, 'rides/trip1'), onTrip()));
  for (const [key, value] of Object.entries(serverTripFields())) {
    await assertFails(updateDoc(doc(as('r1'), 'rides/trip1'), { [key]: value }));
    await assertFails(updateDoc(doc(as('cfree'), 'rides/trip1'), { [key]: value }));
  }
  // Nor tucked into a completion or a stop.
  await assertFails(updateDoc(doc(as('cfree'), 'rides/trip1'), { status: 'completed', completedAt: serverTimestamp(), reachedDropoffAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as('cfree'), 'rides/trip1'), { stopsCompleted: 1, cashExtraDue: 0 }));
  // The office marks an extended trip as checked.
  await assertSucceeds(updateDoc(doc(as('adm'), 'rides/trip1'), { extendedTrip: { flagged: true, reviewedBy: 'adm' } }));
});
test('destination change: a booking cannot arrive with any of the server\'s trip-change fields', async () => {
  const mine = { riderId: 'r1', status: 'searching' };
  for (const [key, value] of Object.entries(serverTripFields())) {
    if (['dropoffLocation', 'fare', 'fareEstimate'].includes(key)) continue;
    await assertFails(setDoc(doc(as('r1'), `rides/dcnew_${key}`), { ...mine, [key]: value }));
  }
  await assertSucceeds(setDoc(doc(as('r1'), 'rides/dcnew_ok'), mine));
});
test('stops: the driver ticks off one stop at a time, never past the stops booked', async () => {
  await seed((db) => setDoc(doc(db, 'rides/trip2'), onTrip()));
  await assertFails(updateDoc(doc(as('cfree'), 'rides/trip2'), { stopsCompleted: 2 }));
  await assertFails(updateDoc(doc(as('r1'), 'rides/trip2'), { stopsCompleted: 1 }));
  await assertSucceeds(updateDoc(doc(as('cfree'), 'rides/trip2'), { stopsCompleted: 1 }));
  await assertFails(updateDoc(doc(as('cfree'), 'rides/trip2'), { stopsCompleted: 2 }));
  await assertFails(updateDoc(doc(as('cfree'), 'rides/trip2'), { stopsCompleted: 0 }));
});

/* Paying by card instead of cash (functions/cardSwitch.js): only the server
   records the switch, and once the card is held or charged no driver's app,
   old or new, can record cash as well. */
test('card instead of cash: nobody but the server writes the switch, the link texts or the card ride', async () => {
  await seed((db) => setDoc(doc(db, 'rides/cs1'), onTrip({ paymentMethod: 'cash' })));
  const fields = {
    paymentSwitch: { n: 1, state: 'paid', method: 'app', amount: 10 },
    cardLinkTexts: 0,
    paymentMethod: 'card',
    paymentIntentId: 'pi_x',
    paymentStatus: 'captured',
    cashCollected: true,
  };
  for (const [key, value] of Object.entries(fields)) {
    await assertFails(updateDoc(doc(as('r1'), 'rides/cs1'), { [key]: value }));
    await assertFails(updateDoc(doc(as('cfree'), 'rides/cs1'), { [key]: value }));
  }
  // Nor tucked into a completion.
  await assertFails(updateDoc(doc(as('cfree'), 'rides/cs1'), { status: 'completed', completedAt: serverTimestamp(), paymentSwitch: { state: 'cancelled' } }));
  // A booking cannot arrive with it, or with cash already taken.
  const mine = { riderId: 'r1', status: 'searching' };
  await assertFails(setDoc(doc(as('r1'), 'rides/csnew1'), { ...mine, paymentSwitch: { state: 'held' } }));
  await assertFails(setDoc(doc(as('r1'), 'rides/csnew2'), { ...mine, cardLinkTexts: 0 }));
  await assertFails(setDoc(doc(as('r1'), 'rides/csnew3'), { ...mine, cashCollected: true }));
  // The page's keys are the server's alone.
  await seed((db) => setDoc(doc(db, 'cardLinks/tok'), { rideId: 'cs1', n: 1 }));
  await assertFails(getDoc(doc(as('r1'), 'cardLinks/tok')));
  await assertFails(getDoc(doc(as('cfree'), 'cardLinks/tok')));
  await assertFails(setDoc(doc(as('cfree'), 'cardLinks/tok2'), { rideId: 'cs1', n: 1 }));
});
test('card instead of cash: cash cannot be recorded once the card is held or charged', async () => {
  const done = { status: 'completed', completedAt: serverTimestamp(), expiresAt: serverTimestamp() };
  for (const state of ['held', 'paid']) {
    await seed((db) => setDoc(doc(db, 'rides/cs2'), onTrip({ paymentMethod: 'card', paymentSwitch: { n: 1, state } })));
    await assertFails(updateDoc(doc(as('cfree'), 'rides/cs2'), { ...done, cashCollected: true }));
    await assertSucceeds(updateDoc(doc(as('cfree'), 'rides/cs2'), done));
  }
  // An attempt still open, or one that failed: cash is still fine.
  for (const state of ['pending', 'failed', 'cancelled']) {
    await seed((db) => setDoc(doc(db, 'rides/cs3'), onTrip({ paymentMethod: 'cash', paymentSwitch: { n: 1, state } })));
    await assertSucceeds(updateDoc(doc(as('cfree'), 'rides/cs3'), { ...done, cashCollected: true }));
  }
  // The extra a card did not cover after a destination change is still cash.
  await seed((db) => setDoc(doc(db, 'rides/cs4'), onTrip({ paymentMethod: 'card', cashExtraDue: 3, paymentSwitch: { n: 1, state: 'held' } })));
  await assertSucceeds(updateDoc(doc(as('cfree'), 'rides/cs4'), { ...done, cashCollected: true }));
});
