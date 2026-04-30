import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db, auth } from "../../config/firebase";
import { onAuthStateChanged } from "firebase/auth";

const TOTAL_STEPS = 5;
const PRIMARY = "#79B531";

export default function PayoutDetailsScreen({ navigation }) {
  const [currentStep, setCurrentStep] = useState(4);
  const [driverId, setDriverId] = useState(null);

  const [accountHolder, setAccountHolder] = useState("");
  const [sortCode, setSortCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false); // <-- checkbox state

  // Listen for auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) setDriverId(user.uid);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const fetchStep = async () => {
      if (!driverId) return;
      const snap = await getDoc(doc(db, "drivers", driverId));
      if (snap.exists()) {
        setCurrentStep(snap.data().onboardingStep || 4);
      }
    };
    fetchStep();
  }, [driverId]);

const handleContinue = async () => {
  try {
    if (!driverId) {
      alert("User not authenticated");
      return;
    }

    // Basic validation
    if (!accountHolder || !sortCode || !accountNumber) {
      alert("Please fill all fields");
      return;
    }

    if (!acceptedTerms) {
      alert("You must accept the terms and conditions");
      return;
    }
    

    const driverRef = doc(db, "drivers", driverId);

    await updateDoc(driverRef, {
      accountDetails: {
        accountHolder,
        sortCode,
        accountNumber,
        acceptedTerms,
        updatedAt: new Date(),
      },
      onboardingStep: 5, // move to next step
      onboardingComplete: false
    });

    navigation.navigate("FinalReview");
  } catch (error) {
    console.log("Error saving payout details:", error);
    alert("Failed to save payout details. Please try again.");
  }
};

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView contentContainerStyle={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()}>
              <Ionicons name="arrow-back" size={24} color="black" />
            </TouchableOpacity>

            <Text style={styles.stepText}>
              Step {currentStep} of {TOTAL_STEPS}
            </Text>

            <View style={{ width: 24 }} />
          </View>

          {/* Progress Bar */}
          <View style={styles.progressBarBg}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${(currentStep / TOTAL_STEPS) * 100}%` },
              ]}
            />
          </View>

          <Text style={styles.title}>Where should we send your earnings?</Text>

          <View style={styles.badge}>
            <Text style={styles.badgeText}>SECURE & ENCRYPTED</Text>
          </View>

          {/* Inputs */}
          <Text style={styles.label}>Account Holder Name</Text>
          <TextInput
            placeholder="Enter account holder name"
            value={accountHolder}
            onChangeText={setAccountHolder}
            style={styles.input}
          />

          <Text style={styles.label}>Sort Code</Text>
          <TextInput
            placeholder="XX-XX-XX"
            value={sortCode}
            onChangeText={setSortCode}
            style={styles.input}
            keyboardType="numeric"
          />

          <Text style={styles.label}>Account Number</Text>
          <TextInput
            placeholder="Enter account number"
            value={accountNumber}
            onChangeText={setAccountNumber}
            style={styles.input}
            keyboardType="numeric"
          />

          {/* Checkbox */}
          <TouchableOpacity
            style={styles.checkboxContainer}
            onPress={() => setAcceptedTerms(!acceptedTerms)}
          >
            <View style={[styles.checkbox, acceptedTerms && styles.checked]}>
              {acceptedTerms && <Ionicons name="checkmark" size={16} color="white" />}
            </View>
            <Text style={styles.termsText}>
              I accept the <Text style={{fontWeight: '700', textDecorationLine: 'underline'}}>Payout terms and conditions</Text>
            </Text>
          </TouchableOpacity>

          {/* Continue Button */}
          <TouchableOpacity style={styles.button} onPress={handleContinue}>
            <Text style={styles.buttonText}>Continue</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  container: { padding: 20, paddingBottom: 40 },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  stepText: {
    fontSize: 16,
    fontWeight: "600",
  },

  progressBarBg: {
    height: 6,
    backgroundColor: "#E5E5E5",
    borderRadius: 10,
    marginTop: 10,
    marginBottom: 25,
  },

  progressBarFill: {
    height: 6,
    backgroundColor: PRIMARY,
    borderRadius: 10,
  },

  title: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 10,
  },

  badge: {
    backgroundColor: "#E6F4D9",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    alignSelf: "flex-start",
    marginBottom: 20,
  },

  badgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: PRIMARY,
  },

  label: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 6,
    marginLeft: 4,
    color: "#333",
  },

  input: {
    backgroundColor: "#F4F4F4",
    borderRadius: 30,
    paddingHorizontal: 18,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 15,
  },

  checkboxContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 20,
  },

  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderColor: PRIMARY,
    borderRadius: 4,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },

  checked: {
    backgroundColor: PRIMARY,
    borderColor: PRIMARY,
  },

  termsText: {
    fontSize: 13,
    color: "gray",
    flexShrink: 1,
  },

  button: {
    backgroundColor: PRIMARY,
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: "center",
    marginTop: 10,
  },

  buttonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
  },
});