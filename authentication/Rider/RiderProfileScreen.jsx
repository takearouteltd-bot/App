import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
} from "react-native";
import { Alert } from "../../components/ui/alert";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";

import { auth, db, storage } from "../../config/firebase";
import { doc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { uriToBlob } from "../../helpers/uploadPicker";
import {
  COLORS,
  SPACE,
  TYPE,
  Button,
  Field,
  Footer,
  Screen,
  ScreenHeader,
} from '../../components/ui/kit';

import { confirmLeaveSignup } from "../../utils/leaveSignup";
const TOTAL_STEPS = 3;

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
    <Screen scroll={false}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <ScreenHeader
            title="Create Your Profile"
            subtitle={`Step ${currentStep} of ${TOTAL_STEPS}`}
            onBack={() => (navigation.canGoBack() ? navigation.goBack() : confirmLeaveSignup())}
          />

          {/* Progress */}
          <View style={styles.progress} accessibilityLabel={`Step ${currentStep} of ${TOTAL_STEPS}`}>
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <View
                key={i}
                style={[styles.segment, i < currentStep && styles.segmentDone]}
              />
            ))}
          </View>

          {/* Photo */}
          <View style={styles.photoContainer}>
            <TouchableOpacity
              style={styles.photoCircle}
              onPress={pickImage}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={profileImage ? "Change profile photo" : "Add a profile photo"}
            >
              {profileImage ? (
                <Image source={{ uri: profileImage }} style={styles.photo} />
              ) : (
                <Ionicons name="camera-outline" size={34} color={COLORS.muted} />
              )}
              <View style={styles.photoBadge}>
                <Ionicons name={profileImage ? "pencil" : "add"} size={16} color={COLORS.midnight} />
              </View>
            </TouchableOpacity>
            <Text style={styles.photoText}>Profile photo (optional)</Text>
          </View>

          {/* Name */}
          <Field
            label="Full Name"
            left="person-outline"
            placeholder="Enter your full name"
            value={fullName}
            onChangeText={setFullName}
          />
        </ScrollView>

        <Footer>
          <Button
            title={loading ? "Saving..." : "Continue"}
            disabled={!isFormValid}
            loading={loading}
            onPress={handleContinue}
          />
        </Footer>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: SPACE[5], paddingBottom: SPACE[8] },

  progress: { flexDirection: "row", gap: 6, marginTop: SPACE[4], marginBottom: SPACE[7] },
  segment: { flex: 1, height: 5, borderRadius: 3, backgroundColor: COLORS.line },
  segmentDone: { backgroundColor: COLORS.midnight },

  photoContainer: { alignItems: "center", marginBottom: SPACE[7] },
  photoCircle: {
    width: 116,
    height: 116,
    borderRadius: 58,
    backgroundColor: COLORS.fill,
    justifyContent: "center",
    alignItems: "center",
  },
  photo: { width: "100%", height: "100%", borderRadius: 58 },
  photoBadge: {
    position: "absolute", right: 0, bottom: 0,
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: COLORS.lime,
    borderWidth: 3, borderColor: COLORS.surface,
    alignItems: "center", justifyContent: "center",
  },
  photoText: { ...TYPE.small, marginTop: SPACE[3] },
});
