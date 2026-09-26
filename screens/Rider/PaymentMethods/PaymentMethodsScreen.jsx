import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { collection, doc, getDoc, getDocs, limit, onSnapshot, query, where } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '../../../config/firebase';
import { currencySymbol } from '../../../utils/appConfig';
import {
  COLORS,
  TYPE,
  SPACE,
  RADIUS,
  Card,
  ListRow,
  Banner,
  EmptyState,
  ScreenHeader,
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
        console.log('Cards listener error:', err);
        if (String(err.message).includes('Missing or insufficient permissions')) {
          setError('You do not have permission to view payment methods.');
        }
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
      console.error('Error fetching transactions:', err);
      setError(
        String(err.message).includes('Missing or insufficient permissions')
          ? 'Permission denied. Please contact support.'
          : 'Could not load your payments. Pull down to try again.'
      );
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

  const statusTone = (status) =>
    status === 'captured'
      ? { bg: COLORS.limeSoft, fg: COLORS.success, label: 'Paid' }
      : status === 'authorized'
      ? { bg: COLORS.blueSoft, fg: COLORS.blue, label: 'Held' }
      : status === 'canceled'
      ? { bg: COLORS.surface, fg: COLORS.muted, label: 'Cancelled' }
      : { bg: COLORS.redSoft, fg: COLORS.red, label: status || 'Failed' };

  const brand = card?.brand ? card.brand.replace(/^./, (c) => c.toUpperCase()) : null;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
        }
      >
        <ScreenHeader title="Payment" subtitle="The card your rides are charged to." />

        {/* The card itself: the brand and last four, nothing invented. */}
        <Card tone="dark" style={styles.cardFace}>
          {loading && !card ? (
            <ActivityIndicator color={COLORS.white} />
          ) : card ? (
            <>
              <View style={styles.cardTop}>
                <Text style={styles.cardBrand}>{brand || 'Card'}</Text>
                <Ionicons name="card" size={22} color={COLORS.onDark} />
              </View>
              <Text style={styles.cardNumber}>···· ···· ···· {card.last4}</Text>
              <View style={styles.cardBottom}>
                <View>
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
              <Ionicons name="card-outline" size={30} color={COLORS.onDark} />
              <Text style={styles.noCardText}>No card added yet</Text>
            </View>
          )}
        </Card>

        <Card flush style={{ marginTop: SPACE[4] }}>
          <ListRow
            icon="add-circle-outline"
            iconColor={COLORS.primary}
            title={card ? 'Add another card' : 'Add a card'}
            detail="Credit or debit"
            onPress={() => navigation.navigate('AddPaymentMethod')}
          />
          <ListRow
            icon="albums-outline"
            title="Manage cards"
            detail="Change your default or remove a card"
            onPress={() => navigation.navigate('AllPaymentMethods')}
            last
          />
        </Card>

        {error ? <Banner tone="danger" body={error} /> : null}

        <Text style={[TYPE.label, { marginTop: SPACE[7], marginBottom: SPACE[3] }]}>Payments</Text>

        {loading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: SPACE[6] }} />
        ) : transactions.length === 0 ? (
          <EmptyState
            icon="receipt-outline"
            title="No payments yet"
            body="Once you take a ride, what you paid shows up here."
          />
        ) : (
          <Card flush>
            {transactions.map((item, i) => {
              const tone = statusTone(item.status);
              return (
                <ListRow
                  key={item.id}
                  icon="car-outline"
                  iconColor={COLORS.navy}
                  title={item.rideId ? 'Ride' : 'Payment'}
                  detail={formatDate(item.createdAtDate)}
                  last={i === transactions.length - 1}
                  right={
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.amount}>
                        {formatAmount(item.amount, item.currency)}
                      </Text>
                      <View style={[styles.pill, { backgroundColor: tone.bg }]}>
                        <Text style={[styles.pillText, { color: tone.fg }]}>{tone.label}</Text>
                      </View>
                    </View>
                  }
                />
              );
            })}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.surface },
  content: { padding: SPACE[5], paddingBottom: SPACE[12] },

  cardFace: { marginTop: SPACE[5], minHeight: 168, justifyContent: 'space-between' },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardBrand: { fontSize: 15, fontWeight: '700', color: COLORS.white, letterSpacing: 0.2 },
  cardNumber: {
    fontSize: 20, fontWeight: '700', color: COLORS.white,
    letterSpacing: 2, marginVertical: SPACE[5],
  },
  cardBottom: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  cardLabel: { fontSize: 11, fontWeight: '700', color: COLORS.onDark, letterSpacing: 0.6, textTransform: 'uppercase' },
  cardValue: { fontSize: 14, fontWeight: '600', color: COLORS.white, marginTop: 2 },
  noCard: { alignItems: 'center', justifyContent: 'center', flex: 1, gap: SPACE[2], paddingVertical: SPACE[6] },
  noCardText: { ...TYPE.small, color: COLORS.onDark },

  amount: { fontSize: 15, fontWeight: '700', color: COLORS.ink },
  pill: {
    marginTop: 4, paddingHorizontal: SPACE[2], paddingVertical: 2,
    borderRadius: RADIUS.pill,
  },
  pillText: { fontSize: 11, fontWeight: '700' },
});
