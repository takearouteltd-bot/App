/* ======================================
   ONE DRIVER ACCOUNT PER PHONE NUMBER
   A phone sign-in is unique (Firebase), but an email sign-in's number is
   only a field on driverPrivate/{id}, so two driver accounts could hold the
   same number (seen 16 Nov 2026: one account had +447…, another 07…, both
   joined a fleet as company cars from one invitation).

   phoneOwners/{e164} = {uid, verified, at}: which driver account holds a
   number, compared in E.164 (toE164: 07… is +447…). Server only; no app
   reads or writes it (firestore.rules).

   Who may hold a number:
   - nobody else holds it: the first account to set it;
   - the owner on record has gone (account deleted, or their record no
     longer has that number): it is released;
   - a number someone signs in with (verified by text) beats one that was
     only typed in: the typed holder is flagged (drivers.phoneConflict) for
     TakeARoute to sort out.
   Passenger-only accounts are not counted: a passenger's number does not
   stop a driver having it, and one person's own passenger and driver
   records are one account anyway.

   Gates: saveDriverContact (staff edits and the dashboard's approval of a
   driver's change request), fleet invitations and joins (fleet.js), and the
   syncDriverPhone trigger, which puts back a number an app or an older
   build wrote that belongs to another driver. checkDriverPhone lets the
   app tell the driver before they ask for a change.
   ====================================== */

const TAKEN = "This number is already registered to another driver. " +
  "Sign in with it instead, or use a different number.";

module.exports = (deps) => {
  const {functions, admin, db, toE164, privacy} = deps;
  const {HttpsError} = functions.https;
  const {FieldValue} = require("firebase-admin/firestore");
  const owners = db.collection("phoneOwners");

  /**
   * The ways a number may be stored on older records.
   * @param {string} e164 +44… number.
   * @return {Array<string>} Forms to look for.
   */
  function forms(e164) {
    const national = e164.startsWith("+44") ? "0" + e164.slice(3) : null;
    return [e164, national, e164.replace("+", "")].filter(Boolean);
  }

  /**
   * The number a sign-in was verified with, or null.
   * @param {string} uid Account.
   * @return {Promise<?string>} E.164.
   */
  async function verifiedNumber(uid) {
    try {
      const user = await admin.auth().getUser(uid);
      return toE164(user.phoneNumber) || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * The number on a driver's record now, or null; null too when there is
   * no driver record (deleted account, or a passenger only).
   * @param {string} uid Driver.
   * @return {Promise<?string>} E.164.
   */
  async function recordNumber(uid) {
    const [driver, secret] = await Promise.all([
      db.collection("drivers").doc(uid).get(), privacy.privateRef(uid).get()]);
    if (!driver.exists) return null;
    const s = secret.exists ? secret.data() : {};
    const d = driver.data();
    return toE164(s.phoneNumber || s.phone || d.phoneNumber || d.phone) ||
      null;
  }

  /**
   * Whether a driver account holds this number now.
   * @param {string} uid Driver.
   * @param {string} e164 Number.
   * @return {Promise<boolean>} Holds it.
   */
  async function holds(uid, e164) {
    const onRecord = await recordNumber(uid);
    if (onRecord === e164) return true;
    if (onRecord !== null) return false;
    // A phone sign-in whose record has no number yet still holds its own.
    const driver = await db.collection("drivers").doc(uid).get();
    return driver.exists && (await verifiedNumber(uid)) === e164;
  }

  /**
   * Every other driver account holding the number, however it was typed.
   * @param {string} e164 Number.
   * @param {?string} exceptUid Leave this account out.
   * @return {Promise<Array<string>>} Driver ids.
   */
  async function holders(e164, exceptUid) {
    const found = new Set();
    try {
      const user = await admin.auth().getUserByPhoneNumber(e164);
      found.add(user.uid);
    } catch (error) {
      // No sign-in with that number.
    }
    for (const col of ["driverPrivate", "drivers"]) {
      for (const field of ["phoneNumber", "phone"]) {
        const snap = await db.collection(col)
            .where(field, "in", forms(e164)).get();
        snap.docs.forEach((d) => found.add(d.id));
      }
    }
    found.delete(exceptUid);
    const out = [];
    for (const uid of found) {
      if (await holds(uid, e164)) out.push(uid);
    }
    return out;
  }

  /**
   * Another driver account that keeps the number from [uid], or null.
   * @param {string} uid Account that wants it.
   * @param {string} e164 Number.
   * @return {Promise<Object>} {rival, mineVerified, beaten: [uids]}.
   */
  async function rivalFor(uid, e164) {
    const mineVerified = (await verifiedNumber(uid)) === e164;
    const others = await holders(e164, uid);
    const reg = await owners.doc(e164).get();
    const owner = reg.exists ? reg.data().uid : null;
    // The owner on record first, then whoever else has it.
    const ordered = [...new Set([owner, ...others].filter((x) =>
      x && x !== uid && others.includes(x)))];
    const beaten = [];
    for (const other of ordered) {
      const otherVerified = (await verifiedNumber(other)) === e164;
      if (mineVerified && !otherVerified) {
        beaten.push(other);
        continue;
      }
      return {rival: other, mineVerified, beaten};
    }
    return {rival: null, mineVerified, beaten};
  }

  /**
   * Gives [uid] the number when no other driver account keeps it.
   * @param {string} uid Driver account.
   * @param {string} raw Number as typed.
   * @return {Promise<Object>} {ok, e164, rival}.
   */
  async function claim(uid, raw) {
    const e164 = toE164(raw);
    if (!e164) return {ok: true, e164: null, rival: null};
    const {rival, mineVerified, beaten} = await rivalFor(uid, e164);
    if (rival) return {ok: false, e164, rival};
    await owners.doc(e164).set({uid, verified: mineVerified,
      at: FieldValue.serverTimestamp()});
    // Typed-in holders of a number someone signs in with: flag them.
    for (const other of beaten) {
      await db.collection("drivers").doc(other).set({phoneConflict: {
        phone: e164, withDriverId: uid, verifiedElsewhere: true,
        at: FieldValue.serverTimestamp(), message: TAKEN}}, {merge: true});
    }
    return {ok: true, e164, rival: null};
  }

  /**
   * Lets go of a number this account owned.
   * @param {string} uid Account.
   * @param {?string} e164 Number.
   * @return {Promise<void>}
   */
  async function release(uid, e164) {
    if (!e164) return;
    const ref = owners.doc(e164);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists && snap.data().uid === uid) tx.delete(ref);
    });
  }

  /**
   * Refuses (HttpsError already-exists) when another driver keeps it.
   * @param {string} uid Driver.
   * @param {string} raw Number.
   * @return {Promise<?string>} E.164 claimed.
   */
  async function claimOrRefuse(uid, raw) {
    const result = await claim(uid, raw);
    if (!result.ok) throw new HttpsError("already-exists", TAKEN);
    return result.e164;
  }

  /* Any write of a driver's number, from any app build or the dashboard:
     claim it, or put the old one back and flag the clash. */
  const syncDriverPhone = functions.firestore
      .document("driverPrivate/{uid}")
      .onWrite(async (change, context) => {
        const uid = context.params.uid;
        const before = change.before.exists ? change.before.data() : {};
        const after = change.after.exists ? change.after.data() : null;
        const was = toE164(before.phoneNumber || before.phone);
        const now = after ? toE164(after.phoneNumber || after.phone) : null;
        if (!now) {
          await release(uid, was);
          return null;
        }
        if (now === was) return null;
        const result = await claim(uid, now);
        const driverRef = db.collection("drivers").doc(uid);
        if (result.ok) {
          if (was) await release(uid, was);
          const d = await driverRef.get();
          if (d.exists && d.data().phoneConflict &&
              !d.data().phoneConflict.verifiedElsewhere) {
            await driverRef.update({phoneConflict: FieldValue.delete()});
          }
          return null;
        }
        // Put back what was there; never leave two accounts on one number.
        await change.after.ref.set({
          phoneNumber: before.phoneNumber !== undefined ?
            before.phoneNumber : FieldValue.delete(),
          phone: before.phone !== undefined ?
            before.phone : FieldValue.delete(),
        }, {merge: true});
        await driverRef.set({phoneConflict: {phone: now,
          withDriverId: result.rival, verifiedElsewhere: false,
          at: FieldValue.serverTimestamp(), message: TAKEN}}, {merge: true});
        console.log(`Number for ${uid} refused: held by ${result.rival}`);
        return null;
      });

  /* The app asks before the driver sends a change of number. */
  const checkDriverPhone = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new HttpsError("unauthenticated", "Sign in.");
    const e164 = toE164(data && data.phone);
    if (!e164) {
      throw new HttpsError("invalid-argument",
          "Enter a phone number, for example 07700 900123.");
    }
    const {rival} = await rivalFor(context.auth.uid, e164);
    return {available: !rival, phone: e164, message: rival ? TAKEN : null};
  });

  return {TAKEN, claim, claimOrRefuse, release, rivalFor, holders,
    functions: {syncDriverPhone, checkDriverPhone}};
};

module.exports.TAKEN = TAKEN;
