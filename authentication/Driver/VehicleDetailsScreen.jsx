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
  Image,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db, auth, storage } from "../../config/firebase";
import * as ImagePicker from "expo-image-picker";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

const TOTAL_STEPS = 5;
const PRIMARY = "#79B531";
const DARK = "#1a1a1a";

export default function VehicleDetailsScreen({
  navigation,
  setOnboardingStatus,
}) {
  const [currentStep, setCurrentStep] = useState(3);
  const driverId = auth.currentUser?.uid;

  const [makeModel, setMakeModel] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");

  const [v5Url, setV5Url] = useState(null);
  const [motUrl, setMotUrl] = useState(null);
  const [insuranceUrl, setInsuranceUrl] = useState(null);
  const [pcoUrl, setPcoUrl] = useState(null);

  // Fetch existing data
  useEffect(() => {
    const fetchData = async () => {
      if (!driverId) return;

      try {
        const snap = await getDoc(doc(db, "drivers", driverId));

        if (snap.exists()) {
          const data = snap.data();

          setCurrentStep(data.onboardingStep || 3);
          setMakeModel(data.makeModel || "");
          setRegistrationNumber(data.registrationNumber || "");

          setV5Url(data.v5Url || null);
          setMotUrl(data.motUrl || null);
          setInsuranceUrl(data.insuranceUrl || null);
          setPcoUrl(data.vehiclePcoUrl || null);
        }
      } catch (error) {
        console.log("Error fetching vehicle data:", error);
      }
    };

    fetchData();
  }, [driverId]);

  // Upload + Save instantly
  const pickDocument = async (type) => {
    if (!driverId) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission required");
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

      let updateData = {};

      switch (type) {
        case "v5Logbook":
          setV5Url(downloadUrl);
          updateData.v5Url = downloadUrl;
          break;
        case "motCert":
          setMotUrl(downloadUrl);
          updateData.motUrl = downloadUrl;
          break;
        case "phvInsurance":
          setInsuranceUrl(downloadUrl);
          updateData.insuranceUrl = downloadUrl;
          break;
        case "vehiclePco":
          setPcoUrl(downloadUrl);
          updateData.vehiclePcoUrl = downloadUrl;
          break;
      }

      await setDoc(doc(db, "drivers", driverId), updateData, { merge: true });

      console.log(`${type} uploaded`);
    } catch (error) {
      console.log("Upload error:", error);
      Alert.alert("Upload failed");
    }
  };

  const handleContinue = async () => {
    if (
      !makeModel ||
      !registrationNumber ||
      !v5Url ||
      !motUrl ||
      !insuranceUrl ||
      !pcoUrl
    ) {
      Alert.alert("Missing info", "Please complete all fields & uploads.");
      return;
    }

    try {
      await setDoc(
        doc(db, "drivers", driverId),
        {
          makeModel,
          registrationNumber,
          onboardingStep: 4,
          onboardingComplete: false,
          updatedAt: new Date(),
        },
        { merge: true }
      );

      setOnboardingStatus("onboarding");
      navigation.navigate("PayoutDetails");
    } catch (error) {
      console.log("Error saving vehicle:", error);
      Alert.alert("Error saving data");
    }
  };

  const renderUploadCard = (title, stateVar, type, icon) => {
    const isUploaded = !!stateVar;

    return (
      <TouchableOpacity
        style={[styles.uploadCard, isUploaded && styles.uploadCardDone]}
        onPress={() => pickDocument(type)}
        activeOpacity={0.8}
      >
        <View style={styles.uploadPreview}>
          {isUploaded ? (
            <Image source={{ uri: stateVar }} style={styles.uploadThumb} />
          ) : (
            <View style={styles.uploadPlaceholder}>
              <MaterialCommunityIcons name={icon} size={28} color={PRIMARY} />
            </View>
          )}
          {isUploaded && (
            <View style={styles.uploadCheck}>
              <Ionicons name="checkmark-circle" size={20} color={PRIMARY} />
            </View>
          )}
        </View>

        <View style={styles.uploadInfo}>
          <Text style={[styles.uploadTitle, isUploaded && { color: PRIMARY }]}>
            {title}
          </Text>
          <Text style={styles.uploadStatus}>
            {isUploaded ? "Uploaded" : "Tap to upload"}
          </Text>
        </View>

        <Ionicons
          name={isUploaded ? "create-outline" : "add-circle-outline"}
          size={22}
          color={isUploaded ? PRIMARY : "#ccc"}
        />
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()}>
              <Ionicons name="arrow-back" size={22} color={DARK} />
            </TouchableOpacity>

            <Text style={styles.stepText}>
              Step {currentStep} of {TOTAL_STEPS}
            </Text>

            <View style={{ width: 40 }} />
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

          <Text style={styles.title}>Vehicle Details</Text>
          <Text style={styles.subtitle}>Enter your vehicle information</Text>

          {/* Make & Model */}
          <Text style={styles.label}>Make & Model</Text>
          <TextInput
            value={makeModel}
            onChangeText={setMakeModel}
            style={styles.input}
            placeholder="e.g. Toyota Prius"
            placeholderTextColor="#aaa"
          />

          {/* Registration Number with UK Flag */}
          <Text style={styles.label}>Registration Number</Text>
          <View style={styles.regRow}>
            <Image
            source={{ uri: "https://flagcdn.com/w40/gb.png" }}
            style={styles.flag}
          />
            <TextInput
              value={registrationNumber}
              onChangeText={setRegistrationNumber}
              style={styles.regInput}
              placeholder="AB12 CDE"
              placeholderTextColor="#aaa"
              autoCapitalize="characters"
              maxLength={8}
            />
          </View>

          {/* Documents Section */}
          <Text style={styles.sectionTitle}>Required Documents</Text>
          <Text style={styles.sectionSub}>Upload clear photos of each document</Text>

          <View style={styles.uploadGrid}>
            {renderUploadCard("V5 Logbook", v5Url, "v5Logbook", "file-document-outline")}
            {renderUploadCard("MOT Certificate", motUrl, "motCert", "certificate-outline")}
            {renderUploadCard("PHV Insurance", insuranceUrl, "phvInsurance", "shield-check-outline")}
            {renderUploadCard("PCO License", pcoUrl, "vehiclePco", "card-account-details-outline")}
          </View>

          <TouchableOpacity
            style={[styles.button, (!makeModel || !registrationNumber || !v5Url || !motUrl || !insuranceUrl || !pcoUrl) && styles.buttonDisabled]}
            onPress={handleContinue}
            disabled={!makeModel || !registrationNumber || !v5Url || !motUrl || !insuranceUrl || !pcoUrl}
          >
            <Text style={styles.buttonText}>Continue</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
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
    marginBottom: 16,
  },
  flag: { width: 32, height: 20, marginRight: 10, resizeMode: "contain" },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F5F5F5",
    justifyContent: "center",
    alignItems: "center",
  },
  stepText: {
    fontSize: 15,
    fontWeight: "700",
    color: DARK,
  },

  progressBarBg: {
    height: 6,
    backgroundColor: "#eee",
    borderRadius: 3,
    marginBottom: 28,
    overflow: "hidden",
  },
  progressBarFill: {
    height: 6,
    backgroundColor: PRIMARY,
    borderRadius: 3,
  },

  title: {
    fontSize: 26,
    fontWeight: "800",
    color: DARK,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: "#888",
    marginBottom: 24,
  },

  label: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 8,
    marginLeft: 4,
    color: DARK,
  },
  input: {
    backgroundColor: "#F8F9FA",
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: "#eee",
    color: DARK,
  },

  /* Registration with UK Flag */
  regRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
    gap: 10,
  },
  flagBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a3f95",
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderRadius: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: "#152e6e",
  },
  ukFlag: {
    width: 28,
    height: 18,
    backgroundColor: "#012169",
    borderRadius: 2,
    overflow: "hidden",
    position: "relative",
  },
  ukFlagCross: {
    position: "absolute",
    width: 28,
    height: 4,
    backgroundColor: "#fff",
    top: 7,
  },
  ukFlagCrossDiag1: {
    position: "absolute",
    width: 4,
    height: 18,
    backgroundColor: "#fff",
    left: 12,
  },
  ukFlagCrossDiag2: {
    position: "absolute",
    width: 28,
    height: 2,
    backgroundColor: "#C8102E",
    top: 8,
  },
  gbText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  regInput: {
    flex: 1,
    backgroundColor: "#F8F9FA",
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
    fontSize: 18,
    fontWeight: "700",
    borderWidth: 1,
    borderColor: "#eee",
    color: DARK,
    letterSpacing: 2,
  },

  /* Upload Section */
  sectionTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: DARK,
    marginBottom: 4,
  },
  sectionSub: {
    fontSize: 13,
    color: "#888",
    marginBottom: 16,
  },
  uploadGrid: {
    gap: 12,
  },
  uploadCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1.5,
    borderColor: "#eee",
    borderStyle: "dashed",
    gap: 14,
  },
  uploadCardDone: {
    borderColor: PRIMARY,
    borderStyle: "solid",
    backgroundColor: "rgba(121,180,49,0.04)",
  },
  uploadPreview: {
    position: "relative",
  },
  uploadThumb: {
    width: 56,
    height: 56,
    borderRadius: 12,
  },
  uploadPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: "#F0F7E6",
    justifyContent: "center",
    alignItems: "center",
  },
  uploadCheck: {
    position: "absolute",
    bottom: -4,
    right: -4,
    backgroundColor: "#fff",
    borderRadius: 10,
  },
  uploadInfo: {
    flex: 1,
  },
  uploadTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: DARK,
    marginBottom: 2,
  },
  uploadStatus: {
    fontSize: 12,
    color: "#aaa",
  },

  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: PRIMARY,
    paddingVertical: 16,
    borderRadius: 16,
    marginTop: 24,
    gap: 8,
  },
  buttonDisabled: {
    backgroundColor: "#ccc",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});