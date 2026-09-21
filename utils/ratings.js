// utils/ratings.js
// Star ratings after a trip. The rating is written onto the ride, and a Cloud
// Function keeps the running average on the driver or passenger record.
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';

// who: 'rider' rates the driver, 'driver' rates the passenger
export async function submitRating(rideId, who, stars, comment = '') {
  const value = Math.max(1, Math.min(5, Math.round(stars)));
  const field = who === 'rider' ? 'driverRating' : 'riderRating';
  await updateDoc(doc(db, 'rides', rideId), {
    [field]: { stars: value, comment: comment.trim(), at: serverTimestamp() },
  });
}
