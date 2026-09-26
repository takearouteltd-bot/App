// utils/modeSwitch.js
// One account, two modes.
//
// users/{uid}.role holds the mode a person is in right now, not who they are.
// App.js listens to that document, so changing role swaps the whole navigator
// without a sign-out. riders/{uid} and drivers/{uid} are separate records on
// the same uid, so one person can hold both at once.
//
// The first switch into a mode creates whichever record is missing and carries
// over the details we already hold. The onboarding gates in App.js then ask for
// whatever that mode still needs: name and location for passengers, documents
// and admin approval for drivers.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '../config/firebase';

// A trip that is still running. These are the statuses the ride screens write:
// FareEstimation creates "searching", the driver moves it through "accepted",
// "arrived" and "ongoing", and RideToDropoff ends it at "completed".
export const ACTIVE_RIDE_STATUSES = ['searching', 'accepted', 'arrived', 'ongoing'];

// Whether this ride is still assigned to the given driver. The server can put
// a ride back to "searching" (card hold failed) or hand it to another driver.
export function isRideMine(ride, uid) {
  return !!ride && !!uid && ride.driverId === uid && ride.status !== 'searching';
}

const RECORD = { rider: 'riders', driver: 'drivers' };

/** The mode you are not in. */
export function otherMode(role) {
  return role === 'driver' ? 'rider' : 'driver';
}

/* ================= PROVISIONING ================= */

// The same person in both records, so nobody types their name twice.
function sharedDetails(source) {
  const d = source || {};
  const out = {};
  if (d.fullName) out.fullName = d.fullName;
  if (d.phoneNumber) out.phoneNumber = d.phoneNumber;
  if (d.email) out.email = d.email;
  if (d.profileImage) out.profileImage = d.profileImage;
  return out;
}

// Creates riders/{uid} if it is missing and makes sure a Stripe customer
// exists. Passengers pay by card, and createSetupIntent refuses to run without
// a customer id, so a driver who has never been a passenger needs one making
// here or they can never add a card.
export async function ensureRiderProfile(uid, carryOver) {
  const riderRef = doc(db, 'riders', uid);
  let snap = await getDoc(riderRef);

  if (!snap.exists()) {
    await setDoc(
      riderRef,
      {
        createdAt: serverTimestamp(),
        fullName: '',
        locationEnabled: false,
        onboardingComplete: false,
        ...sharedDetails(carryOver),
      },
      { merge: true }
    );
    snap = await getDoc(riderRef);
  }

  if (!snap.data()?.stripeCustomerId) {
    const email = auth.currentUser?.email || `${uid}@phone.user`;
    const createStripeCustomer = httpsCallable(functions, 'createStripeCustomer');
    const res = await createStripeCustomer({ email, uid });
    if (!res.data?.customerId) {
      throw new Error('Could not set up payments for your passenger account. Please try again.');
    }
  }
}

// Creates drivers/{uid} if it is missing. Everything else about driving —
// licence, insurance, vehicle, approval — is asked for by the existing driver
// onboarding stack, which App.js shows because onboardingComplete is false.
export async function ensureDriverProfile(uid, carryOver) {
  const driverRef = doc(db, 'drivers', uid);
  const snap = await getDoc(driverRef);
  if (snap.exists()) return;

  await setDoc(
    driverRef,
    {
      createdAt: serverTimestamp(),
      approved: false,
      onboardingComplete: false,
      status: 'offline',
      ...sharedDetails(carryOver),
    },
    { merge: true }
  );
}

/* ================= GUARDS ================= */

// Nobody leaves a mode in the middle of a trip. The other side of that trip is
// watching this screen for arrival and progress, and switching away would leave
// the ride with nobody looking at it.
async function riderHasLiveRide(uid) {
  const snap = await getDocs(
    query(
      collection(db, 'rides'),
      where('riderId', '==', uid),
      where('status', 'in', ACTIVE_RIDE_STATUSES)
    )
  );
  return !snap.empty;
}

async function driverHasLiveRide(uid) {
  const snap = await getDoc(doc(db, 'drivers', uid));
  return snap.exists() && snap.data().isOnRide === true;
}

// A mode whose record is suspended drops the person on the "Account suspended"
// screen with nothing but a sign-out button, so switching into one is refused
// rather than leaving them stuck there.
async function isSuspended(role, uid) {
  const snap = await getDoc(doc(db, RECORD[role], uid));
  return snap.exists() && snap.data().blocked === true;
}

/* ================= THE SWITCH ================= */

// Moves the account into the given mode. Throws with a sentence worth showing
// to the person if it cannot be done.
export async function switchMode(uid, target) {
  if (!uid) throw new Error('Please sign in first.');
  if (!RECORD[target]) throw new Error('Unknown mode.');

  const leaving = otherMode(target);

  const onATrip =
    leaving === 'rider' ? await riderHasLiveRide(uid) : await driverHasLiveRide(uid);
  if (onATrip) {
    throw new Error(
      leaving === 'rider'
        ? 'You have a trip in progress. Finish or cancel it before switching to driving.'
        : 'You are on a job. Finish or cancel it before switching to passenger mode.'
    );
  }

  if (await isSuspended(target, uid)) {
    throw new Error(
      target === 'rider'
        ? 'Your passenger account has been suspended. Please contact support.'
        : 'Your driver account has been suspended. Please contact support.'
    );
  }

  // Carry across what the mode being left already knows about this person.
  const sourceSnap = await getDoc(doc(db, RECORD[leaving], uid));
  const carryOver = sourceSnap.exists() ? sourceSnap.data() : null;

  if (target === 'rider') await ensureRiderProfile(uid, carryOver);
  else await ensureDriverProfile(uid, carryOver);

  // A driver stepping away has to stop being dispatched. Without this they stay
  // in the "online" pool that offerRideToDrivers reads and keep being rung for
  // jobs while sitting in the back of someone else's car.
  if (leaving === 'driver') {
    await updateDoc(doc(db, 'drivers', uid), {
      status: 'offline',
      shiftStartedAt: null,
    }).catch(() => null);
  }

  // Flip the mode. App.js's users/{uid} listener rebuilds the navigator from
  // here, including sending them into onboarding if this mode is new to them.
  await setDoc(
    doc(db, 'users', uid),
    { role: target, updatedAt: serverTimestamp() },
    { merge: true }
  );

  return target;
}

/* ================= DESCRIBING THE OTHER MODE ================= */

// What the account screens should say about the mode this person is not in.
// `record` is drivers/{uid} or riders/{uid}, or null when they have never used
// that mode. Returns plain data so this file stays free of components.
export function describeMode(target, record) {
  if (target === 'rider') {
    return record
      ? {
          title: 'Switch to passenger',
          detail: 'Book a ride with this same account.',
          confirmTitle: 'Switch to passenger mode?',
          confirmBody:
            'You will go offline and stop receiving job offers. You can switch back to driving any time.',
          confirmAction: 'Switch',
          tone: 'normal',
        }
      : {
          title: 'Use TakeARoute as a passenger',
          detail: 'Book rides with this same account.',
          confirmTitle: 'Use TakeARoute as a passenger?',
          confirmBody:
            'We will set up a passenger profile on this account. You will go offline and stop receiving job offers, and you can switch back to driving any time.',
          confirmAction: 'Set up',
          tone: 'normal',
        };
  }

  if (!record) {
    return {
      title: 'Start driving with TakeARoute',
      detail: 'Earn on your schedule.',
      confirmTitle: 'Start driving with TakeARoute?',
      confirmBody:
        'We will ask for your licence, insurance and vehicle details, and an admin reviews them before you can take jobs. You can switch back to passenger mode any time.',
      confirmAction: 'Get started',
      tone: 'normal',
    };
  }

  if (!record.onboardingComplete) {
    return {
      title: 'Finish your driver application',
      detail: 'Pick up where you left off.',
      confirmTitle: 'Finish your driver application?',
      confirmBody:
        'You can carry on from the step you stopped at, and switch back to passenger mode any time.',
      confirmAction: 'Continue',
      tone: 'warning',
    };
  }

  if (record.approved !== true) {
    return {
      title: 'Switch to driving',
      detail: 'Application under review.',
      confirmTitle: 'Switch to driving?',
      confirmBody:
        'Your application is still being reviewed, so you cannot go online yet. You can switch back to passenger mode any time.',
      confirmAction: 'Switch',
      tone: 'warning',
    };
  }

  return {
    title: 'Switch to driving',
    detail: 'Approved. Go online and take jobs.',
    confirmTitle: 'Switch to driving?',
    confirmBody:
      'You will go to your driver home, where you can go online. You can switch back to passenger mode any time.',
    confirmAction: 'Switch',
    tone: 'normal',
  };
}

// Reads the record behind describeMode(). Kept here so both account screens
// load it the same way.
export async function loadModeRecord(target, uid) {
  if (!uid) return null;
  const snap = await getDoc(doc(db, RECORD[target], uid));
  return snap.exists() ? snap.data() : null;
}
