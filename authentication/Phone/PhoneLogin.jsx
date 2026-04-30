import React, { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FirebaseRecaptchaVerifierModal } from "expo-firebase-recaptcha";
import { PhoneAuthProvider } from "firebase/auth";
import { auth } from "../../config/firebase";
import app from "../../config/firebase";

export default function PhoneLoginScreen({ navigation, setUserRole, setRiderOnboardingStatus, setDriverOnboardingStatus }) {

  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const recaptchaVerifier = useRef(null);

 const handleContinue = async () => {
    if (phone.length !== 10) {
      Alert.alert("Invalid Number", "Please enter a valid 10-digit phone number (without the leading 0).");
      return;
    }

    const fullPhone = `+92${phone}`;
    setLoading(true);

    try {
      const phoneProvider = new PhoneAuthProvider(auth);
      const verificationId = await phoneProvider.verifyPhoneNumber(fullPhone, recaptchaVerifier.current);

      // ✅ Forward the same props email screen uses
      navigation.navigate("VerifyPhone", {
        phone: fullPhone,
        verificationId,
        setUserRole,
        setRiderOnboardingStatus,
        setDriverOnboardingStatus,
      });
    } catch (error) {
      console.log("Phone auth error:", error);
      Alert.alert("Error", error.message || "Failed to send code. Please try again.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <SafeAreaView style={styles.container}>
      <FirebaseRecaptchaVerifierModal
        ref={recaptchaVerifier}
        firebaseConfig={app.options}
        attemptInvisibleVerification={true}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.innerContainer}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={28} color="#111827" />
        </TouchableOpacity>

        <Text style={styles.title}>Enter your phone number</Text>
        <Text style={styles.subtitle}>
          We will send a code to verify your account
        </Text>

        <View style={styles.inputContainer}>
          {/* UK Flag */}
          <Image
            source={{ uri: "https://flagcdn.com/w40/gb.png" }}
            style={styles.flag}
          />
          
          <Text style={styles.countryCode}>+92</Text>
          <TextInput
            style={styles.input}
            placeholder="7700 900 123"
            placeholderTextColor="#9ca3af"
            keyboardType="number-pad"
            maxLength={10}
            value={phone}
            onChangeText={setPhone}
          />
        </View>

        <Text style={styles.hint}>Enter your number without the leading 0</Text>

        <View style={{ flex: 1 }} />

        <TouchableOpacity
          style={[styles.button, (loading || phone.length !== 10) && { opacity: 0.5 }]}
          onPress={handleContinue}
          disabled={loading || phone.length !== 10}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Send a Verification Code</Text>
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
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 12,
    paddingHorizontal: 15,
    height: 60,
  },
  flag: { width: 32, height: 20, marginRight: 10, resizeMode: "contain" },
  countryCode: { fontSize: 18, fontWeight: "bold", color: "#111827", marginRight: 10 },
  input: { flex: 1, fontSize: 18, color: "#111827" },
  hint: { fontSize: 13, color: "#9ca3af", marginTop: 8, marginLeft: 4 },
  button: {
    backgroundColor: "#79B531",
    paddingVertical: 20,
    borderRadius: 30,
    alignItems: "center",
    marginBottom: 15,
  },
  buttonText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
});