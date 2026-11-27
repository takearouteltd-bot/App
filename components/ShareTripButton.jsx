// "Share my trip": a link to a live tracking page for a friend or family
// member, sent with the phone's own share sheet. The server makes the link
// once per trip (functions/fleetWeb.js shareTripLink; only this ride's
// passenger can) and the page (admin.takearoute.ltd/t/...) shows the
// driver's first name, car and plate, where the car is, the pickup and
// drop-off and a rough arrival time. No phone numbers and no fare, and the
// map stops when the trip ends.
import React, { useState } from 'react';
import { Share } from 'react-native';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';
import { Alert } from './ui/alert';
import { Button } from './ui/kit';

const plateOf = (driver) => (driver?.registrationNumber ? String(driver.registrationNumber).toUpperCase() : '');

export function shareMessage(url, driver) {
  const name = driver?.firstName || String(driver?.fullName || '').split(' ')[0] || '';
  const car = [driver?.vehicleColor, driver?.makeModel].filter(Boolean).join(' ');
  const plate = plateOf(driver);
  const who = name ? ` with ${name}` : '';
  const what = [car, plate].filter(Boolean).join(', ');
  return `I'm in a TakeARoute taxi${who}${what ? ` (${what})` : ''}. Follow my trip live: ${url}`;
}

export default function ShareTripButton({ rideId, driver, style }) {
  const [busy, setBusy] = useState(false);

  const share = async () => {
    if (!rideId || busy) return;
    setBusy(true);
    try {
      const res = await httpsCallable(functions, 'shareTripLink')({ rideId });
      const url = res?.data?.url;
      if (!url) throw new Error('No link came back.');
      await Share.share({ message: shareMessage(url, driver) }, { dialogTitle: 'Share my trip' });
    } catch (error) {
      Alert.alert('Could not share your trip', error?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      title="Share my trip"
      icon="share-outline"
      variant="secondary"
      size="small"
      loading={busy}
      style={style}
      onPress={share}
    />
  );
}
