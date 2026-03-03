import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Image,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";

const PRIMARY = "#79B531";
const SECONDARY = "#235594";

export default function PersonalInformationScreen({ navigation }) {
  const isOnline = true;

  const [fullName, setFullName] = useState("Hassan Jamil");
  const [email, setEmail] = useState("hassan@email.com");
  const [phone, setPhone] = useState("+44 7123 456789");
  const [address, setAddress] = useState("221B Baker Street, London");

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={{ flex: 1 }}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 120 }}
          >
            {/* Header */}
            <View style={styles.header}>
              <TouchableOpacity onPress={() => navigation?.goBack()}>
                <Ionicons name="arrow-back" left={20} size={24} color={SECONDARY} />
              </TouchableOpacity>

              <Text style={styles.headerTitle}>Personal Information</Text>

              <View style={{ width: 24 }} />
            </View>

            {/* Profile Section */}
            <View style={styles.profileSection}>
              <Image
                source={{ uri: "https://i.pravatar.cc/150?img=3" }}
                style={styles.avatar}
              />

              <Text style={styles.name}>Hassan Jamil</Text>

              <View style={styles.badgeRow}>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: isOnline ? PRIMARY : "#ccc" },
                  ]}
                >
                  <Text style={styles.badgeText}>
                    {isOnline ? "Online" : "Offline"}
                  </Text>
                </View>

                <View style={styles.premiumBadge}>
                  <MaterialCommunityIcons
                    name="crown"
                    size={14}
                    color="#fff"
                    style={{ marginRight: 4 }}
                  />
                  <Text style={styles.badgeText}>TakeARoute Premium</Text>
                </View>
              </View>
            </View>

            {/* Form Section */}
            <View style={styles.formContainer}>
              
              {/* Full Name */}
              <Text style={styles.label}>Full Name</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="person-outline" size={20} color={SECONDARY} />
                <TextInput
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder="Enter full name"
                  style={styles.input}
                />
              </View>

              {/* Email */}
              <Text style={styles.label}>Email Address</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="mail-outline" size={20} color={SECONDARY} />
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Enter email"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  style={styles.input}
                />
              </View>

              {/* Phone */}
              <Text style={styles.label}>Phone Number</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="call-outline" size={20} color={SECONDARY} />
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="Enter phone number"
                  keyboardType="phone-pad"
                  style={styles.input}
                />
              </View>

              {/* Address */}
              <Text style={styles.label}>Home Address</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="location-outline" size={20} color={SECONDARY} />
                <TextInput
                  value={address}
                  onChangeText={setAddress}
                  placeholder="Enter home address"
                  style={styles.input}
                />
              </View>
            </View>
            <TouchableOpacity style={styles.saveButton}>
              <Text style={styles.saveButtonText}>Save Changes</Text>
            </TouchableOpacity>
          </ScrollView>

          {/* Fixed Bottom Button */}
            
   
        </View>
      </KeyboardAvoidingView>
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

  profileSection: {
    alignItems: "center",
    marginTop: 30,
  },

  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },

  name: {
    fontSize: 20,
    fontWeight: "700",
    color: "#000",
    marginTop: 15,
  },

  badgeRow: {
    flexDirection: "row",
    marginTop: 15,
  },

  statusBadge: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    marginRight: 10,
  },

  premiumBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: SECONDARY,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
  },

  badgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },

  formContainer: {
    marginTop: 40,
  },

  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#444",
    marginBottom: 6,
    marginTop: 15,
    padding: 20
  },

  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 14,
    paddingHorizontal: 15,
    paddingVertical: 14,
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },

  input: {
    flex: 1,
    marginLeft: 12,
    fontSize: 14,
    color: "#000",
  },



  saveButton: {
    backgroundColor: PRIMARY,
    paddingVertical: 16,
    width: '90%',
    borderRadius: 30,
    alignItems: "center",
    margin: 20,
    marginTop: 50
  },

  saveButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});
