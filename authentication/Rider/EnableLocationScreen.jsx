import React from "react";
import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";

import { auth, db } from "../../config/firebase";
import { doc, updateDoc } from "firebase/firestore";

const PRIMARY = "#79B531";

export default function EnableLocationScreen({ setOnboardingStatus }) {

  const enableLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        Alert.alert(
          "Permission Required",
          "Location permission is required to find nearby drivers."
        );
        return;
      }

      const user = auth.currentUser;
      if (!user) {
        Alert.alert("Error", "User not authenticated.");
        return;
      }

      const location = await Location.getCurrentPositionAsync({});
      const { latitude, longitude } = location.coords;

      const riderRef = doc(db, "riders", user.uid);
      await updateDoc(riderRef, {
        locationEnabled: true,
        onboardingComplete: true,
        onBoardingStep: 'complete',
        coordinates: { latitude, longitude },
      });

      setOnboardingStatus("complete");

    } catch (error) {
      console.log("Location error:", error);
      Alert.alert("Error", "Unable to enable location.");
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.iconContainer}>
          <Ionicons name="location" size={70} color={PRIMARY} />
        </View>

        <Text style={styles.title}>Enable Location</Text>

        <Text style={styles.subtitle}>
          We use your location to find nearby drivers and provide accurate pickup times.
        </Text>

        <View style={{ flex: 1 }} />

        <TouchableOpacity style={styles.button} onPress={enableLocation}>
          <Text style={styles.buttonText}>Enable Location</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  container: { flex: 1, padding: 25, alignItems: "center" },
  iconContainer: { marginTop: 80, marginBottom: 30 },
  title: { fontSize: 28, fontWeight: "bold", marginBottom: 15, textAlign: "center" },
  subtitle: { fontSize: 16, color: "#6b7280", textAlign: "center", paddingHorizontal: 10 },
  button: { backgroundColor: PRIMARY, width: "100%", paddingVertical: 18, borderRadius: 30, alignItems: "center", marginBottom: 40 },
  buttonText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
});