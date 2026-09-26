import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { Alert } from '../../../components/ui/alert';
import { Ionicons } from '@expo/vector-icons';
import {
  collection,
  onSnapshot,
  doc,
  deleteDoc,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../../config/firebase';
import {
  COLORS,
  TYPE,
  SPACE,
  Screen,
  Card,
  Button,
  EmptyState,
  Loading,
  ScreenHeader,
  StatusPill,
} from '../../../components/ui/kit';

export default function AllPaymentMethodsScreen({ navigation }) {
  const [cards, setCards] = useState([]);
  const [defaultId, setDefaultId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const user = getAuth().currentUser;

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return undefined;
    }

    const unsubCards = onSnapshot(
      collection(db, 'riders', user.uid, 'cards'),
      (snapshot) => {
        setCards(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (error) => {
        console.log('Error loading cards:', error);
        setLoading(false);
      }
    );

    // The field the backend actually charges against.
    const unsubRider = onSnapshot(doc(db, 'riders', user.uid), (snap) => {
      setDefaultId(snap.exists() ? snap.data().defaultPaymentMethodId || null : null);
    });

    return () => {
      unsubCards();
      unsubRider();
    };
  }, [user]);

  /* Choosing a default has to write riders/{uid}.defaultPaymentMethodId,
     because that is the field authorizePaymentOnRideAccept passes to Stripe.
     This screen used to set only `isDefault` on the card document, so picking
     a different card changed the badge and nothing else — the old card kept
     being charged. */
  const setDefaultCard = async (card) => {
    if (!card.paymentMethodId) {
      Alert.alert('Cannot set default', 'This card is missing its payment reference.');
      return;
    }
    setBusyId(card.id);
    try {
      await setDoc(
        doc(db, 'riders', user.uid),
        { defaultPaymentMethodId: card.paymentMethodId },
        { merge: true }
      );
      await Promise.all(
        cards.map((c) =>
          updateDoc(doc(db, 'riders', user.uid, 'cards', c.id), {
            isDefault: c.id === card.id,
          }).catch(() => null)
        )
      );
    } catch (error) {
      console.log(error);
      Alert.alert('Could not set default', 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const deleteCard = (card) => {
    Alert.alert('Remove this card?', 'You can add it again later.', [
      { text: 'Keep card', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          if (!card.paymentMethodId) {
            Alert.alert('Cannot remove', 'This card is missing its payment reference.');
            return;
          }
          setBusyId(card.id);
          try {
            const detachPaymentMethod = httpsCallable(getFunctions(), 'detachPaymentMethod');
            const result = await detachPaymentMethod({ paymentMethodId: card.paymentMethodId });
            if (!result.data?.success) {
              throw new Error(result.data?.error || 'Could not remove the card from Stripe.');
            }

            await deleteDoc(doc(db, 'riders', user.uid, 'cards', card.id));

            /* If this was the card rides are charged to, hand the default to
               another card, or clear it. Left pointing at a detached card,
               the next booking fails at the hold with no explanation. */
            if (defaultId === card.paymentMethodId) {
              const remaining = cards.filter((c) => c.id !== card.id);
              const next = remaining.find((c) => c.paymentMethodId) || null;
              await setDoc(
                doc(db, 'riders', user.uid),
                { defaultPaymentMethodId: next ? next.paymentMethodId : null },
                { merge: true }
              );
              if (next) {
                await updateDoc(doc(db, 'riders', user.uid, 'cards', next.id), {
                  isDefault: true,
                }).catch(() => null);
              }
            }
          } catch (error) {
            console.log('Delete card error:', error);
            Alert.alert('Could not remove', error.message || 'Please try again.');
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  const renderCard = ({ item }) => {
    const isDefault = item.paymentMethodId && item.paymentMethodId === defaultId;
    const busy = busyId === item.id;
    const brand = item.brand ? item.brand.replace(/^./, (c) => c.toUpperCase()) : 'Card';

    return (
      <Card style={[styles.card, isDefault && styles.cardDefault]}>
        <View style={styles.top}>
          <View style={styles.brandRow}>
            <View style={[styles.brandIcon, isDefault && { backgroundColor: COLORS.midnight }]}>
              <Ionicons name="card" size={20} color={isDefault ? COLORS.lime : COLORS.midnight} />
            </View>
            <View>
              <Text style={styles.brand}>{brand}</Text>
              <Text style={styles.number}>···· {item.last4}</Text>
            </View>
          </View>
          {isDefault ? <StatusPill status="approved" label="Default" /> : null}
        </View>

        <Text style={[TYPE.small, { marginTop: SPACE[3] }]}>
          {item.cardholderName ? `${item.cardholderName} · ` : ''}
          Expires {String(item.exp_month).padStart(2, '0')}/{String(item.exp_year).slice(-2)}
        </Text>

        <View style={styles.actions}>
          {!isDefault ? (
            <Button
              title="Set as default"
              variant="secondary"
              size="small"
              loading={busy}
              onPress={() => setDefaultCard(item)}
              style={{ flex: 1 }}
            />
          ) : (
            <View style={{ flex: 1 }} />
          )}
          <Button
            title="Remove"
            variant="ghost"
            size="small"
            disabled={busy}
            onPress={() => deleteCard(item)}
          />
        </View>
      </Card>
    );
  };

  if (loading) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <FlatList
        data={cards}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={{ marginBottom: SPACE[5] }}>
            <ScreenHeader
              title="Your cards"
              subtitle="The default card is the one your rides are charged to."
              onBack={() => navigation.goBack()}
            />
          </View>
        }
        renderItem={renderCard}
        ListEmptyComponent={
          <EmptyState
            icon="card-outline"
            title="No cards yet"
            body="Add a card so you can book a ride."
            action={
              <Button title="Add a card" onPress={() => navigation.navigate('AddPaymentMethod')} />
            }
          />
        }
        ListFooterComponent={
          cards.length ? (
            <Button
              title="Add another card"
              icon="add"
              style={{ marginTop: SPACE[3] }}
              onPress={() => navigation.navigate('AddPaymentMethod')}
            />
          ) : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: SPACE[5], paddingBottom: SPACE[12] },

  card: { marginBottom: SPACE[3] },
  cardDefault: { borderWidth: 2, borderColor: COLORS.midnight, backgroundColor: COLORS.limeSoft },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE[3] },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE[3], flex: 1 },
  brandIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.fill,
    alignItems: 'center', justifyContent: 'center',
  },
  brand: { ...TYPE.subhead, color: COLORS.midnight },
  number: { ...TYPE.small, letterSpacing: 1.5, marginTop: 2 },
  actions: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[3],
    marginTop: SPACE[4],
  },
});
