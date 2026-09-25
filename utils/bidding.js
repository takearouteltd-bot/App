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
    expiresAtMs: Date.now() + offerSeconds(config) * 1000,
  });
}

/* Passenger takes a driver's counter-offer. The ride is claimed in a
   transaction, so it cannot also be taken by another driver accepting the
   passenger's own price at the same moment. */
export async function acceptCounterOffer(rideId, offer) {
  const rideRef = doc(db, 'rides', rideId);
  const offerRef = doc(db, 'rides', rideId, 'offers', offer.driverId);
  await runTransaction(db, async (tx) => {
    const rideSnap = await tx.get(rideRef);
    const offerSnap = await tx.get(offerRef);
    if (!rideSnap.exists() || rideSnap.data().status !== 'searching') {
      throw new Error('This ride already has a driver.');
    }
    const live = offerSnap.exists() ? offerSnap.data() : null;
    if (!live || live.status !== 'pending' || Number(live.expiresAtMs) < Date.now()) {
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
