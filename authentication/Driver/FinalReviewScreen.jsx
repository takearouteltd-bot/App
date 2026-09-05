import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Switch,
  Alert,
} from "react-native";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { auth, db } from "../../config/firebase";
import { doc, getDoc, updateDoc } from "firebase/firestore";

const TOTAL_STEPS = 5;
const PRIMARY = "#79B531";

export default function ApplicationSummaryScreen({
  navigation,
  setOnboardingStatus,
}) {
  const [currentStep, setCurrentStep] = useState(TOTAL_STEPS);

  const [personalInfoCompleted, setPersonalInfoCompleted] = useState(false);
  const [identityDocsVerified, setIdentityDocsVerified] = useState(false);
  const [vehicleDocsUploaded, setVehicleDocsUploaded] = useState(false);
  const [bankDetailsConnected, setBankDetailsConnected] = useState(false);

  const [termsAccepted, setTermsAccepted] = useState(false);
  const [gdprAccepted, setGdprAccepted] = useState(false);

  const driverId = auth.currentUser?.uid;

  // ✅ Fetch driver data to determine completion
  useEffect(() => {
    const fetchData = async () => {
      if (!driverId) return;

      try {
        const snap = await getDoc(doc(db, "drivers", driverId));

        if (snap.exists()) {
          const data = snap.data();
          setCurrentStep(data.onboardingStep || TOTAL_STEPS);

          setPersonalInfoCompleted(
            !!(
              data.firstName &&
              data.lastName &&
              data.dob &&
              data.nin &&
              data.address
            )
          );
          setIdentityDocsVerified(
            !!(
              (data.driverLicenseFrontUrl || data.driverLicenseUrl) &&
              (data.driverLicenseBackUrl || data.driverLicenseUrl) &&
              data.pcoLicenseUrl &&
              data.selfieUrl
            )
          );
          setVehicleDocsUploaded(
            !!(
              data.makeModel &&
              data.registrationNumber &&
              data.vehicleType &&
              data.motUrl &&
              data.insuranceUrl
            )
          );
          setBankDetailsConnected(
            !!(
              data.accountDetails?.accountHolder &&
              data.accountDetails?.sortCode &&
              data.accountDetails?.accountNumber
            )
          );
        }
      } catch (error) {
        console.log("Error fetching application summary:", error);
      }
    };

    fetchData();
  }, [driverId]);

  const renderCard = (title, status, icon) => (
    <View style={styles.card}>
      <View style={styles.cardContent}>
        <View style={styles.iconContainer}>{icon}</View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardStatus}>{status}</Text>
        </View>
        {status !== "Incomplete" && (
          <Ionicons name="checkmark-circle" size={24} color={PRIMARY} />
        )}
      </View>
    </View>
  );

  const handleSubmit = async () => {
    if (!termsAccepted || !gdprAccepted) {
      Alert.alert(
        "Consent Required",
        "Please accept Terms and GDPR consent before submitting."
      );
      return;
    }

    try {
      if (driverId) {
        await updateDoc(doc(db, "drivers", driverId), {
          onboardingComplete: true,
          onboardingStatus: "pending", // Can change to "approved" after admin review
          approved: true,
          updatedAt: new Date(),
        });
      }

      // Update global onboarding status to move driver to main app
      setOnboardingStatus('complete')

    } catch (error) {
      console.log("Error submitting application:", error);
      Alert.alert("Error", "Something went wrong. Please try again.");
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
          Review all details before submitting your application
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
          <Text style={styles.sectionTitle}>Terms & GDPR Consent</Text>

          <View style={styles.switchContainer}>
            <Text style={styles.switchText}>
              I agree to the{" "}
              <Text
                style={{ fontWeight: "700", textDecorationLine: "underline" }}
              >
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
              <Text
                style={{ fontWeight: "700", textDecorationLine: "underline" }}
              >
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
  container: {
    flexGrow: 1,
    paddingHorizontal: 25,
    paddingVertical: 30,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  stepText: { fontSize: 14, color: "#6b7280" },
  progressBarBg: {
    height: 6,
    backgroundColor: "#e5e7eb",
    borderRadius: 3,
    marginBottom: 20,
  },
  progressBarFill: {
    height: 6,
    backgroundColor: PRIMARY,
    borderRadius: 3,
  },
  title: { fontSize: 28, fontWeight: "bold", color: "#111827", marginBottom: 6 },
  subtitle: { fontSize: 16, color: "#6b7280", marginBottom: 20 },
  card: {
    backgroundColor: "#f3f4f6",
    borderRadius: 12,
    padding: 15,
    marginBottom: 15,
  },
  cardContent: { flexDirection: "row", alignItems: "center" },
  iconContainer: { width: 50, alignItems: "center" },
  cardTitle: { fontSize: 18, fontWeight: "bold", color: "#111827" },
  cardStatus: { fontSize: 14, color: "#6b7280", marginTop: 4 },
  sectionTitle: { fontSize: 16, fontWeight: "700", marginBottom: 12 },
  switchContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 15,
  },
  switchText: { fontSize: 14, color: "#111827", flex: 1, marginRight: 10 },
  button: {
    backgroundColor: PRIMARY,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 20,
    marginBottom: 30,
  },
  buttonText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
});
