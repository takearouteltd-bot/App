// utils/legal.js
// The published terms and privacy policy. Linked from the sign-up screen, and
// from Account so people can read them again after they have agreed to them.
//
// The full drafts live in this repo under public/ and can be served from
// Firebase Hosting if the site has not been updated yet.
import { Alert, Linking } from 'react-native';

export const TERMS_URL = 'https://www.takearoute.co.uk/terms-conditions/';
export const PRIVACY_URL = 'https://www.takearoute.co.uk/privacy-policy/';

export async function openPolicy(url, label) {
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) throw new Error('unsupported');
    await Linking.openURL(url);
  } catch (error) {
    Alert.alert(`${label} unavailable`, 'We could not open that page. Please try again later.');
  }
}

export const openTerms = () => openPolicy(TERMS_URL, 'Terms of use');
export const openPrivacy = () => openPolicy(PRIVACY_URL, 'Privacy policy');
