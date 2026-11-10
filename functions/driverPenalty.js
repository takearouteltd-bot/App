/* ======================================
   A DRIVER CANCELS A JOB THEY ACCEPTED

   The driver gives the job back from the app (accepted or arrived, then back
   to searching, or to the fleet's office for a phone job). Each one is
   written to driverCancellations for the panels, and the admin can penalise
   it: Settings > Cancellation, driverPenaltyMode 0 none, 1 money, 2 time off
   the road. Near the pickup (within driverPenaltyRadiusKm) it counts; further
   away it is free; radius 0 means every cancel counts.

   The app's warning is only an estimate. This is what decides.
====================================== */

const LOCATION_FRESH_MS = 5 * 60 * 1000;

const toMs = (value) => (value && value.toMillis ? value.toMillis() : 0);
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Was this update a driver giving a job back? Server releases (a card hold
 * that failed) stamp serverReleasedAt in the same write; the rules do not let
 * a driver touch that field, or the job could not be told apart.
 * @param {Object} before Ride before.
 * @param {Object} after Ride after.
 * @return {boolean} True for a driver's own cancel.
 */
function isDriverCancel(before, after) {
  return ["accepted", "arrived"].includes(before.status) &&
    ["searching", "dispatching"].includes(after.status) &&
    Boolean(before.driverId) && !after.driverId &&
    toMs(before.serverReleasedAt) === toMs(after.serverReleasedAt);
}

/**
 * What this cancel costs the driver.
 * @param {Object} settings config cancellation section.
 * @param {?number} km Distance from the pickup, null when not known.
 * @return {Object} {applied, type, amount, minutes, reason}.
 */
function penaltyDecision(settings, km) {
  const c = settings || {};
  const mode = Number(c.driverPenaltyMode) || 0;
  const type = mode === 1 ? "money" : mode === 2 ? "time" : "none";
  const amount = round2(Number(c.driverPenaltyAmount) || 0);
  const minutes = Math.round(Number(c.driverPenaltyMinutes) || 0);
  const radius = Number(c.driverPenaltyRadiusKm) || 0;
  const none = (reason) => ({applied: false, type, amount: null, minutes: null,
    reason});

  if (type === "none") return none("off");
  if (type === "money" && !(amount > 0)) return none("not_set");
  if (type === "time" && !(minutes > 0)) return none("not_set");
  if (radius > 0) {
    if (km === null) return none("location_unknown");
    if (km > radius) return none("outside_radius");
  }
  return {
    applied: true,
    type,
    amount: type === "money" ? amount : null,
    minutes: type === "time" ? minutes : null,
    reason: radius > 0 ? "within_radius" : "every_cancel",
  };
}

/**
 * The driver's distance from the pickup, if we can trust where they are.
 * @param {Object} driver Driver data.
 * @param {Object} pickup Pickup {latitude, longitude}.
 * @param {function} distanceKm Distance helper.
 * @param {number} now Current time in ms.
 * @return {?number} Kilometres, or null when missing or out of date.
 */
function freshDistance(driver, pickup, distanceKm, now) {
  const updated = toMs(driver.lastUpdated);
  if (!updated || now - updated > LOCATION_FRESH_MS) return null;
  const km = distanceKm(driver.location, pickup);
  return Number.isFinite(km) ? round2(km) : null;
}

module.exports = ({functions, db, sendPush, loadAppConfig, distanceKm}) => {
  const {FieldValue, Timestamp} = require("firebase-admin/firestore");

  const recordDriverCancel = functions.firestore
      .document("rides/{rideId}")
      .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();
        if (!isDriverCancel(before, after)) return null;

        const rideId = context.params.rideId;
        const driverId = before.driverId;
        const cfg = await loadAppConfig();
        const driverRef = db.collection("drivers").doc(driverId);
        const walletRef = db.collection("driverWallets").doc(driverId);
        // Once per acceptance: delivered twice, the second run finds this.
        const recordRef = db.collection("driverCancellations")
            .doc(`${rideId}_${driverId}_${toMs(before.acceptedAt)}`);

        const outcome = await db.runTransaction(async (tx) => {
          const seen = await tx.get(recordRef);
          if (seen.exists) return null;
          const driverSnap = await tx.get(driverRef);
          const wallet = await tx.get(walletRef);
          const driver = driverSnap.exists ? driverSnap.data() : {};
          const now = Date.now();
          const km = freshDistance(driver, before.pickupLocation, distanceKm,
              now);
          const decision = penaltyDecision(cfg.cancellation, km);
          let until = null;

          // A company driver's fares go to the fleet and they never withdraw,
          // so a wallet debit could never be collected. It comes off what
          // the fleet owes them, on their statement, instead.
          const statementFleet = driver.fleetId &&
            driver.fleetDriverType !== "self" ? driver.fleetId : null;
          if (decision.applied && decision.type === "money" && statementFleet) {
            const pence = Math.round(decision.amount * 100);
            const fleetRef = db.collection("fleets").doc(statementFleet);
            tx.set(fleetRef.collection("driverPayments").doc(), {
              driverId,
              direction: "penalty",
              amountPence: pence,
              note: "Penalty for cancelling a job",
              rideId,
              paidAt: FieldValue.serverTimestamp(),
            });
            tx.set(fleetRef.collection("driverAccounts").doc(driverId), {
              driverId,
              owedPence: FieldValue.increment(-pence),
              updatedAt: FieldValue.serverTimestamp(),
            }, {merge: true});
          } else if (decision.applied && decision.type === "money") {
            const currency = String(before.currency || cfg.currency ||
              "GBP").toUpperCase();
            if (wallet.exists) {
              tx.update(walletRef, {
                availableBalance: FieldValue.increment(-decision.amount),
                totalPenalties: FieldValue.increment(decision.amount),
                updatedAt: FieldValue.serverTimestamp(),
              });
            } else {
              tx.set(walletRef, {
                availableBalance: -decision.amount,
                totalEarned: 0,
                totalPenalties: decision.amount,
                pendingBalance: 0,
                currency,
                walletStatus: "active",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
              });
            }
            tx.set(walletRef.collection("transactions").doc(), {
              type: "cancel_penalty",
              amount: -decision.amount,
              rideId,
              driverId,
              status: "cleared",
              description: "Penalty for cancelling a job",
              createdAt: FieldValue.serverTimestamp(),
            });
          }

          if (decision.applied && decision.type === "time" &&
              driverSnap.exists) {
            const untilMs = Math.max(now + decision.minutes * 60000,
                toMs(driver.cancelBlockedUntil));
            until = Timestamp.fromMillis(untilMs);
            const fields = {cancelBlockedUntil: until};
            // Already on another job? That one finishes; the rules stop the
            // next. Otherwise they come off the road now.
            const onOther = driver.currentRideId &&
              driver.currentRideId !== rideId;
            if (!onOther) {
              fields.status = "offline";
              fields.isOnRide = false;
              fields.currentRideId = null;
            }
            tx.update(driverRef, fields);
          }

          const name = [driver.firstName, driver.lastName].filter(Boolean)
              .join(" ") || driver.name || driver.fullName || "Driver";
          tx.set(recordRef, {
            rideId,
            driverId,
            driverName: name,
            fleetId: before.fleetId || null,
            source: before.source === "phone" ? "phone" : "app",
            via: (before.bookedBy && before.bookedBy.via) || null,
            statusWhenCancelled: before.status,
            pickup: (before.pickupLocation &&
              before.pickupLocation.address) || null,
            dropoff: (before.dropoffLocation &&
              before.dropoffLocation.address) || null,
            at: FieldValue.serverTimestamp(),
            distanceKm: km,
            locationKnown: km !== null,
            currency: String(before.currency || cfg.currency || "GBP")
                .toUpperCase(),
            penalty: {
              applied: decision.applied,
              type: decision.type,
              amount: decision.amount,
              minutes: decision.minutes,
              reason: decision.reason,
              until,
              chargedTo: decision.applied && decision.type === "money" ?
                (statementFleet ? "fleet_statement" : "wallet") : null,
            },
          });
          return Object.assign({}, decision, {statementFleet});
        });

        if (outcome && outcome.applied) {
          await sendPush([driverId], {
            title: "Penalty for cancelling a job",
            body: outcome.type === "money" ?
              `You cancelled a job you had accepted, so ` +
                `${outcome.amount.toFixed(2)} has been taken from ` +
                (outcome.statementFleet ? `what your fleet owes you.` :
                  `your balance.`) :
              `You cancelled a job you had accepted, so you can't go ` +
                `online for ${outcome.minutes} minutes.`,
            data: {type: "driver_cancel_penalty", rideId},
          }).catch((error) => {
            console.error("Penalty push failed:", rideId, error.message);
          });
        }
        return null;
      });

  return {functions: {recordDriverCancel}};
};

module.exports.isDriverCancel = isDriverCancel;
module.exports.penaltyDecision = penaltyDecision;
