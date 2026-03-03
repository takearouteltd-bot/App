import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function SelectUserTypeScreen({ setUserRole, setIsLoggedIn }) {
  const [selected, setSelected] = useState(null); // "driver" or "rider"

  const handleContinue = () => {
    if (!selected) {
      alert("Please select an option to continue");
      return;
    }

    // Update App.js state
    setUserRole(selected);
    setIsLoggedIn(true);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>How would you like to use TakeARoute?</Text>

        {/* Driver Option */}
        <TouchableOpacity
          style={[styles.optionCard, selected === "driver" && styles.selectedCard]}
          onPress={() => setSelected("driver")}
        >
          <View style={styles.optionContent}>
            <Ionicons
              name="car-sport"
              size={28}
              color={selected === "driver" ? "#fff" : "#22c55e"}
            />
            <View style={{ marginLeft: 15 }}>
              <Text
                style={[
                  styles.optionTitle,
                  selected === "driver" && { color: "#fff" },
                ]}
              >
                Driver
              </Text>
              <Text
                style={[
                  styles.optionSubtitle,
                  selected === "driver" && { color: "#e5e7eb" },
                ]}
              >
                Earn on your schedule
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* Rider Option */}
        <TouchableOpacity
          style={[styles.optionCard, selected === "rider" && styles.selectedCard]}
          onPress={() => setSelected("rider")}
        >
          <View style={styles.optionContent}>
            <Ionicons
              name="person"
              size={28}
              color={selected === "rider" ? "#fff" : "#22c55e"}
            />
            <View style={{ marginLeft: 15 }}>
              <Text
                style={[
                  styles.optionTitle,
                  selected === "rider" && { color: "#fff" },
                ]}
              >
                Rider
              </Text>
              <Text
                style={[
                  styles.optionSubtitle,
                  selected === "rider" && { color: "#e5e7eb" },
                ]}
              >
                Book a ride instantly
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        <View style={{ flex: 1 }} />

        {/* Continue Button */}
        <TouchableOpacity
          style={[styles.button, !selected && { opacity: 0.6 }]}
          disabled={!selected}
          onPress={handleContinue}
        >
          <Text style={styles.buttonText}>Continue</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { flexGrow: 1, paddingHorizontal: 25, paddingTop: 40, justifyContent: "center" },
  title: { fontSize: 32, fontWeight: "bold", color: "#111827", marginBottom: 40, textAlign: "center" },
  optionCard: { backgroundColor: "#f3f4f6", borderRadius: 16, padding: 20, marginBottom: 20 },
  selectedCard: { backgroundColor: "#A1D77C" },
  optionContent: { flexDirection: "row", alignItems: "center" },
  optionTitle: { fontSize: 20, fontWeight: "bold", color: "#111827" },
  optionSubtitle: { fontSize: 14, color: "#6b7280", marginTop: 4 },
  button: { backgroundColor: "#79B531", paddingVertical: 18, borderRadius: 12, alignItems: "center", marginBottom: 30 },
  buttonText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
});
