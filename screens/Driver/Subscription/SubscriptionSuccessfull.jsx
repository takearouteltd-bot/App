import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";

const PRIMARY = "#79B531";
const SECONDARY = "#235594";

export default function SubscriptionSuccessScreen() {
  const navigation = useNavigation();

  return (
    <SafeAreaView style={styles.container}>
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={{marginLeft: 10}} onPress={() => navigation.goBack()}>
          <Ionicons name="close" size={28} color={SECONDARY} />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>Subscription</Text>

        <View style={{ width: 28 }} />
      </View>

      {/* Elite Icon */}
      <View style={styles.iconContainer}>
        <View style={styles.iconCircle}>
          <MaterialCommunityIcons
            name="crown"
            size={42}
            color="#fff"
          />
        </View>
      </View>

      {/* Welcome Text */}
      <Text style={styles.title}>Welcome to Elite!</Text>
      <Text style={styles.subtitle}>
        Your plan has been successfully upgraded. You have now top priority for all ride requests
      </Text>

      {/* Perks Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>ACTIVE ELITE PERKS</Text>

        {[
          "Top priority dispatch",
          "Reduced Service Fee",
          "Premium Support Access",
          "Exclusive Weekly Rewards",
        ].map((perk, index) => (
          <View key={index} style={styles.perkRow}>
            <Ionicons
              name="checkmark-circle"
              size={20}
              color={PRIMARY}
            />
            <Text style={styles.perkText}>{perk}</Text>
          </View>
        ))}
      </View>

      {/* Go to Dashboard Button */}
      <TouchableOpacity
        style={styles.button}
        onPress={() => navigation.navigate("Dashboard")}
      >
        <Text style={styles.buttonText}>Go to Dashboard</Text>
      </TouchableOpacity>

      {/* View Details Link */}
      <TouchableOpacity>
        <Text style={styles.linkText}>View Subscription details</Text>
      </TouchableOpacity>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: SECONDARY,
  },
  iconContainer: {
    alignItems: "center",
    marginTop: 40,
  },
  iconCircle: {
    backgroundColor: PRIMARY,
    width: 90,
    height: 90,
    borderRadius: 45,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
  },
  title: {
    textAlign: "center",
    fontSize: 24,
    fontWeight: "700",
    color: SECONDARY,
    marginTop: 25,
  },
  subtitle: {
    textAlign: "center",
    fontSize: 14,
    color: "#666",
    marginTop: 8,
    marginBottom: 30,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    marginBottom: 30,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: PRIMARY,
    marginBottom: 15,
  },
  perkRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  perkText: {
    marginLeft: 10,
    fontSize: 14,
    color: "#333",
  },
  button: {
    backgroundColor: PRIMARY,
    paddingVertical: 14,
    width: '80%',
    marginLeft: 40,
    marginTop: 50,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 15,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  linkText: {
    textAlign: "center",
    color: SECONDARY,
    fontSize: 14,
    fontWeight: "500",
  },
});
