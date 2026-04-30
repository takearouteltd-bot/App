import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { auth, db } from "../../config/firebase";
import { doc, getDoc, updateDoc, Timestamp } from "firebase/firestore";
import { useNavigation } from "@react-navigation/native";

const PRIMARY = "#79B531";
const MONTHLY_PRICE = 99.99;

export default function SubscriptionScreen({ setOnboardingStatus }) {
  const [loading, setLoading] = useState(false);
  const navigation = useNavigation();
  const driverId = auth.currentUser?.uid;

  const handleActivate = async () => {
    if (!driverId) {
      Alert.alert("Error", "Not authenticated");
      return;
    }

    setLoading(true);

    try {
      const driverRef = doc(db, "drivers", driverId);
      const driverSnap = await getDoc(driverRef);

      if (!driverSnap.exists()) {
        throw new Error("Driver profile not found");
      }

      const driverData = driverSnap.data();
      const walletId = driverData.walletId;

      if (!walletId) {
        throw new Error("No wallet linked to driver account");
      }

      const walletRef = doc(db, "wallets", walletId);
      const walletSnap = await getDoc(walletRef);

      if (!walletSnap.exists()) {
        throw new Error("Wallet not found");
      }

      const walletData = walletSnap.data();
      const available = walletData.availableBalance || 0;

      const now = new Date();
      const nextBilling = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

      if (available >= MONTHLY_PRICE) {
        // Deduct immediately
        await updateDoc(walletRef, {
          availableBalance: available - MONTHLY_PRICE,
          totalWithdrawn: (walletData.totalWithdrawn || 0) + MONTHLY_PRICE,
          updatedAt: Timestamp.now(),
        });

        await updateDoc(driverRef, {
          "subscription.status": "active",
          "subscription.tier": "monthly",
          "subscription.amount": MONTHLY_PRICE,
          "subscription.nextBillingDate": Timestamp.fromDate(nextBilling),
          "subscription.lastPaidAt": Timestamp.now(),
          "subscription.paymentMethod": "wallet_deduction",
          onboardingCompleted: true,
        });

        Alert.alert("Success", "Subscription activated! Welcome aboard.");
      } else {
        // Not enough balance — activate with debt tracking
        await updateDoc(driverRef, {
          "subscription.status": "active",
          "subscription.tier": "monthly",
          "subscription.amount": MONTHLY_PRICE,
          "subscription.nextBillingDate": Timestamp.fromDate(nextBilling),
          "subscription.lastPaidAt": null, // not paid yet
          "subscription.paymentMethod": "wallet_deduction",
          "subscription.debtAmount": MONTHLY_PRICE,
          onboardingCompleted: true,
        });

        Alert.alert(
          "Activated",
          `You're active! £${MONTHLY_PRICE} will be deducted from your earnings as soon as your wallet reaches that amount.`
        );
      }

      setOnboardingStatus?.("completed");
      navigation.replace("DriverHome");
    } catch (err) {
      console.log("Activation error:", err);
      Alert.alert("Error", err.message || "Could not activate subscription");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Activate Your Account</Text>
      <Text style={styles.subtitle}>
        Monthly subscription of £{MONTHLY_PRICE} — deducted from your wallet
      </Text>

      <View style={styles.card}>
        <Text style={styles.planTitle}>Monthly Driver Plan</Text>
        <Text style={styles.planPrice}>£{MONTHLY_PRICE}<Text style={styles.perMonth}>/month</Text></Text>
        <View style={styles.perkRow}>
          <Text style={styles.bullet}>•</Text>
          <Text style={styles.perkText}>Zero commission on all rides</Text>
        </View>
        <View style={styles.perkRow}>
          <Text style={styles.bullet}>•</Text>
          <Text style={styles.perkText}>Unlimited ride requests</Text>
        </View>
        <View style={styles.perkRow}>
          <Text style={styles.bullet}>•</Text>
          <Text style={styles.perkText}>Auto-deducted from wallet</Text>
        </View>
      </View>

      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          If your wallet has £{MONTHLY_PRICE} or more, we'll deduct it now. 
          Otherwise, it will be deducted automatically once you earn enough.
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.button, loading && { opacity: 0.6 }]}
        onPress={handleActivate}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Activate & Start Driving</Text>
        )}
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: "#fff" },
  title: { fontSize: 26, fontWeight: "700", marginTop: 20 },
  subtitle: { fontSize: 14, color: "#666", marginTop: 8, marginBottom: 20 },
  card: {
    padding: 20,
    borderWidth: 2,
    borderColor: PRIMARY,
    borderRadius: 16,
    backgroundColor: "#F3FBEA",
    marginBottom: 16,
  },
  planTitle: { fontSize: 16, fontWeight: "600", color: "#235594" },
  planPrice: { fontSize: 32, fontWeight: "700", color: PRIMARY, marginTop: 8 },
  perMonth: { fontSize: 16, color: "#666", fontWeight: "400" },
  perkRow: { flexDirection: "row", marginTop: 10, alignItems: "flex-start" },
  bullet: { color: PRIMARY, fontWeight: "700", marginRight: 8, fontSize: 14 },
  perkText: { fontSize: 14, color: "#444", flex: 1 },
  infoBox: {
    backgroundColor: "#f0f0f0",
    padding: 14,
    borderRadius: 12,
    marginBottom: 20,
  },
  infoText: { fontSize: 13, color: "#666", lineHeight: 18 },
  button: {
    backgroundColor: PRIMARY,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});