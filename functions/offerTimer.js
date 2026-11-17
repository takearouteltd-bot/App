"use strict";

/* Waiting out a driver's time to answer an offer, inside the trigger that
   saw the offer (appOffers.js timeAppOffers, fleet.js timeFleetOffers), so
   the job moves on within a second of the time running out rather than at
   the next per-minute scheduler run.

   Deployed, the trigger waits and only then returns: Cloud Functions may
   stop work still running after a function has returned. The functions
   emulator, though, runs a change's triggers largely one after another, so
   a trigger waiting there holds up every later change to the job (the
   tests' declines, accepts and resends) for the whole wait. There the wait
   runs on in the background instead; what happens at the end is the same. */

/**
 * Runs fn after ms.
 * @param {number} ms Milliseconds to wait.
 * @param {Function} fn Async work for after the wait. Errors are logged.
 * @return {Promise<void>} Settles after fn (deployed), or at once (emulator).
 */
function waitThen(ms, fn) {
  const run = new Promise((r) => setTimeout(r, Math.max(0, ms)))
      .then(fn)
      .catch((error) => console.error("Offer timer failed:", error.message));
  if (process.env.FUNCTIONS_EMULATOR === "true") return Promise.resolve();
  return run;
}

module.exports = {waitThen};
