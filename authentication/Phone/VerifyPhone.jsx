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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function VerifyPhone({ navigation, route }) {
  const { phone } = route.params;
  const [otp, setOtp] = useState(["", "", "", ""]);
  const [timer, setTimer] = useState(60);
  const [resendEnabled, setResendEnabled] = useState(false);

  const inputRefs = [];

  // Timer countdown
  useEffect(() => {
    if (timer === 0) {
      setResendEnabled(true);
      return;
    }

    const interval = setInterval(() => {
      setTimer((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [timer]);

  const handleChange = (text, index) => {
    if (/^\d?$/.test(text)) {
      const newOtp = [...otp];
      newOtp[index] = text;
      setOtp(newOtp);

      // Auto-focus next input
      if (text && index < 3) inputRefs[index + 1].focus();
      // Auto-focus previous input on delete
      if (!text && index > 0) inputRefs[index - 1].focus();
    }
  };

  const handleVerify = () => {
    if (otp.some((digit) => digit === "")) {
      alert("Please enter the complete 4-digit code");
      return;
    }
    const verificationCode = otp.join("");
    console.log("Entered OTP:", verificationCode);
    navigation.navigate("SelectUserType");
  };

  const handleResend = () => {
    setTimer(60);
    setResendEnabled(false);
    alert(`A new verification code has been sent to ${phone}`);
    // Here you can call API to resend OTP
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
        <Text style={styles.subtitle}>We sent a 4-digit code to {phone}</Text>

        {/* OTP Inputs */}
        <View style={styles.otpContainer}>
          {otp.map((digit, index) => (
            <TextInput
              key={index}
              ref={(ref) => (inputRefs[index] = ref)}
              style={styles.otpInput}
              keyboardType="number-pad"
              maxLength={1}
              value={digit}
              onChangeText={(text) => handleChange(text, index)}
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

        {/* Spacer */}
        <View style={{ flex: 1 }} />

        {/* Verify Button */}
        <TouchableOpacity style={styles.button} onPress={handleVerify}>
          <Text style={styles.buttonText}>Send Verification Code</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  innerContainer: {
    flex: 1,
    paddingHorizontal: 25,
    paddingTop: 20,
  },
  backBtn: {
    marginBottom: 30,
  },
  title: {
    fontSize: 36,
    fontWeight: "bold",
    color: "#111827",
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: "#6b7280",
    marginBottom: 40,
  },
  otpContainer: {
    flexDirection: "row",
    justifyContent: "center",
    marginBottom: 20,
  },
  otpInput: {
    width: 60,
    height: 60,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 12,
    textAlign: "center",
    fontSize: 24,
    fontWeight: "bold",
    color: "#111827",
    marginHorizontal: 8,
  },
  resendBtn: {
    alignSelf: "center",
    marginBottom: 30,
  },
  resendText: {
    color: "black",
    fontWeight: "bold",
    fontSize: 14,
  },
  button: {
    backgroundColor: "#79B531",
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 30,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
});
