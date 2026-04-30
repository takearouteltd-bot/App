import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  collection,
  onSnapshot,
  doc,
  deleteDoc,
  updateDoc,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "../../../config/firebase";

const PRIMARY = "#79B531";
const SECONDARY = "#235594";
const CARD_DARK = "#1B3F73";

export default function AllPaymentMethodsScreen({ navigation }) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const user = getAuth().currentUser;

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const ref = collection(db, "riders", user.uid, "cards");

    const unsubscribe = onSnapshot(
      ref,
      (snapshot) => {
        const data = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        setCards(data);
        setLoading(false);
      },
      (error) => {
        console.log("Error loading cards:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  const maskCard = (last4) => "•••• •••• •••• " + last4;

  const setDefaultCard = async (cardId) => {
    try {
      cards.forEach(async (c) => {
        const ref = doc(db, "riders", user.uid, "cards", c.id);
        await updateDoc(ref, {
          isDefault: c.id === cardId,
        });
      });
    } catch (err) {
      console.log(err);
      Alert.alert("Error", "Could not set default card");
    }
  };

  const deleteCard = (cardId) => {
    Alert.alert("Delete Card", "Are you sure you want to remove this card?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            setDeleting(true);

            const card = cards.find((c) => c.id === cardId);
            if (!card?.paymentMethodId) {
              Alert.alert("Error", "Payment method ID not found");
              setDeleting(false);
              return;
            }

            // 1. Detach from Stripe via Cloud Function
            const functions = getFunctions();
            const detachPaymentMethod = httpsCallable(functions, "detachPaymentMethod");

            const result = await detachPaymentMethod({
              paymentMethodId: card.paymentMethodId,
            });

            if (!result.data.success) {
              throw new Error(result.data.error || "Failed to remove from Stripe");
            }

            // 2. Delete from Firestore only after Stripe success
            await deleteDoc(doc(db, "riders", user.uid, "cards", cardId));

            Alert.alert("Success", "Card removed successfully");
          } catch (err) {
            console.log("Delete card error:", err);
            Alert.alert(
              "Error",
              err.message || "Could not delete card. Please try again."
            );
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  };

  const renderCard = ({ item }) => (
    <View style={styles.card}>
      {/* Top row */}
      <View style={styles.cardHeader}>
        <Text style={styles.brandText}>
          {item.brand?.toUpperCase() || "CARD"}
        </Text>

        {item.isDefault && (
          <View style={styles.defaultBadge}>
            <Text style={styles.defaultText}>DEFAULT</Text>
          </View>
        )}
      </View>

      {/* Card number */}
      <Text style={styles.cardNumber}>{maskCard(item.last4)}</Text>

      {/* Details */}
      <View style={styles.cardDetails}>
        <View>
          <Text style={styles.detailLabel}>EXPIRY</Text>
          <Text style={styles.detailValue}>
            {item.exp_month}/{item.exp_year}
          </Text>
        </View>

        <View>
          <Text style={styles.detailLabel}>PAYMENT ID</Text>
          <Text style={styles.detailValueSmall}>
            {item.paymentMethodId?.slice(-8)}
          </Text>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.cardActions}>
        <TouchableOpacity onPress={() => setDefaultCard(item.id)}>
          <Text style={styles.setDefaultText}>Set Default</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => deleteCard(item.id)}
          disabled={deleting}
        >
          <Text style={[styles.removeText, deleting && { opacity: 0.5 }]}>
            {deleting ? "Removing…" : "Remove"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={SECONDARY} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Payment Methods</Text>

        <TouchableOpacity onPress={() => navigation.navigate("AddPaymentMethod")}>
          <Ionicons name="add-circle" size={28} color={PRIMARY} />
        </TouchableOpacity>
      </View>

      {/* Cards list */}
      <FlatList
        data={cards}
        keyExtractor={(item) => item.id}
        renderItem={renderCard}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="card-outline" size={48} color="#ccc" />
            <Text style={styles.emptyText}>No payment methods added</Text>
            <TouchableOpacity
              style={styles.addCardBtn}
              onPress={() => navigation.navigate("AddPaymentMethod")}
            >
              <Text style={styles.addCardText}>Add a card</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    paddingHorizontal: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
    paddingTop: 60,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: SECONDARY,
  },
  listContent: {
    paddingBottom: 30,
  },
  card: {
    backgroundColor: CARD_DARK,
    padding: 18,
    borderRadius: 16,
    marginBottom: 15,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  brandText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
    letterSpacing: 1,
  },
  defaultBadge: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  defaultText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "800",
  },
  cardNumber: {
    color: "#fff",
    fontSize: 20,
    marginTop: 20,
    letterSpacing: 2,
    fontWeight: "600",
  },
  cardDetails: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 20,
  },
  detailLabel: {
    color: "#aaa",
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  detailValue: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  detailValueSmall: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "500",
  },
  cardActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  setDefaultText: {
    color: PRIMARY,
    fontWeight: "700",
    fontSize: 14,
  },
  removeText: {
    color: "#ff5a5a",
    fontWeight: "700",
    fontSize: 14,
  },
  emptyState: {
    alignItems: "center",
    marginTop: 80,
    paddingHorizontal: 40,
  },
  emptyText: {
    textAlign: "center",
    marginTop: 16,
    color: "#888",
    fontSize: 16,
    fontWeight: "500",
  },
  addCardBtn: {
    marginTop: 20,
    backgroundColor: PRIMARY,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  addCardText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
});