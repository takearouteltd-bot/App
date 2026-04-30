import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { PhoneAuthProvider, signInWithCredential } from "firebase/auth";
import { auth, db } from "../../config/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";

export default function VerifyPhone({ navigation, route }) {
  // Destructure the new props from route.params
const { phone, verificationId, setUserRole, setRiderOnboardingStatus, setDriverOnboardingStatus } = route.params;
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [timer, setTimer] = useState(60);
  const [resendEnabled, setResendEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  const inputRefs = [];

  // Timer countdown
  useEffect(() => {
    if (timer === 0) { setResendEnabled(true); return; }
    const interval = setInterval(() => setTimer(prev => prev - 1), 1000);
    return () => clearInterval(interval);
  }, [timer]);

  const handleChange = (text, index) => {
    if (/^\d?$/.test(text)) {
      const newOtp = [...otp];
      newOtp[index] = text;
      setOtp(newOtp);
      // Auto-focus next
      if (text && index < 5) inputRefs[index + 1].focus();
      // Auto-focus previous on delete
      if (!text && index > 0) inputRefs[index - 1].focus();
    }
  };

  // Replace just the handleVerify function
const handleVerify = async () => {
  const code = otp.join("");
  if (code.length < 6) {
    Alert.alert("Invalid Code", "Please enter the complete 6-digit code.");
    return;
  }

  setLoading(true);
  try {
    const credential = PhoneAuthProvider.credential(verificationId, code);
    const userCredential = await signInWithCredential(auth, credential);
    const uid = userCredential.user.uid;

    // 🔥 Check if user doc exists (new vs returning)
    const userDoc = await getDoc(doc(db, "users", uid));

    if (!userDoc.exists()) {
      // 🆕 First time phone login — create user doc
      await setDoc(doc(db, "users", uid), {
        phone,
        role: null,
        createdAt: new Date(),
      });
      navigation.navigate("SelectUserType");
      return;
    }

    const userData = userDoc.data();
    const role = userData.role;

    // 🚨 Role not selected yet
    if (!role) {
      navigation.navigate("SelectUserType");
      return;
    }

    setUserRole(role);

    // ✅ RIDER FLOW
    if (role === "rider") {
      const riderDoc = await getDoc(doc(db, "riders", uid));
      if (riderDoc.exists()) {
        const data = riderDoc.data();
        if (!data.fullName) {
          setRiderOnboardingStatus("profile");
        } else if (!data.locationEnabled) {
          setRiderOnboardingStatus("location");
        } else {
          setRiderOnboardingStatus("complete");
        }
      } else {
        setRiderOnboardingStatus("profile");
      }
    }

    // ✅ DRIVER FLOW
    if (role === "driver") {
      const driverDoc = await getDoc(doc(db, "drivers", uid));
      if (driverDoc.exists()) {
        const data = driverDoc.data();
        if (data.onboardingComplete) {
          setDriverOnboardingStatus("complete");
        } else {
          setDriverOnboardingStatus("onboarding");
        }
      } else {
        setDriverOnboardingStatus("onboarding");
      }
    }
  } catch (error) {
    console.log("OTP error:", error);
    let message = "The code you entered is incorrect. Please try again.";
    if (error.code === "auth/code-expired") {
      message = "The code has expired. Please go back and request a new one.";
    }
    Alert.alert("Invalid Code", message);
  } finally {
    setLoading(false);
  }
};

  const handleResend = () => {
    setTimer(60);
    setResendEnabled(false);
    Alert.alert("Resend Code", "Go back and request a new code.");
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.innerContainer}
      >
        {/* Back Button */}
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={28} color="#111827" />
        </TouchableOpacity>

        {/* Title & Subtitle */}
        <Text style={styles.title}>Enter Verification Code</Text>
        <Text style={styles.subtitle}>We sent a 6-digit code to {phone}</Text>

        {/* OTP Inputs - 6 boxes */}
        <View style={styles.otpContainer}>
          {otp.map((digit, index) => (
            <TextInput
              key={index}
              ref={ref => (inputRefs[index] = ref)}
              style={[
                styles.otpInput,
                digit !== "" && styles.otpInputFilled,
              ]}
              keyboardType="number-pad"
              maxLength={1}
              value={digit}
              onChangeText={text => handleChange(text, index)}
            />
          ))}
        </View>

        {/* Resend Code */}
        <TouchableOpacity
          style={[styles.resendBtn, !resendEnabled && { opacity: 0.5 }]}
          disabled={!resendEnabled}
          onPress={handleResend}
        >
          <Text style={styles.resendText}>
            {resendEnabled
              ? "Resend Code"
              : `Resend Code (0:${timer < 10 ? "0" + timer : timer})`}
          </Text>
        </TouchableOpacity>

        <View style={{ flex: 1 }} />

        {/* Verify Button */}
        <TouchableOpacity
          style={[styles.button, loading && { opacity: 0.7 }]}
          onPress={handleVerify}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Verify & Continue</Text>
          )}
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  innerContainer: { flex: 1, paddingHorizontal: 25, paddingTop: 20 },
  backBtn: { marginBottom: 30 },
  title: { fontSize: 36, fontWeight: "bold", color: "#111827", marginBottom: 10 },
  subtitle: { fontSize: 16, color: "#6b7280", marginBottom: 40 },

  otpContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  otpInput: {
    width: 48,
    height: 58,
    borderWidth: 1.5,
    borderColor: "#d1d5db",
    borderRadius: 12,
    textAlign: "center",
    fontSize: 22,
    fontWeight: "bold",
    color: "#111827",
  },
  otpInputFilled: {
    borderColor: "#79B531",
    backgroundColor: "#f0fce8",
  },

  resendBtn: { alignSelf: "center", marginBottom: 30 },
  resendText: { color: "black", fontWeight: "bold", fontSize: 14 },

  button: {
    backgroundColor: "#79B531",
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 30,
  },
  buttonText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
});