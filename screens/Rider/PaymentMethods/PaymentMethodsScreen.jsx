import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

const PRIMARY = "#79B531";
const SECONDARY = "#235594";
const CARD_DARK = "#1B3F73";

export default function PaymentsMethodScreen({ navigation }) {
  const TransactionItem = ({ icon, title, date, amount, positive }) => (
    <View style={styles.transactionItem}>
      <View style={styles.transactionLeft}>
        <View style={styles.transactionIcon}>
          <Ionicons name={icon} size={18} color={PRIMARY} />
        </View>
        <View>
          <Text style={styles.transactionTitle}>{title}</Text>
          <Text style={styles.transactionDate}>{date}</Text>
        </View>
      </View>

      <Text
        style={[
          styles.transactionAmount,
          { color: positive ? PRIMARY : "#D32F2F" },
        ]}
      >
        {positive ? "+" : "-"}£{amount}
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* 🔵 HEADER WITH CARD */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Payment Methods</Text>

          {/* ❓ Help Icon */}
          <TouchableOpacity style={styles.helpButton}>
            <Ionicons name="help-circle-outline" size={24} color="#fff" />
          </TouchableOpacity>

          {/* 💳 Debit Card */}
          <View style={styles.cardContainer}>
            <View style={styles.cardTopRow}>
              <View style={styles.chip} />
              <Ionicons name="card" size={28} color="#fff" />
            </View>

            <Text style={styles.cardNumber}>
              •••• •••• •••• 2034
            </Text>

            <View style={styles.cardBottomRow}>
              <View>
                <Text style={styles.label}>CARD HOLDER</Text>
                <Text style={styles.cardText}>Hassan Jamil</Text>
              </View>

              <View>
                <Text style={styles.label}>EXPIRES</Text>
                <Text style={styles.cardText}>09/28</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.content}>

          {/* ➕ Add New Payment */}
          <TouchableOpacity onPress={() => navigation.navigate('AddPaymentMethod')} style={styles.addPaymentCard}>
            <View style={styles.addPaymentLeft}>
              <View style={styles.addIconWrapper}>
                <Ionicons name="add" size={18} color={PRIMARY} />
              </View>
              <Text style={styles.addPaymentText}>Add New Payment</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#999" />
          </TouchableOpacity>

          {/* 🧾 Recent Transactions */}
          <Text style={styles.sectionTitle}>Recent Transactions</Text>

          <View style={styles.transactionsCard}>
            <TransactionItem
              icon="car-outline"
              title="Ride Payment"
              date="18 Feb 2026"
              amount="12.50"
            />
            <TransactionItem
              icon="refresh-outline"
              title="Wallet Top-up"
              date="16 Feb 2026"
              amount="50.00"
              positive
            />
            <TransactionItem
              icon="car-outline"
              title="Ride Payment"
              date="14 Feb 2026"
              amount="8.20"
            />
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

  header: {
    backgroundColor: SECONDARY,
    paddingTop: 60,
    paddingBottom: 40,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    alignItems: "center",
  },

  headerTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 20,
  },

  helpButton: {
    position: "absolute",
    right: 20,
    top: 60,
  },

  cardContainer: {
    backgroundColor: CARD_DARK,
    width: "90%",
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

  content: {
    padding: 20,
    marginTop: 20,
  },

  addPaymentCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 14,
    marginBottom: 25,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },

  addPaymentLeft: {
    flexDirection: "row",
    alignItems: "center",
  },

  addIconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#E8F5E9",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },

  addPaymentText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#222",
  },

  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 15,
    color: "#222",
  },

  transactionsCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 10,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },

  transactionItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: "#eee",
  },

  transactionLeft: {
    flexDirection: "row",
    alignItems: "center",
  },

  transactionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#E8F5E9",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },

  transactionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#222",
  },

  transactionDate: {
    fontSize: 12,
    color: "#777",
    marginTop: 3,
  },

  transactionAmount: {
    fontSize: 14,
    fontWeight: "600",
  },
});
