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
import { auth, db } from "../../config/firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { ensureDriverProfile, ensureRiderProfile } from "../../utils/modeSwitch";
import { COLORS } from '../../components/ui/kit';

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

  try {
    setLoading(true);

    const user = auth.currentUser;

    if (!user) {
      throw new Error("User not authenticated");
    }

    const uid = user.uid;
    const userRef = doc(db, "users", uid);

    // Role-specific setup first. These are the same helpers the account
    // screens use when someone switches mode later, so a passenger record
    // always comes with a Stripe customer however it was created.
    if (selected === "driver") {
      await ensureDriverProfile(uid);
    } else {
      await ensureRiderProfile(uid);
    }

    // Then save the starting mode — App.js's listener picks this up. It is not
    // a permanent choice: either mode can be added later from Account.
    await setDoc(
      userRef,
      {
        role: selected,
        updatedAt: serverTimestamp(),
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
              color={selected === "driver" ? COLORS.white : "#22c55e"}
            />
            <View style={{ marginLeft: 15 }}>
              <Text
                style={[
                  styles.optionTitle,
                  selected === "driver" && { color: COLORS.white },
                ]}
              >
                Driver
              </Text>
              <Text
                style={[
                  styles.optionSubtitle,
                  selected === "driver" && { color: COLORS.line },
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
              color={selected === "rider" ? COLORS.white : "#22c55e"}
            />
            <View style={{ marginLeft: 15 }}>
              <Text
                style={[
                  styles.optionTitle,
                  selected === "rider" && { color: COLORS.white },
                ]}
              >
                Passenger
              </Text>
              <Text
                style={[
                  styles.optionSubtitle,
                  selected === "rider" && { color: COLORS.line },
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
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <Text style={styles.buttonText}>Continue</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.white },
  content: {
    flexGrow: 1,
    paddingHorizontal: 25,
    paddingTop: 40,
    justifyContent: "center",
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: COLORS.ink,
    marginBottom: 40,
    textAlign: "center",
  },
  optionCard: {
    backgroundColor: COLORS.surface,
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
    color: COLORS.ink,
  },
  optionSubtitle: {
    fontSize: 14,
    color: COLORS.muted,
    marginTop: 4,
  },
  button: {
    backgroundColor: COLORS.green,
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 30,
  },
  buttonText: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: "bold",
  },
});