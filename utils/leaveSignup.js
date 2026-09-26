// "Back" from the first step of sign-up.
//
// The first screen of rider or driver sign-up (and the account type picker
// before them) has nothing behind it in the navigation stack: the person is
// already signed in with their phone number, and App.js decides which flow
// they see. A back arrow that called goBack() there simply did nothing.
//
// Leaving sign-up therefore means signing out, which App.js answers by
// returning to the start screen. It asks first, because it throws away the
// phone sign-in they just completed.
import { Alert } from '../components/ui/alert';
import { signOutEverywhere } from './notifications';

export function confirmLeaveSignup() {
  Alert.alert(
    'Leave sign-up?',
    'You will be signed out and can start again with the same number at any time.',
    [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () => {
          signOutEverywhere().catch(() => {
            Alert.alert('Could not sign out', 'Please check your connection and try again.');
          });
        },
      },
    ],
  );
}
