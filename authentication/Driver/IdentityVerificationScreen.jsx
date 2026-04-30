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
  Alert,
} from "react-native";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db, auth, storage } from "../../config/firebase";
import * as ImagePicker from "expo-image-picker";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

const TOTAL_STEPS = 5;
const PRIMARY = "#79B531";

export default function IdentityVerificationScreen({
  navigation,
  setOnboardingStatus,
}) {
  const [currentStep, setCurrentStep] = useState(2);
  const driverId = auth.currentUser?.uid;

  const [driverLicenseUrl, setDriverLicenseUrl] = useState(null);
  const [pcoLicenseUrl, setPcoLicenseUrl] = useState(null);
  const [selfieUrl, setSelfieUrl] = useState(null);

  // ✅ Fetch existing data (important!)
  useEffect(() => {
    const fetchData = async () => {
      if (!driverId) return;

      try {
        const snap = await getDoc(doc(db, "drivers", driverId));

        if (snap.exists()) {
          const data = snap.data();

          setCurrentStep(data.onboardingStep || 2);
          setDriverLicenseUrl(data.driverLicenseUrl || null);
          setPcoLicenseUrl(data.pcoLicenseUrl || null);
          setSelfieUrl(data.selfieUrl || null);
        }
      } catch (error) {
        console.log("Error fetching identity data:", error);
      }
    };

    fetchData();
  }, [driverId]);

  // ✅ Upload + Save to Firestore
  const pickDocument = async (type) => {
    if (!driverId) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission required", "Allow access to upload documents.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });

    if (result.canceled) return;

    try {
      const imageUri = result.assets[0].uri;
      const response = await fetch(imageUri);
      const blob = await response.blob();

      const storageRef = ref(storage, `drivers/${driverId}/${type}.jpg`);

      await uploadBytes(storageRef, blob);
      const downloadUrl = await getDownloadURL(storageRef);

      // 🔥 Save in Firestore immediately
      const updateData = {};
      updateData[`${type}Url`] = downloadUrl;

      await setDoc(doc(db, "drivers", driverId), updateData, { merge: true });

      // Update local state
      if (type === "driverLicense") setDriverLicenseUrl(downloadUrl);
      if (type === "pcoLicense") setPcoLicenseUrl(downloadUrl);
      if (type === "selfie") setSelfieUrl(downloadUrl);

      console.log(`${type} uploaded!`);
    } catch (error) {
      console.log("Upload error:", error);
      Alert.alert("Error", "Failed to upload document.");
    }
  };

  const handleContinue = async () => {
    if (!driverLicenseUrl || !pcoLicenseUrl || !selfieUrl) {
      Alert.alert("Missing Documents", "Please upload all documents.");
      return;
    }

    try {
      await setDoc(
        doc(db, "drivers", driverId),
        {
          onboardingStep: 3,
          onboardingComplete: false,
          updatedAt: new Date(),
        },
        { merge: true }
      );

      setOnboardingStatus("onboarding");

      navigation.navigate("VehicleDetails");
    } catch (error) {
      console.log("Error saving identity info:", error);
      Alert.alert("Error", "Failed to continue.");
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

          {/* Progress */}
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
            Upload required documents to verify your identity.
          </Text>

          {renderCard(
            "Driver's License",
            "Valid driving license required",
            <MaterialIcons name="card-membership" size={40} color={PRIMARY} />,
            driverLicenseUrl,
            "driverLicense"
          )}

          {renderCard(
            "PCO License",
            "Required for ride-hailing",
            <MaterialIcons name="description" size={40} color={PRIMARY} />,
            pcoLicenseUrl,
            "pcoLicense"
          )}

          {renderCard(
            "Selfie Verification",
            "Match with your ID",
            <Ionicons name="camera" size={40} color={PRIMARY} />,
            selfieUrl,
            "selfie"
          )}

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
