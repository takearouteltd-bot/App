import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Switch,
} from "react-native";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { auth, db } from "../../config/firebase";
import { doc, getDoc, updateDoc } from "firebase/firestore";

const TOTAL_STEPS = 5;
const PRIMARY = "#79B531";

export default function ApplicationSummaryScreen({
  navigation,
  setOnboardingStatus, // 🔥 IMPORTANT
}) {
  const [currentStep, setCurrentStep] = useState(TOTAL_STEPS);

  const [personalInfoCompleted, setPersonalInfoCompleted] = useState(false);
  const [identityDocsVerified, setIdentityDocsVerified] = useState(false);
  const [vehicleDocsUploaded, setVehicleDocsUploaded] = useState(false);
  const [bankDetailsConnected, setBankDetailsConnected] = useState(false);

  const [termsAccepted, setTermsAccepted] = useState(false);
  const [gdprAccepted, setGdprAccepted] = useState(false);

  const driverId = auth.currentUser?.uid;

  useEffect(() => {
    const fetchData = async () => {
      if (!driverId) return;

      const snap = await getDoc(doc(db, "drivers", driverId));

      if (snap.exists()) {
        const data = snap.data();
        setCurrentStep(data.onboardingStep || TOTAL_STEPS);
        setPersonalInfoCompleted(!!data.personalInfo);
        setIdentityDocsVerified(!!data.identityVerification);
        setVehicleDocsUploaded(!!data.vehicleDetails);
        setBankDetailsConnected(!!data.payoutDetails);
      }
    };

    fetchData();
  }, [driverId]);

  const renderCard = (title, status, icon) => (
    <View style={styles.card}>
      <View style={styles.cardContent}>
        <View style={styles.iconContainer}>{icon}</View>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardStatus}>{status}</Text>
        </View>
        <Ionicons name="checkmark-circle" size={24} color={PRIMARY} />
      </View>
    </View>
  );

  const handleSubmit = async () => {
    if (!termsAccepted || !gdprAccepted) {
      alert("Please accept Terms and GDPR consent before submitting.");
      return;
    }

    try {
      // 🔥 Optional: update Firestore status
      if (driverId) {
        await updateDoc(doc(db, "drivers", driverId), {
          onboardingCompleted: true,
          onboardingStatus: "pending", // or "approved" depending on your flow
        });
      }

      // 🔥 This switches to DriverTabs automatically
      setOnboardingStatus("approved");

    } catch (error) {
      console.log("Error submitting application:", error);
      alert("Something went wrong. Please try again.");
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
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

        <Text style={styles.title}>Application Summary</Text>
        <Text style={styles.subtitle}>
          Please review your details before submitting your application
        </Text>

        {/* Summary Cards */}
        {renderCard(
          "Personal Information",
          personalInfoCompleted ? "Completed" : "Incomplete",
          <MaterialIcons name="person" size={40} color={PRIMARY} />
        )}

        {renderCard(
          "Identity Documents",
          identityDocsVerified ? "Verified" : "Pending",
          <MaterialIcons name="verified" size={40} color={PRIMARY} />
        )}

        {renderCard(
          "Vehicle Documents",
          vehicleDocsUploaded ? "Uploaded" : "Missing",
          <MaterialIcons name="directions-car" size={40} color={PRIMARY} />
        )}

        {renderCard(
          "Bank Details",
          bankDetailsConnected ? "Connected" : "Incomplete",
          <MaterialIcons name="account-balance" size={40} color={PRIMARY} />
        )}

        {/* Terms & GDPR */}
        <View style={{ marginTop: 30 }}>
          <Text style={styles.sectionTitle}>Terms and GDPR</Text>

          <View style={styles.switchContainer}>
            <Text style={styles.switchText}>
              I agree to the{" "}
              <Text style={{ fontWeight: "700", textDecorationLine: "underline" }}>
                Terms and Privacy Policy
              </Text>
            </Text>
            <Switch
              value={termsAccepted}
              onValueChange={setTermsAccepted}
              trackColor={{ true: PRIMARY, false: "#ccc" }}
              thumbColor="#fff"
            />
          </View>

          <View style={styles.switchContainer}>
            <Text style={styles.switchText}>
              <Text style={{ fontWeight: "700", textDecorationLine: "underline" }}>
                GDPR Data Consent
              </Text>
            </Text>
            <Switch
              value={gdprAccepted}
              onValueChange={setGdprAccepted}
              trackColor={{ true: PRIMARY, false: "#ccc" }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* Submit Button */}
        <TouchableOpacity style={styles.button} onPress={handleSubmit}>
          <Text style={styles.buttonText}>Submit Application</Text>
        </TouchableOpacity>

      </ScrollView>
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
    marginBottom: 6,
  },

  subtitle: {
    fontSize: 14,
    color: "gray",
    marginBottom: 20,
  },

  card: {
    backgroundColor: "#F9F9F9",
    borderRadius: 15,
    padding: 15,
    marginBottom: 15,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },

  cardContent: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },

  iconContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#E6F4D9",
    justifyContent: "center",
    alignItems: "center",
  },

  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
  },

  cardStatus: {
    fontSize: 12,
    color: "gray",
  },

  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 12,
  },

  switchContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 15,
    justifyContent: "space-between",
  },

  switchText: {
    fontSize: 14,
    color: "#333",
    flexShrink: 1,
  },

  button: {
    backgroundColor: PRIMARY,
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: "center",
    marginTop: 20,
  },

  buttonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
  },
});
