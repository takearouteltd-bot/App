import React, { useState } from "react";
import {
  View,
  Text,
  Alert,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  SafeAreaView,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CardField, useStripe } from "@stripe/stripe-react-native";
import { httpsCallable } from "firebase/functions";
import { functions, auth } from "../../../config/firebase";

const PRIMARY = "#79B531";
const SECONDARY = "#235594";
const CARD_DARK = "#1B3F73";

export default function AddCardScreen({ navigation }) {
  const { confirmSetupIntent } = useStripe();

  const [cardDetails, setCardDetails] = useState(null);
  const [cardholderName, setCardholderName] = useState("");
  const [loading, setLoading] = useState(false);

  const cardNumber = cardDetails?.number || "•••• •••• •••• ••••";
  const expiry =
    cardDetails?.expiryMonth && cardDetails?.expiryYear
      ? `${String(cardDetails.expiryMonth).padStart(2, "0")}/${cardDetails.expiryYear
          .toString()
          .slice(-2)}`
      : "MM/YY";
  const cvc = cardDetails?.cvc || "•••";

  const handleAddCard = async () => {
    if (!cardDetails?.complete) {
      return Alert.alert("Incomplete Card", "Please enter complete card details");
    }

    if (!cardholderName.trim()) {
      return Alert.alert("Missing Name", "Please enter the cardholder name");
    }

    const user = auth.currentUser;
    if (!user) {
      return Alert.alert("Not Logged In", "Please sign in to add a card");
    }

    setLoading(true);

    try {
      // 1. Create Setup Intent
      const createSetupIntent = httpsCallable(functions, "createSetupIntent");
      const res = await createSetupIntent({});
      const clientSecret = res.data?.clientSecret;

      if (!clientSecret) {
        throw new Error("Missing client secret from server");
      }

      // 2. Confirm Setup Intent
      const { setupIntent, error } = await confirmSetupIntent(clientSecret, {
        paymentMethodType: "Card",
        paymentMethodData: {
          billingDetails: {
            name: cardholderName,
          },
        },
      });

      if (error) {
        console.log("Stripe error:", error);
        return Alert.alert("Payment Error", error.message);
      }

      const paymentMethodId =
        setupIntent?.payment_method || setupIntent?.paymentMethodId;

      if (!paymentMethodId) {
        throw new Error("Missing payment method ID");
      }

      // 3. Save to Backend
      const saveCard = httpsCallable(functions, "saveCard");
      const saveRes = await saveCard({
        paymentMethodId,
        cardholderName,
      });

      console.log("Card saved:", saveRes.data);

      Alert.alert("Success", "Your card has been added successfully!", [
        { text: "OK", onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      console.log("ERROR:", err);
      Alert.alert("Error", err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.backButton}
            >
              <Ionicons name="arrow-back" size={24} color={SECONDARY} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Add Payment Method</Text>
            <View style={{ width: 40 }} />
          </View>

          {/* Card Preview */}
          <View style={styles.cardPreviewContainer}>
            <View style={styles.cardPreview}>
              {/* Card Top Row */}
              <View style={styles.cardTopRow}>
                <View style={styles.chip} />
                <Ionicons name="wifi" size={20} color="rgba(255,255,255,0.5)" />
              </View>

              {/* Card Number */}
              <Text style={styles.cardNumber}>{cardNumber}</Text>

              {/* Card Bottom Row */}
              <View style={styles.cardBottomRow}>
                <View>
                  <Text style={styles.cardLabel}>CARD HOLDER</Text>
                  <Text style={styles.cardValue}>
                    {(cardholderName || "YOUR NAME").toUpperCase()}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.cardLabel}>EXPIRES</Text>
                  <Text style={styles.cardValue}>{expiry}</Text>
                </View>
              </View>

              {/* Card Brand Badge */}
              <View style={styles.cardBrandBadge}>
                <Text style={styles.cardBrandText}>
                  {cardDetails?.brand?.toUpperCase() || "VISA"}
                </Text>
              </View>
            </View>
          </View>

          {/* Form Section */}
          <View style={styles.formSection}>
            <Text style={styles.sectionTitle}>Card Details</Text>

            {/* Cardholder Name */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Cardholder Name</Text>
              <View style={styles.inputWrapper}>
                <Ionicons
                  name="person-outline"
                  size={20}
                  color="#9CA3AF"
                  style={styles.inputIcon}
                />
                <TextInput
                  placeholder="e.g. John Doe"
                  placeholderTextColor="#9CA3AF"
                  value={cardholderName}
                  onChangeText={setCardholderName}
                  style={styles.input}
                  autoCapitalize="words"
                />
              </View>
            </View>

            {/* Stripe Card Field */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Card Information</Text>
              <View style={styles.stripeWrapper}>
                <CardField
                  postalCodeEnabled={true}
                  placeholders={{
                    number: "4242 4242 4242 4242",
                    cvc: "CVC",
                    expiry: "MM/YY",
                  }}
                  cardStyle={styles.cardFieldStyle}
                  style={styles.cardField}
                  onCardChange={(details) => {
                    setCardDetails(details);
                  }}
                />
              </View>
            </View>

            {/* Security Note */}
            <View style={styles.securityNote}>
              <Ionicons name="shield-checkmark" size={18} color={PRIMARY} />
              <Text style={styles.securityText}>
                Your card information is securely encrypted and stored by Stripe.
                We never store your full card details.
              </Text>
            </View>
          </View>

          {/* Save Button */}
          <TouchableOpacity
            style={[
              styles.saveButton,
              (!cardDetails?.complete || !cardholderName.trim() || loading) &&
                styles.saveButtonDisabled,
            ]}
            onPress={handleAddCard}
            disabled={!cardDetails?.complete || !cardholderName.trim() || loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <Text style={styles.saveButtonText}>Processing...</Text>
            ) : (
              <>
                <Ionicons name="lock-closed" size={18} color="#fff" />
                <Text style={styles.saveButtonText}>Save Card Securely</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8F9FA",
  },

  scrollContent: {
    paddingBottom: 40,
  },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },

  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },

  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1F2937",
  },

  // Card Preview
  cardPreviewContainer: {
    alignItems: "center",
    marginTop: 8,
    marginBottom: 24,
  },

  cardPreview: {
    backgroundColor: CARD_DARK,
    width: "88%",
    borderRadius: 24,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 12,
  },

  cardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 28,
  },

  chip: {
    width: 48,
    height: 34,
    backgroundColor: "#D4AF37",
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },

  cardNumber: {
    color: "#fff",
    fontSize: 22,
    letterSpacing: 3,
    marginBottom: 28,
    fontWeight: "500",
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
  },

  cardBottomRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },

  cardLabel: {
    fontSize: 10,
    color: "rgba(255,255,255,0.6)",
    marginBottom: 4,
    letterSpacing: 1,
    fontWeight: "600",
  },

  cardValue: {
    fontSize: 14,
    color: "#fff",
    fontWeight: "600",
    letterSpacing: 1,
  },

  cardBrandBadge: {
    position: "absolute",
    bottom: -12,
    right: 20,
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },

  cardBrandText: {
    fontSize: 14,
    fontWeight: "800",
    color: SECONDARY,
    letterSpacing: 2,
  },

  // Form Section
  formSection: {
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 24,
    marginHorizontal: 20,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1F2937",
    marginBottom: 20,
  },

  inputGroup: {
    marginBottom: 20,
  },

  inputLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 8,
    letterSpacing: 0.5,
  },

  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F9FAFB",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    paddingHorizontal: 14,
  },

  inputIcon: {
    marginRight: 10,
  },

  input: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 15,
    color: "#1F2937",
    fontWeight: "500",
  },

  stripeWrapper: {
    backgroundColor: "#F9FAFB",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    paddingHorizontal: 14,
    paddingVertical: 4,
  },

  cardField: {
    width: "100%",
    height: 50,
  },

  cardFieldStyle: {
    backgroundColor: "#F9FAFB",
    textColor: "#1F2937",
    fontSize: 15,
    placeholderColor: "#9CA3AF",
  },

  // Security Note
  securityNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#F0FDF4",
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },

  securityText: {
    flex: 1,
    fontSize: 12,
    color: "#166534",
    lineHeight: 18,
    fontWeight: "500",
  },

  // Save Button
  saveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: PRIMARY,
    marginHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 16,
    gap: 10,
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },

  saveButtonDisabled: {
    backgroundColor: "#D1D5DB",
    shadowOpacity: 0,
    elevation: 0,
  },

  saveButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});