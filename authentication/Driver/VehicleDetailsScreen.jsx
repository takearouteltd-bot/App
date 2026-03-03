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
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db, auth, storage } from "../../config/firebase";
import * as ImagePicker from "expo-image-picker";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { onAuthStateChanged } from "firebase/auth";

const TOTAL_STEPS = 5;
const PRIMARY = "#79B531";

export default function VehicleDetailsScreen({ navigation }) {
  const [currentStep, setCurrentStep] = useState(3);
  const [driverId, setDriverId] = useState(null);

  const [makeModel, setMakeModel] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");

  const [v5Url, setV5Url] = useState(null);
  const [motUrl, setMotUrl] = useState(null);
  const [insuranceUrl, setInsuranceUrl] = useState(null);
  const [pcoUrl, setPcoUrl] = useState(null);

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
        setCurrentStep(snap.data().onboardingStep || 3);
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

      switch (type) {
        case "v5Logbook":
          setV5Url(downloadUrl);
          break;
        case "motCert":
          setMotUrl(downloadUrl);
          break;
        case "phvInsurance":
          setInsuranceUrl(downloadUrl);
          break;
        case "pcoLicense":
          setPcoUrl(downloadUrl);
          break;
      }
    }
  };

  const handleContinue = async () => {
    try {
      navigation.navigate("PayoutDetails");
    } catch (error) {
      console.log("Error saving vehicle details:", error);
      alert("Failed to save vehicle details. Please try again.");
    }
  };

  const renderCard = (title, stateVar, type) => (
    <TouchableOpacity
      style={[styles.card, stateVar && { backgroundColor: "#DFF5E1" }]}
      onPress={() => pickDocument(type)}
    >
      <View style={styles.cardContent}>
        <MaterialIcons name="description" size={30} color={PRIMARY} />
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      <Text style={styles.cardSubtitle}>
        {stateVar ? "Uploaded ✅" : "Tap to upload"}
      </Text>
    </TouchableOpacity>
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

          <Text style={styles.title}>Vehicle Registration Documents</Text>
          <Text style={styles.subtitle}>
            Please provide your vehicle registration documents
          </Text>

          {/* Inputs */}
          <Text style={styles.label}>Make & Model</Text>
          <TextInput
            placeholder="Enter vehicle make & model"
            value={makeModel}
            onChangeText={setMakeModel}
            style={styles.input}
          />

          <Text style={styles.label}>Registration Number</Text>
          <TextInput
            placeholder="Enter registration number"
            value={registrationNumber}
            onChangeText={setRegistrationNumber}
            style={styles.input}
          />

          <Text style={[styles.subtitle, { marginTop: 20 }]}>
            Required Documents
          </Text>

          {/* Document Cards */}
          <View style={styles.cardsRow}>
            {renderCard("V5 Logbook", v5Url, "v5Logbook")}
            {renderCard("MOT Cert", motUrl, "motCert")}
          </View>
          <View style={styles.cardsRow}>
            {renderCard("PHV Insurance", insuranceUrl, "phvInsurance")}
            {renderCard("PCO License", pcoUrl, "pcoLicense")}
          </View>

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

  cardsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 15,
  },

  card: {
    flex: 0.48,
    backgroundColor: "#F9F9F9",
    borderRadius: 15,
    padding: 15,
    minHeight: 100,
    justifyContent: "space-between",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },

  cardContent: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },

  cardTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 8,
  },

  cardSubtitle: {
    fontSize: 12,
    color: "gray",
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
