import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

const PRIMARY = "#79B531";
const SECONDARY = "#235594";

export default function SuccessfulCardScreen({ navigation, route }) {
  // You can pass these via navigation params
  const {
    cardNumber = "4587 1234 5678 1234",
    cardHolder = "Hassan Jamil",
    expiry = "02/27",
  } = route?.params || {};

  const lastFour = cardNumber.replace(/\s/g, "").slice(-4);

  return (
    <View style={styles.container}>
      
      {/* ✅ Success Icon */}
      <View style={styles.iconWrapper}>
        <Ionicons name="checkmark" size={40} color="#fff" />
      </View>

      {/* Title */}
      <Text style={styles.title}>Card Saved Successfully</Text>

      {/* Description */}
      <Text style={styles.subtitle}>
        Your Visa ending in {lastFour} is now ready to{"\n"}
        use for your next ride.
      </Text>

      {/* 💳 Card Preview */}
      <View style={styles.cardContainer}>
        <View style={styles.cardTopRow}>
          <View style={styles.chip} />
          <Ionicons name="card" size={26} color="#fff" />
        </View>

        <Text style={styles.cardNumber}>{cardNumber}</Text>

        <View style={styles.cardBottomRow}>
          <View>
            <Text style={styles.label}>Card Holder</Text>
            <Text style={styles.cardText}>{cardHolder}</Text>
          </View>

          <View>
            <Text style={styles.label}>Expires</Text>
            <Text style={styles.cardText}>{expiry}</Text>
          </View>
        </View>
      </View>

      {/* Buttons */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.primaryButton} onPress={() => navigation.navigate('PaymentsScreen')}>
          <Text style={styles.primaryButtonText}>Go to Wallet</Text>
        </TouchableOpacity>

        <TouchableOpacity>
          <Text style={styles.secondaryText}>Book a Ride</Text>
        </TouchableOpacity>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8F9FA",
    alignItems: "center",
    paddingHorizontal: 25,
    paddingTop: 120,
  },

  /* Success Icon */
  iconWrapper: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 25,
  },

  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#222",
    marginBottom: 10,
  },

  subtitle: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 40,
  },

  /* Card */
  cardContainer: {
    backgroundColor: SECONDARY,
    width: "100%",
    borderRadius: 20,
    padding: 22,
    marginBottom: 50,
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
    fontSize: 18,
    letterSpacing: 2,
    marginVertical: 25,
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

  /* Buttons */
  buttonContainer: {
    width: "100%",
    alignItems: "center",
  },

  primaryButton: {
    backgroundColor: PRIMARY,
    width: "100%",
    padding: 16,
    borderRadius: 14,
    alignItems: "center",
    marginBottom: 20,
  },

  primaryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },

  secondaryText: {
    color: SECONDARY,
    fontSize: 15,
    fontWeight: "600",
  },
});
