// utils/calling.js
// Masked calling. Tapping Call asks the server to ring this phone first, then
// connect the other party. Neither side sees the other's number, and it only
// works while a trip is live.
import { Alert } from 'react-native';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';

let inFlight = false;

export async function startMaskedCall(rideId, otherPartyLabel = 'the other person') {
  if (!rideId || inFlight) return;
  inFlight = true;
  try {
    const call = httpsCallable(functions, 'startMaskedCall');
    await call({ rideId });
    Alert.alert(
      'Connecting your call',
      `Your phone will ring in a moment. Answer it and we will connect you to ${otherPartyLabel}. Your numbers stay private.`
    );
  } catch (error) {
    Alert.alert('Call not connected', error?.message || 'Please try again, or use chat.');
  } finally {
    inFlight = false;
  }
}

// Confirms first, so a mis-tap doesn't ring two phones.
export function confirmMaskedCall(rideId, otherPartyLabel) {
  Alert.alert(
    `Call ${otherPartyLabel}?`,
    'We will ring your phone first, then connect you. Neither of you sees the other\'s number.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Call', onPress: () => startMaskedCall(rideId, otherPartyLabel) },
    ]
  );
}
