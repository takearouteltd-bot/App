import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Alert } from "../../components/ui/alert";
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
import {
  COLORS,
  RADIUS,
  SPACE,
  TYPE,
  Button,
  Footer,
  Screen,
  ScreenHeader,
} from '../../components/ui/kit';

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
  const [focusedIndex, setFocusedIndex] = useState(-1);
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

  const complete = otp.every((d) => d !== "");

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <View style={styles.body}>
          <ScreenHeader
            title="Enter Verification Code"
            subtitle={`We sent a 6-digit code to ${phone}`}
            onBack={() => navigation.goBack()}
          />

          {/* Six boxes, one digit each. Hand-built: the kit's Field is one
              input, and this needs six that hand focus along. */}
          <View style={styles.otpContainer}>
            {otp.map((digit, index) => (
              <TextInput
                key={index}
                ref={(ref) => {
                  inputRefs.current[index] = ref;
                }}
                style={[
                  styles.otpInput,
                  (digit !== "" || focusedIndex === index) && styles.otpInputActive,
                  complete && styles.otpInputComplete,
                ]}
                keyboardType="number-pad"
                autoComplete="sms-otp"
                textContentType="oneTimeCode"
                selectionColor={COLORS.midnight}
                value={digit}
                onChangeText={(text) => handleChange(text, index)}
                onKeyPress={(e) => handleKeyPress(e, index)}
                onFocus={() => setFocusedIndex(index)}
                onBlur={() => setFocusedIndex((i) => (i === index ? -1 : i))}
                accessibilityLabel={`Digit ${index + 1} of 6`}
              />
            ))}
          </View>

          <TouchableOpacity
            style={[styles.resendBtn, (!resendEnabled || loading) && { opacity: 0.5 }]}
            disabled={!resendEnabled || loading}
            onPress={handleResend}
            accessibilityRole="button"
          >
            <Text style={styles.resendText}>
              {resendEnabled
                ? "Resend Code"
                : `Resend Code (0:${timer < 10 ? `0${timer}` : timer})`}
            </Text>
          </TouchableOpacity>
        </View>

        <Footer>
          <Button title="Verify & Continue" onPress={handleVerify} loading={loading} />
        </Footer>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: SPACE[5] },
  otpContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: SPACE[6],
    marginBottom: SPACE[5],
  },
  otpInput: {
    width: 48,
    height: 58,
    borderWidth: 1.5,
    borderColor: COLORS.fill,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.fill,
    textAlign: "center",
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.midnight,
  },
  otpInputActive: {
    borderColor: COLORS.midnight,
    backgroundColor: COLORS.white,
  },
  otpInputComplete: {
    borderColor: COLORS.midnight,
    backgroundColor: COLORS.limeSoft,
  },
  resendBtn: { alignSelf: "center", paddingVertical: SPACE[2], paddingHorizontal: SPACE[4] },
  resendText: { ...TYPE.callout, color: COLORS.midnight },
});
