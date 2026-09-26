import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { db, auth } from "../../config/firebase";
import { Alert } from "../../components/ui/alert";
import { COLORS, Field, RADIUS, SPACE, TYPE } from "../../components/ui/kit";
import { ConsentRow, OnboardingFrame, StepSection } from "../../components/onboarding/kit";
import { openTerms } from "../../utils/legal";

// UK sort code: 6 digits shown as XX-XX-XX.
const isValidSortCode = (value) => /^\d{2}-\d{2}-\d{2}$/.test(value);
// UK account numbers are 8 digits; a few older ones have 7 and are written
// with a leading 0.
const isValidAccountNumber = (value) => /^\d{8}$/.test(value);

export default function PayoutDetailsScreen({ navigation }) {
  const [driverId, setDriverId] = useState(null);

  const [accountHolder, setAccountHolder] = useState("");
  const [sortCode, setSortCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);

  // Auto-format sort code as XX-XX-XX (dash after every 2 digits).
  const handleSortCodeChange = (text) => {
    const digits = text.replace(/\D/g, "").slice(0, 6);
    const parts = digits.match(/.{1,2}/g) || [];
    setSortCode(parts.join("-"));
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) setDriverId(user.uid);
    });
    return () => unsubscribe();
  }, []);

  // Bring back what they entered before, if they return to this step.
  useEffect(() => {
    if (!driverId) return;
    getDoc(doc(db, "drivers", driverId))
      .then((snap) => {
        const saved = snap.exists() ? snap.data().accountDetails : null;
        if (!saved) return;
        setAccountHolder(saved.accountHolder || "");
        setSortCode(saved.sortCode || "");
        setAccountNumber(saved.accountNumber || "");
        setAcceptedTerms(!!saved.acceptedTerms);
      })
      .catch(() => {});
  }, [driverId]);

  const errors = {
    accountHolder: !accountHolder.trim() ? "Enter the name on the account" : null,
    sortCode: !isValidSortCode(sortCode) ? "Six digits, e.g. 12-34-56" : null,
    accountNumber: !isValidAccountNumber(accountNumber)
      ? "Eight digits. If yours has seven, add a 0 at the start."
      : null,
  };
  const show = (key) => (tried ? errors[key] : null);

  const handleContinue = async () => {
    if (!driverId) {
      Alert.alert("Not signed in", "Please sign in again to continue.");
      return;
    }
    setTried(true);

    const firstError = Object.values(errors).find(Boolean);
    if (firstError) {
      Alert.alert("Check your bank details", firstError);
      return;
    }
    if (!acceptedTerms) {
      Alert.alert("One more thing", "Please accept the payout terms to continue.");
      return;
    }

    setSaving(true);
    try {
      await updateDoc(doc(db, "drivers", driverId), {
        accountDetails: {
          accountHolder: accountHolder.trim(),
          sortCode,
          accountNumber,
          acceptedTerms,
          updatedAt: new Date(),
        },
        onboardingStep: 5,
        onboardingComplete: false,
      });

      navigation.navigate("FinalReview");
    } catch (error) {
      console.log("Error saving payout details:", error);
      Alert.alert("Could not save", "Your bank details were not saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <OnboardingFrame
      step={4}
      title="Where should we pay you?"
      subtitle="Your earnings go straight to this UK bank account when you withdraw."
      action={{ title: "Continue", onPress: handleContinue, loading: saving, icon: "arrow-forward" }}
    >
      <View style={styles.secure}>
        <Ionicons name="shield-checkmark" size={18} color={COLORS.success} />
        <Text style={styles.secureText}>Encrypted and only used to pay you</Text>
      </View>

      <StepSection title="Bank account">
        <Field
          label="Name on the account"
          value={accountHolder}
          onChangeText={setAccountHolder}
          placeholder="Jane Smith"
          autoCapitalize="words"
          error={show("accountHolder")}
        />
        <View style={styles.row}>
          <Field
            label="Sort code"
            value={sortCode}
            onChangeText={handleSortCodeChange}
            placeholder="12-34-56"
            keyboardType="number-pad"
            maxLength={8}
            error={show("sortCode")}
            style={styles.sort}
          />
          <Field
            label="Account number"
            value={accountNumber}
            onChangeText={(t) => setAccountNumber(t.replace(/\D/g, "").slice(0, 8))}
            placeholder="12345678"
            keyboardType="number-pad"
            maxLength={8}
            error={show("accountNumber")}
            style={styles.account}
          />
        </View>
      </StepSection>

      <ConsentRow
        checked={acceptedTerms}
        onToggle={() => setAcceptedTerms((v) => !v)}
        text="I accept the "
        link={{ label: "payout terms and conditions", onPress: openTerms }}
      />
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  secure: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE[2],
    alignSelf: "flex-start",
    backgroundColor: COLORS.limeSoft,
    paddingHorizontal: SPACE[3],
    paddingVertical: SPACE[2],
    borderRadius: RADIUS.pill,
    marginBottom: SPACE[5],
  },
  secureText: { ...TYPE.small, color: COLORS.success, fontWeight: "700" },
  row: { flexDirection: "row", gap: SPACE[3] },
  sort: { width: 130 },
  account: { flex: 1 },
});
