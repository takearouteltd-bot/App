import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

const PRIMARY = "#79B531";
const SECONDARY = "#235594";

export default function AddPaymentMethodScreen({ navigation }) {
  const [cardNumber, setCardNumber] = useState("");
  const [cardHolder, setCardHolder] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");

  /* Format Card Number */
  const formatCardNumber = (value) => {
    const cleaned = value.replace(/\D/g, "");
    const formatted = cleaned
      .match(/.{1,4}/g)
      ?.join(" ")
      ?.substr(0, 19);
    return formatted || "";
  };

  const handleCardNumberChange = (text) => {
    setCardNumber(formatCardNumber(text));
  };

  /* Format Expiry Date MM/YY */
  const handleExpiryChange = (text) => {
    const cleaned = text.replace(/\D/g, "");

    let formatted = cleaned;

    if (cleaned.length >= 3) {
      formatted = cleaned.substring(0, 2) + "/" + cleaned.substring(2, 4);
    }

    setExpiry(formatted.substring(0, 5));
  };

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView showsVerticalScrollIndicator={false}>
          
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => navigation.goBack()}
            >
              <Ionicons name="arrow-back" size={24} color={SECONDARY} />
            </TouchableOpacity>

            <Text style={styles.headerTitle}>Add New Card</Text>
          </View>

          {/* Live Card Preview */}
          <View style={styles.cardContainer}>
            <View style={styles.cardTopRow}>
              <View style={styles.chip} />
              <Ionicons name="card" size={28} color="#fff" />
            </View>

            <Text style={styles.cardNumber}>
              {cardNumber || "1234 5678 9012 3456"}
            </Text>

            <View style={styles.cardBottomRow}>
              <View>
                <Text style={styles.label}>Card Holder</Text>
                <Text style={styles.cardText}>
                  {cardHolder || "FULL NAME"}
                </Text>
              </View>

              <View>
                <Text style={styles.label}>Expires</Text>
                <Text style={styles.cardText}>
                  {expiry || "MM/YY"}
                </Text>
              </View>
            </View>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <Text style={styles.inputLabel}>Card Number</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter card number"
              keyboardType="numeric"
              value={cardNumber}
              onChangeText={handleCardNumberChange}
              maxLength={19}
            />

            <Text style={styles.inputLabel}>Card Holder Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter full name"
              value={cardHolder}
              onChangeText={setCardHolder}
            />

            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>Expiry Date</Text>
                <TextInput
                  style={styles.input}
                  placeholder="MM/YY"
                  keyboardType="numeric"
                  value={expiry}
                  onChangeText={handleExpiryChange}
                  maxLength={5}
                />
              </View>

              <View style={{ width: 15 }} />

              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>CVV</Text>
                <TextInput
                  style={styles.input}
                  placeholder="123"
                  keyboardType="numeric"
                  secureTextEntry
                  value={cvv}
                  onChangeText={setCvv}
                  maxLength={3}
                />
              </View>
            </View>

            {/* Save Button */}
            <TouchableOpacity style={styles.saveButton} onPress={() => navigation.navigate('CardSuccessful')}>
              <Ionicons name="save-outline" size={20} color="#fff" />
              <Text style={styles.saveButtonText}>Save Card</Text>
            </TouchableOpacity>

          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8F9FA",
  },

  header: {
    paddingTop: 60,
    paddingBottom: 30,
    alignItems: "center",
    justifyContent: "center",
  },

  backButton: {
    position: "absolute",
    left: 20,
    top: 60,
  },

  headerTitle: {
    color: SECONDARY,
    fontSize: 20,
    fontWeight: "600",
  },

  cardContainer: {
    backgroundColor: SECONDARY,
    marginHorizontal: 20,
    marginTop: 25,
    borderRadius: 20,
    padding: 22,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },

  cardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  chip: {
    width: 45,
    height: 32,
    backgroundColor: "#D4AF37",
    borderRadius: 6,
  },

  cardNumber: {
    color: "#fff",
    fontSize: 20,
    letterSpacing: 2,
    marginVertical: 30,
    fontWeight: "500",
  },

  cardBottomRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },

  label: {
    fontSize: 11,
    color: "rgba(255,255,255,0.7)",
    marginBottom: 4,
  },

  cardText: {
    fontSize: 14,
    color: "#fff",
    fontWeight: "600",
  },

  form: {
    padding: 20,
    marginTop: 20,
  },

  inputLabel: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 6,
    color: "#333",
  },

  input: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: "#eee",
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
  },

  saveButton: {
    flexDirection: "row",
    backgroundColor: PRIMARY,
    padding: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },

  saveButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 8,
  },
});
