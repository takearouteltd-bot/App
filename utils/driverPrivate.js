// utils/driverPrivate.js
// A driver's private details live apart from drivers/{id}, which every
// signed-in user can read: driverPrivate/{id} (bank, NI number, date of birth,
// home address, phone, email, emergency contact) and driverFiles/{id}
// (document links). See firestore.rules.
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';

export const privateDocRef = (uid) => doc(db, 'driverPrivate', uid);
export const filesDocRef = (uid) => doc(db, 'driverFiles', uid);

const merged = (driver, files, secrets) => ({ ...driver, ...files, ...secrets });

// The driver's whole record, for their own screens.
export async function loadMyDriverRecord(uid) {
  const [driver, files, secrets] = await Promise.all([
    getDoc(doc(db, 'drivers', uid)),
    getDoc(filesDocRef(uid)),
    getDoc(privateDocRef(uid)),
  ]);
  return {
    exists: driver.exists(),
    data: merged(
      driver.exists() ? driver.data() : {},
      files.exists() ? files.data() : {},
      secrets.exists() ? secrets.data() : {}
    ),
  };
}

// Live version. Calls back with null while the driver has no record, and only
// once all three documents have reported, so no field flickers in.
export function watchMyDriverRecord(uid, onChange, onError = () => {}) {
  const parts = { driver: undefined, files: undefined, secrets: undefined };
  const emit = () => {
    if (parts.driver === undefined || parts.files === undefined || parts.secrets === undefined) return;
    onChange(parts.driver === null ? null : merged(parts.driver, parts.files, parts.secrets));
  };
  const listen = (ref, key, missing) =>
    onSnapshot(
      ref,
      (snap) => {
        parts[key] = snap.exists() ? snap.data() : missing;
        emit();
      },
      onError
    );
  const stops = [
    listen(doc(db, 'drivers', uid), 'driver', null),
    listen(filesDocRef(uid), 'files', {}),
    listen(privateDocRef(uid), 'secrets', {}),
  ];
  return () => stops.forEach((stop) => stop());
}
