// utils/deleteAccount.js
// "Delete my account": the person deletes their whole TakeARoute account
// (passenger and driver alike) from the app. The server does the work and
// refuses while a trip is booked or running, money is in the wallet or a
// withdrawal is pending (functions/fleet.js deleteMyAccount).
//
// Two confirmations, then the sign-in is gone, so the phone is signed out
// straight away. The same number can sign up again afterwards.
import { signOut } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../config/firebase';
import { Alert } from '../components/ui/alert';

export function confirmDeleteAccount({ onBusy } = {}) {
  const run = async () => {
    if (onBusy) onBusy(true);
    try {
      await httpsCallable(functions, 'deleteMyAccount')({});
    } catch (error) {
      if (onBusy) onBusy(false);
      Alert.alert("Couldn't delete your account", error?.message || 'Please try again.');
      return;
    }
    // The sign-in no longer exists; clear it from this phone.
    await signOut(auth).catch(() => {});
    Alert.alert('Account deleted', 'Your TakeARoute account and details have been deleted. You can sign up again at any time.');
  };

  Alert.alert(
    'Delete your account?',
    'This deletes your TakeARoute account: your passenger and driver details, documents, saved places, cards and photos. If you drive for a fleet, you leave it. Trip and payment records are kept for our accounts, without your details. This cannot be undone.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Continue',
        style: 'destructive',
        onPress: () =>
          setTimeout(() =>
            Alert.alert('Are you sure?', 'Your account will be deleted now.', [
              { text: 'Keep my account', style: 'cancel' },
              { text: 'Delete my account', style: 'destructive', onPress: run },
            ]), 50),
      },
    ],
  );
}
