// utils/bookingFor.js
// Booking a taxi for someone else (friends, family).
//
// The booker stays the passenger account on the ride (riderId): they pay,
// track it and message the driver. The person riding is on the ride as
//   passengerFor: { name, hasPhone }
// Only the name goes on the ride, because nearby drivers can read a ride while
// it looks for a driver. Their mobile goes in rides/{id}/contact/passenger,
// which only the booker and admins can read (firestore.rules). The server uses
// it to put the driver's calls through to them (startMaskedCall) and to text
// them when the driver is on the way and outside, with a tracking link
// (functions/fleetWeb.js someoneElseUpdates). The server adds the booker's
// first name as bookedByName.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

const RECENT_KEY = 'bookingFor.recent.v1';
const RECENT_MAX = 6;

export const NAME_MAX = 60;

/** A name to show, trimmed and capped, or '' if there is none. */
export function cleanName(raw) {
  return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

/** A UK number as +44…, or null if it isn't one. Empty input is null too.
    Same rules as the passenger's own number (EditProfileScreen). */
export function ukPhone(raw) {
  let p = String(raw || '').trim().replace(/[\s()-]/g, '');
  if (!p) return null;
  if (!p.startsWith('+')) {
    if (p.startsWith('0')) p = `+44${p.substring(1)}`;
    else if (p.startsWith('44')) p = `+${p}`;
    else p = `+44${p}`;
  }
  return /^\+44[1-9]\d{8,10}$/.test(p) ? p : null;
}

/** "+447123456789" as "07123 456789" for showing. */
export function prettyPhone(e164) {
  const m = /^\+44(\d{4})(\d{6})$/.exec(String(e164 || ''));
  return m ? `0${m[1]} ${m[2]}` : String(e164 || '');
}

/** The ride's passengerFor field, from what the booker typed. */
export function passengerForField(person) {
  const name = cleanName(person?.name);
  if (!name) return null;
  return { name, hasPhone: Boolean(ukPhone(person?.phone)) };
}

/** Saves the person's mobile against the ride, straight after booking. */
export async function savePassengerContact(rideId, person) {
  const phone = ukPhone(person?.phone);
  if (!rideId || !phone) return;
  await setDoc(doc(db, 'rides', rideId, 'contact', 'passenger'), { phone });
}

/** People this phone booked for recently, newest first: [{ name, phone }]. */
export async function recentPeople() {
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY);
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list.filter((p) => cleanName(p?.name)) : [];
  } catch {
    return [];
  }
}

/** Remembers someone booked for, on this phone only. */
export async function rememberPerson(person) {
  const name = cleanName(person?.name);
  if (!name) return;
  const phone = ukPhone(person?.phone) || '';
  try {
    const list = await recentPeople();
    const rest = list.filter((p) => cleanName(p.name).toLowerCase() !== name.toLowerCase());
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify([{ name, phone }, ...rest].slice(0, RECENT_MAX)));
  } catch {
    // Only a convenience.
  }
}

/** Who the driver is collecting: the person booked for, or the booker.
    { name, bookedBy, forSomeone, photo } */
export function riderOnTrip(ride, riderData) {
  const own = riderData?.fullName || riderData?.name || riderData?.firstName || '';
  const pf = ride?.passengerFor;
  if (pf?.name) {
    const booker = ride?.bookedByName || String(own).split(' ')[0] || '';
    return { name: pf.name, bookedBy: booker, forSomeone: true, photo: null };
  }
  return {
    name: own || 'Passenger',
    bookedBy: '',
    forSomeone: false,
    photo: riderData?.profileImage || riderData?.photoURL || null,
  };
}
