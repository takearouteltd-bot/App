// screens/Driver/Fleet/DriverFleetScreen.jsx
// Driving for a taxi firm (a fleet) on TakeARoute. A driver joins with the
// fleet's code, which the fleet then accepts, or accepts an invitation the
// fleet sent to their phone number. The fleet makes them a company driver
// (its car: card earnings go to the fleet, which pays the membership, and
// the fleet lets them go) or self-employed (own car: they keep their own
// fares and membership, and leave here themselves).
// Server side: functions/fleet.js.
import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { getAuth } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../../config/firebase';
import { Alert } from '../../../components/ui/alert';
import {
  TYPE, SPACE,
  Screen, ScreenHeader, Section, Card, Banner, Button, Field, Loading,
} from '../../../components/ui/kit';

const call = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);

export default function DriverFleetScreen({ navigation }) {
  const uid = getAuth().currentUser?.uid;
  const [driver, setDriver] = useState(undefined);
  const [code, setCode] = useState('');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!uid) return undefined;
    return onSnapshot(doc(db, 'drivers', uid), (snap) => setDriver(snap.exists() ? snap.data() : null), () => setDriver(null));
  }, [uid]);

  const run = async (name, data, done) => {
    setWorking(true);
    try {
      const result = await call(name, data);
      if (done) done(result);
    } catch (error) {
      Alert.alert('Something went wrong', error?.message || 'Please try again.');
    } finally {
      setWorking(false);
    }
  };

  if (driver === undefined) return <Loading label="Loading" />;

  const invite = driver?.fleetInvite;
  const request = driver?.fleetRequest;
  const fleetName = driver?.fleetName || 'your fleet';
  const selfEmployed = driver?.fleetDriverType === 'self';
  // A fleet on a flat monthly plan pays every driver's membership.
  const fleetPaysMembership = driver?.subscription?.paymentMethod === 'fleet';

  const leave = () =>
    Alert.alert(`Leave ${fleetName}?`, fleetPaysMembership ? `You stop getting their jobs and drive independently. Your wallet stays as it is; ${fleetName} stops paying your membership, so the one you had before comes back (or you activate one).` : 'You stop getting their jobs and drive independently. Your wallet and membership stay as they are.', [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () => run('leaveFleet', {}, () => Alert.alert('You left the fleet', 'You now drive independently.')),
      },
    ]);

  return (
    <Screen>
      <ScreenHeader title="Fleet" subtitle="Drive for a taxi firm on TakeARoute" />

      {driver?.fleetId ? (
        <Section title="Your fleet">
          <Card>
            <Text style={TYPE.heading}>{driver.fleetName || 'Your fleet'}</Text>
            <Text style={[TYPE.small, { marginTop: SPACE[1] }]}>{selfEmployed ? 'Self-employed, own car' : 'Company car driver'}</Text>
            {selfEmployed ? (
              <Text style={[TYPE.body, { marginTop: SPACE[2] }]}>
                You get their phone bookings as well as normal app jobs. Card fares still go to your wallet{fleetPaysMembership ? `, and ${fleetName} pays your TakeARoute membership` : ', and you pay your own membership'}.
              </Text>
            ) : (
              <>
                <Text style={[TYPE.body, { marginTop: SPACE[2] }]}>
                  Your card fares go to {fleetName}, who pay you. They also pay your TakeARoute membership.
                  You get their phone bookings as well as normal app jobs.
                </Text>
                <Text style={[TYPE.small, { marginTop: SPACE[3] }]}>
                  To leave, ask your fleet to let you go. You then drive on your own: card fares go to your wallet again, and the membership you had before joining comes back (or you activate one).
                </Text>
              </>
            )}
            <Button title="Messages with the office" onPress={() => navigation.navigate('OfficeChat')} style={{ marginTop: SPACE[4] }} />
            <Button title="My statement" variant="secondary" onPress={() => navigation.navigate('DriverStatement')} style={{ marginTop: SPACE[4] }} />
            {selfEmployed ? (
              <Button title="Leave fleet" variant="secondary" loading={working} onPress={leave} style={{ marginTop: SPACE[4] }} />
            ) : null}
          </Card>
        </Section>
      ) : null}

      {!driver?.fleetId && invite ? (
        <Section title="Invitation">
          <Banner
            tone="success"
            icon="people-outline"
            title={`${invite.fleetName || 'A fleet'} invited you`}
            body={invite.driverType === 'self'
              ? 'They invited you as a self-employed driver. You get their phone bookings, and your card fares and membership stay your own.'
              : 'They invited you as a company car driver. Your card fares go to the fleet and the fleet pays your membership. You also get their phone bookings.'}
            action={
              <>
                <Button
                  title={`Join ${invite.fleetName || 'the fleet'}`}
                  loading={working}
                  onPress={() =>
                    run('answerFleetInvite', { accept: true }, (r) =>
                      Alert.alert(r.joined ? 'Welcome' : 'Invitation gone', r.joined ? `You now drive for ${r.fleetName}.` : 'This invitation is no longer valid.')
                    )
                  }
                />
                <Button title="No thanks" variant="ghost" disabled={working} onPress={() => run('answerFleetInvite', { accept: false })} style={{ marginTop: SPACE[2] }} />
              </>
            }
          />
        </Section>
      ) : null}

      {!driver?.fleetId && request ? (
        <Section title="Request sent">
          <Banner
            tone="info"
            icon="time-outline"
            title={`Waiting for ${request.fleetName || 'the fleet'}`}
            body="They will accept you from their dashboard. We will let you know."
            action={<Button title="Cancel request" variant="secondary" loading={working} onPress={() => run('cancelFleetRequest', {})} />}
          />
        </Section>
      ) : null}

      {!driver?.fleetId && !request ? (
        <Section title="Join a fleet">
          <Card>
            <Text style={[TYPE.body, { marginBottom: SPACE[4] }]}>
              Ask the fleet for their join code and enter it here. When they accept you, they choose: company car driver (the fleet gets your card fares and pays your membership) or self-employed (you keep both).
            </Text>
            <Field
              label="Fleet code"
              value={code}
              onChangeText={(v) => setCode(v.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={8}
              placeholder="For example ABC234"
            />
            <Button
              title="Send request"
              loading={working}
              disabled={code.trim().length < 4}
              onPress={() =>
                run('requestFleetJoin', { code: code.trim() }, (r) => {
                  setCode('');
                  Alert.alert('Request sent', `${r.fleetName} will accept you from their dashboard.`);
                })
              }
            />
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}
