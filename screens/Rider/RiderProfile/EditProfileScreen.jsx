import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Alert } from "../../../components/ui/alert";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import {
  doc,
  getDoc,
  updateDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import {
  updateProfile,
  verifyBeforeUpdateEmail,
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendEmailVerification,
  signInWithPhoneNumber,
  PhoneAuthProvider,
  updatePhoneNumber,
} from "firebase/auth";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { uriToBlob } from "../../../helpers/uploadPicker";
import { db, auth, storage } from "../../../config/firebase";
import { COLORS } from '../../../components/ui/kit';

const PRIMARY = COLORS.primary;
const SECONDARY = COLORS.blue;
const BG = COLORS.surface;

export default function EditProfileScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { riderData: initialRiderData } = route.params || {};

  const user = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [savingField, setSavingField] = useState(null); // 'name' | 'email' | 'phone' | null
  const [uploadingImage, setUploadingImage] = useState(false);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [profileImage, setProfileImage] = useState(null);
  const [originalData, setOriginalData] = useState({});

  // Email verification state
  const [emailPending, setEmailPending] = useState(false);
  const [pendingEmailAddress, setPendingEmailAddress] = useState("");

  // Re-authentication modal
  const [showReauth, setShowReauth] = useState(false);
  const [reauthPassword, setReauthPassword] = useState("");
  const [reauthCallback, setReauthCallback] = useState(null);

  // Phone verification
  const [verificationId, setVerificationId] = useState(null);
  const [smsCode, setSmsCode] = useState("");
  const [phoneStep, setPhoneStep] = useState("input"); // 'input' | 'verify'

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    if (!user) {
      navigation.goBack();
      return;
    }

    try {
      let data = initialRiderData;
      if (!data) {
        const riderRef = doc(db, "riders", user.uid);
        const riderSnap = await getDoc(riderRef);
        data = riderSnap.exists() ? riderSnap.data() : {};
      }

      const name = data?.fullName || user.displayName || "";
      const emailAddr = user.email || data?.email || "";
      const phone = data?.phoneNumber || user.phoneNumber || "";

      setFullName(name);
      setEmail(emailAddr);
      setPhoneNumber(phone);
      setProfileImage(data?.profileImage || user.photoURL || null);

      // Check if there's a pending email change (stored locally or from Firebase)
      setEmailPending(data?.pendingEmail ? true : false);
      setPendingEmailAddress(data?.pendingEmail || "");

      setOriginalData({
        fullName: name,
        email: emailAddr,
        phoneNumber: phone,
        profileImage: data?.profileImage || user.photoURL || null,
      });
    } catch (error) {
      console.error("Error loading user data:", error);
      Alert.alert("Error", "Failed to load profile data");
    } finally {
      setLoading(false);
    }
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Please allow access to photos");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (!result.canceled && result.assets?.[0]?.uri) {
      await uploadProfileImage(result.assets[0].uri);
    }
  };

  const uploadProfileImage = async (uri) => {
    if (!user) return;
    setUploadingImage(true);

    try {
      // XHR blob plus an explicit content type. Storage rules that check
      // for image/* rejected the old upload, whose blob type was empty on Android.
      const blob = await uriToBlob(uri);

      const imageRef = ref(storage, `riders/${user.uid}/profile.jpg`);
      await uploadBytes(imageRef, blob, { contentType: "image/jpeg" });
      blob.close?.();
      const downloadURL = await getDownloadURL(imageRef);

      await updateProfile(user, { photoURL: downloadURL });

      // merge, so it also works if the rider record doesn't exist yet
      const riderRef = doc(db, "riders", user.uid);
      await setDoc(
        riderRef,
        { profileImage: downloadURL, updatedAt: serverTimestamp() },
        { merge: true }
      );

      setProfileImage(downloadURL);
      Alert.alert("Success", "Profile photo updated");
    } catch (error) {
      console.error("Upload error:", error);
      Alert.alert(
        "Error",
        error?.code === "storage/unauthorized"
          ? "Photo uploads are not allowed for this account yet. (storage/unauthorized)"
          : `Failed to upload image${error?.code ? ` (${error.code})` : ""}`
      );
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSaveName = async () => {
    if (!fullName.trim()) {
      Alert.alert("Error", "Name cannot be empty");
      return;
    }

    setSavingField("name");
    try {
      await updateProfile(user, { displayName: fullName.trim() });

      const riderRef = doc(db, "riders", user.uid);
      await updateDoc(riderRef, {
        fullName: fullName.trim(),
        updatedAt: serverTimestamp(),
      });

      setOriginalData((prev) => ({ ...prev, fullName: fullName.trim() }));
      Alert.alert("Success", "Name updated successfully");
    } catch (error) {
      console.error("Name update error:", error);
      Alert.alert("Error", "Failed to update name");
    } finally {
      setSavingField(null);
    }
  };

  // ============================================
  // EMAIL CHANGE FLOW (THE IMPORTANT PART)
  // ============================================
  
  const initiateEmailChange = async () => {
    if (!email.trim() || !email.includes("@")) {
      Alert.alert("Error", "Please enter a valid email");
      return;
    }

    if (email === originalData.email) {
      Alert.alert("Info", "This is already your current email");
      return;
    }

    setSavingField("email");

    try {
      // Step 1: Send verification email to the NEW address
      // This sends a link to the NEW email. When clicked, Firebase updates auth.email automatically
      await verifyBeforeUpdateEmail(user, email.trim());

      // Step 2: Save pending state to Firestore so we know a change is in progress
      const riderRef = doc(db, "riders", user.uid);
      await updateDoc(riderRef, {
        pendingEmail: email.trim(),
        pendingEmailSentAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Step 3: Update local state
      setEmailPending(true);
      setPendingEmailAddress(email.trim());

      Alert.alert(
        "Verification Email Sent",
        `We've sent a verification link to ${email.trim()}. Please check your inbox (and spam folder) and click the link to confirm your new email address.\n\nYour current email will remain active until you verify.`,
        [{ text: "Got it", style: "default" }]
      );

    } catch (error) {
      console.error("Email change error:", error);

      if (error.code === "auth/requires-recent-login") {
        // User needs to re-authenticate before changing email
        setReauthCallback(() => () => initiateEmailChange());
        setShowReauth(true);
      } else if (error.code === "auth/email-already-in-use") {
        Alert.alert("Email In Use", "This email is already associated with another account.");
      } else if (error.code === "auth/invalid-email") {
        Alert.alert("Invalid Email", "Please enter a valid email address.");
      } else {
        Alert.alert("Error", "Failed to send verification email. Please try again.");
      }
    } finally {
      setSavingField(null);
    }
  };

  const handleReauthenticate = async () => {
    if (!reauthPassword) {
      Alert.alert("Error", "Please enter your password");
      return;
    }

    try {
      const credential = EmailAuthProvider.credential(user.email, reauthPassword);
      await reauthenticateWithCredential(user, credential);

      setShowReauth(false);
      setReauthPassword("");
      
      // Execute the pending action (email change)
      if (reauthCallback) {
        reauthCallback();
        setReauthCallback(null);
      }
    } catch (error) {
      if (error.code === "auth/wrong-password") {
        Alert.alert("Incorrect Password", "The password you entered is incorrect.");
      } else {
        Alert.alert("Error", "Authentication failed. Please try again.");
      }
    }
  };

  const cancelPendingEmail = async () => {
    Alert.alert(
      "Cancel Email Change",
      "Are you sure? The verification link sent to your new email will no longer work.",
      [
        { text: "Keep Pending", style: "cancel" },
        {
          text: "Cancel Change",
          style: "destructive",
          onPress: async () => {
            try {
              const riderRef = doc(db, "riders", user.uid);
              await updateDoc(riderRef, {
                pendingEmail: null,
                pendingEmailSentAt: null,
                updatedAt: serverTimestamp(),
              });
              setEmailPending(false);
              setPendingEmailAddress("");
              setEmail(originalData.email);
            } catch (error) {
              Alert.alert("Error", "Failed to cancel");
            }
          },
        },
      ]
    );
  };

  // ============================================
  // PHONE NUMBER FLOW
  // ============================================

 const handleSavePhone = async () => {
  if (!phoneNumber.trim() || phoneNumber.length < 10) {
    Alert.alert("Error", "Please enter a valid phone number");
    return;
  }

  // Normalize to UK E.164 format (+44)
  let formattedPhone = phoneNumber.trim().replace(/\s/g, "");
  
  if (!formattedPhone.startsWith("+")) {
    if (formattedPhone.startsWith("07")) {
      // UK mobile: 07XXX XXXXXX → +447XXX XXXXXX
      formattedPhone = `+44${formattedPhone.substring(1)}`;
    } else if (formattedPhone.startsWith("0")) {
      // UK landline: 0XXXX XXX XXX → +44XXXX XXX XXX
      formattedPhone = `+44${formattedPhone.substring(1)}`;
    } else if (formattedPhone.startsWith("44")) {
      formattedPhone = `+${formattedPhone}`;
    } else {
      // Assume UK mobile without leading 0
      formattedPhone = `+44${formattedPhone}`;
    }
  }

  // Validate UK number format
  if (!/^\+44[1-9]\d{8,10}$/.test(formattedPhone)) {
    Alert.alert("Invalid Number", "Please enter a valid UK phone number.\nExamples:\n• 07123 456789\n• +44 7123 456789");
    return;
  }

  setSavingField("phone");
  try {
    const riderRef = doc(db, "riders", user.uid);
    await updateDoc(riderRef, {
      phoneNumber: formattedPhone,
      updatedAt: serverTimestamp(),
    });

    setPhoneNumber(formattedPhone);
    setOriginalData((prev) => ({ ...prev, phoneNumber: formattedPhone }));
    Alert.alert("Success", "Phone number saved");
  } catch (error) {
    console.error("Phone save error:", error);
    Alert.alert("Error", "Failed to save phone number");
  } finally {
    setSavingField(null);
  }
};


  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  if (!user) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={{ color: COLORS.muted }}>Please sign in to edit your profile</Text>
      </View>
    );
  }

  const displayName = fullName || user.displayName || "Rider";

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={COLORS.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Personal Information</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Photo */}
        <View style={styles.photoSection}>
          <TouchableOpacity onPress={pickImage} disabled={uploadingImage}>
            <View style={styles.avatarContainer}>
              {profileImage ? (
                <Image source={{ uri: profileImage }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <Text style={styles.avatarInitial}>
                    {displayName.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={styles.cameraOverlay}>
                {uploadingImage ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <Ionicons name="camera" size={18} color={COLORS.white} />
                )}
              </View>
            </View>
          </TouchableOpacity>
          <Text style={styles.photoHint}>Tap to change photo</Text>
        </View>

        {/* Form */}
        <View style={styles.formSection}>
          
          {/* Full Name */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Full Name</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="person-outline" size={18} color={PRIMARY} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={fullName}
                onChangeText={setFullName}
                placeholder="Your full name"
                placeholderTextColor={COLORS.faint}
              />
            </View>
            {fullName !== originalData.fullName && (
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleSaveName}
                disabled={savingField === "name"}
              >
                {savingField === "name" ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <Text style={styles.saveBtnText}>Save Name</Text>
                )}
              </TouchableOpacity>
            )}
          </View>

          {/* Email */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email Address</Text>
            
            {emailPending ? (
              <View style={styles.pendingCard}>
                <View style={styles.pendingHeader}>
                  <Ionicons name="mail-unread-outline" size={20} color={SECONDARY} />
                  <Text style={styles.pendingTitle}>Verification Pending</Text>
                </View>
                <Text style={styles.pendingDesc}>
                  A verification link was sent to{" "}
                  <Text style={styles.pendingEmail}>{pendingEmailAddress}</Text>. 
                  Click the link in that email to complete the change.
                </Text>
                <Text style={styles.pendingNote}>
                  Your current email ({originalData.email}) remains active until verified.
                </Text>
                <TouchableOpacity style={styles.cancelPendingBtn} onPress={cancelPendingEmail}>
                  <Text style={styles.cancelPendingText}>Cancel This Change</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <View style={styles.inputWrapper}>
                  <Ionicons name="mail-outline" size={18} color={PRIMARY} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="your@email.com"
                    placeholderTextColor={COLORS.faint}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
                {email !== originalData.email && (
                  <TouchableOpacity
                    style={styles.saveBtn}
                    onPress={initiateEmailChange}
                    disabled={savingField === "email"}
                  >
                    {savingField === "email" ? (
                      <ActivityIndicator size="small" color={COLORS.white} />
                    ) : (
                      <Text style={styles.saveBtnText}>Send Verification Email</Text>
                    )}
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>

          {/* Phone Number */}
          {/* Phone Number - Simple Save */}
<View style={styles.inputGroup}>
  <Text style={styles.label}>
    Phone Number {originalData.phoneNumber ? "" : "(Not added)"}
  </Text>
  <View style={styles.inputWrapper}>
    <Ionicons name="call-outline" size={18} color={PRIMARY} style={styles.inputIcon} />
    <TextInput
      style={styles.input}
      value={phoneNumber}
      onChangeText={setPhoneNumber}
      placeholder="+44 312 3456789"
      placeholderTextColor={COLORS.faint}
      keyboardType="phone-pad"
    />
  </View>
  {phoneNumber !== originalData.phoneNumber && (
    <TouchableOpacity
      style={styles.saveBtn}
      onPress={handleSavePhone}
      disabled={savingField === "phone"}
    >
      {savingField === "phone" ? (
        <ActivityIndicator size="small" color={COLORS.white} />
      ) : (
        <Text style={styles.saveBtnText}>
          {originalData.phoneNumber ? "Update Phone" : "Add Phone Number"}
        </Text>
      )}
    </TouchableOpacity>
  )}
</View>
        </View>

        {/* Info */}
        <View style={styles.infoCard}>
          <Ionicons name="shield-checkmark-outline" size={20} color={SECONDARY} />
          <Text style={styles.infoText}>
            For your security, email changes require verification. Phone changes use SMS confirmation. Your data is encrypted and never shared.
          </Text>
        </View>
      </ScrollView>

      {/* Re-auth Modal */}
      {showReauth && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalIcon}>
              <Ionicons name="lock-closed" size={32} color={SECONDARY} />
            </View>
            <Text style={styles.modalTitle}>Verify Identity</Text>
            <Text style={styles.modalSubtitle}>
              For security reasons, please re-enter your current password to change your email address.
            </Text>
            <TextInput
              style={styles.modalInput}
              value={reauthPassword}
              onChangeText={setReauthPassword}
              placeholder="Current password"
              placeholderTextColor="#aaa"
              secureTextEntry
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnSecondary]}
                onPress={() => {
                  setShowReauth(false);
                  setReauthPassword("");
                  setReauthCallback(null);
                }}
              >
                <Text style={styles.modalBtnSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnPrimary]}
                onPress={handleReauthenticate}
              >
                <Text style={styles.modalBtnPrimaryText}>Verify</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  centered: {
    justifyContent: "center",
    alignItems: "center",
    flex: 1,
  },

  // Header
  header: {
    backgroundColor: SECONDARY,
    paddingTop: 50,
    paddingBottom: 16,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.white,
  },

  scrollContent: {
    paddingBottom: 40,
  },

  // Photo
  photoSection: {
    alignItems: "center",
    paddingVertical: 28,
  },
  avatarContainer: {
    position: "relative",
  },
  avatar: {
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 4,
    borderColor: COLORS.white,
  },
  avatarPlaceholder: {
    backgroundColor: "#E8E8E8",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarInitial: {
    fontSize: 44,
    fontWeight: "700",
    color: SECONDARY,
  },
  cameraOverlay: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: PRIMARY,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
    borderColor: COLORS.white,
  },
  photoHint: {
    marginTop: 10,
    fontSize: 13,
    color: COLORS.faint,
  },

  // Form
  formSection: {
    paddingHorizontal: 20,
  },
  inputGroup: {
    marginBottom: 24,
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.muted,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderRadius: 12,
    paddingHorizontal: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: COLORS.ink,
    paddingVertical: 14,
  },
  saveBtn: {
    backgroundColor: PRIMARY,
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  saveBtnText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: "600",
  },

  // Pending Email Card
  pendingCard: {
    backgroundColor: "#EEF0F4",
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: SECONDARY,
  },
  pendingHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  pendingTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: SECONDARY,
  },
  pendingDesc: {
    fontSize: 13,
    color: "#444",
    lineHeight: 20,
    marginBottom: 8,
  },
  pendingEmail: {
    fontWeight: "700",
    color: SECONDARY,
  },
  pendingNote: {
    fontSize: 12,
    color: COLORS.muted,
    fontStyle: "italic",
    marginBottom: 12,
  },
  cancelPendingBtn: {
    alignSelf: "flex-start",
  },
  cancelPendingText: {
    fontSize: 13,
    color: PRIMARY,
    fontWeight: "600",
  },

  // Phone Verification
  verificationCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  verifyLabel: {
    fontSize: 14,
    color: "#555",
    marginBottom: 12,
  },
  codeInput: {
    fontSize: 32,
    fontWeight: "700",
    color: COLORS.ink,
    letterSpacing: 8,
    textAlign: "center",
    paddingVertical: 10,
    marginBottom: 16,
  },
  verifyActions: {
    flexDirection: "row",
    gap: 10,
  },
  verifyBtn: {
    flex: 2,
    marginTop: 0,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "#F0F0F0",
  },
  cancelBtnText: {
    color: COLORS.muted,
    fontSize: 14,
    fontWeight: "600",
  },

  // Info
  infoCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginHorizontal: 20,
    marginTop: 10,
    backgroundColor: "#F2FADF",
    padding: 14,
    borderRadius: 12,
    gap: 10,
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    color: "#555",
    lineHeight: 18,
  },

  // Modal
  modalOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    padding: 24,
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
  },
  modalIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#EEF0F4",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.ink,
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 13,
    color: COLORS.muted,
    marginBottom: 20,
    textAlign: "center",
    lineHeight: 18,
  },
  modalInput: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: COLORS.ink,
    width: "100%",
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  modalBtnPrimary: {
    backgroundColor: PRIMARY,
  },
  modalBtnPrimaryText: {
    color: COLORS.white,
    fontWeight: "700",
    fontSize: 14,
  },
  modalBtnSecondary: {
    backgroundColor: "#F0F0F0",
  },
  modalBtnSecondaryText: {
    color: COLORS.muted,
    fontWeight: "600",
    fontSize: 14,
  },
});