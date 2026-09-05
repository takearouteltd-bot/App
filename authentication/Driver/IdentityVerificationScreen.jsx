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
  TextInput,
} from "react-native";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db, auth, storage } from "../../config/firebase";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import {
  inferUploadExtension,
  selectUploadAsset,
} from "../../helpers/uploadPicker";

const TOTAL_STEPS = 5;
const PRIMARY = "#79B531";

export default function IdentityVerificationScreen({
  navigation,
  setOnboardingStatus,
}) {
  const [currentStep, setCurrentStep] = useState(2);
  const driverId = auth.currentUser?.uid;

  const [driverLicenseFrontUrl, setDriverLicenseFrontUrl] = useState(null);
  const [driverLicenseBackUrl, setDriverLicenseBackUrl] = useState(null);
  const [pcoLicenseUrl, setPcoLicenseUrl] = useState(null);
  const [dbsCertificateUrl, setDbsCertificateUrl] = useState(null);
  const [selfieUrl, setSelfieUrl] = useState(null);
  const [shareCode, setShareCode] = useState("");

  // ✅ Fetch existing data (important!)
  useEffect(() => {
    const fetchData = async () => {
      if (!driverId) return;

      try {
        const snap = await getDoc(doc(db, "drivers", driverId));

        if (snap.exists()) {
          const data = snap.data();
          const legacyDriverLicenseUrl = data.driverLicenseUrl || null;

          setCurrentStep(data.onboardingStep || 2);
          setDriverLicenseFrontUrl(
            data.driverLicenseFrontUrl || legacyDriverLicenseUrl
          );
          setDriverLicenseBackUrl(
            data.driverLicenseBackUrl || legacyDriverLicenseUrl
          );
          setPcoLicenseUrl(data.pcoLicenseUrl || null);
          setDbsCertificateUrl(data.dbsCertificateUrl || null);
          setSelfieUrl(data.selfieUrl || null);
          setShareCode(data.rightToWorkShareCode || "");
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

    const asset = await selectUploadAsset();
    if (!asset) return;

    if (asset.error) {
      Alert.alert("Permission required", asset.error);
      return;
    }

    try {
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const extension = inferUploadExtension(asset.name, asset.mimeType);

      const storageRef = ref(storage, `drivers/${driverId}/${type}.${extension}`);

      await uploadBytes(storageRef, blob);
      const downloadUrl = await getDownloadURL(storageRef);

      // 🔥 Save in Firestore immediately
      const updateData = {};
      updateData[`${type}Url`] = downloadUrl;

      await setDoc(doc(db, "drivers", driverId), updateData, { merge: true });

      // Update local state
      if (type === "driverLicenseFront") setDriverLicenseFrontUrl(downloadUrl);
      if (type === "driverLicenseBack") setDriverLicenseBackUrl(downloadUrl);
      if (type === "pcoLicense") setPcoLicenseUrl(downloadUrl);
      if (type === "dbsCertificate") setDbsCertificateUrl(downloadUrl);
      if (type === "selfie") setSelfieUrl(downloadUrl);

      console.log(`${type} uploaded!`);
    } catch (error) {
      console.log("Upload error:", error);
      Alert.alert("Error", "Failed to upload document.");
    }
  };

  const handleContinue = async () => {
    if (!driverLicenseFrontUrl || !driverLicenseBackUrl || !pcoLicenseUrl || !selfieUrl) {
      Alert.alert("Missing Documents", "Please upload all required documents.");
      return;
    }

    if (!shareCode.trim()) {
      Alert.alert("Missing Share Code", "Please enter your Right to Work Share Code.");
      return;
    }

    try {
      await setDoc(
        doc(db, "drivers", driverId),
        {
          onboardingStep: 3,
          onboardingComplete: false,
          rightToWorkShareCode: shareCode.trim(),
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

          <Text style={styles.title}>Identity & Compliance</Text>
          <Text style={styles.subtitle}>
            Please upload valid documents to verify your identity. These are required by the UK regulations.
          </Text>

          {renderCard(
            "Driver's License (Front)",
            "Upload the front side of your driving license",
            <MaterialIcons name="card-membership" size={40} color={PRIMARY} />,
            driverLicenseFrontUrl,
            "driverLicenseFront"
          )}

          {renderCard(
            "Driver's License (Back)",
            "Upload the back side of your driving license",
            <MaterialIcons name="flip-to-back" size={40} color={PRIMARY} />,
            driverLicenseBackUrl,
            "driverLicenseBack"
          )}

          {renderCard(
            "PCO License",
            "Required for ride-hailing",
            <MaterialIcons name="description" size={40} color={PRIMARY} />,
            pcoLicenseUrl,
            "pcoLicense"
          )}

          {renderCard(
            "Enhanced DBS Certificate",
            "Ensure good lighting. Must be valid",
            <MaterialIcons name="description" size={40} color={PRIMARY} />,
            dbsCertificateUrl,
            "dbsCertificate"
          )}

          {renderCard(
            "Selfie Verification",
            "Match with your ID",
            <Ionicons name="camera" size={40} color={PRIMARY} />,
            selfieUrl,
            "selfie"
          )}

          {/* Right to Work Share Code */}
          <View style={styles.card}>
            <View style={styles.cardContent}>
              <View style={styles.iconContainer}>
                <MaterialIcons name="vpn-key" size={40} color={PRIMARY} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.cardTitle}>Right to Work Share Code</Text>
                <Text style={styles.cardSubtitle}>
                  Must not be older than 28 days
                </Text>
              </View>
            </View>

            <TextInput
              style={styles.shareCodeInput}
              value={shareCode}
              onChangeText={setShareCode}
              placeholder="ABC 123 DEF"
              placeholderTextColor="#aaa"
              autoCapitalize="characters"
              maxLength={11}
            />
          </View>

          <TouchableOpacity style={styles.button} onPress={handleContinue}>
            <Text style={styles.buttonText}>Continue</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#fff",
  },
  container: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  stepText: {
    fontSize: 14,
    color: "#666",
    fontWeight: "500",
  },
  progressBarBg: {
    height: 6,
    backgroundColor: "#e0e0e0",
    borderRadius: 4,
    marginBottom: 24,
  },
  progressBarFill: {
    height: 6,
    backgroundColor: "#79B531",
    borderRadius: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#111",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
    marginBottom: 24,
    lineHeight: 20,
  },
  card: {
    backgroundColor: "#f9f9f9",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#eee",
  },
  cardContent: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  iconContainer: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: "#f0f9e6",
    justifyContent: "center",
    alignItems: "center",
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111",
    marginBottom: 2,
  },
  cardSubtitle: {
    fontSize: 12,
    color: "#888",
  },
  uploadBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#79B531",
    borderRadius: 8,
    paddingVertical: 10,
  },
  uploadBtnText: {
    color: "white",
    fontWeight: "600",
    fontSize: 14,
  },
  uploadedText: {
    marginTop: 8,
    fontSize: 13,
    color: "#79B531",
    fontWeight: "500",
  },
  shareCodeInput: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: "#111",
    backgroundColor: "#fff",
    letterSpacing: 1.5,
  },
  button: {
    backgroundColor: "#79B531",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
  },
});
