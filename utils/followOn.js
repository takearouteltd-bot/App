/* Follow-on jobs and booked jobs for drivers.

   Follow-on job: while a passenger is on board, the server may offer the
   driver a booking that starts near their drop-off (followOnOffers/{me},
   functions/followOn.js). Accepting it makes it their next job; when the
   trip ends the server makes it their current one, and the job list's
   "accepted job" listener on the home screen opens it.

   Booked jobs: a fleet's pre-booked phone jobs the office allocated to this
   driver (fleetAllocations, functions/fleet.js syncFleetAllocation). They
   ring as usual when it is time to send them. */
import { useEffect, useState } from 'react';
import { collection, doc, limit, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../config/firebase';

const ms = (t) => (t?.toMillis ? t.toMillis() : t ? Number(new Date(t)) : 0);

/** The follow-on offer waiting for this driver, or null once it runs out. */
export function useFollowOnOffer(driverId) {
  const [offer, setOffer] = useState(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!driverId) return undefined;
    return onSnapshot(
      doc(db, 'followOnOffers', driverId),
      (snap) => setOffer(snap.exists() ? { id: snap.id, ...snap.data() } : null),
      () => setOffer(null)
    );
  }, [driverId]);
  // A second tick only while an offer is showing, for the countdown.
  useEffect(() => {
    if (!offer) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [offer]);
  if (!offer) return null;
  const left = Math.ceil((ms(offer.expiresAt) - now) / 1000);
  return left > 0 ? { ...offer, secondsLeft: left } : null;
}

/** The follow-on job this driver accepted and hasn't started, if any.
    With started, also one the server has just made their current job. */
export function useNextJob(driverId, currentRideId, started = false) {
  const [next, setNext] = useState(null);
  useEffect(() => {
    if (!driverId) return undefined;
    return onSnapshot(
      query(
        collection(db, 'rides'),
        where('driverId', '==', driverId),
        where('status', '==', 'accepted'),
        limit(3)
      ),
      (snap) => {
        const job = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .find((r) => r.id !== currentRideId && r.followOn && (started || !r.followOn.startedAt));
        setNext(job || null);
      },
      () => setNext(null)
    );
  }, [driverId, currentRideId, started]);
  return next;
}

/** Accept or decline an offer, or give back an accepted follow-on ("drop"). */
export async function answerFollowOn(rideId, answer) {
  const res = await httpsCallable(functions, 'answerFollowOnJob')({ rideId, answer });
  return res.data;
}

/** This driver's booked jobs from their fleet, soonest first. */
export function useBookedJobs(driverId, fleetId) {
  const [jobs, setJobs] = useState([]);
  useEffect(() => {
    if (!driverId || !fleetId) {
      setJobs([]);
      return undefined;
    }
    return onSnapshot(
      query(collection(db, 'fleetAllocations'), where('driverId', '==', driverId)),
      (snap) =>
        setJobs(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => ms(a.pickupAt) - ms(b.pickupAt))
        ),
      () => setJobs([])
    );
  }, [driverId, fleetId]);
  return jobs;
}

/** "I can't do this booked job": it goes back to the office. */
export async function declineBookedJob(rideId) {
  await httpsCallable(functions, 'declineFleetAllocation')({ rideId });
}

/** "Fri 14 Nov, 14:30", or "Today 14:30" / "Tomorrow 09:15". */
export function bookedWhen(t) {
  const at = ms(t);
  if (!at) return 'Booked';
  const d = new Date(at);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (day === t0) return `Today ${time}`;
  if (day === t0 + 86400000) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}

/** Why the server said no, as a sentence for the driver. */
export function followOnError(error) {
  const m = error?.message || '';
  return /internal|network|unavailable|deadline/i.test(error?.code || '') || !m
    ? 'Check your connection and try again.'
    : m;
}
