import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Alert } from "../../../components/ui/alert";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import nativeAuth from "@react-native-firebase/auth";
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
} from "firebase/auth";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { uriToBlob } from "../../../helpers/uploadPicker";
import { db, auth, storage } from "../../../config/firebase";
import {
  COLORS,
  TYPE,
  SPACE,
  RADIUS,
  SHADOW,
  Screen,
  ScreenHeader,
  Avatar,
  Field,
  Button,
  Banner,
  Loading,
  EmptyState,
} from '../../../components/ui/kit';

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

  // Phone verification: the code is checked by SMS before the number is saved.
  const [verificationId, setVerificationId] = useState(null);
  const [pendingPhone, setPendingPhone] = useState(null); // E.164 number awaiting its code
  const [smsCode, setSmsCode] = useState("");
  const [phoneStep, setPhoneStep] = useState("input"); // 'input' | 'verify'

  useEffect(() => {
    loadUserData();
  }, []);

  // A verified email change completes on Firebase's side when the link is
  // clicked; the rider record only learns of it here.
  const settlePendingEmail = useCallback(async () => {
    if (!user) return;
    try {
      await user.reload();
      const riderRef = doc(db, "riders", user.uid);
      const snap = await getDoc(riderRef);
      const pending = snap.exists() ? snap.data().pendingEmail : null;
      if (pending && user.email && user.email.toLowerCase() === String(pending).toLowerCase()) {
        await updateDoc(riderRef, {
          email: user.email,
          pendingEmail: null,
          pendingEmailSentAt: null,
          updatedAt: serverTimestamp(),
        });
        setEmailPending(false);
        setPendingEmailAddress("");
        setEmail(user.email);
        setOriginalData((prev) => ({ ...prev, email: user.email }));
      }
    } catch (error) {
      console.log("Pending email check:", error?.code || error?.message);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      settlePendingEmail();
    }, [settlePendingEmail])
  );

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
      mediaTypes: ["images"],
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
        // User needs to re-authenticate before changing email. Only an
        // account with a password can do that here.
        const hasPassword = (user.providerData || []).some((p) => p.providerId === "password");
        if (hasPassword) {
          setReauthCallback(() => () => initiateEmailChange());
          setShowReauth(true);
        } else {
          Alert.alert(
            "Please sign in again",
            "For your security, changing your email needs a recent sign-in. Sign out, sign back in, then try again."
          );
        }
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
  // Proves the number by SMS first. The native Firebase SDK sends and checks
  // the code (the same handshake as phone sign-in); the number is only
  // written to the rider record once the code is right.
  // ============================================

  const normaliseUkPhone = (raw) => {
    let formatted = String(raw || "").trim().replace(/\s/g, "");
    if (!formatted.startsWith("+")) {
      if (formatted.startsWith("0")) {
        formatted = `+44${formatted.substring(1)}`;
      } else if (formatted.startsWith("44")) {
        formatted = `+${formatted}`;
      } else {
        formatted = `+44${formatted}`;
      }
    }
    return /^\+44[1-9]\d{8,10}$/.test(formatted) ? formatted : null;
  };

  const handleSavePhone = async () => {
    if (!phoneNumber.trim() || phoneNumber.length < 10) {
      Alert.alert("Error", "Please enter a valid phone number");
      return;
    }
    const formattedPhone = normaliseUkPhone(phoneNumber);
    if (!formattedPhone) {
      Alert.alert("Invalid Number", "Please enter a valid UK phone number.\nExamples:\n• 07123 456789\n• +44 7123 456789");
      return;
    }
    if (formattedPhone === originalData.phoneNumber) {
      Alert.alert("Info", "This is already your phone number");
      return;
    }

    setSavingField("phone");
    try {
      const confirmation = await nativeAuth().signInWithPhoneNumber(formattedPhone, true);
      setVerificationId(confirmation.verificationId);
      setPendingPhone(formattedPhone);
      setSmsCode("");
      setPhoneStep("verify");
    } catch (error) {
      console.log("Phone code error:", error);
      Alert.alert("Could not send code", error?.message || "Please try again.");
    } finally {
      setSavingField(null);
    }
  };

  const cancelPhoneVerify = async () => {
    setPhoneStep("input");
    setVerificationId(null);
    setPendingPhone(null);
    setSmsCode("");
    try {
      if (nativeAuth().currentUser) await nativeAuth().signOut();
    } catch (e) {}
  };

  const handleVerifyPhone = async () => {
    const code = smsCode.trim();
    if (code.length !== 6) {
      Alert.alert("Invalid Code", "Please enter the full 6-digit code.");
      return;
    }
    if (!verificationId || !pendingPhone) {
      Alert.alert("Session Expired", "Please request a new code.");
      setPhoneStep("input");
      return;
    }

    setSavingField("phone");
    try {
      const credential = nativeAuth.PhoneAuthProvider.credential(verificationId, code);
      const result = await nativeAuth().signInWithCredential(credential);
      const nativeUser = result.user;

      // The native sign-in was only the proof of possession. Leave no trace:
      // a brand-new native account is removed; an existing one belongs to
      // someone else's login and must not be taken over.
      if (nativeUser.uid !== user.uid) {
        if (result.additionalUserInfo?.isNewUser) {
          await nativeUser.delete().catch(() => nativeAuth().signOut());
        } else {
          await nativeAuth().signOut();
          Alert.alert("Number in use", "That phone number is already linked to another TakeARoute account.");
          setPhoneStep("input");
          return;
        }
      } else {
        await nativeAuth().signOut();
      }

      const riderRef = doc(db, "riders", user.uid);
      await updateDoc(riderRef, {
        phoneNumber: pendingPhone,
        phoneVerifiedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setPhoneNumber(pendingPhone);
      setOriginalData((prev) => ({ ...prev, phoneNumber: pendingPhone }));
      setPhoneStep("input");
      setVerificationId(null);
      setPendingPhone(null);
      setSmsCode("");
      Alert.alert("Success", "Phone number verified and saved");
    } catch (error) {
      console.log("Phone verify error:", error);
      Alert.alert("Verification Failed", error?.message || "That code isn't right. Check the SMS and try again.");
    } finally {
      setSavingField(null);
    }
  };


  if (loading) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  if (!user) {
    return (
      <Screen scroll={false} style={{ justifyContent: "center" }}>
        <EmptyState icon="person-circle-outline" title="Please sign in to edit your profile" />
      </Screen>
    );
  }

  const displayName = fullName || user.displayName || "Rider";

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <Screen>
        <ScreenHeader title="Personal Information" />

        {/* Photo */}
        <View style={styles.photoSection}>
          <TouchableOpacity
            onPress={pickImage}
            disabled={uploadingImage}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
          >
            <Avatar uri={profileImage} name={displayName} size={96} />
            <View style={styles.cameraBadge}>
              {uploadingImage ? (
                <ActivityIndicator size="small" color={COLORS.lime} />
              ) : (
                <Ionicons name="camera" size={16} color={COLORS.lime} />
              )}
            </View>
          </TouchableOpacity>
          <Text style={[TYPE.small, { marginTop: SPACE[3] }]}>Tap to change photo</Text>
        </View>

        {/* Full Name */}
        <Field
          label="Full Name"
          left="person-outline"
          value={fullName}
          onChangeText={setFullName}
          placeholder="Your full name"
          style={fullName !== originalData.fullName && { marginBottom: SPACE[2] }}
        />
        {fullName !== originalData.fullName && (
          <Button
            title="Save Name"
            size="small"
            style={styles.saveBtn}
            onPress={handleSaveName}
            loading={savingField === "name"}
            disabled={savingField === "name"}
          />
        )}

        {/* Email */}
        {emailPending ? (
          <View style={{ marginBottom: SPACE[4] }}>
            <Text style={styles.fieldLabel}>Email Address</Text>
            <Banner
              tone="info"
              icon="mail-unread-outline"
              title="Verification Pending"
              body={`A verification link was sent to ${pendingEmailAddress}. Click the link in that email to complete the change.\n\nYour current email (${originalData.email}) remains active until verified.`}
              action={
                <Button title="Cancel This Change" variant="ghost" size="small" style={{ alignSelf: "flex-start" }} onPress={cancelPendingEmail} />
              }
            />
          </View>
        ) : (
          <>
            <Field
              label="Email Address"
              left="mail-outline"
              value={email}
              onChangeText={setEmail}
              placeholder="your@email.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              style={email !== originalData.email && { marginBottom: SPACE[2] }}
            />
            {email !== originalData.email && (
              <Button
                title="Send Verification Email"
                size="small"
                style={styles.saveBtn}
                onPress={initiateEmailChange}
                loading={savingField === "email"}
                disabled={savingField === "email"}
              />
            )}
          </>
        )}

        {/* Phone Number - Simple Save */}
        <Field
          label={`Phone Number ${originalData.phoneNumber ? "" : "(Not added)"}`}
          left="call-outline"
          value={phoneNumber}
          onChangeText={setPhoneNumber}
          placeholder="+44 312 3456789"
          keyboardType="phone-pad"
          style={phoneNumber !== originalData.phoneNumber && { marginBottom: SPACE[2] }}
        />
        {phoneNumber !== originalData.phoneNumber && (
          <Button
            title={originalData.phoneNumber ? "Update Phone" : "Add Phone Number"}
            size="small"
            style={styles.saveBtn}
            onPress={handleSavePhone}
            loading={savingField === "phone"}
            disabled={savingField === "phone"}
          />
        )}

        {/* Info */}
        <View style={{ marginTop: SPACE[4] }}>
          <Banner
            tone="success"
            icon="shield-checkmark-outline"
            body="For your security, email changes are confirmed by a link to the new address and phone changes by an SMS code. Your data is encrypted and never shared."
          />
        </View>
      </Screen>

      {/* SMS code sheet */}
      {phoneStep === "verify" && (
        <View style={styles.modalOverlay}>
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <View style={styles.modalIcon}>
              <Ionicons name="chatbubble-ellipses" size={28} color={COLORS.midnight} />
            </View>
            <Text style={[TYPE.heading, { textAlign: "center" }]}>Enter the code</Text>
            <Text style={styles.modalSubtitle}>
              We sent a 6-digit code by SMS to {pendingPhone}. Enter it to confirm this is your number.
            </Text>
            <Field
              value={smsCode}
              onChangeText={(t) => setSmsCode(t.replace(/\D/g, "").slice(0, 6))}
              placeholder="6-digit code"
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              maxLength={6}
              autoFocus
            />
            <View style={styles.modalActions}>
              <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={cancelPhoneVerify} />
              <Button
                title="Confirm"
                style={{ flex: 1 }}
                onPress={handleVerifyPhone}
                loading={savingField === "phone"}
                disabled={savingField === "phone"}
              />
            </View>
          </View>
        </View>
      )}

      {/* Re-auth sheet */}
      {showReauth && (
        <View style={styles.modalOverlay}>
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <View style={styles.modalIcon}>
              <Ionicons name="lock-closed" size={28} color={COLORS.midnight} />
            </View>
            <Text style={[TYPE.heading, { textAlign: "center" }]}>Verify Identity</Text>
            <Text style={styles.modalSubtitle}>
              For security reasons, please re-enter your current password to change your email address.
            </Text>
            <Field
              value={reauthPassword}
              onChangeText={setReauthPassword}
              placeholder="Current password"
              secureTextEntry
              autoFocus
            />
            <View style={styles.modalActions}>
              <Button
                title="Cancel"
                variant="secondary"
                style={{ flex: 1 }}
                onPress={() => {
                  setShowReauth(false);
                  setReauthPassword("");
                  setReauthCallback(null);
                }}
              />
              <Button title="Verify" style={{ flex: 1 }} onPress={handleReauthenticate} />
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
    backgroundColor: COLORS.surface,
  },

  // Photo
  photoSection: {
    alignItems: "center",
    paddingVertical: SPACE[6],
  },
  cameraBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.midnight,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
    borderColor: COLORS.surface,
  },

  fieldLabel: { fontSize: 13, fontWeight: "700", color: COLORS.inkSoft, marginBottom: SPACE[2] },
  saveBtn: { alignSelf: "flex-start", marginBottom: SPACE[4] },

  // Re-auth sheet
  modalOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.overlay,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SPACE[5],
    paddingTop: SPACE[3],
    paddingBottom: SPACE[8],
    ...SHADOW.sheet,
  },
  grabber: {
    width: 44, height: 5, borderRadius: 3, backgroundColor: COLORS.lineStrong,
    alignSelf: "center", marginBottom: SPACE[4],
  },
  modalIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.lime,
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "center",
    marginBottom: SPACE[4],
  },
  modalSubtitle: {
    ...TYPE.small,
    textAlign: "center",
    marginTop: SPACE[2],
    marginBottom: SPACE[5],
  },
  modalActions: {
    flexDirection: "row",
    gap: SPACE[3],
  },
});
