/* What changed on a trip after it was booked, for the passenger's summary
   and trip details: an extended trip (it went on past the drop-off), a
   destination changed on the way, and a fare paid partly in cash because
   the card would not cover the new price (functions/destinationChange.js).
   Draws nothing for an ordinary trip. */
import React from 'react';
import { Text } from 'react-native';
import { money } from '../../utils/appConfig';
import { acceptedChanges, extraMiles } from '../../utils/destinationChange';
import { Card, SPACE, TYPE } from '../ui/kit';

export function tripChangeNotes(ride, driverName = 'your driver') {
  const fare = ride?.fare || {};
  const currency = ride?.currency || fare.currency;
  const from = String(ride?.originalDropoffLocation?.address || '').split(',')[0];
  return [
    ride?.extendedTrip
      ? `Extended trip: ${extraMiles(ride.extendedTrip.extraKm)} mi past your drop-off, charged at the normal rate.`
      : null,
    acceptedChanges(ride).length ? `Destination changed on the way${from ? `, from ${from}` : ''}.` : null,
    Number(fare.cashExtra) > 0
      ? `${money(fare.cardTotal, currency)} by card and ${money(fare.cashExtra, currency)} in cash to ${driverName}.`
      : null,
  ].filter(Boolean);
}

export default function TripChangeNotes({ ride, driverName, style }) {
  const notes = tripChangeNotes(ride, driverName);
  if (!notes.length) return null;
  return (
    <Card style={[{ marginTop: SPACE[3] }, style]}>
      {notes.map((note, i) => (
        <Text key={note} style={[TYPE.small, i > 0 && { marginTop: SPACE[2] }]}>
          {note}
        </Text>
      ))}
    </Card>
  );
}
