import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db, auth, storage } from "../../config/firebase";
import * as ImagePicker from "expo-image-picker";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { onAuthStateChanged } from "firebase/auth";

const TOTAL_STEPS = 5;
const PRIMARY = "#79B531";

export default function IdentityVerificationScreen({ navigation }) {
  const [currentStep, setCurrentStep] = useState(2);
  const [driverId, setDriverId] = useState(null);

  const [driverLicenseUrl, setDriverLicenseUrl] = useState(null);
  const [pcoLicenseUrl, setPcoLicenseUrl] = useState(null);
  const [selfieUrl, setSelfieUrl] = useState(null);

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
        setCurrentStep(snap.data().onboardingStep || 2);
      }
    };
    fetchStep();
  }, [driverId]);

  const pickDocument = async (type) => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });

    if (!result.canceled) {
      const imageUri = result.assets[0].uri;
      const response = await fetch(imageUri);
      const blob = await response.blob();

      const storageRef = ref(storage, `drivers/${driverId}/${type}`);
      await uploadBytes(storageRef, blob);

      const downloadUrl = await getDownloadURL(storageRef);

      if (type === "driverLicense") setDriverLicenseUrl(downloadUrl);
      else if (type === "pcoLicense") setPcoLicenseUrl(downloadUrl);
      else if (type === "selfie") setSelfieUrl(downloadUrl);
    }
  };

  const handleContinue = async () => {
    try {
      navigation.navigate("VehicleDetails");
    } catch (error) {
      console.log("Error saving identity info:", error);
      alert("Failed to save documents. Please try again.");
    }
  };

  const renderCard = (title, subtitle, icon, stateVar, type) => (
    <View style={styles.card}>
      <View style={styles.cardContent}>
        <View style={styles.iconContainer}>{icon}</View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardSubtitle}>{subtitle}</Text>
        </View>
      </View>

      <TouchableOpacity
        style={styles.uploadBtn}
        onPress={() => pickDocument(type)}
      >
        <Ionicons name="cloud-upload" size={18} color="white" />
        <Text style={styles.uploadBtnText}> Upload</Text>
      </TouchableOpacity>

      {stateVar && <Text style={styles.uploadedText}>Uploaded ✅</Text>}
    </View>
  );

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

          <Text style={styles.title}>Identity Verification</Text>
          <Text style={styles.subtitle}>
            Please upload valid documents to verify your identity. These are required by UK Regulations.
          </Text>

          {/* Cards */}
          {renderCard(
            "Driver's License",
            "Valid driving license required",
            <MaterialIcons name="card-membership" size={40} color={PRIMARY} />,
            driverLicenseUrl,
            "driverLicense"
          )}

          {renderCard(
            "PCO Paper License",
            "PCO license for ride-hailing",
            <MaterialIcons name="description" size={40} color={PRIMARY} />,
            pcoLicenseUrl,
            "pcoLicense"
          )}

          {renderCard(
            "Selfie Verification",
            "Take a selfie to verify identity",
            <Ionicons name="camera" size={40} color={PRIMARY} />,
            selfieUrl,
            "selfie"
          )}

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
    padding: 20,
    marginBottom: 15,
    minHeight: 120, // increased height
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
    position: "relative",
  },

  cardContent: {
    flexDirection: "row",
    alignItems: "center",
  },

  iconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#E6F4D9",
    justifyContent: "center",
    alignItems: "center",
  },

  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },

  cardSubtitle: {
    fontSize: 12,
    color: "gray",
  },

  uploadBtn: {
    position: "absolute",
    bottom: 15,
    right: 15,
    backgroundColor: PRIMARY,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 25,
    flexDirection: "row",
    alignItems: "center",
  },

  uploadBtnText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },

  uploadedText: {
    marginTop: 8,
    fontSize: 12,
    color: PRIMARY,
    fontWeight: "600",
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
