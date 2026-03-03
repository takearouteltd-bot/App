import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

const PRIMARY = "#79B531";
const SECONDARY = "#235594";

export default function RiderProfileScreen() {
  const OptionItem = ({ icon, title, subtitle, danger }) => (
    <TouchableOpacity style={styles.optionContainer} activeOpacity={0.7}>
      <View style={styles.leftSection}>
        <View
          style={[
            styles.iconWrapper,
            danger && { backgroundColor: "#FFEAEA" },
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
            style={[
              styles.optionTitle,
              danger && { color: "#D32F2F" },
            ]}
          >
            {title}
          </Text>
          <Text style={styles.optionSubtitle}>{subtitle}</Text>
        </View>
      </View>

      <Ionicons name="chevron-forward" size={20} color="#999" />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* 🔵 Header */}
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

        {/* ⬇️ Options Section */}
        <View style={styles.content}>
          <OptionItem
            icon="person-outline"
            title="Personal Information"
            subtitle="Update your name, phone & email"
          />

          <OptionItem
            icon="location-outline"
            title="Saved Places"
            subtitle="Manage home & work addresses"
          />

          <OptionItem
            icon="card-outline"
            title="Payments"
            subtitle="Cards, transactions & billing"
          />

          <OptionItem
            icon="shield-checkmark-outline"
            title="Safety Support"
            subtitle="Emergency help & ride safety"
          />

          <OptionItem
            icon="trash-outline"
            title="Delete Account"
            subtitle="Permanently remove your account"
            danger
          />
        </View>

        {/* Version */}
        <Text style={styles.versionText}>
        VERSION 1.0 (UK-STABLE)
        </Text>

      </ScrollView>
    </View>
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
    paddingVertical: 60,
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
    fontSize: 17,
    marginLeft: 6,
  },

  trips: {
    opacity: 0.8,
    fontSize: 13,
  },

  content: {
    padding: 20,
    marginTop: 10,
  },

  optionContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 14,
    marginBottom: 15,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },

  leftSection: {
    flexDirection: "row",
    alignItems: "center",
  },

  iconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "#E8F5E9",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },

  optionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#222",
  },

  optionSubtitle: {
    fontSize: 12,
    color: "#777",
    marginTop: 3,
  },
  versionText: {
  textAlign: "center",
  fontSize: 13,
  color: "#999",
  marginTop: 25,
  marginBottom: 40,
  letterSpacing: 1,
},

});
