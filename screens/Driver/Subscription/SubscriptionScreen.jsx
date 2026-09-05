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
const DARK_BLUE = "#235594";
const MONTHLY_PRICE = 99.99;
const MONTHLY_PRICE_STR = "£99.99";

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
      if (!driverSnap.exists()) throw new Error("Driver profile not found");

      const walletRef = doc(db, "driverWallets", driverId);
      const walletSnap = await getDoc(walletRef);
      if (!walletSnap.exists()) throw new Error("Wallet not found");

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
          "You're active! " + MONTHLY_PRICE_STR + " will be deducted from your earnings as soon as your wallet reaches that amount."
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

  // ─── Helpers ────────────────────────────────────────────────────────────────

  const formatDate = (timestamp) => {
    if (!timestamp) return "—";
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    } catch {
      return "—";
    }
  };

  const formatCurrency = (amount) => {
    if (amount === undefined || amount === null) return "£0.00";
    const n = typeof amount === "number" ? amount : parseFloat(amount);
    if (isNaN(n)) return "£0.00";
    return "£" + n.toFixed(2);
  };

  const formatPaymentMethod = (method) => {
    if (!method) return "Wallet Deduction";
    return method
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  // ─── Loading state ───────────────────────────────────────────────────────────

  if (checking) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={PRIMARY} />
        <Text style={styles.checkingText}>Checking subscription status...</Text>
      </SafeAreaView>
    );
  }

  // ─── Active subscription view ────────────────────────────────────────────────

  if (subscription && subscription.status === "active") {
    const debtAmount = Number(subscription.debtAmount) || 0;
    const hasDebt = debtAmount > 0;
    const nextBillingDate = formatDate(subscription.nextBillingDate);
    const monthlyAmount = formatCurrency(subscription.amount || MONTHLY_PRICE);
    const paymentMethod = formatPaymentMethod(subscription.paymentMethod);
    const debtStr = formatCurrency(debtAmount);

    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent}>

          {/* Header */}
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={22} color={DARK_BLUE} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Subscription</Text>
            <View style={styles.headerSpacer} />
          </View>

          {/* Status Card */}
          <View style={styles.statusCard}>
            <View style={styles.statusBadge}>
              <Ionicons name="checkmark-circle" size={16} color="#fff" />
              <Text style={styles.statusBadgeText}>Active</Text>
            </View>
            <Text style={styles.statusPlan}>Monthly Driver Plan</Text>
            <View style={styles.priceRow}>
              <Text style={styles.statusPrice}>{monthlyAmount}</Text>
              <Text style={styles.perMonth}>/month</Text>
            </View>
          </View>

          {/* Details Card */}
          <View style={styles.detailsCard}>

            <View style={styles.detailRow}>
              <View style={styles.detailIcon}>
                <Ionicons name="calendar-outline" size={18} color="#6B7280" />
              </View>
              <View style={styles.detailTextBlock}>
                <Text style={styles.detailLabel}>Next billing date</Text>
                <Text style={styles.detailValue}>{nextBillingDate}</Text>
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.detailRow}>
              <View style={styles.detailIcon}>
                <Ionicons name="card-outline" size={18} color="#6B7280" />
              </View>
              <View style={styles.detailTextBlock}>
                <Text style={styles.detailLabel}>Payment method</Text>
                <Text style={styles.detailValue}>{paymentMethod}</Text>
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.detailRow}>
              <View style={styles.detailIcon}>
                <Ionicons name="cash-outline" size={18} color="#6B7280" />
              </View>
              <View style={styles.detailTextBlock}>
                <Text style={styles.detailLabel}>Monthly amount</Text>
                <Text style={styles.detailValue}>{monthlyAmount}</Text>
              </View>
            </View>

            {hasDebt && (
              <>
                <View style={styles.divider} />
                <View style={styles.debtRow}>
                  <Ionicons name="alert-circle-outline" size={18} color="#EF4444" />
                  <View style={styles.detailTextBlock}>
                    <Text style={styles.debtLabel}>Outstanding balance</Text>
                    <Text style={styles.debtValue}>{debtStr + " — will auto-deduct when wallet reaches this amount"}</Text>
                  </View>
                </View>
              </>
            )}
          </View>

          {/* Info Box */}
          <View style={styles.infoCard}>
            <Ionicons name="information-circle-outline" size={20} color={DARK_BLUE} />
            <Text style={styles.infoText}>
              {"Your subscription renews monthly. The fee is deducted from your wallet. If your balance is insufficient, your account will be suspended until you earn enough."}
            </Text>
          </View>

          {/* Done Button */}
          <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.primaryBtnText}>Done</Text>
          </TouchableOpacity>

        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─── Activation view ─────────────────────────────────────────────────────────

  const subtitleText = "Monthly subscription of " + MONTHLY_PRICE_STR + " — deducted from your wallet";
  const infoText = "If your wallet has " + MONTHLY_PRICE_STR + " or more, we'll deduct it now. Otherwise it will be deducted automatically once you earn enough.";

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>

        {/* Header */}
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={DARK_BLUE} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Activate Your Account</Text>
          <View style={styles.headerSpacer} />
        </View>

        <Text style={styles.subtitle}>{subtitleText}</Text>

        {/* Plan Card */}
        <View style={styles.planCard}>
          <Text style={styles.planTitle}>Monthly Driver Plan</Text>
          <View style={styles.priceRow}>
            <Text style={styles.planPrice}>{MONTHLY_PRICE_STR}</Text>
            <Text style={styles.perMonth}>/month</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.perkRow}>
            <View style={styles.perkDot} />
            <Text style={styles.perkText}>Zero commission on all rides</Text>
          </View>
          <View style={styles.perkRow}>
            <View style={styles.perkDot} />
            <Text style={styles.perkText}>Unlimited ride requests</Text>
          </View>
          <View style={styles.perkRow}>
            <View style={styles.perkDot} />
            <Text style={styles.perkText}>Auto-deducted from wallet</Text>
          </View>
        </View>

        {/* Info Box */}
        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={18} color={DARK_BLUE} />
          <Text style={styles.infoText}>{infoText}</Text>
        </View>

        {/* Activate Button */}
        <TouchableOpacity
          style={[styles.primaryBtn, loading && styles.btnDisabled]}
          onPress={handleActivate}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.primaryBtnText}>Activate &amp; Start Driving</Text>
          }
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8F9FA",
  },
  centered: {
    justifyContent: "center",
    alignItems: "center",
  },
  scrollContent: {
    paddingBottom: 48,
  },
  checkingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#666",
    fontWeight: "600",
  },

  // Header
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#F0F0F0",
    marginBottom: 20,
  },
  backBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: "#F0F4FA",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: DARK_BLUE,
    letterSpacing: -0.3,
  },
  headerSpacer: {
    width: 34,
  },

  // Status card (active view)
  statusCard: {
    marginHorizontal: 20,
    padding: 24,
    borderRadius: 20,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: PRIMARY,
    alignItems: "center",
    marginBottom: 16,
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: PRIMARY,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    marginBottom: 14,
    gap: 5,
  },
  statusBadgeText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
  },
  statusPlan: {
    fontSize: 15,
    fontWeight: "600",
    color: DARK_BLUE,
    marginBottom: 8,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 2,
  },
  statusPrice: {
    fontSize: 36,
    fontWeight: "800",
    color: PRIMARY,
    letterSpacing: -1,
  },
  planPrice: {
    fontSize: 36,
    fontWeight: "800",
    color: PRIMARY,
    letterSpacing: -1,
  },
  perMonth: {
    fontSize: 15,
    color: "#9CA3AF",
    fontWeight: "500",
    marginBottom: 6,
  },

  // Details card
  detailsCard: {
    marginHorizontal: 20,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 2,
  },
  detailIcon: {
    width: 32,
    alignItems: "center",
    paddingTop: 2,
  },
  detailTextBlock: {
    flex: 1,
    marginLeft: 4,
  },
  detailLabel: {
    fontSize: 12,
    color: "#9CA3AF",
    fontWeight: "500",
    marginBottom: 3,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
  },
  divider: {
    height: 1,
    backgroundColor: "#F3F4F6",
    marginVertical: 14,
  },
  debtRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#FEF2F2",
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  debtLabel: {
    fontSize: 12,
    color: "#EF4444",
    fontWeight: "600",
    marginBottom: 3,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  debtValue: {
    fontSize: 14,
    fontWeight: "500",
    color: "#EF4444",
    lineHeight: 20,
  },

  // Info boxes
  infoCard: {
    flexDirection: "row",
    marginHorizontal: 20,
    backgroundColor: "#EFF6FF",
    padding: 16,
    borderRadius: 14,
    marginBottom: 20,
    gap: 10,
    alignItems: "flex-start",
  },
  infoBox: {
    flexDirection: "row",
    marginHorizontal: 20,
    backgroundColor: "#EFF6FF",
    padding: 14,
    borderRadius: 14,
    marginBottom: 20,
    gap: 10,
    alignItems: "flex-start",
  },
  infoText: {
    fontSize: 13,
    color: "#374151",
    lineHeight: 19,
    flex: 1,
  },

  // Buttons
  primaryBtn: {
    backgroundColor: PRIMARY,
    padding: 17,
    borderRadius: 14,
    alignItems: "center",
    marginHorizontal: 20,
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
    letterSpacing: 0.2,
  },
  btnDisabled: {
    opacity: 0.6,
  },

  // Activation view
  subtitle: {
    fontSize: 14,
    color: "#6B7280",
    marginBottom: 20,
    paddingHorizontal: 20,
    lineHeight: 20,
  },
  planCard: {
    marginHorizontal: 20,
    padding: 22,
    borderWidth: 2,
    borderColor: PRIMARY,
    borderRadius: 20,
    backgroundColor: "#fff",
    marginBottom: 16,
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 3,
  },
  planTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: DARK_BLUE,
    marginBottom: 10,
  },
  perkRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    gap: 10,
  },
  perkDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: PRIMARY,
  },
  perkText: {
    fontSize: 14,
    color: "#374151",
    fontWeight: "500",
  },
});
