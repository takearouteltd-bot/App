import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { auth, db, functions } from "../../config/firebase";
import { doc, updateDoc, setDoc, getDoc } from "firebase/firestore";

import { httpsCallable } from "firebase/functions";

export default function SelectUserTypeScreen({
  setUserRole,
  setRiderOnboardingStatus,
}) {
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);

const handleContinue = async () => {
  if (!selected) {
    Alert.alert("Selection Required", "Please select an option to continue.");
    return;
  }

  let customerId = null;

  try {
    setLoading(true);

    const user = auth.currentUser;

    if (!user) {
      throw new Error("User not authenticated");
    }

    const uid = user.uid;
    const email = user.email || `${uid}@phone.user`;
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      throw new Error("User data not found");
    }

    const userData = userSnap.data();

    // ================================
    // 🔥 STRIPE CUSTOMER (SAFE LOGIC)
    // ================================
    customerId = userData?.stripeCustomerId;

    if (!customerId) {
      const createStripeCustomer = httpsCallable(functions, "createStripeCustomer");

      console.log("Creating Stripe customer...");

      const res = await createStripeCustomer({
        email,
        uid,
      });

      customerId = res.data.customerId;

      console.log("Stripe Customer Created:", customerId);

      if (!customerId) {
        throw new Error("Failed to create Stripe customer");
      }
    } else {
      console.log("Existing Stripe Customer:", customerId);
    }

 
   // ================================
// 🔥 ROLE-SPECIFIC SETUP FIRST
// ================================
if (selected === "driver") {
  await setDoc(
    doc(db, "drivers", uid),
    {
      createdAt: new Date(),
      approved: false,
      onboardingComplete: false, // ✅ FIXED NAME
    },
    { merge: true }
  );
}

if (selected === "rider") {
  await setDoc(
    doc(db, "riders", uid),
    {
      createdAt: new Date(),
      fullName: "",
      locationEnabled: false,
      onboardingComplete: false,
    },
    { merge: true }
  );
}

// ================================
// 🔥 THEN SAVE USER ROLE
// ================================
await setDoc(
  userRef,
  {
    role: selected,
    updatedAt: new Date(),
  },
  { merge: true }
);

    // ================================
    // 🔥 STATE UPDATES
    // ================================
    setUserRole(selected);

    if (selected === "rider" && setRiderOnboardingStatus) {
      setRiderOnboardingStatus("profile");
    }

  } catch (error) {
    console.log("handleContinue ERROR:", error);

    Alert.alert(
      "Error",
      error.message || "Something went wrong. Please try again."
    );
  } finally {
    setLoading(false);
  }
};

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>
          How would you like to use TakeARoute?
        </Text>

        {/* Driver */}
        <TouchableOpacity
          style={[
            styles.optionCard,
            selected === "driver" && styles.selectedCard,
          ]}
          onPress={() => setSelected("driver")}
        >
          <View style={styles.optionContent}>
            <Ionicons
              name="car-sport"
              size={28}
              color={selected === "driver" ? "#fff" : "#22c55e"}
            />
            <View style={{ marginLeft: 15 }}>
              <Text
                style={[
                  styles.optionTitle,
                  selected === "driver" && { color: "#fff" },
                ]}
              >
                Driver
              </Text>
              <Text
                style={[
                  styles.optionSubtitle,
                  selected === "driver" && { color: "#e5e7eb" },
                ]}
              >
                Earn on your schedule
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* Rider */}
        <TouchableOpacity
          style={[
            styles.optionCard,
            selected === "rider" && styles.selectedCard,
          ]}
          onPress={() => setSelected("rider")}
        >
          <View style={styles.optionContent}>
            <Ionicons
              name="person"
              size={28}
              color={selected === "rider" ? "#fff" : "#22c55e"}
            />
            <View style={{ marginLeft: 15 }}>
              <Text
                style={[
                  styles.optionTitle,
                  selected === "rider" && { color: "#fff" },
                ]}
              >
                Passenger
              </Text>
              <Text
                style={[
                  styles.optionSubtitle,
                  selected === "rider" && { color: "#e5e7eb" },
                ]}
              >
                Book a ride instantly
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        <View style={{ flex: 1 }} />

        {/* Button */}
        <TouchableOpacity
          style={[styles.button, (!selected || loading) && { opacity: 0.6 }]}
          disabled={!selected || loading}
          onPress={handleContinue}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Continue</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: {
    flexGrow: 1,
    paddingHorizontal: 25,
    paddingTop: 40,
    justifyContent: "center",
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#111827",
    marginBottom: 40,
    textAlign: "center",
  },
  optionCard: {
    backgroundColor: "#f3f4f6",
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  selectedCard: {
    backgroundColor: "#A1D77C",
  },
  optionContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  optionTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#111827",
  },
  optionSubtitle: {
    fontSize: 14,
    color: "#6b7280",
    marginTop: 4,
  },
  button: {
    backgroundColor: "#79B531",
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 30,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
});