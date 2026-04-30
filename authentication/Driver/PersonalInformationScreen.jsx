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
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db, auth } from "../../config/firebase";

const TOTAL_STEPS = 5;
const PRIMARY = "#79B531";

export default function PersonalInformationScreen({
  navigation,
  setOnboardingStatus,
}) {
  const [currentStep, setCurrentStep] = useState(1);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState("");
  const [nin, setNin] = useState("");
  const [address, setAddress] = useState("");

  const driverId = auth.currentUser?.uid;

  // ✅ Fetch existing data (if user returns)
  useEffect(() => {
    const fetchData = async () => {
      if (!driverId) return;

      try {
        const snap = await getDoc(doc(db, "drivers", driverId));

        if (snap.exists()) {
          const data = snap.data();

          setCurrentStep(data.onboardingStep || 1);
          setFirstName(data.firstName || "");
          setLastName(data.lastName || "");
          setDob(data.dob || "");
          setNin(data.nin || "");
          setAddress(data.address || "");
        }
      } catch (error) {
        console.log("Error fetching driver data:", error);
      }
    };

    fetchData();
  }, [driverId]);

  // ✅ Save data + move forward
  const handleContinue = async () => {
    if (!driverId) return;

    if (!firstName || !lastName || !dob || !nin || !address) {
      Alert.alert("Missing Fields", "Please fill all fields.");
      return;
    }

    try {
      await setDoc(
        doc(db, "drivers", driverId),
        {
          firstName,
          lastName,
          fullName: `${firstName} ${lastName}`,
          dob,
          nin,
          address,

          onboardingStep: 2,
          onboardingComplete: false,

          role: "driver",
          approved: false,
          status: "offline",

          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { merge: true } // 🔥 important
      );

      // update global onboarding flow
      setOnboardingStatus("onboarding");

      console.log("Personal info saved!");

      navigation.navigate("IdentityVerification");
    } catch (error) {
      console.log("Error saving personal info:", error);
      Alert.alert("Error", "Failed to save info. Please try again.");
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
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

          <Text style={styles.title}>Personal Information</Text>

          {/* First Name */}
          <Text style={styles.label}>First Name</Text>
          <TextInput
            placeholder="Enter first name"
            value={firstName}
            onChangeText={setFirstName}
            style={styles.input}
          />

          {/* Last Name */}
          <Text style={styles.label}>Last Name</Text>
          <TextInput
            placeholder="Enter last name"
            value={lastName}
            onChangeText={setLastName}
            style={styles.input}
          />

          {/* DOB */}
          <Text style={styles.label}>Date of Birth</Text>
          <TextInput
            placeholder="DD/MM/YYYY"
            value={dob}
            onChangeText={setDob}
            style={styles.input}
          />

          {/* NIN */}
          <Text style={styles.label}>National ID Number</Text>
          <TextInput
            placeholder="Enter ID number"
            value={nin}
            onChangeText={setNin}
            style={styles.input}
          />

          <Text style={styles.infoText}>
            Required for verification. Your data is securely stored.
          </Text>

          {/* Address */}
          <Text style={styles.label}>Home Address</Text>
          <View style={styles.addressContainer}>
            <TextInput
              placeholder="Enter your address"
              value={address}
              onChangeText={setAddress}
              style={styles.addressInput}
            />
            <TouchableOpacity style={styles.searchBtn}>
              <Ionicons name="search" size={20} color="white" />
            </TouchableOpacity>
          </View>

          <TouchableOpacity>
            <Text style={styles.manualText}>Enter address manually</Text>
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
    marginBottom: 20,
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

  infoText: {
    fontSize: 13,
    color: "gray",
    marginBottom: 20,
  },

  addressContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },

  addressInput: {
    flex: 1,
    backgroundColor: "#F4F4F4",
    borderTopLeftRadius: 30,
    borderBottomLeftRadius: 30,
    paddingHorizontal: 18,
    paddingVertical: 14,
    fontSize: 16,
  },

  searchBtn: {
    backgroundColor: PRIMARY,
    padding: 14,
    borderTopRightRadius: 30,
    borderBottomRightRadius: 30,
    justifyContent: "center",
    alignItems: "center",
  },

  manualText: {
    color: PRIMARY,
    fontWeight: "600",
    marginBottom: 30,
  },

  button: {
    backgroundColor: PRIMARY,
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: "center",
  },

  buttonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
  },
});