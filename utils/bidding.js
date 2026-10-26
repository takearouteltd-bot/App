// utils/bidding.js
// inDrive-style pricing: the passenger offers a fare, drivers accept it or
// counter with a higher one, and the passenger picks.
//
// Switched on and tuned from the dashboard (Settings, Bidding):
//   enabled            1 = bidding, 0 = fixed fares as before
//   minOfferPercent    lowest offer allowed, as % of the recommended fare
//   maxCounterPercent  how far above the passenger's offer a driver may go
//   offerSeconds       how long a driver's counter-offer stays open
//
// Data:
//   rides/{id}                 bidding: true, offeredFare, fareEstimate and
//                              fare.total follow the price on the table
//   rides/{id}/offers/{uid}    one counter-offer per driver
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../config/firebase';

const round2 = (n) => Math.round(Number(n) * 100) / 100;
// Offers move in steps a person can read: 50p (or 0.50 of any currency).
const roundHalf = (n) => Math.round(Number(n) * 2) / 2;

export function biddingEnabled(config) {
  return Number(config?.bidding?.enabled) === 1;
}

function setting(config, key, fallback) {
  const n = Number(config?.bidding?.[key]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function offerSeconds(config) {
  return Math.max(15, setting(config, 'offerSeconds', 60));
}

/* The lowest a passenger may offer for a trip whose recommended fare is
   `recommended`. */
export function minOffer(recommended, config) {
  return round2(recommended * (setting(config, 'minOfferPercent', 100) / 100));
}

/* The highest a driver may counter an offer of `offered`. */
export function maxCounter(offered, config) {
  return round2(offered * (1 + setting(config, 'maxCounterPercent', 50) / 100));
}

/* Three counter-offers a driver can send with one tap: about 10%, 20% and
   30% more, rounded to 50p and never above the cap. */
export function counterSteps(offered, config) {
  const cap = maxCounter(offered, config);
  const steps = [1.1, 1.2, 1.3]
    .map((m) => roundHalf(offered * m))
    .filter((p) => p > offered && p <= cap);
  return [...new Set(steps)];
}

/* The fare record at an agreed price. VAT stays inside the price, so the
   receipt still adds up; the original recommendation is kept for reference. */
export function fareAtPrice(fare, price) {
  const vatRate = (Number(fare?.vatPercent) || 0) / 100;
  const total = round2(price);
  const subtotal = round2(total / (1 + vatRate));
  return {
    ...fare,
    total,
    subtotal,
    vat: round2(total - subtotal),
    agreedPrice: total,
    recommendedTotal: fare?.recommendedTotal ?? fare?.total ?? total,
  };
}

/* Passenger raises their offer while waiting. */
export async function raiseOffer(rideId, ride, newPrice) {
  const price = round2(newPrice);
  await updateDoc(doc(db, 'rides', rideId), {
    offeredFare: price,
    fareEstimate: price,
    fare: fareAtPrice(ride.fare, price),
  });
}

/* A driver's counter-offer. One per driver per ride; sending again replaces
   it. */
export async function sendCounterOffer(rideId, driver, price, config) {
  await setDoc(doc(db, 'rides', rideId, 'offers', driver.id), {
    driverId: driver.id,
    price: round2(price),
    driverName: driver.name || 'Driver',
    rating: Number(driver.rating) || null,
    ratingCount: Number(driver.ratingCount) || 0,
    vehicle: driver.vehicle || null,
    photoUrl: driver.photoUrl || null,
    status: 'pending',
    createdAt: serverTimestamp(),
    // Both from the driver's clock, so their difference is the offer's
    // length whatever that clock says (see offerIsLive).
    sentAtMs: Date.now(),
    expiresAtMs: Date.now() + offerSeconds(config) * 1000,
  });
}

/* Whether a counter-offer is still open. Timed from the server's createdAt
   where it has one, so a driver's phone clock running slow or fast can't
   make every offer arrive already expired (or never expire). The driver's
   expiresAtMs is the fallback while createdAt is still pending. */
export function offerIsLive(offer, now = Date.now(), seenAtMs = null) {
  const sentAt = Number(offer?.sentAtMs);
  const length = Number(offer?.expiresAtMs) - sentAt;
  // Timed from when this phone first saw the offer, on this phone's own
  // clock: comparing the passenger's clock with the server's (or the
  // driver's) hid every offer whenever the passenger's phone ran a minute or
  // two out.
  if (seenAtMs && sentAt && length > 0) return now < seenAtMs + length;
  const created = offer?.createdAt?.toMillis?.();
  if (created && sentAt && length > 0) return now < created + length;
  return Number(offer?.expiresAtMs) > now;
}

/* Passenger takes a driver's counter-offer. The ride is claimed in a
   transaction, so it cannot also be taken by another driver accepting the
   passenger's own price at the same moment. */
export async function acceptCounterOffer(rideId, offer) {
  const rideRef = doc(db, 'rides', rideId);
  const offerRef = doc(db, 'rides', rideId, 'offers', offer.driverId);
  // Read outside the transaction: the driver's phone rewrites this record
  // with its position every few seconds, and a transaction that reads it
  // fails whenever it changes before the commit.
  const driverSnap = await getDoc(doc(db, 'drivers', offer.driverId));
  const driver = driverSnap.exists() ? driverSnap.data() : {};
  if (driver.status !== 'online' || driver.isOnRide === true) {
    throw new Error('That driver has just taken another job. Pick another offer.');
  }
  await runTransaction(db, async (tx) => {
    const rideSnap = await tx.get(rideRef);
    const offerSnap = await tx.get(offerRef);
    if (!rideSnap.exists() || rideSnap.data().status !== 'searching') {
      throw new Error('This ride already has a driver.');
    }
    const live = offerSnap.exists() ? offerSnap.data() : null;
    // The passenger already saw this offer as open, so only the offer's own
    // status decides here, not the clocks (see offerIsLive).
    if (!live || live.status !== 'pending' || !offerIsLive(live, Date.now(), offer.seenAtMs)) {
      throw new Error('That offer has expired. Pick another, or wait for a new one.');
    }
    const price = round2(live.price);
    tx.update(rideRef, {
      status: 'accepted',
      driverId: live.driverId,
      acceptedAt: serverTimestamp(),
      walletProcessed: false,
      offeredFare: price,
      fareEstimate: price,
      fare: fareAtPrice(rideSnap.data().fare, price),
      acceptedOfferId: live.driverId,
    });
    tx.update(offerRef, { status: 'accepted' });
  });
}
