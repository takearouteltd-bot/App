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
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import {
  inferUploadExtension,
  isPdfUpload,
  selectUploadAsset,
} from "../../helpers/uploadPicker";

const TOTAL_STEPS = 5;
const PRIMARY = "#79B531";
const DARK = "#1a1a1a";
const VEHICLE_TYPES = [
  {
    id: "RouteMini",
    label: "RouteMini",
    description: "Affordable everyday rides",
    icon: "car",
    passengers: 4,
  },
  {
    id: "RoutePlus",
    label: "RoutePlus",
    description: "Comfortable sedans",
    icon: "car",
    passengers: 4,
  },
  {
    id: "RouteXL",
    label: "RouteXL",
    description: "Spacious SUVs for groups",
    icon: "car-estate",
    passengers: 6,
  },
  {
    id: "RouteEco",
    label: "RouteEco",
    description: "Eco-friendly hybrid rides",
    icon: "leaf",
    passengers: 4,
  },
  {
    id: "RouteExecutive",
    label: "Executive",
    description: "Premium luxury experience",
    icon: "car-wash",
    passengers: 4,
  },
];

export default function VehicleDetailsScreen({
  navigation,
  setOnboardingStatus,
}) {
  const [currentStep, setCurrentStep] = useState(3);
  const driverId = auth.currentUser?.uid;

  const [makeModel, setMakeModel] = useState("");
  const [year, setYear] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [ownershipType, setOwnershipType] = useState(null); // "company" | "private"

  const [motUrl, setMotUrl] = useState(null);
  const [insuranceUrl, setInsuranceUrl] = useState(null);
  const [companyAgreementUrl, setCompanyAgreementUrl] = useState(null);

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
          setYear(data.year || "");
          setRegistrationNumber(data.registrationNumber || "");
          setVehicleType(data.vehicleType || "");
          setOwnershipType(data.ownershipType || null);

          setMotUrl(data.motUrl || null);
          setInsuranceUrl(data.insuranceUrl || null);
          setCompanyAgreementUrl(data.companyAgreementUrl || null);
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

      let updateData = {};

      switch (type) {
        case "motCert":
          setMotUrl(downloadUrl);
          updateData.motUrl = downloadUrl;
          break;
        case "phvInsurance":
          setInsuranceUrl(downloadUrl);
          updateData.insuranceUrl = downloadUrl;
          break;
        case "companyAgreement":
          setCompanyAgreementUrl(downloadUrl);
          updateData.companyAgreementUrl = downloadUrl;
          break;
      }

      await setDoc(doc(db, "drivers", driverId), updateData, { merge: true });

      console.log(`${type} uploaded`);
    } catch (error) {
      console.log("Upload error:", error);
      Alert.alert("Upload failed");
    }
  };

  const isFormComplete = () => {
    const baseComplete =
      makeModel &&
      year &&
      registrationNumber &&
      vehicleType &&
      ownershipType &&
      motUrl &&
      insuranceUrl;

    if (ownershipType === "company") {
      return baseComplete && !!companyAgreementUrl;
    }

    return baseComplete;
  };

  const handleContinue = async () => {
    if (!isFormComplete()) {
      Alert.alert("Missing info", "Please complete all fields & uploads.");
      return;
    }

    try {
      await setDoc(
        doc(db, "drivers", driverId),
        {
          makeModel,
          year,
          registrationNumber,
          vehicleType,
          ownershipType,
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
          {isUploaded && !isPdfUpload(stateVar) ? (
            <Image source={{ uri: stateVar }} style={styles.uploadThumb} />
          ) : isUploaded ? (
            <View style={styles.uploadPlaceholder}>
              <MaterialCommunityIcons
                name="file-pdf-box"
                size={28}
                color={PRIMARY}
              />
            </View>
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
        <ScrollView
          contentContainerStyle={styles.container}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => navigation.goBack()}
            >
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

          {/* Year */}
          <Text style={styles.label}>Year</Text>
          <TextInput
            value={year}
            onChangeText={setYear}
            style={styles.input}
            placeholder="e.g. 2021"
            placeholderTextColor="#aaa"
            keyboardType="numeric"
            maxLength={4}
          />

          {/* Registration Number */}
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

          <Text style={styles.label}>Vehicle Type</Text>
          <View style={styles.vehicleTypeList}>
            {VEHICLE_TYPES.map((option) => {
              const selected = vehicleType === option.id;
              return (
                <TouchableOpacity
                  key={option.id}
                  style={[
                    styles.vehicleTypeCard,
                    selected && styles.vehicleTypeCardSelected,
                  ]}
                  onPress={() => setVehicleType(option.id)}
                  activeOpacity={0.85}
                >
                  <View style={styles.vehicleTypeLeft}>
                    <View
                      style={[
                        styles.vehicleTypeIconWrap,
                        selected && styles.vehicleTypeIconWrapSelected,
                      ]}
                    >
                      <MaterialCommunityIcons
                        name={option.icon}
                        size={20}
                        color={selected ? PRIMARY : DARK}
                      />
                    </View>
                    <View style={styles.vehicleTypeContent}>
                      <Text
                        style={[
                          styles.vehicleTypeTitle,
                          selected && styles.vehicleTypeTitleSelected,
                        ]}
                      >
                        {option.label}
                      </Text>
                      <Text style={styles.vehicleTypeDescription}>
                        {option.description}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.vehicleTypeMeta}>
                    <Text style={styles.vehicleTypePassengers}>
                      {option.passengers} seats
                    </Text>
                    {selected ? (
                      <Ionicons name="checkmark-circle" size={22} color={PRIMARY} />
                    ) : (
                      <Ionicons name="ellipse-outline" size={20} color="#C7C7CC" />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Vehicle Ownership */}
          <Text style={styles.label}>Vehicle Ownership</Text>
          <View style={styles.radioRow}>
            <TouchableOpacity
              style={[
                styles.radioOption,
                ownershipType === "company" && styles.radioOptionSelected,
              ]}
              onPress={() => setOwnershipType("company")}
              activeOpacity={0.8}
            >
              <View style={styles.radioCircle}>
                {ownershipType === "company" && (
                  <View style={styles.radioFill} />
                )}
              </View>
              <MaterialCommunityIcons
                name="office-building-outline"
                size={18}
                color={ownershipType === "company" ? PRIMARY : "#999"}
                style={{ marginRight: 6 }}
              />
              <Text
                style={[
                  styles.radioLabel,
                  ownershipType === "company" && styles.radioLabelSelected,
                ]}
              >
                Company Car
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.radioOption,
                ownershipType === "private" && styles.radioOptionSelected,
              ]}
              onPress={() => setOwnershipType("private")}
              activeOpacity={0.8}
            >
              <View style={styles.radioCircle}>
                {ownershipType === "private" && (
                  <View style={styles.radioFill} />
                )}
              </View>
              <MaterialCommunityIcons
                name="car-outline"
                size={18}
                color={ownershipType === "private" ? PRIMARY : "#999"}
                style={{ marginRight: 6 }}
              />
              <Text
                style={[
                  styles.radioLabel,
                  ownershipType === "private" && styles.radioLabelSelected,
                ]}
              >
                Private Car
              </Text>
            </TouchableOpacity>
          </View>

          {/* Documents Section */}
          <Text style={styles.sectionTitle}>Required Documents</Text>
          <Text style={styles.sectionSub}>
            Upload clear photos of each document
          </Text>

          <View style={styles.uploadGrid}>
            {renderUploadCard(
              "MOT Certificate",
              motUrl,
              "motCert",
              "certificate-outline"
            )}
            {renderUploadCard(
              "PHV Insurance",
              insuranceUrl,
              "phvInsurance",
              "shield-check-outline"
            )}
            {ownershipType === "company" &&
              renderUploadCard(
                "Company Agreement",
                companyAgreementUrl,
                "companyAgreement",
                "file-sign"
              )}
          </View>

          <TouchableOpacity
            style={[styles.button, !isFormComplete() && styles.buttonDisabled]}
            onPress={handleContinue}
            disabled={!isFormComplete()}
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

  regRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
    gap: 10,
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
  vehicleTypeList: {
    gap: 12,
    marginBottom: 24,
  },
  vehicleTypeCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F8F9FA",
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#eee",
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  vehicleTypeCardSelected: {
    borderColor: PRIMARY,
    backgroundColor: "rgba(121,181,49,0.08)",
  },
  vehicleTypeLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 12,
  },
  vehicleTypeIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  vehicleTypeIconWrapSelected: {
    backgroundColor: "rgba(121,181,49,0.14)",
  },
  vehicleTypeContent: {
    flex: 1,
  },
  vehicleTypeTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: DARK,
  },
  vehicleTypeTitleSelected: {
    color: PRIMARY,
  },
  vehicleTypeDescription: {
    fontSize: 12,
    color: "#777",
    marginTop: 4,
  },
  vehicleTypeMeta: {
    alignItems: "flex-end",
    gap: 6,
  },
  vehicleTypePassengers: {
    fontSize: 12,
    fontWeight: "600",
    color: "#777",
  },

  /* Radio Buttons */
  radioRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 28,
  },
  radioOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#eee",
    backgroundColor: "#F8F9FA",
  },
  radioOptionSelected: {
    borderColor: PRIMARY,
    backgroundColor: "rgba(121,181,49,0.06)",
  },
  radioCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: "#ccc",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  radioFill: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: PRIMARY,
  },
  radioLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#888",
  },
  radioLabelSelected: {
    color: PRIMARY,
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
