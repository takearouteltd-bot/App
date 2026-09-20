import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { 
  doc, 
  onSnapshot, 
  collection, 
  query, 
  where, 
  orderBy, 
  getDocs,
  limit 
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { db } from "../../../config/firebase";
import { currencySymbol } from '../../../utils/appConfig';

const PRIMARY = "#79B531";
const SECONDARY = "#235594";
const CARD_DARK = "#1B3F73";
const DANGER = "#DC2626";

export default function PaymentsMethodScreen({ navigation }) {
  const [card, setCard] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const user = getAuth().currentUser;

  // Fetch saved card
  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const cardsRef = collection(db, "riders", user.uid, "cards");
    const unsubscribe = onSnapshot(
      cardsRef,
      (snapshot) => {
        if (!snapshot.empty) {
          const latestCard = snapshot.docs[0].data();
          setCard(latestCard);
        } else {
          setCard(null);
        }
        setError(null);
      },
      (error) => {
        console.log("Cards listener error:", error);
        if (error.message.includes("Missing or insufficient permissions")) {
          setError("You don't have permission to view payment methods.");
        }
      }
    );

    return () => unsubscribe();
  }, [user]);

  // Fetch real transactions from payments collection
  const fetchTransactions = async () => {
    if (!user) return;

    try {
      setError(null);
      
      // ✅ Query payments where riderId matches current user
      const paymentsQuery = query(
        collection(db, "payments"),
        where("riderId", "==", user.uid),
        // orderBy("createdAt", "desc"),

        limit(20)
      );

      const snapshot = await getDocs(paymentsQuery);
      const paymentsData = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAtDate: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt),
        };
      });

      setTransactions(paymentsData);
    } catch (error) {
      console.error("Error fetching transactions:", error);
      
      if (error.message.includes("requires an index")) {
        setError("Database index required. Please check console for the link.");
      } else if (error.message.includes("Missing or insufficient permissions")) {
        setError("Permission denied. Please contact support.");
      } else {
        setError("Failed to load transactions. Please try again.");
      }
    }
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await fetchTransactions();
      setLoading(false);
    };
    loadData();
  }, [user]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchTransactions();
    setRefreshing(false);
  };

  const maskCard = (last4 = "") => {
    return "•••• •••• •••• " + last4;
  };

  const formatDate = (date) => {
    if (!date) return "N/A";
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const formatAmount = (amount, currency = "gbp") => {
    const symbol = currencySymbol(currency);
    // Amount is stored in pence (e.g., 720 = £7.20)
    return `${symbol}${(amount / 100).toFixed(2)}`;
  };

  const getTransactionTitle = (payment) => {
    if (payment.rideId) return "Ride Payment";
    return "Payment";
  };

  const TransactionItem = ({ item }) => {
    return (
      <View style={styles.transactionItem}>
        <View style={styles.transactionLeft}>
          <View style={styles.transactionIconContainer}>
            <Ionicons name="car-outline" size={20} color={PRIMARY} />
          </View>
          <View>
            <Text style={styles.transactionTitle}>{getTransactionTitle(item)}</Text>
            <Text style={styles.transactionDate}>{formatDate(item.createdAtDate)}</Text>
          </View>
        </View>

        <View style={styles.transactionRight}>
          <Text style={[styles.transactionAmount, { color: DANGER }]}>
            -{formatAmount(item.amount, item.currency)}
          </Text>
          <View style={[
            styles.statusBadge,
            { 
              backgroundColor: item.status === "captured" ? "#E9F5DD" : "#FDECEC",
            }
          ]}>
            <Text style={[
              styles.statusText,
              { 
                color: item.status === "captured" ? PRIMARY : DANGER,
                textTransform: "capitalize",
              }
            ]}>
              {item.status}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView 
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
        }
      >
        {/* Header Section */}
        <View style={styles.headerSection}>
          <View style={styles.headerTop}>
            <Text style={styles.headerTitle}>Payment Methods</Text>
            <TouchableOpacity 
              onPress={() => navigation.navigate("AllPaymentMethods")}
              style={styles.helpButton}
            >
              <Ionicons name="help-circle-outline" size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          {/* Credit Card */}
          <View style={styles.cardWrapper}>
            <View style={styles.cardContainer}>
              <View style={styles.cardTopRow}>
                <View style={styles.chip} />
                <Ionicons name="wifi" size={24} color="rgba(255,255,255,0.6)" />
              </View>

              {loading && !card ? (
                <ActivityIndicator color="#fff" style={{ marginTop: 30 }} />
              ) : card ? (
                <>
                  <Text style={styles.cardNumber}>
                    {maskCard(card.last4)}
                  </Text>

                  <View style={styles.cardBottomRow}>
                    <View>
                      <Text style={styles.cardLabel}>CARD HOLDER</Text>
                      <Text style={styles.cardValue}>
                        {(card.name || "CARD HOLDER").toUpperCase()}
                      </Text>
                    </View>

                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={styles.cardLabel}>EXPIRES</Text>
                      <Text style={styles.cardValue}>
                        {String(card.exp_month).padStart(2, "0")}/{String(card.exp_year).slice(-2)}
                      </Text>
                    </View>
                  </View>
                </>
              ) : (
                <View style={styles.noCardContent}>
                  <Ionicons name="card-outline" size={40} color="rgba(255,255,255,0.5)" />
                  <Text style={styles.noCardText}>No payment method added</Text>
                </View>
              )}
            </View>

            <View style={styles.cardBrand}>
              <Text style={styles.cardBrandText}>
                {card?.brand?.toUpperCase() || "VISA"}
              </Text>
            </View>
          </View>
        </View>

        {/* Content Section */}
        <View style={styles.contentSection}>
          {/* Add Payment Button */}
          <TouchableOpacity
            onPress={() => navigation.navigate("AddPaymentMethod")}
            style={styles.addPaymentButton}
            activeOpacity={0.8}
          >
            <View style={styles.addPaymentLeft}>
              <View style={styles.addIconWrapper}>
                <Ionicons name="add" size={22} color={PRIMARY} />
              </View>
              <View>
                <Text style={styles.addPaymentTitle}>Add New Payment</Text>
                <Text style={styles.addPaymentSubtitle}>Credit or debit card</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#999" />
          </TouchableOpacity>

          {/* Error Banner */}
          {error && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle" size={20} color={DANGER} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Transactions Section */}
          <View style={styles.transactionsSection}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent Transactions</Text>
              <TouchableOpacity onPress={onRefresh}>
                <Text style={styles.seeAllText}>Refresh</Text>
              </TouchableOpacity>
            </View>

            {loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={PRIMARY} />
                <Text style={styles.loadingText}>Loading transactions...</Text>
              </View>
            ) : transactions.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="receipt-outline" size={48} color="#CBD5E1" />
                <Text style={styles.emptyTitle}>No transactions yet</Text>
                <Text style={styles.emptySubtitle}>
                  Your ride payments will appear here
                </Text>
              </View>
            ) : (
              <View style={styles.transactionsList}>
                {transactions.map((item) => (
                  <TransactionItem key={item.id} item={item} />
                ))}
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8F9FA",
  },

  headerSection: {
    backgroundColor: SECONDARY,
    paddingTop: 60,
    paddingBottom: 40,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },

  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    marginBottom: 24,
  },

  headerTitle: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "700",
  },

  helpButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
  },

  cardWrapper: {
    alignItems: "center",
    position: "relative",
  },

  cardContainer: {
    backgroundColor: CARD_DARK,
    width: "88%",
    borderRadius: 24,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },

  cardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 30,
  },

  chip: {
    width: 50,
    height: 35,
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
    marginBottom: 30,
    fontWeight: "500",
    fontFamily: "monospace",
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

  noCardContent: {
    alignItems: "center",
    paddingVertical: 30,
  },

  noCardText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    marginTop: 12,
  },

  cardBrand: {
    position: "absolute",
    bottom: -12,
    right: "8%",
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

  contentSection: {
    padding: 20,
    paddingTop: 30,
  },

  addPaymentButton: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 18,
    borderRadius: 16,
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },

  addPaymentLeft: {
    flexDirection: "row",
    alignItems: "center",
  },

  addIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#E8F5E9",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },

  addPaymentTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1F2937",
  },

  addPaymentSubtitle: {
    fontSize: 13,
    color: "#6B7280",
    marginTop: 2,
  },

  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FDECEC",
    padding: 14,
    borderRadius: 12,
    marginBottom: 20,
    gap: 10,
  },

  errorText: {
    color: DANGER,
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },

  transactionsSection: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },

  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1F2937",
  },

  seeAllText: {
    fontSize: 13,
    fontWeight: "600",
    color: PRIMARY,
  },

  loadingContainer: {
    alignItems: "center",
    paddingVertical: 40,
  },

  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#6B7280",
  },

  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
  },

  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#374151",
    marginTop: 12,
  },

  emptySubtitle: {
    fontSize: 13,
    color: "#9CA3AF",
    marginTop: 4,
    textAlign: "center",
  },

  transactionsList: {
    gap: 4,
  },

  transactionItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },

  transactionLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },

  transactionIconContainer: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "#F0FDF4",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },

  transactionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1F2937",
  },

  transactionDate: {
    fontSize: 12,
    color: "#9CA3AF",
    marginTop: 3,
  },

  transactionRight: {
    alignItems: "flex-end",
  },

  transactionAmount: {
    fontSize: 15,
    fontWeight: "700",
  },

  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginTop: 4,
  },

  statusText: {
    fontSize: 10,
    fontWeight: "700",
  },
});