import React, { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "../../config/firebase";
import { Alert } from "../../components/ui/alert";
import { Banner, COLORS, RADIUS, SPACE, TYPE } from "../../components/ui/kit";
import { ConsentRow, DRIVER_STEPS, OnboardingFrame, StepSection } from "../../components/onboarding/kit";
import { openPrivacy, openTerms } from "../../utils/legal";

// What each earlier step needs before the application can go in.
const CHECKS = [
  {
    step: 1,
    ok: (d) => !!(d.firstName && d.lastName && d.dob && d.nin && d.address),
    summary: (d) => d.fullName || [d.firstName, d.lastName].filter(Boolean).join(" "),
  },
  {
    step: 2,
    ok: (d) =>
      !!(
        (d.driverLicenseFrontUrl || d.driverLicenseUrl) &&
        (d.driverLicenseBackUrl || d.driverLicenseUrl) &&
        d.pcoLicenseUrl &&
        d.selfieUrl
      ),
    summary: () => "Licence, PCO licence and selfie",
  },
  {
    step: 3,
    ok: (d) => !!(d.makeModel && d.registrationNumber && d.vehicleType && d.motUrl && d.insuranceUrl),
    summary: (d) => [d.makeModel, d.registrationNumber].filter(Boolean).join(" · "),
  },
  {
    step: 4,
    ok: (d) =>
      !!(d.accountDetails?.accountHolder && d.accountDetails?.sortCode && d.accountDetails?.accountNumber),
    summary: (d) =>
      d.accountDetails?.accountNumber
        ? `Account ending ${String(d.accountDetails.accountNumber).slice(-4)}`
        : "",
  },
];

export default function ApplicationSummaryScreen({ navigation, setOnboardingStatus }) {
  const [driver, setDriver] = useState(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [gdprAccepted, setGdprAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const driverId = auth.currentUser?.uid;

  // Reload whenever this step comes into view, so fixing something on an
  // earlier step is reflected when they come back.
  useEffect(() => {
    if (!driverId) return undefined;
    const load = () =>
      getDoc(doc(db, "drivers", driverId))
        .then((snap) => setDriver(snap.exists() ? snap.data() : {}))
        .catch((error) => console.log("Error fetching application summary:", error));
    load();
    return navigation.addListener("focus", load);
  }, [driverId, navigation]);

  const results = CHECKS.map((c) => ({ ...c, done: driver ? c.ok(driver) : false }));
  const allDone = results.every((r) => r.done);

  const handleSubmit = async () => {
    const firstGap = results.find((r) => !r.done);
    if (firstGap) {
      Alert.alert(
        "Something's missing",
        `Please finish "${DRIVER_STEPS[firstGap.step - 1].label}" before submitting.`,
        [
          { text: "Later", style: "cancel" },
          { text: "Go there", onPress: () => navigation.navigate(DRIVER_STEPS[firstGap.step - 1].route) },
        ]
      );
      return;
    }
    if (!termsAccepted || !gdprAccepted) {
      Alert.alert("One more thing", "Please accept the terms and the data consent before submitting.");
      return;
    }

    setSubmitting(true);
    try {
      if (driverId) {
        await updateDoc(doc(db, "drivers", driverId), {
          onboardingComplete: true,
          onboardingStatus: "pending", // Admin approves or rejects from the dashboard
          approved: false,
          updatedAt: new Date(),
        });
      }

      // Moves the driver into the app, where they wait for approval.
      setOnboardingStatus("pending");
    } catch (error) {
      console.log("Error submitting application:", error);
      Alert.alert("Could not submit", "Your application was not sent. Check your connection and try again.");
      setSubmitting(false);
    }
  };

  return (
    <OnboardingFrame
      step={5}
      title="Check and submit"
      subtitle="Tap any section to change it. Once you submit, our team reviews your documents."
      action={{
        title: "Submit application",
        onPress: handleSubmit,
        loading: submitting,
        icon: "paper-plane",
      }}
    >
      <StepSection title="Your application">
        <View style={styles.list}>
          {results.map((r, i) => {
            const meta = DRIVER_STEPS[r.step - 1];
            const detail = r.done ? r.summary(driver || {}) : "Needs finishing";
            return (
              <TouchableOpacity
                key={r.step}
                style={[styles.item, i < results.length - 1 && styles.itemLine]}
                onPress={() => navigation.navigate(meta.route)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`${meta.label}, ${r.done ? "complete" : "incomplete"}. Tap to edit`}
              >
                <View style={[styles.itemIcon, r.done ? styles.itemIconDone : styles.itemIconTodo]}>
                  <Ionicons
                    name={r.done ? "checkmark" : meta.icon}
                    size={20}
                    color={r.done ? COLORS.white : COLORS.amber}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle}>{meta.label}</Text>
                  <Text
                    style={[styles.itemDetail, !r.done && { color: COLORS.amber }]}
                    numberOfLines={1}
                  >
                    {detail}
                  </Text>
                </View>
                <Text style={styles.edit}>Edit</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </StepSection>

      <StepSection title="Your consent">
        <ConsentRow
          checked={termsAccepted}
          onToggle={() => setTermsAccepted((v) => !v)}
          text="I agree to the "
          link={{ label: "Terms of use", onPress: openTerms }}
        />
        <ConsentRow
          checked={gdprAccepted}
          onToggle={() => setGdprAccepted((v) => !v)}
          text="I consent to TakeARoute processing my data to review my application, as set out in the "
          link={{ label: "Privacy policy", onPress: openPrivacy }}
        />
      </StepSection>

      {allDone ? (
        <Banner
          tone="success"
          title="Ready to submit"
          body="You can explore the app while your application is reviewed."
        />
      ) : (
        <Banner
          tone="warning"
          title="A few things left"
          body="Finish the sections marked above, then come back here to submit."
        />
      )}
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  list: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.line,
    paddingHorizontal: SPACE[4],
  },
  item: { flexDirection: "row", alignItems: "center", gap: SPACE[3], minHeight: 68, paddingVertical: SPACE[3] },
  itemLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.line },
  itemIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  itemIconDone: { backgroundColor: COLORS.primary },
  itemIconTodo: { backgroundColor: COLORS.amberSoft },
  itemTitle: { ...TYPE.callout, color: COLORS.navy },
  itemDetail: { ...TYPE.small, marginTop: 2 },
  edit: { ...TYPE.small, color: COLORS.blue, fontWeight: "700" },
});
