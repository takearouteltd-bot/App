import React, { useEffect, useRef, useState } from "react";
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
import nativeAuth from "@react-native-firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { signInWithCustomToken } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "../../config/firebase";
import {
  clearConfirmation,
  getConfirmation,
  setConfirmation,
} from "../../store/phoneAuthStore";

const PRIMARY = "#79B531";
const DARK = "#111827";

const EMPTY_OTP = ["", "", "", "", "", ""];

const describeError = (error) => {
  const code = error?.code || "";
  if (code === "auth/invalid-verification-code") {
    return "That verification code is incorrect. Please try again.";
  }
  if (code === "auth/code-expired" || code === "auth/session-expired") {
    return "The code has expired. Please request a new one.";
  }
  if (code.startsWith("functions/") || code === "auth/network-request-failed") {
    return "We verified your number but couldn't complete sign-in. Please check your internet connection and tap Verify again.";
  }
  return error?.message || "Verification failed. Please try again.";
};

export default function VerifyPhone({ navigation, route }) {
  const phone = route.params?.phone || "";
  const [otp, setOtp] = useState(EMPTY_OTP);
  const [timer, setTimer] = useState(60);
  const [resendEnabled, setResendEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRefs = useRef([]);
  const handledRef = useRef(false);

  useEffect(() => {
    const stored = getConfirmation();
    if (!stored?.verificationId && !nativeAuth().currentUser) {
      Alert.alert("Session Expired", "Please request a new verification code.");
      navigation.goBack();
    }
  }, [navigation]);

  useEffect(() => {
    if (timer === 0) {
      setResendEnabled(true);
      return;
    }
    const interval = setInterval(() => setTimer((prev) => prev - 1), 1000);
    return () => clearInterval(interval);
  }, [timer]);

  // Bridges the verified NATIVE session to the JS SDK (which the rest of the
  // app observes). Existing users are routed automatically by the auth
  // listener in App.js; only new/role-less users need SelectUserType.
  const completeSignIn = async (nativeUser) => {
    const idToken = await nativeUser.getIdToken();
    const exchangeToken = httpsCallable(functions, "exchangePhoneAuthToken");
    const { data } = await exchangeToken({ idToken });
    const userCredential = await signInWithCustomToken(auth, data.token);

    // Native session was only needed for the OTP handshake.
    await nativeAuth().signOut();
    clearConfirmation();

    const uid = userCredential.user.uid;
    const userRef = doc(db, "users", uid);
    const userDoc = await getDoc(userRef);

    if (!userDoc.exists()) {
      await setDoc(userRef, {
        phone,
        role: null,
        createdAt: serverTimestamp(),
      });
    }
    if (!userDoc.exists() || !userDoc.data().role) {
      navigation.replace("SelectUserType");
    }
  };

  // Android can verify the number silently (instant verification / SMS
  // auto-retrieval): the native SDK signs in without a code being typed.
  useEffect(() => {
    const unsubscribe = nativeAuth().onAuthStateChanged(async (user) => {
      if (!user || handledRef.current) return;
      handledRef.current = true;
      setLoading(true);
      try {
        await completeSignIn(user);
      } catch (error) {
        handledRef.current = false;
        console.log("Auto verification error:", error);
        Alert.alert("Verification Failed", describeError(error));
      } finally {
        setLoading(false);
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (text, index) => {
    const digits = text.replace(/\D/g, "");

    // Pasted or auto-filled full code
    if (digits.length >= 6) {
      setOtp(digits.slice(0, 6).split(""));
      inputRefs.current[5]?.focus();
      return;
    }
    const next = [...otp];
    // Typing into a filled box replaces its digit with the new one
    next[index] = digits.length > 1 ? digits[digits.length - 1] : digits;
    setOtp(next);
    if (digits && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handleKeyPress = (e, index) => {
    if (e.nativeEvent.key === "Backspace" && !otp[index] && index > 0) {
      const next = [...otp];
      next[index - 1] = "";
      setOtp(next);
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    const code = otp.join("");
    if (code.length !== 6 && !nativeAuth().currentUser) {
      Alert.alert("Invalid Code", "Please enter the full 6-digit verification code.");
      return;
    }

    setLoading(true);
    handledRef.current = true;
    try {
      // If a previous attempt verified the code but failed later (e.g. lost
      // connection), the native user already exists — skip re-confirming.
      let user = nativeAuth().currentUser;
      if (!user) {
        const confirmationData = getConfirmation();
        if (!confirmationData?.verificationId) {
          Alert.alert("Session Expired", "Please request a new verification code.");
          navigation.goBack();
          return;
        }
        const credential = nativeAuth.PhoneAuthProvider.credential(
          confirmationData.verificationId,
          code
        );
        ({ user } = await nativeAuth().signInWithCredential(credential));
      }
      await completeSignIn(user);
    } catch (error) {
      handledRef.current = false;
      console.log("OTP verification error:", error);
      Alert.alert("Verification Failed", describeError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!resendEnabled || !phone) return;

    setLoading(true);
    try {
      const confirmation = await nativeAuth().signInWithPhoneNumber(phone, true);
      setConfirmation({
        verificationId: confirmation.verificationId,
        phoneNumber: phone,
      });
      setOtp(EMPTY_OTP);
      setTimer(60);
      setResendEnabled(false);
      Alert.alert("Code Sent", "A new verification code has been sent.");
    } catch (error) {
      console.log("Resend error:", error);
      Alert.alert(
        "Resend Failed",
        error?.message || "Failed to resend code. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.innerContainer}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={28} color={DARK} />
        </TouchableOpacity>

        <Text style={styles.title}>Enter Verification Code</Text>
        <Text style={styles.subtitle}>We sent a 6-digit code to {phone}</Text>

        <View style={styles.otpContainer}>
          {otp.map((digit, index) => (
            <TextInput
              key={index}
              ref={(ref) => {
                inputRefs.current[index] = ref;
              }}
              style={[styles.otpInput, digit !== "" && styles.otpInputFilled]}
              keyboardType="number-pad"
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
              value={digit}
              onChangeText={(text) => handleChange(text, index)}
              onKeyPress={(e) => handleKeyPress(e, index)}
            />
          ))}
        </View>

        <TouchableOpacity
          style={[styles.resendBtn, (!resendEnabled || loading) && { opacity: 0.5 }]}
          disabled={!resendEnabled || loading}
          onPress={handleResend}
        >
          <Text style={styles.resendText}>
            {resendEnabled
              ? "Resend Code"
              : `Resend Code (0:${timer < 10 ? `0${timer}` : timer})`}
          </Text>
        </TouchableOpacity>

        <View style={{ flex: 1 }} />

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
  title: { fontSize: 34, fontWeight: "bold", color: DARK, marginBottom: 10 },
  subtitle: { fontSize: 16, color: "#6b7280", marginBottom: 40, lineHeight: 22 },
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
    color: DARK,
  },
  otpInputFilled: {
    borderColor: PRIMARY,
    backgroundColor: "#f0fce8",
  },
  resendBtn: { alignSelf: "center", marginBottom: 30 },
  resendText: { color: DARK, fontWeight: "bold", fontSize: 14 },
  button: {
    backgroundColor: PRIMARY,
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 30,
  },
  buttonText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
});
