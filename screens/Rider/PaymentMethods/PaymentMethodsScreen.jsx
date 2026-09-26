import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { collection, doc, getDoc, getDocs, limit, onSnapshot, query, where } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '../../../config/firebase';
import { currencySymbol } from '../../../utils/appConfig';
import {
  COLORS,
  TYPE,
  SPACE,
  Screen,
  ScreenHeader,
  Section,
  Card,
  RowGroup,
  ListRow,
  Button,
  Banner,
  EmptyState,
  StatusPill,
} from '../../../components/ui/kit';

export default function PaymentsMethodScreen({ navigation }) {
  const [card, setCard] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const user = getAuth().currentUser;

  /* The card that would actually be charged: the rider's default, falling
     back to whatever is saved. It used to show docs[0], which is whichever
     card Firestore happened to return first. */
  useEffect(() => {
    if (!user) {
      setLoading(false);
      return undefined;
    }

    const unsubscribe = onSnapshot(
      collection(db, 'riders', user.uid, 'cards'),
      async (snapshot) => {
        if (snapshot.empty) {
          setCard(null);
          setError(null);
          return;
        }
        const cards = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        let defaultId = null;
        try {
          const riderSnap = await getDoc(doc(db, 'riders', user.uid));
          defaultId = riderSnap.exists() ? riderSnap.data().defaultPaymentMethodId : null;
        } catch (e) {
          defaultId = null;
        }
        setCard(cards.find((c) => c.paymentMethodId === defaultId) || cards[0]);
        setError(null);
      },
      (err) => {
        // permission-denied here is the sign-out race: the listener outlives
        // the session for a frame. Nothing to tell the user.
        if (err?.code === 'permission-denied') return;
        console.log('Cards listener error:', err);
        setError('Could not load your cards. Pull down to try again.');
      }
    );

    return () => unsubscribe();
  }, [user]);

  /* Newest first. The ordering used to be done by Firestore, which needs a
     composite index, so it was commented out and the list came back in no
     order at all. Sorting here needs no index. */
  const fetchTransactions = useCallback(async () => {
    if (!user) return;
    try {
      setError(null);
      const snapshot = await getDocs(
        query(collection(db, 'payments'), where('riderId', '==', user.uid), limit(20))
      );
      const rows = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          createdAtDate: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt),
        };
      });
      rows.sort((a, b) => (b.createdAtDate?.getTime() || 0) - (a.createdAtDate?.getTime() || 0));
      setTransactions(rows);
    } catch (err) {
      if (err?.code === 'permission-denied') return; // signing out
      console.error('Error fetching transactions:', err);
      setError('Could not load your payments. Pull down to try again.');
    }
  }, [user]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchTransactions();
      setLoading(false);
    })();
  }, [fetchTransactions]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchTransactions();
    setRefreshing(false);
  };

  const formatDate = (date) => {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  // Stored in the smallest unit, e.g. 720 = £7.20.
  const formatAmount = (amount, currency) =>
    `${currencySymbol(currency)}${(Number(amount || 0) / 100).toFixed(2)}`;

  // The kit's pill tones, one per payment state.
  const statusPill = (status) =>
    status === 'captured'
      ? { status: 'approved', label: 'Paid' }
      : status === 'authorized'
      ? { status: 'pending', label: 'Held' }
      : status === 'canceled'
      ? { status: 'offline', label: 'Cancelled' }
      : { status: 'rejected', label: status || 'Failed' };

  const brand = card?.brand ? card.brand.replace(/^./, (c) => c.toUpperCase()) : null;

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.midnight} />
      }
    >
      <ScreenHeader title="Payment" subtitle="The card your rides are charged to." />

      {/* The card itself: the brand and last four, nothing invented. */}
      <Card tone="dark" style={styles.cardFace}>
        {loading && !card ? (
          <ActivityIndicator color={COLORS.lime} />
        ) : card ? (
          <>
            <View style={styles.cardTop}>
              <Text style={styles.cardEyebrow}>Default card</Text>
              <Ionicons name="card" size={22} color={COLORS.lime} />
            </View>
            <Text style={styles.cardBrand}>{brand || 'Card'}</Text>
            <Text style={styles.cardNumber}>···· ···· ···· {card.last4}</Text>
            <View style={styles.cardBottom}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardLabel}>Cardholder</Text>
                <Text style={styles.cardValue} numberOfLines={1}>
                  {card.cardholderName || card.name || '—'}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.cardLabel}>Expires</Text>
                <Text style={styles.cardValue}>
                  {String(card.exp_month).padStart(2, '0')}/{String(card.exp_year).slice(-2)}
                </Text>
              </View>
            </View>
          </>
        ) : (
          <View style={styles.noCard}>
            <View style={styles.noCardIcon}>
              <Ionicons name="card-outline" size={26} color={COLORS.lime} />
            </View>
            <Text style={styles.noCardText}>No card added yet</Text>
          </View>
        )}
        <Button
          title={card ? 'Add another card' : 'Add a card'}
          variant="accent"
          icon="add"
          style={{ marginTop: SPACE[5] }}
          onPress={() => navigation.navigate('AddPaymentMethod')}
        />
      </Card>

      <RowGroup
        style={{ marginTop: SPACE[4] }}
        items={[
          {
            icon: 'albums-outline',
            iconColor: COLORS.midnight,
            title: 'Manage cards',
            detail: 'Change your default or remove a card',
            onPress: () => navigation.navigate('AllPaymentMethods'),
          },
        ]}
      />

      {error ? (
        <View style={{ marginTop: SPACE[4] }}>
          <Banner tone="danger" body={error} />
        </View>
      ) : null}

      <Section title="Payments">
        {loading ? (
          <ActivityIndicator color={COLORS.midnight} style={{ marginTop: SPACE[6] }} />
        ) : transactions.length === 0 ? (
          <EmptyState
            icon="receipt-outline"
            title="No payments yet"
            body="Once you take a ride, what you paid shows up here."
          />
        ) : (
          <Card flush>
            {transactions.map((item, i) => {
              const pill = statusPill(item.status);
              return (
                <ListRow
                  key={item.id}
                  icon="car-outline"
                  iconColor={COLORS.midnight}
                  title={item.rideId ? 'Ride' : 'Payment'}
                  detail={formatDate(item.createdAtDate)}
                  last={i === transactions.length - 1}
                  right={
                    <View style={{ alignItems: 'flex-end', gap: SPACE[1] }}>
                      <Text style={styles.amount}>{formatAmount(item.amount, item.currency)}</Text>
                      <StatusPill status={pill.status} label={pill.label} />
                    </View>
                  }
                />
              );
            })}
          </Card>
        )}
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardFace: { marginTop: SPACE[5] },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardEyebrow: { ...TYPE.label, color: COLORS.lime },
  cardBrand: { ...TYPE.subhead, color: COLORS.white, marginTop: SPACE[4] },
  cardNumber: {
    fontSize: 22, fontWeight: '800', color: COLORS.white,
    letterSpacing: 2, marginTop: SPACE[1], marginBottom: SPACE[5],
  },
  cardBottom: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: SPACE[4] },
  cardLabel: { ...TYPE.label, color: COLORS.onDark },
  cardValue: { ...TYPE.callout, color: COLORS.white, marginTop: 2 },
  noCard: { alignItems: 'center', justifyContent: 'center', gap: SPACE[3], paddingVertical: SPACE[4] },
  noCardIcon: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: COLORS.midnightSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  noCardText: { ...TYPE.small, color: COLORS.onDark },

  amount: { ...TYPE.callout, color: COLORS.midnight },
});
