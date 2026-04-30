// screens/LandingScreen.js
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import {
  GoogleAuthProvider,
  signInWithCredential,
} from "firebase/auth";
import { auth } from "../config/firebase";
import { handlePostLogin } from "../utils/authHelper";
import { makeRedirectUri } from "expo-auth-session";

WebBrowser.maybeCompleteAuthSession();

export default function LandingScreen({
  navigation,
  setUserRole,
  setRiderOnboardingStatus,
  setDriverOnboardingStatus,
}) {
  const [loadingProvider, setLoadingProvider] = useState(null);

 


  const isLoading = (provider) => loadingProvider === provider;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Placeholder Logo */}
        <View style={styles.logoContainer}>
          <View style={styles.logoCircle}>
            <Ionicons name="car" size={48} color="#fff" />
          </View>
        </View>

        <Text style={styles.logoText}>TakeARoute</Text>
        <Text style={styles.tagline}>Your ride, Your way.</Text>

        <TouchableOpacity
          style={[styles.button, { backgroundColor: "#79B531" }]}
          onPress={() => navigation.navigate("PhoneLogin")}
          disabled={!!loadingProvider}
        >
          <Text style={[styles.buttonText, { color: "#fff" }]}>
            Continue with Phone
          </Text>
        </TouchableOpacity>

        {/* OR Divider */}
        <View style={styles.dividerContainer}>
          <View style={styles.line} />
          <Text style={styles.orText}>OR</Text>
          <View style={styles.line} />
        </View>

        <TouchableOpacity
          style={[styles.button, styles.outlineButton]}
          onPress={() => navigation.navigate("EmailAuth")}
          disabled={!!loadingProvider}
        >
          <Text style={[styles.buttonText, { color: "#79B531" }]}>
            Continue with Email
          </Text>
        </TouchableOpacity>
      </ScrollView>

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
  container: { flex: 1, backgroundColor: "#fff" },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 25,
    paddingTop: 60,
    paddingBottom: 20,
  },
  logoContainer: {
    marginBottom: 20,
    alignItems: "center",
  },
  logoCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#79B531",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  logoText: { fontSize: 34, fontWeight: "bold", color: "#333", marginBottom: 8 },
  tagline: { fontSize: 18, color: "#6b7280", marginBottom: 50, textAlign: "center" },
  button: {
    flexDirection: "row",
    width: "100%",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  outlineButton: {
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#79B531",
  },
  buttonText: { fontSize: 16, fontWeight: "600" },
  dividerContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 16,
    width: "100%",
  },
  line: { flex: 1, height: 1, backgroundColor: "#d1d5db" },
  orText: { marginHorizontal: 12, color: "#6b7280", fontWeight: "bold", fontSize: 14 },
  termsContainer: { paddingHorizontal: 25, paddingVertical: 20 },
  termsText: { color: "#6b7280", fontSize: 12, textAlign: "center" },
  linkText: { textDecorationLine: "underline", fontWeight: "bold", color: "#79B531" },
});