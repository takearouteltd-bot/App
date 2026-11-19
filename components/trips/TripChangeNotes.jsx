/* What changed on a trip after it was booked, for the passenger's summary
   and trip details: an extended trip (it went on past the drop-off), a
   destination changed on the way, and a fare paid partly in cash because
   the card would not cover the new price (functions/destinationChange.js).
   Draws nothing for an ordinary trip. */
import React from 'react';
import { Text } from 'react-native';
import { money } from '../../utils/appConfig';
import { acceptedChanges, extraMiles } from '../../utils/destinationChange';
import { extendedState, extraAmount } from '../../utils/extendedTrip';
import { Card, SPACE, TYPE } from '../ui/kit';

/** What happened to the extra miles of an extended trip
    (functions/extendedTrips.js); the approve / dispute card covers
    "pending". */
function extendedNote(ride, currency) {
  const state = extendedState(ride);
  if (!state || state === 'pending') return null;
  const mi = `${extraMiles(ride.extendedTrip.extraKm)} mi past your drop-off`;
  const extra = money(extraAmount(ride), currency);
  switch (state) {
    case 'charged':
      return ride.extendedTrip.state
        ? `Extended trip: ${mi}. ${extra} extra charged to your card.`
        : `Extended trip: ${mi}, charged at the normal rate.`;
    case 'collect':
      return `Extended trip: ${mi}. ${extra} extra, paid to your driver.`;
    case 'approved':
    case 'charging':
      return `Extended trip: ${mi}. ${extra} extra, being charged.`;
    case 'disputed':
      return `Extended trip: ${mi}. You disputed the ${extra} extra; our office will let you know what they decide.`;
    case 'waived':
      return `Extended trip: ${mi}. You were not charged for the extra miles.`;
    default:
      // office, unanswered, charge_failed: the office looks at it.
      return `Extended trip: ${mi}. Our office is checking the ${extra} extra.`;
  }
}

export function tripChangeNotes(ride, driverName = 'your driver') {
  const fare = ride?.fare || {};
  const currency = ride?.currency || fare.currency;
  const from = String(ride?.originalDropoffLocation?.address || '').split(',')[0];
  return [
    extendedNote(ride, currency),
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
