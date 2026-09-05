import React, { useMemo, useRef, useState } from "react";
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
import { setConfirmation } from "../../store/phoneAuthStore";

const PRIMARY = "#79B531";
const DARK = "#111827";

const UK_DIAL_CODE = "+44";
const UK_LOCAL_LENGTH = 10; // UK mobile: 7xxxxxxxxx (the leading 0 is dropped)

// Keep only digits, drop a leading 0 (UK users type 07..., E.164 omits it),
// and cap at the UK subscriber-number length so typing/pasting stays smooth.
const sanitizeLocal = (value) => {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.replace(/^0+/, "");
  return digits.slice(0, UK_LOCAL_LENGTH);
};

// Light "7700 900123" grouping purely for display.
const formatLocal = (digits) => {
  if (digits.length <= 4) return digits;
  return `${digits.slice(0, 4)} ${digits.slice(4)}`;
};

export default function PhoneLoginScreen({ navigation }) {
  const [local, setLocal] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  const fullNumber = useMemo(() => `${UK_DIAL_CODE}${local}`, [local]);
  const canSubmit = local.length === UK_LOCAL_LENGTH;

  const handleChange = (text) => setLocal(sanitizeLocal(text));

  const handleContinue = async () => {
    if (!canSubmit) {
      Alert.alert(
        "Invalid Number",
        "Enter your 10-digit UK mobile number after +44 (for example 7700 900123)."
      );
      return;
    }

    setLoading(true);
    try {
      const confirmation = await nativeAuth().signInWithPhoneNumber(fullNumber);
      setConfirmation({
        verificationId: confirmation.verificationId,
        phoneNumber: fullNumber,
      });

      navigation.navigate("VerifyPhone", { phone: fullNumber });
    } catch (error) {
      console.log("Phone auth error:", error);
      Alert.alert(
        "Verification Failed",
        error?.message || "Failed to send verification code. Please try again."
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

        <Text style={styles.title}>Enter your phone number</Text>
        <Text style={styles.subtitle}>
          We will send a verification code to sign you in.
        </Text>

        <TouchableOpacity
          activeOpacity={1}
          style={styles.inputContainer}
          onPress={() => inputRef.current?.focus()}
        >
          <View style={styles.prefix}>
            <Text style={styles.flag}>🇬🇧</Text>
            <Text style={styles.prefixText}>{UK_DIAL_CODE}</Text>
          </View>
          <View style={styles.divider} />
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="7700 900123"
            placeholderTextColor="#9ca3af"
            keyboardType="number-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            value={formatLocal(local)}
            onChangeText={handleChange}
            autoFocus
            maxLength={12}
          />
        </TouchableOpacity>

        <Text style={styles.hint}>
          UK mobile numbers only. Enter the number after +44 without the leading 0.
        </Text>

        <View style={{ flex: 1 }} />

        <TouchableOpacity
          style={[styles.button, (!canSubmit || loading) && styles.buttonDisabled]}
          onPress={handleContinue}
          disabled={!canSubmit || loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Send Verification Code</Text>
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
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 12,
    paddingHorizontal: 15,
    height: 60,
  },
  prefix: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  flag: { fontSize: 20 },
  prefixText: { fontSize: 18, fontWeight: "600", color: DARK },
  divider: {
    width: 1,
    height: 28,
    backgroundColor: "#d1d5db",
    marginHorizontal: 12,
  },
  input: { flex: 1, fontSize: 18, color: DARK, letterSpacing: 0.5 },
  hint: { fontSize: 13, color: "#9ca3af", marginTop: 8, marginLeft: 4 },
  button: {
    backgroundColor: PRIMARY,
    paddingVertical: 20,
    borderRadius: 30,
    alignItems: "center",
    marginBottom: 15,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
});
