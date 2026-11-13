// A fleet driver's booked jobs: pre-booked phone jobs the office has
// allocated to them, soonest first. Each one rings as usual when it is time
// to go; until then the driver can tell the office they can't do it.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { getAuth } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { Alert } from '../../../components/ui/alert';
import {
  COLORS, TYPE, SPACE, Screen, ScreenHeader, Card, Chip, Button, EmptyState, RouteLine,
} from '../../../components/ui/kit';
import { classLabel } from '../../../constants/vehicleClasses';
import { money } from '../../../utils/appConfig';
import { bookedWhen, declineBookedJob, followOnError, useBookedJobs } from '../../../utils/followOn';

const PAY = { account: 'On account', card: 'Card (your terminal)', online: 'Paid online' };

export default function DriverBookedJobsScreen() {
  const uid = getAuth().currentUser?.uid || null;
  const [fleetId, setFleetId] = useState(null);
  useEffect(() => {
    if (!uid) return undefined;
    return onSnapshot(doc(db, 'drivers', uid), (s) => setFleetId(s.data()?.fleetId || null), () => {});
  }, [uid]);
  const jobs = useBookedJobs(uid, fleetId);
  const [busy, setBusy] = useState(null);

  const cantDo = (job) =>
    Alert.alert(
      "Can't do this job?",
      `The office gets it back to give to another driver. ${bookedWhen(job.pickupAt)} from ${String(job.pickupLocation?.address || '').split(',')[0]}.`,
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: "I can't do it",
          style: 'destructive',
          onPress: async () => {
            setBusy(job.id);
            try {
              await declineBookedJob(job.id);
            } catch (error) {
              Alert.alert('That did not work', followOnError(error));
            } finally {
              setBusy(null);
            }
          },
        },
      ]
    );

  return (
    <Screen>
      <ScreenHeader
        title="Booked jobs"
        subtitle={jobs.length ? `${jobs.length} from your office` : undefined}
      />
      {!jobs.length ? (
        <EmptyState
          icon="calendar-outline"
          title="No booked jobs"
          body="When your office books a job for later and gives it to you, it shows here. It rings like any job when it's time to go."
        />
      ) : (
        jobs.map((job) => (
          <Card key={job.id} style={styles.card}>
            <View style={styles.top}>
              <Text style={TYPE.subhead}>{bookedWhen(job.pickupAt)}</Text>
              <Text style={TYPE.callout}>{money(job.fare || 0, job.currency || 'GBP')}</Text>
            </View>
            <View style={styles.chips}>
              <Chip label={classLabel(job.rideType)} active />
              <Chip label={PAY[job.collectBy] || 'Cash'} icon="wallet-outline" />
              {job.stops?.length ? <Chip label={`${job.stops.length} stop${job.stops.length === 1 ? '' : 's'}`} icon="flag-outline" /> : null}
            </View>
            <RouteLine compact pickup={job.pickupLocation?.address} dropoff={job.dropoffLocation?.address} />
            {job.customerName ? (
              <Text style={[TYPE.small, { marginTop: SPACE[2] }]}>Customer: {job.customerName}</Text>
            ) : null}
            {job.accountCompany ? (
              <Text style={[TYPE.small, { marginTop: SPACE[1] }]}>Account: {job.accountCompany}</Text>
            ) : null}
            {job.notes ? (
              <Text style={[TYPE.small, { marginTop: SPACE[1], color: COLORS.inkSoft }]}>{job.notes}</Text>
            ) : null}
            <Text style={[TYPE.caption, { marginTop: SPACE[2], color: COLORS.muted }]}>
              {job.dispatchAt ? `It will ring at ${bookedWhen(job.dispatchAt).replace(/^(Today|Tomorrow) /, '')}.` : 'It rings when it is time to go.'}
            </Text>
            <Button
              title="I can't do this job"
              variant="secondary"
              size="small"
              style={{ marginTop: SPACE[3] }}
              loading={busy === job.id}
              disabled={Boolean(busy)}
              onPress={() => cantDo(job)}
            />
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: SPACE[3] },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE[2], marginVertical: SPACE[3] },
});
