import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../../../config/firebase";

const PRIMARY = "#79B531";
const SECONDARY = "#235594";
const BG = "#F8F9FA";

export default function PreferencesScreen() {
  const navigation = useNavigation();
  const user = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [preferences, setPreferences] = useState({
    pushNotifications: false,
    emailNotifications: false,
    smsNotifications: false,
    marketingEmails: false,
    locationSharing: false,
  });

  useEffect(() => {
    loadPreferences();
  }, []);

  const loadPreferences = async () => {
    if (!user) return;

    try {
      const riderRef = doc(db, "riders", user.uid);
      const riderSnap = await getDoc(riderRef);

      if (riderSnap.exists()) {
        const data = riderSnap.data();
        setPreferences((prev) => ({
          ...prev,
          ...data.preferences,
        }));
      }
    } catch (error) {
      console.error("Error loading preferences:", error);
    } finally {
      setLoading(false);
    }
  };

  const togglePreference = async (key) => {
    const newValue = !preferences[key];
    setPreferences((prev) => ({ ...prev, [key]: newValue }));

    try {
      const riderRef = doc(db, "riders", user.uid);
      await updateDoc(riderRef, {
        [`preferences.${key}`]: newValue,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("Error saving preference:", error);
      // Revert on error
      setPreferences((prev) => ({ ...prev, [key]: !newValue }));
      Alert.alert("Error", "Failed to save preference");
    }
  };

  const PreferenceItem = ({ icon, title, subtitle, value, onToggle, danger }) => (
    <View style={styles.preferenceRow}>
      <View style={styles.preferenceLeft}>
        <View
          style={[
            styles.preferenceIcon,
            danger && { backgroundColor: "#FEE2E2" },
          ]}
        >
          <Ionicons
            name={icon}
            size={20}
            color={danger ? "#D32F2F" : PRIMARY}
          />
        </View>
        <View>
          <Text
            style={[styles.preferenceTitle, danger && { color: "#D32F2F" }]}
          >
            {title}
          </Text>
          {subtitle && (
            <Text style={styles.preferenceSubtitle}>{subtitle}</Text>
          )}
        </View>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: "#ddd", true: "#C8E6C9" }}
        thumbColor={value ? PRIMARY : "#fff"}
        ios_backgroundColor="#ddd"
      />
    </View>
  );

  const SectionHeader = ({ title }) => (
    <Text style={styles.sectionHeader}>{title}</Text>
  );

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Preferences</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {/* Notifications Section */}
        <SectionHeader title="Notifications" />

        <View style={styles.card}>
          <PreferenceItem
            icon="notifications-outline"
            title="Push Notifications"
            subtitle="Ride updates, driver arrival & promos"
            value={preferences.pushNotifications}
            onToggle={() => togglePreference("pushNotifications")}
          />


        </View>

        {/* Privacy Section */}
        <SectionHeader title="Privacy" />

        <View style={styles.card}>
          <PreferenceItem
            icon="location-outline"
            title="Location Sharing"
            subtitle="Share location during rides for safety"
            value={preferences.locationSharing}
            onToggle={() => togglePreference("locationSharing")}
          />


        </View>

        {/* Info Card */}
        <View style={styles.infoCard}>
          <Ionicons name="shield-checkmark-outline" size={20} color={SECONDARY} />
          <Text style={styles.infoText}>
            You can change these preferences anytime. Some settings may require app restart to take full effect.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  centered: {
    justifyContent: "center",
    alignItems: "center",
    flex: 1,
  },

  // Header
  header: {
    backgroundColor: SECONDARY,
    paddingTop: 50,
    paddingBottom: 16,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
  },

  // Content
  content: {
    padding: 20,
    paddingBottom: 40,
  },

  // Section
  sectionHeader: {
    fontSize: 13,
    fontWeight: "700",
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 12,
    marginTop: 8,
  },

  // Card
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
    overflow: "hidden",
  },

  // Preference Row
  preferenceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
  },
  preferenceLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 12,
  },
  preferenceIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "#F0F7E6",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  preferenceTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  preferenceSubtitle: {
    fontSize: 12,
    color: "#999",
    marginTop: 3,
  },

  // Divider
  divider: {
    height: 1,
    backgroundColor: "#f0f0f0",
    marginLeft: 70,
  },

  // Info Card
  infoCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#EBF2FA",
    padding: 16,
    borderRadius: 14,
    gap: 12,
    marginTop: 10,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: SECONDARY,
    lineHeight: 20,
  },
});