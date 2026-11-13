/* Keeping people's private details away from other users.

   drivers/{id} is readable by every signed-in user (a passenger needs their
   driver's name, photo, car and rating, and the live position), so nothing
   private is kept there:

   driverPrivate/{id}  bank details, National Insurance number, date of
                       birth, home address, phone, email, emergency contact
                       and payout account. Owner and admins only.
   driverFiles/{id}    document links and the right to work share code.
                       Owner, admins, and the staff of the driver's fleet or
                       the fleet they are asking to join.
   riderPublic/{id}    a passenger's name, photo and rating, for the driver on
                       their trip. riders/{id} itself is the passenger's and
                       admins' only. Written here, never by the apps.
   fleetJobOffers/{id} a phone job waiting for a driver, without the
                       customer's number, for the fleet's own drivers.

   Keep the field lists in step with firestore.rules and
   qa/migrate-driver-private.mjs. */

const PRIVATE_FIELDS = ["accountDetails", "bankDetails", "sortCode",
  "accountNumber", "nin", "dob", "address", "phoneNumber", "phone", "email",
  "emergencyContact", "payoutAccountId", "payoutAccountFingerprint",
  "payoutTermsAcceptance"];

const FILE_FIELDS = ["rightToWorkShareCode", "driverLicenseFrontUrl",
  "driverLicenseBackUrl", "driverLicenseUrl", "pcoLicenseUrl",
  "vehicleLicenceUrl", "insuranceUrl", "motUrl", "dbsCertificateUrl",
  "companyAgreementUrl"];

/* What a driver on a job may see of their passenger. */
const RIDER_PUBLIC_FIELDS = ["fullName", "firstName", "lastName", "name",
  "profileImage", "photoURL", "selfieUrl", "rating", "ratingCount",
  "averageRating"];

/* What a fleet's drivers see of a phone job on offer. An allowlist, so the
   customer's number can never come along by accident. */
const OFFER_FIELDS = ["source", "fleetId", "fleetName", "status", "rideType",
  "bidding", "dispatch", "declinedBy", "blockedDriverIds", "pickupLocation",
  "dropoffLocation", "stops", "route", "fare", "fareEstimate", "offeredFare",
  "currency", "notes", "paymentMethod", "payment", "collectBy", "account",
  "pickupAt", "femaleDriverOnly", "cityId", "cityName", "waitingPolicy",
  "cancellationPolicy", "timestamps"];

const FIELDS = {PRIVATE_FIELDS, FILE_FIELDS, RIDER_PUBLIC_FIELDS,
  OFFER_FIELDS};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const pick = (data, fields) => {
  const out = {};
  fields.forEach((f) => {
    if (data && data[f] !== undefined) out[f] = data[f];
  });
  return out;
};

const {FieldValue} = require("firebase-admin/firestore");

const makePrivacy = ({functions, db}) => {
  const privateRef = (uid) => db.collection("driverPrivate").doc(uid);
  const filesRef = (uid) => db.collection("driverFiles").doc(uid);

  /**
   * A driver's private details and documents.
   * @param {string} uid Driver.
   * @return {Promise<Object>} Fields from driverPrivate and driverFiles.
   */
  async function driverSecrets(uid) {
    const [a, b] = await Promise.all([privateRef(uid).get(),
      filesRef(uid).get()]);
    return Object.assign({}, b.exists ? b.data() : {},
        a.exists ? a.data() : {});
  }

  /**
   * The driver's full record: drivers/{id} plus their private details. The
   * private documents win; a driver not yet migrated keeps working from the
   * old fields.
   * @param {string} uid Driver.
   * @param {Object} driver drivers/{id} data.
   * @return {Promise<Object>} Merged record.
   */
  async function withPrivate(uid, driver) {
    return Object.assign({}, driver || {}, await driverSecrets(uid));
  }

  /* Passengers' public card, kept in step with riders/{id}. */
  const syncRiderPublic = functions.firestore
      .document("riders/{uid}")
      .onWrite(async (change, context) => {
        const ref = db.collection("riderPublic").doc(context.params.uid);
        if (!change.after.exists) {
          await ref.delete().catch(() => null);
          return null;
        }
        const next = pick(change.after.data(), RIDER_PUBLIC_FIELDS);
        const prev = change.before.exists ?
          pick(change.before.data(), RIDER_PUBLIC_FIELDS) : null;
        if (prev && same(next, prev)) return null;
        await ref.set(next);
        return null;
      });

  /* A phone job while it waits for a driver, without the customer's number,
     for the fleet's drivers (fleetJobOffers/{rideId}). Taking it goes on the
     ride itself (firestore.rules driverClaimsFleetJob). */
  const mirrorFleetJobOffer = functions.firestore
      .document("rides/{rideId}")
      .onWrite(async (change, context) => {
        const after = change.after.exists ? change.after.data() : null;
        const ref = db.collection("fleetJobOffers").doc(context.params.rideId);
        // A job held for the office (functions/fleet.js heldForOffice) is
        // offered to nobody.
        const offered = after && after.source === "phone" &&
          after.status === "dispatching" && typeof after.fleetId === "string" &&
          !after.riderId && (after.dispatch || {}).mode !== "office";
        if (!offered) {
          const before = change.before.exists ? change.before.data() : null;
          if (before && before.status === "dispatching" &&
              (before.dispatch || {}).mode !== "office") {
            await ref.delete().catch(() => null);
          }
          return null;
        }
        const next = pick(after, OFFER_FIELDS);
        next.customer = {name: (after.customer && after.customer.name) || ""};
        const before = change.before.exists ?
          pick(change.before.data(), OFFER_FIELDS) : null;
        if (before && before.status === "dispatching") {
          before.customer = {name: (change.before.data().customer || {}).name ||
            ""};
          if (same(next, before)) return null;
        }
        await ref.set(next);
        return null;
      });

  /* A rejected applicant goes back through the application. Handing in an
     application is one-way for the app (firestore.rules), so reopening it
     is done here, and only after a rejection. */
  const resubmitDriverApplication = functions.https.onCall(
      async (data, context) => {
        if (!context.auth) {
          throw new functions.https.HttpsError("unauthenticated", "Sign in.");
        }
        const ref = db.collection("drivers").doc(context.auth.uid);
        const snap = await ref.get();
        if (!snap.exists || snap.data().onboardingStatus !== "rejected") {
          throw new functions.https.HttpsError("failed-precondition",
              "Only a declined application can be sent again.");
        }
        await ref.update({onboardingComplete: false,
          onboardingStatus: FieldValue.delete(),
          rejectionReason: FieldValue.delete(), approved: false,
          updatedAt: FieldValue.serverTimestamp()});
        return {ok: true};
      });

  return {
    privateRef, filesRef, driverSecrets, withPrivate,
    PRIVATE_FIELDS, FILE_FIELDS,
    functions: {syncRiderPublic, mirrorFleetJobOffer,
      resubmitDriverApplication},
  };
};

module.exports = makePrivacy;
module.exports.FIELDS = FIELDS;
