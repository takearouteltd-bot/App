/* Invite a friend. Everything that matters happens on the server
   (functions/referrals.js): it makes the codes, checks a code entered, pays
   the ride credit after the friend's first card trip, and takes the credit
   off the next card trip. The app only asks and shows. Settings: config/app
   referrals (dashboard Settings > Invite friends); hidden while it is off. */
import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';
import { money } from './appConfig';

export const SHARE_URL = 'https://www.takearoute.co.uk';

/** Switched on, with at least one reward to give. */
export function referralsEnabled(config) {
  const r = config?.referrals || {};
  return Number(r.enabled) === 1 && (Number(r.newRiderReward) > 0 || Number(r.referrerReward) > 0);
}

/** This passenger's code (made on first ask). */
export async function myReferralCode() {
  const res = await httpsCallable(functions, 'myReferralCode')({});
  return res.data?.code || null;
}

/** Enters a friend's code. Throws with the server's reason as the message. */
export async function applyReferralCode(code) {
  const res = await httpsCallable(functions, 'applyReferralCode')({ code: String(code || '').trim() });
  return res.data;
}

/** The text the share sheet sends. */
export function shareText(code, config) {
  const reward = Number(config?.referrals?.newRiderReward) || 0;
  const offer = reward > 0 ? `get ${money(reward)} off a TakeARoute trip` : 'try TakeARoute';
  return `Use my code ${code} to ${offer}. Download the app and enter the code before your first trip: ${SHARE_URL}`;
}

/** Ride credit in pounds from riderCredit/{uid}. */
export function creditPounds(creditDoc) {
  return Math.max(0, Number(creditDoc?.balanceMinor) || 0) / 100;
}
