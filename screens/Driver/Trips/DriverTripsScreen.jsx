// Driver trip history. The list itself is shared with passengers.
import React from 'react';
import TripsList from '../../../components/trips/TripsList';

export default function DriverTripsScreen() {
  return <TripsList role="driver" />;
}
