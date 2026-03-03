import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, ScrollView } from "react-native";
import { Ionicons } from '@expo/vector-icons';

export default function LandingScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Logo */}
        <Text style={styles.logo}>Welcome to TakeARoute</Text>
        <Text style={styles.tagline}>Your ride, Your way.</Text>

        {/* Continue with Phone */}
        <TouchableOpacity
          style={[styles.button, { backgroundColor: "#79B531" }]}
          onPress={() => navigation.navigate("PhoneLogin")}
        >
          <Text style={[styles.buttonText, { color: '#fff'}]}>Continue with Phone</Text>
        </TouchableOpacity>

        {/* Continue with Email */}
        <TouchableOpacity
          style={[styles.button, { backgroundColor: "#79B531" }]}
          onPress={() => navigation.navigate("EmailAuth")}
        >
          <Text style={[styles.buttonText, { color: '#fff'}]}>Continue with Email</Text>
        </TouchableOpacity>

        {/* Divider with OR */}
        <View style={styles.dividerContainer}>
          <View style={styles.line} />
          <Text style={styles.orText}>OR CONTINUE WITH</Text>
          <View style={styles.line} />
        </View>

        {/* Continue with Apple */}
        <TouchableOpacity
          style={[styles.button, styles.socialButton]}
          onPress={() => console.log("Apple login")}
        >
          <Ionicons name="logo-apple" size={20} color="#000" style={{ marginRight: 8 }} />
          <Text style={[styles.buttonText, { color: "#000" }]}>Continue with Apple</Text>
        </TouchableOpacity>

        {/* Continue with Google */}
        <TouchableOpacity
          style={[styles.button, styles.socialButton]}
          onPress={() => console.log("Google login")}
        >
          <Ionicons name="logo-google" size={20} color="#000" style={{ marginRight: 8 }} />
          <Text style={[styles.buttonText, { color: "#000" }]}>Continue with Google</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Terms Text fixed at bottom */}
      <View style={styles.termsContainer}>
        <Text style={styles.termsText}>
          By continuing, you accept the{" "}
          <Text style={styles.linkText}>Terms of Use</Text> and{" "}
          <Text style={styles.linkText}>Privacy Policy</Text>.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 25,
    paddingTop: 60,
    paddingBottom: 20,
  },
  logo: {
    fontSize: 34,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 10,
  },
  tagline: {
    fontSize: 20,
    color: "#6b7280",
    marginBottom: 60,
    textAlign: "center",
  },
  button: {
    flexDirection: "row",
    width: "100%",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 15,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  socialButton: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d1d5db",
  },
  dividerContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 20,
    width: "100%",
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: "#d1d5db",
  },
  orText: {
    marginHorizontal: 10,
    color: "#6b7280",
    fontWeight: "bold",
  },
  termsContainer: {
    paddingHorizontal: 25,
    paddingVertical: 20,
    borderTopWidth: 0,
  },
  termsText: {
    color: "#6b7280",
    fontSize: 12,
    textAlign: "center",
  },
  linkText: {
    textDecorationLine: "underline",
    fontWeight: "bold",
    color: "#79B531",
  },
});
