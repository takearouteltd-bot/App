// Passenger trip history. The list itself is shared with drivers.
import React from 'react';
import TripsList from '../../../components/trips/TripsList';

export default function RiderTripsScreen() {
  return <TripsList role="rider" />;
}
