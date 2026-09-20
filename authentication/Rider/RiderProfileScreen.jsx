import React, { useState } from "react";
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
  Image,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";

import { auth, db, storage } from "../../config/firebase";
import { doc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { uriToBlob } from "../../helpers/uploadPicker";

const TOTAL_STEPS = 3;
const PRIMARY = "#79B531";

export default function RiderProfileScreen({ navigation }) {
  const [currentStep] = useState(1);
  const [fullName, setFullName] = useState("");
  const [profileImage, setProfileImage] = useState(null);
  const [loading, setLoading] = useState(false);

  const isFormValid = fullName.trim().length > 0;

  // 📸 Pick image
  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert("Permission required", "Please allow access to upload a photo.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (!result.canceled) {
      setProfileImage(result.assets[0].uri);
    }
  };

  // ☁️ Upload image
  const uploadImage = async (uri, uid) => {
    try {
      const blob = await uriToBlob(uri);

      const imageRef = ref(storage, `riders/${uid}/profile.jpg`);
      await uploadBytes(imageRef, blob, { contentType: "image/jpeg" });
      blob.close?.();

      return await getDownloadURL(imageRef);
    } catch (error) {
      console.log("Image upload error:", error);
      return null;
    }
  };

  // 👉 Continue
  const handleContinue = async () => {
    if (!isFormValid) return;

    setLoading(true);

    try {
      const user = auth.currentUser;

      if (!user) {
        Alert.alert("Error", "User not authenticated.");
        return;
      }

      const uid = user.uid;

      let profileImageURL = null;

      if (profileImage) {
        profileImageURL = await uploadImage(profileImage, uid);
      }

      // 🔥 SAFE UPDATE (no overwrite)
      await updateDoc(doc(db, "riders", uid), {
        fullName: fullName,
        profileImage: profileImageURL || null,
        onBoardingStep: 'location'
      });

      console.log("✅ Rider profile updated");

      // 👉 Move to next onboarding step
      navigation.navigate("EnableLocation");

    } catch (error) {
      console.log("Firestore error:", error);
      Alert.alert("Error", error.message);
    } finally {
      setLoading(false);
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

          {/* Progress */}
          <View style={styles.progressBarBg}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${(currentStep / TOTAL_STEPS) * 100}%` },
              ]}
            />
          </View>

          <Text style={styles.title}>Create Your Profile</Text>

          {/* Photo */}
          <View style={styles.photoContainer}>
            <TouchableOpacity style={styles.photoCircle} onPress={pickImage}>
              {profileImage ? (
                <Image source={{ uri: profileImage }} style={styles.photo} />
              ) : (
                <Ionicons name="camera-outline" size={32} color="gray" />
              )}
            </TouchableOpacity>
            <Text style={styles.photoText}>Profile photo (optional)</Text>
          </View>

          {/* Name */}
          <Text style={styles.label}>Full Name</Text>
          <TextInput
            placeholder="Enter your full name"
            value={fullName}
            onChangeText={setFullName}
            style={styles.input}
          />

          {/* Button */}
          <TouchableOpacity
            style={[
              styles.button,
              { opacity: isFormValid && !loading ? 1 : 0.5 },
            ]}
            disabled={!isFormValid || loading}
            onPress={handleContinue}
          >
            <Text style={styles.buttonText}>
              {loading ? "Saving..." : "Continue"}
            </Text>
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

  stepText: { fontSize: 16, fontWeight: "600" },

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

  title: { fontSize: 22, fontWeight: "bold", marginBottom: 30 },

  photoContainer: { alignItems: "center", marginBottom: 30 },
  photoCircle: {
    width: 110,
    height: 110,
    borderRadius: 60,
    backgroundColor: "#F4F4F4",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  photo: { width: "100%", height: "100%" },
  photoText: { marginTop: 10, fontSize: 14, color: "gray" },

  label: { fontSize: 14, fontWeight: "600", marginBottom: 6, marginLeft: 4 },
  input: {
    backgroundColor: "#F4F4F4",
    borderRadius: 30,
    paddingHorizontal: 18,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 30,
  },

  button: {
    backgroundColor: PRIMARY,
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: "center",
  },
  buttonText: { color: "white", fontSize: 16, fontWeight: "bold" },
});