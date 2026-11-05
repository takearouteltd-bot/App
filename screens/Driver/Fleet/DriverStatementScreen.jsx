// screens/Driver/Fleet/DriverStatementScreen.jsx
// A fleet driver's own statement: what the fleet owes them or they owe the
// fleet, their jobs and the payments the fleet recorded. Read only. The same
// figures the fleet sees on its dashboard (functions/fleet.js settleFleetJob).
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { getAuth } from 'firebase/auth';
import { collection, doc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import {
  COLORS, TYPE, SPACE,
  Screen, ScreenHeader, Section, Card, Banner, Segmented, EmptyState, Loading, Divider, formatWhen,
} from '../../../components/ui/kit';

const pounds = (pence) => `${pence < 0 ? '-' : ''}£${(Math.abs(pence || 0) / 100).toFixed(2)}`;
const place = (p) => p?.address?.split(',')[0] || '';

const KIND_WORDS = {
  account: 'Account job',
  cash: 'Cash, you kept it',
  card: 'Card, your terminal',
  appCard: 'App card, paid to the fleet',
  appCash: 'App cash, you kept it',
  cancelFee: 'Cancellation fee',
};

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'account', label: 'Account' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
];
const matches = (kind, filter) =>
  filter === 'all' ||
  (filter === 'account' && kind === 'account') ||
  (filter === 'cash' && (kind === 'cash' || kind === 'appCash')) ||
  (filter === 'card' && (kind === 'card' || kind === 'appCard'));

function balanceBanner(owed, fleetName) {
  if (owed > 0) return { tone: 'success', title: `${fleetName} owes you ${pounds(owed)}`, body: 'They pay you directly and record it here.' };
  if (owed < 0) return { tone: 'warning', title: `You owe ${fleetName} ${pounds(-owed)}`, body: 'This is their commission on money you already hold. Settle it with them directly.' };
  return { tone: 'info', title: 'Nothing outstanding', body: `You and ${fleetName} are square.` };
}

export default function DriverStatementScreen() {
  const uid = getAuth().currentUser?.uid;
  const [driver, setDriver] = useState(undefined);
  const [account, setAccount] = useState({});
  const [rides, setRides] = useState(null);
  const [payments, setPayments] = useState([]);
  const [filter, setFilter] = useState('all');
  const fleetId = driver?.fleetId;

  useEffect(() => {
    if (!uid) return undefined;
    return onSnapshot(doc(db, 'drivers', uid), (snap) => setDriver(snap.exists() ? snap.data() : null), () => setDriver(null));
  }, [uid]);

  useEffect(() => {
    if (!uid || !fleetId) return undefined;
    const unsubs = [
      onSnapshot(doc(db, 'fleets', fleetId, 'driverAccounts', uid), (s) => setAccount(s.exists() ? s.data() : {}), () => setAccount({})),
      onSnapshot(
        query(collection(db, 'rides'), where('fleetId', '==', fleetId), where('driverId', '==', uid), orderBy('timestamps.createdAt', 'desc'), limit(100)),
        (s) => setRides(s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => r.settlement)),
        () => setRides([])
      ),
      onSnapshot(
        query(collection(db, 'fleets', fleetId, 'driverPayments'), where('driverId', '==', uid), limit(100)),
        (s) => setPayments(s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.paidAt?.toMillis?.() || 0) - (a.paidAt?.toMillis?.() || 0))),
        () => setPayments([])
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, [uid, fleetId]);

  if (driver === undefined) return <Loading label="Loading" />;
  if (!fleetId) {
    return (
      <Screen>
        <ScreenHeader title="My statement" />
        <EmptyState icon="people-outline" title="You're not with a fleet" body="Your statement shows here when you drive for one." />
      </Screen>
    );
  }

  const fleetName = driver.fleetName || 'Your fleet';
  const banner = balanceBanner(account.owedPence || 0, fleetName);
  const shown = (rides || []).filter((r) => matches(r.settlement.kind, filter));

  return (
    <Screen>
      <ScreenHeader title="My statement" subtitle={`Commission now ${account.commissionPercent ?? 0}%`} />
      <Section title="Balance">
        <Banner tone={banner.tone} icon="wallet-outline" title={banner.title} body={banner.body} />
      </Section>

      <Section title="Jobs">
        <Segmented options={FILTERS} value={filter} onChange={setFilter} style={{ marginBottom: SPACE[3] }} />
        {rides === null ? (
          <Loading label="Loading" />
        ) : shown.length === 0 ? (
          <EmptyState icon="car-outline" title="No jobs here" body="Finished jobs show here once they count towards your balance." />
        ) : (
          <Card>
            {shown.map((r, i) => {
              const s = r.settlement;
              return (
                <View key={r.id}>
                  {i > 0 ? <Divider style={{ marginVertical: SPACE[3] }} /> : null}
                  <Text style={TYPE.small}>{formatWhen(r.completedAt || r.timestamps?.completedAt || r.timestamps?.createdAt)}</Text>
                  <Text style={[TYPE.body, { marginTop: SPACE[1] }]} numberOfLines={2}>{place(r.pickupLocation)} to {place(r.dropoffLocation)}</Text>
                  <Text style={[TYPE.small, { marginTop: SPACE[1] }]}>
                    {s.kind === 'account' && r.account?.company ? `Account job: ${r.account.company}` : KIND_WORDS[s.kind]}
                  </Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: SPACE[1] }}>
                    <Text style={TYPE.small}>{pounds(s.farePence)}, commission {pounds(s.commissionPence)}</Text>
                    <Text style={[TYPE.body, { color: s.balancePence < 0 ? COLORS.red : COLORS.midnight }]}>{s.balancePence > 0 ? '+' : ''}{pounds(s.balancePence)}</Text>
                  </View>
                </View>
              );
            })}
          </Card>
        )}
      </Section>

      <Section title="Payments">
        {payments.length === 0 ? (
          <EmptyState icon="cash-outline" title="No payments recorded" body="Payments between you and the fleet show here." />
        ) : (
          <Card>
            {payments.map((p, i) => (
              <View key={p.id}>
                {i > 0 ? <Divider style={{ marginVertical: SPACE[3] }} /> : null}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={TYPE.body}>{p.direction === 'toDriver' ? `${fleetName} paid you` : `You paid ${fleetName}`}</Text>
                  <Text style={TYPE.body}>{pounds(p.amountPence)}</Text>
                </View>
                <Text style={[TYPE.small, { marginTop: SPACE[1] }]}>{formatWhen(p.paidAt)}{p.note ? ` · ${p.note}` : ''}</Text>
              </View>
            ))}
          </Card>
        )}
      </Section>
    </Screen>
  );
}
