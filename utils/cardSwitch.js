// Paying by card instead of cash (functions/cardSwitch.js). The server
// decides everything, the amount included; these only decide what to show
// and make the calls.
import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';
import { getAppConfig } from './appConfig';

// Wallets in Stripe's payment sheet. Both need a new native build first:
// Google Pay the "@stripe/stripe-react-native" plugin in app.json with
// enableGooglePay: true; Apple Pay a merchant ID (Apple Developer and
// Stripe), set on StripeProvider in App.js and here. Until then the sheet
// offers saved cards and a new card.
export const WALLETS = { googlePay: false, applePayMerchantId: null };

const call = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);

export const startInApp = (rideId) => call('cardSwitchStart', { rideId });
export const startLink = (rideId, opts = {}) => call('cardLinkStart', { rideId, ...opts });
export const checkCardSwitch = (rideId) => call('cardSwitchStatus', { rideId });
export const stopCardSwitch = (rideId, opts = {}) => call('cardSwitchCancel', { rideId, ...opts });

export const switchOf = (ride) => ride?.paymentSwitch || null;

// Booked as cash, and the card is now held or charged instead.
export function paidByCardInstead(ride) {
  return ['held', 'paid'].includes(switchOf(ride)?.state);
}

function settings(cfg) {
  const s = cfg?.cardSwitch || {};
  return {
    enabled: Number(s.enabled ?? 1) === 1,
    windowMinutes: Number(s.windowMinutes ?? 30),
    fleetJobs: Number(s.fleetJobs ?? 0) === 1,
  };
}

// Whether "Pay by card instead" (passenger) or "Customer wants to pay by
// card" (driver) applies to this trip now. The driver's link is for a
// finished trip only: its amount is the final fare.
export function cardSwitchOffered(ride, who = 'passenger', now = Date.now(), cfg = getAppConfig()) {
  const s = settings(cfg);
  if (!s.enabled || !ride || paidByCardInstead(ride)) return false;
  if (ride.paymentMethod !== 'cash' || ['account', 'card', 'online'].includes(ride.collectBy)) return false;
  if ((ride.fleetId || ride.source === 'phone') && !s.fleetJobs) return false;
  if (who === 'passenger' && ride.source === 'phone') return false;
  if (ride.cashCollected === true) return false;
  if (ride.status === 'ongoing') return who === 'passenger';
  if (ride.status !== 'completed' || ride.paymentStatus === 'no_charge') return false;
  const ended = ride.completedAt?.toMillis?.() || 0;
  return ended > 0 && now - ended <= s.windowMinutes * 60000;
}

// Whether the driver may offer card when they complete (on the trip screen).
export function cardOnCompletion(ride, cfg = getAppConfig()) {
  const s = settings(cfg);
  if (!s.enabled || !ride || ride.paymentMethod !== 'cash') return false;
  if (['account', 'card', 'online'].includes(ride.collectBy)) return false;
  return !((ride.fleetId || ride.source === 'phone') && !s.fleetJobs);
}

// The error text a callable sent, without Firebase's prefix.
export const reason = (error) => String(error?.message || 'Something went wrong. Please try again.').replace(/^(FirebaseError|Error):\s*/, '');
