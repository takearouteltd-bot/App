import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function PhoneLoginScreen({ navigation }) {
  const [phone, setPhone] = useState("");

  const handleContinue = () => {
    if (phone.length < 10) {
      alert("Please enter a valid phone number");
      return;
    }
    navigation.navigate("VerifyPhone", { phone: `+44${phone}` });
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.innerContainer}
      >
        {/* Back Button */}
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={28} color="#111827" />
        </TouchableOpacity>

        {/* Title & Subtitle */}
        <Text style={styles.title}>Enter your phone number</Text>
        <Text style={styles.subtitle}>
          We will send a code to verify your account
        </Text>

        {/* Phone Input */}
        <View style={styles.inputContainer}>
          <Image
            source={{ uri: "https://upload.wikimedia.org/wikipedia/en/a/ae/Flag_of_the_United_Kingdom.svg" }}
            style={styles.flag}
          />
          <Text style={styles.countryCode}>+44</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter phone number"
            keyboardType="number-pad"
            maxLength={10}
            value={phone}
            onChangeText={setPhone}
          />
        </View>

        {/* Spacer to push button to bottom */}
        <View style={{ flex: 1 }} />

        {/* Send Verification Code */}
        <TouchableOpacity style={styles.button} onPress={handleContinue}>
          <Text style={styles.buttonText}>Send a Verification Code</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  innerContainer: {
    flex: 1,
    paddingHorizontal: 25,
    paddingTop: 20,
  },
  backBtn: {
    marginBottom: 30,
  },
  title: {
    fontSize: 36,
    fontWeight: "bold",
    color: "#111827",
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: "#6b7280",
    marginBottom: 40,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 12,
    paddingHorizontal: 15,
    height: 60,
  },
  flag: {
    width: 32,
    height: 20,
    marginRight: 10,
    resizeMode: "contain",
  },
  countryCode: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#111827",
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 18,
    color: "#111827",
  },
  button: {
    backgroundColor: "#79B531",
    paddingVertical: 20,
    borderRadius: 30,
    alignItems: "center",
    marginBottom: 15,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
});
