import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { auth, db } from "../../../config/firebase";
import { doc, getDoc, updateDoc, Timestamp } from "firebase/firestore";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";

const PRIMARY = "#79B531";
const MONTHLY_PRICE = 99.99;

export default function SubscriptionScreen({ setOnboardingStatus }) {
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [subscription, setSubscription] = useState(null);
  const navigation = useNavigation();
  const driverId = auth.currentUser?.uid;

  useEffect(() => {
    const fetchSubscription = async () => {
      if (!driverId) {
        setChecking(false);
        return;
      }

      try {
        const driverRef = doc(db, "drivers", driverId);
        const driverSnap = await getDoc(driverRef);

        if (driverSnap.exists()) {
          const data = driverSnap.data();
          setSubscription(data.subscription || null);
        }
      } catch (err) {
        console.log("Error fetching subscription:", err);
      } finally {
        setChecking(false);
      }
    };

    fetchSubscription();
  }, [driverId]);

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

      const walletRef = doc(db, "driverWallets", driverId);
      const walletSnap = await getDoc(walletRef);

      if (!walletSnap.exists()) {
        throw new Error("Wallet not found");
      }

      const walletData = walletSnap.data();
      const available = walletData.availableBalance || 0;

      const now = new Date();
      const nextBilling = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

      if (available >= MONTHLY_PRICE) {
        await updateDoc(walletRef, {
          availableBalance: available - MONTHLY_PRICE,
          totalWithdrawn: (walletData.totalWithdrawn || 0) + MONTHLY_PRICE,
          updatedAt: Timestamp.now(),
        });

        await updateDoc(driverRef, {
          subscription: {
            status: "active",
            tier: "monthly",
            amount: MONTHLY_PRICE,
            nextBillingDate: Timestamp.fromDate(nextBilling),
            lastPaidAt: Timestamp.now(),
            paymentMethod: "wallet_deduction",
            debtAmount: 0,
          },
          onboardingCompleted: true,
        });

        Alert.alert("Success", "Subscription activated! Welcome aboard.");
      } else {
        await updateDoc(driverRef, {
          subscription: {
            status: "active",
            tier: "monthly",
            amount: MONTHLY_PRICE,
            nextBillingDate: Timestamp.fromDate(nextBilling),
            lastPaidAt: null,
            paymentMethod: "wallet_deduction",
            debtAmount: MONTHLY_PRICE,
          },
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

  const formatDate = (timestamp) => {
    if (!timestamp) return "—";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  const formatCurrency = (amount) => {
    if (amount === undefined || amount === null) return "£0.00";
    return `£${amount.toFixed(2)}`;
  };

  if (checking) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={PRIMARY} />
        <Text style={styles.checkingText}>Checking subscription status...</Text>
      </SafeAreaView>
    );
  }

  // Already subscribed — show management view
  if (subscription && subscription.status === "active") {
    const hasDebt = subscription.debtAmount && subscription.debtAmount > 0;
    const nextBillingDate = subscription.nextBillingDate ? formatDate(subscription.nextBillingDate) : "—";
    const monthlyAmount = subscription.amount || MONTHLY_PRICE;

    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {/* Header */}
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={22} color="#235594" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Subscription</Text>
            <View style={{ width: 22 }} />
          </View>

          {/* Status Card */}
          <View style={styles.statusCard}>
            <View style={styles.statusBadge}>
              <Ionicons name="checkmark-circle" size={16} color="#fff" style={{ marginRight: 4 }} />
              <Text style={styles.statusBadgeText}>Active</Text>
            </View>
            <Text style={styles.statusPlan}>Monthly Driver Plan</Text>
            <Text style={styles.statusPrice}>
              £{MONTHLY_PRICE}
              <Text style={styles.perMonth}>/month</Text>
            </Text>
          </View>

          {/* Details */}
          <View style={styles.detailsCard}>
            <View style={styles.detailRow}>
              <Ionicons name="calendar-outline" size={18} color="#6B7280" />
              <View style={styles.detailTextBlock}>
                <Text style={styles.detailLabel}>Next billing date</Text>
                <Text style={styles.detailValue}>{nextBillingDate}</Text>
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.detailRow}>
              <Ionicons name="card-outline" size={18} color="#6B7280" />
              <View style={styles.detailTextBlock}>
                <Text style={styles.detailLabel}>Payment method</Text>
                <Text style={styles.detailValue}>Wallet deduction</Text>
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.detailRow}>
              <Ionicons name="cash-outline" size={18} color="#6B7280" />
              <View style={styles.detailTextBlock}>
                <Text style={styles.detailLabel}>Monthly amount</Text>
                <Text style={styles.detailValue}>{formatCurrency(monthlyAmount)}</Text>
              </View>
            </View>

            {hasDebt && (
              <>
                <View style={styles.divider} />
                <View style={[styles.detailRow, { backgroundColor: "#FEF2F2", borderRadius: 8, padding: 10, marginHorizontal: -4 }]}>
                  <Ionicons name="alert-circle-outline" size={18} color="#EF4444" />
                  <View style={styles.detailTextBlock}>
                    <Text style={[styles.detailLabel, { color: "#EF4444" }]}>Outstanding balance</Text>
                    <Text style={[styles.detailValue, { color: "#EF4444" }]}>
                      {formatCurrency(subscription.debtAmount)} — will auto-deduct when wallet reaches this amount
                    </Text>
                  </View>
                </View>
              </>
            )}
          </View>

          {/* Info */}
          <View style={styles.infoCard}>
            <Ionicons name="information-circle-outline" size={20} color="#235594" style={{ marginRight: 10, marginTop: 2 }} />
            <Text style={styles.infoText}>
              Your subscription is automatically renewed each month. The fee is deducted from your wallet balance. If your balance is insufficient, your account will be temporarily suspended until you earn enough.
            </Text>
          </View>

          {/* CTA */}
          <TouchableOpacity
            style={styles.doneBtn}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Not subscribed — show activation view
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Header */}
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color="#235594" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Activate Your Account</Text>
          <View style={{ width: 22 }} />
        </View>

        <Text style={styles.subtitle}>
          Monthly subscription of £{MONTHLY_PRICE} — deducted from your wallet
        </Text>

        <View style={styles.card}>
          <Text style={styles.planTitle}>Monthly Driver Plan</Text>
          <Text style={styles.planPrice}>
            £{MONTHLY_PRICE}
            <Text style={styles.perMonth}>/month</Text>
          </Text>
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
          <Ionicons name="information-circle-outline" size={18} color="#235594" style={{ marginRight: 8, marginTop: 1 }} />
          <Text style={styles.infoText}>
            If your wallet has £{MONTHLY_PRICE} or more, we'll deduct it now. Otherwise, it will be deducted automatically once you earn enough.
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
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  centered: { justifyContent: "center", alignItems: "center" },
  checkingText: { marginTop: 12, color: "#666", fontWeight: "600" },

  // Header
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 10,
    marginBottom: 20,
  },
  backBtn: { padding: 6 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#235594" },

  // Activation view
  subtitle: { fontSize: 14, color: "#666", marginTop: 8, marginBottom: 20, paddingHorizontal: 20 },
  card: {
    marginHorizontal: 20,
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
    flexDirection: "row",
    marginHorizontal: 20,
    backgroundColor: "#f0f0f0",
    padding: 14,
    borderRadius: 12,
    marginBottom: 20,
  },
  infoText: { fontSize: 13, color: "#666", lineHeight: 18, flex: 1 },
  button: {
    backgroundColor: PRIMARY,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginHorizontal: 20,
  },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },

  // Subscribed view
  statusCard: {
    marginHorizontal: 20,
    padding: 24,
    borderRadius: 16,
    backgroundColor: "#F3FBEA",
    borderWidth: 2,
    borderColor: PRIMARY,
    alignItems: "center",
    marginBottom: 16,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: PRIMARY,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    marginBottom: 14,
  },
  statusBadgeText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  statusPlan: { fontSize: 16, fontWeight: "600", color: "#235594", marginBottom: 6 },
  statusPrice: { fontSize: 28, fontWeight: "700", color: PRIMARY },

  detailsCard: {
    marginHorizontal: 20,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 4,
  },
  detailTextBlock: { marginLeft: 12, flex: 1 },
  detailLabel: { fontSize: 12, color: "#9CA3AF", fontWeight: "500", marginBottom: 2 },
  detailValue: { fontSize: 15, fontWeight: "600", color: "#111827" },
  divider: { height: 1, backgroundColor: "#E5E7EB", marginVertical: 14 },

  infoCard: {
    flexDirection: "row",
    marginHorizontal: 20,
    backgroundColor: "#EFF6FF",
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
  },

  doneBtn: {
    backgroundColor: "#235594",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginHorizontal: 20,
  },
  doneBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});