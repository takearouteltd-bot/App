import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Alert } from '../../../components/ui/alert';
import { CardField, useStripe } from '@stripe/stripe-react-native';
import { httpsCallable } from 'firebase/functions';
import { functions, auth } from '../../../config/firebase';
import {
  COLORS,
  TYPE,
  SPACE,
  RADIUS,
  Field,
  Button,
  Banner,
  ScreenHeader,
} from '../../../components/ui/kit';

export default function AddCardScreen({ navigation }) {
  const { confirmSetupIntent } = useStripe();

  const [cardDetails, setCardDetails] = useState(null);
  const [cardholderName, setCardholderName] = useState('');
  const [loading, setLoading] = useState(false);

  const ready = Boolean(cardDetails?.complete) && cardholderName.trim().length > 1;

  const handleAddCard = async () => {
    if (!cardDetails?.complete) {
      Alert.alert('Card not complete', 'Please finish entering your card details.');
      return;
    }
    if (!cardholderName.trim()) {
      Alert.alert('Name needed', 'Please enter the name on the card.');
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      Alert.alert('Not signed in', 'Please sign in to add a card.');
      return;
    }

    setLoading(true);

    try {
      // 1. Ask the server for a SetupIntent.
      const createSetupIntent = httpsCallable(functions, 'createSetupIntent');
      const res = await createSetupIntent({});
      const clientSecret = res.data?.clientSecret;
      if (!clientSecret) throw new Error('The server did not return a setup secret.');

      // 2. Confirm it with the card the person typed. The card itself never
      //    touches our servers; Stripe hands back a token.
      const { setupIntent, error } = await confirmSetupIntent(clientSecret, {
        paymentMethodType: 'Card',
        paymentMethodData: { billingDetails: { name: cardholderName.trim() } },
      });

      if (error) {
        console.log('Stripe error:', error);
        Alert.alert('Card not added', error.message);
        return;
      }

      const paymentMethodId = setupIntent?.payment_method || setupIntent?.paymentMethodId;
      if (!paymentMethodId) throw new Error('Stripe did not return a payment method.');

      // 3. Save it and make it the card rides are charged to.
      const saveCard = httpsCallable(functions, 'saveCard');
      await saveCard({ paymentMethodId, cardholderName: cardholderName.trim() });

      Alert.alert('Card added', 'This card will be used for your rides.', [
        { text: 'Done', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      console.log('Add card error:', err);
      Alert.alert('Card not added', err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <ScreenHeader
            title="Add a card"
            subtitle="Used for your rides. You can change it any time."
            onBack={() => navigation.goBack()}
          />

          <View style={{ marginTop: SPACE[6] }}>
            <Field
              label="Name on the card"
              placeholder="As printed on the card"
              value={cardholderName}
              onChangeText={setCardholderName}
              autoCapitalize="words"
              autoCorrect={false}
            />

            <Text style={styles.label}>Card details</Text>
            <View style={styles.cardFieldWrap}>
              <CardField
                postalCodeEnabled
                placeholders={{ number: '1234 1234 1234 1234', cvc: 'CVC', expiry: 'MM/YY' }}
                cardStyle={{
                  backgroundColor: COLORS.white,
                  textColor: COLORS.ink,
                  placeholderColor: COLORS.faint,
                  fontSize: 15,
                  borderWidth: 0,
                }}
                style={styles.cardField}
                onCardChange={setCardDetails}
              />
            </View>
          </View>

          <Banner
            tone="info"
            icon="lock-closed"
            body="Your card details go straight to Stripe and are never stored on our servers."
          />

          <Button
            title="Save card"
            onPress={handleAddCard}
            disabled={!ready}
            loading={loading}
            style={{ marginTop: SPACE[6] }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.surface },
  content: { padding: SPACE[5], paddingBottom: SPACE[12] },

  label: { fontSize: 13, fontWeight: '600', color: COLORS.navy, marginBottom: SPACE[2] },
  cardFieldWrap: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.lineStrong,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.white,
    paddingHorizontal: SPACE[2],
    marginBottom: SPACE[5],
  },
  cardField: { width: '100%', height: 52 },
});
