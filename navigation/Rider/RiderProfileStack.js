import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  SafeAreaView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

const SECONDARY = "#2C3E50"; // Change to your secondary color

export default function RiderProfileScreen() {
  return (
    <SafeAreaView style={styles.container}>
      
      {/* 🔵 Top Section */}
      <View style={styles.header}>
        <Image
          source={{ uri: "https://i.pravatar.cc/150?img=3" }}
          style={styles.avatar}
        />

        <Text style={styles.name}>Hassan Jamil</Text>

        <View style={styles.ratingContainer}>
          <Ionicons name="star" size={16} color="#FFD700" />
          <Text style={styles.ratingText}>
            4.9 <Text style={styles.trips}>(56 Trips)</Text>
          </Text>
        </View>
      </View>

      {/* ⬇️ Rest of screen content goes here */}
      <View style={styles.content}>
        <Text>Profile options will go here...</Text>
      </View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8F9FA",
  },

  header: {
    backgroundColor: SECONDARY,
    alignItems: "center",
    paddingVertical: 40,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },

  avatar: {
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 3,
    borderColor: "#fff",
    marginBottom: 15,
  },

  name: {
    fontSize: 20,
    fontWeight: "600",
    color: "#fff",
    marginBottom: 8,
  },

  ratingContainer: {
    flexDirection: "row",
    alignItems: "center",
  },

  ratingText: {
    color: "#fff",
    fontSize: 14,
    marginLeft: 6,
  },

  trips: {
    opacity: 0.8,
    fontSize: 13,
  },

  content: {
    flex: 1,
    padding: 20,
  },
});
