import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { Alert } from "../../components/ui/alert";
import { Ionicons } from "@expo/vector-icons";
import { auth, db } from "../../config/firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { ensureDriverProfile, ensureRiderProfile } from "../../utils/modeSwitch";
import {
  COLORS,
  RADIUS,
  SHADOW,
  SPACE,
  TYPE,
  Button,
  Footer,
  Screen,
  ScreenHeader,
} from '../../components/ui/kit';
import { confirmLeaveSignup } from "../../utils/leaveSignup";

/* One of the two ways to use the app. Selected: pale lime with a midnight
   edge, and the icon sits in a midnight circle drawn in lime. */
function RoleCard({ icon, title, subtitle, selected, onPress }) {
  return (
    <TouchableOpacity
      style={[styles.optionCard, selected && styles.selectedCard]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="radio"
      accessibilityState={{ selected: !!selected }}
    >
      <View style={[styles.optionIcon, selected && styles.optionIconSelected]}>
        <Ionicons name={icon} size={28} color={selected ? COLORS.lime : COLORS.midnight} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.optionTitle}>{title}</Text>
        <Text style={styles.optionSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons
        name={selected ? "checkmark-circle" : "ellipse-outline"}
        size={26}
        color={selected ? COLORS.midnight : COLORS.lineStrong}
      />
    </TouchableOpacity>
  );
}

export default function SelectUserTypeScreen({
  setUserRole,
  setRiderOnboardingStatus,
}) {
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);

const handleContinue = async () => {
  if (!selected) {
    Alert.alert("Selection Required", "Please select an option to continue.");
    return;
  }

  try {
    setLoading(true);

    const user = auth.currentUser;

    if (!user) {
      throw new Error("User not authenticated");
    }

    const uid = user.uid;
    const userRef = doc(db, "users", uid);

    // Role-specific setup first. These are the same helpers the account
    // screens use when someone switches mode later, so a passenger record
    // always comes with a Stripe customer however it was created.
    if (selected === "driver") {
      await ensureDriverProfile(uid);
    } else {
      await ensureRiderProfile(uid);
    }

    // Then save the starting mode — App.js's listener picks this up. It is not
    // a permanent choice: either mode can be added later from Account.
    await setDoc(
      userRef,
      {
        role: selected,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    // ================================
    // 🔥 STATE UPDATES
    // ================================
    setUserRole(selected);

    if (selected === "rider" && setRiderOnboardingStatus) {
      setRiderOnboardingStatus("profile");
    }

  } catch (error) {
    console.log("handleContinue ERROR:", error);

    Alert.alert(
      "Error",
      error.message || "Something went wrong. Please try again."
    );
  } finally {
    setLoading(false);
  }
};

  return (
    <Screen scroll={false}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          title="How would you like to use TakeARoute?"
          subtitle="You can add the other later from your account."
          onBack={confirmLeaveSignup}
        />

        <View style={styles.options}>
          <RoleCard
            icon="car-sport"
            title="Driver"
            subtitle="Earn on your schedule"
            selected={selected === "driver"}
            onPress={() => setSelected("driver")}
          />
          <RoleCard
            icon="person"
            title="Passenger"
            subtitle="Book a ride instantly"
            selected={selected === "rider"}
            onPress={() => setSelected("rider")}
          />
        </View>
      </ScrollView>

      <Footer>
        <Button
          title="Continue"
          onPress={handleContinue}
          disabled={!selected}
          loading={loading}
        />
      </Footer>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: SPACE[5], paddingBottom: SPACE[8] },
  options: { marginTop: SPACE[6], gap: SPACE[4] },
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE[4],
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    borderWidth: 2,
    borderColor: COLORS.white,
    padding: SPACE[5],
    ...SHADOW.card,
  },
  selectedCard: {
    backgroundColor: COLORS.limeSoft,
    borderColor: COLORS.midnight,
  },
  optionIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.fill,
    alignItems: "center",
    justifyContent: "center",
  },
  optionIconSelected: { backgroundColor: COLORS.midnight },
  optionTitle: { ...TYPE.heading },
  optionSubtitle: { ...TYPE.small, marginTop: 2 },
});
