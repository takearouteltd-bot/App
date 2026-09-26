import React, { useMemo, useRef, useState } from "react";
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
import { setConfirmation } from "../../store/phoneAuthStore";
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
  const [focused, setFocused] = useState(false);
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
    <Screen scroll={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <View style={styles.body}>
          <ScreenHeader
            title="Enter your phone number"
            subtitle="New or returning, we text you a code. No password to remember, and no password to forget."
            onBack={() => navigation.goBack()}
          />

          {/* The phone field: a fixed +44 prefix, then the number. Hand-built
              because the kit's Field has no prefix slot. */}
          <TouchableOpacity
            activeOpacity={1}
            style={[styles.inputContainer, focused && styles.inputContainerFocused]}
            onPress={() => inputRef.current?.focus()}
            accessibilityRole="none"
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
              placeholderTextColor={COLORS.faint}
              selectionColor={COLORS.midnight}
              keyboardType="number-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              value={formatLocal(local)}
              onChangeText={handleChange}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              autoFocus
              maxLength={12}
            />
          </TouchableOpacity>

          <Text style={styles.hint}>
            UK mobile numbers only. Enter the number after +44 without the leading 0.
          </Text>
        </View>

        <Footer>
          <Button
            title="Send Verification Code"
            onPress={handleContinue}
            disabled={!canSubmit}
            loading={loading}
          />
        </Footer>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: SPACE[5] },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: COLORS.fill,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.fill,
    paddingHorizontal: SPACE[4],
    height: 60,
    marginTop: SPACE[6],
  },
  inputContainerFocused: { borderColor: COLORS.midnight, backgroundColor: COLORS.white },
  prefix: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  flag: { fontSize: 20 },
  prefixText: { fontSize: 18, fontWeight: "700", color: COLORS.midnight },
  divider: {
    width: 1,
    height: 28,
    backgroundColor: COLORS.lineStrong,
    marginHorizontal: SPACE[3],
  },
  input: { flex: 1, fontSize: 18, color: COLORS.ink, letterSpacing: 0.5 },
  hint: { ...TYPE.small, marginTop: SPACE[2], marginLeft: SPACE[1] },
});
