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
  ActivityIndicator,
  Alert,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { auth, db } from "../../config/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";

export default function EmailAuthScreen({
  navigation,
  setUserRole,
  setRiderOnboardingStatus,
  setDriverOnboardingStatus
}) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const isLogin = mode === "login";

  const handleSubmit = async () => {
    if (!email || !password) {
      Alert.alert("Missing Fields", "Please fill in all required fields.");
      return;
    }

    if (!isLogin && password !== confirmPassword) {
      Alert.alert("Password Mismatch", "Passwords do not match.");
      return;
    }

    if (password.length < 6) {
      Alert.alert("Weak Password", "Password must be at least 6 characters.");
      return;
    }

    setLoading(true);

    try {
      if (isLogin) {
        // ✅ LOGIN
        const userCredential = await signInWithEmailAndPassword(
          auth,
          email,
          password
        );
        const uid = userCredential.user.uid;

        // 🔥 Get user role
        const userDoc = await getDoc(doc(db, "users", uid));

        if (!userDoc.exists()) {
          Alert.alert("Error", "User data not found.");
          return;
        }

        const userData = userDoc.data();
        const role = userData.role;

        // 🚨 If role not selected yet
        if (!role) {
          navigation.navigate("SelectUserType");
          return;
        }

        setUserRole(role);
      


        // ✅ RIDER FLOW
        if (role === "rider") {
          const riderDoc = await getDoc(doc(db, "riders", uid));

          if (riderDoc.exists()) {
            const data = riderDoc.data();

            if (!data.fullName) {
              setRiderOnboardingStatus("profile");
            } else if (!data.locationEnabled) {
              setRiderOnboardingStatus("location");
            } else {
              setRiderOnboardingStatus("complete");
            }
          } else {
            setRiderOnboardingStatus("profile");
          }
        }

        // ✅ DRIVER FLOW (basic for now)
       if (role === "driver") {
          const driverDoc = await getDoc(doc(db, "drivers", uid));

          if (driverDoc.exists()) {
            const data = driverDoc.data();

            if (data.onboardingComplete) {
              setDriverOnboardingStatus("complete");
            } else {
              setDriverOnboardingStatus("onboarding");
            }
          } else {
            setDriverOnboardingStatus("onboarding");
          }
        }
      } else {
        // ✅ SIGNUP
        const userCredential = await createUserWithEmailAndPassword(
          auth,
          email,
          password
        );
        const uid = userCredential.user.uid;

        // 🔥 Create user in USERS collection
        await setDoc(doc(db, "users", uid), {
          email: email,
          role: null,
          createdAt: new Date(),
        });

        // 👉 Go to role selection
        navigation.navigate("SelectUserType");
      }
    } catch (error) {
      console.log("Email auth error:", error);

      let message = "Something went wrong. Please try again.";

      if (
        error.code === "auth/user-not-found" ||
        error.code === "auth/wrong-password"
      ) {
        message = "Invalid email or password.";
      } else if (error.code === "auth/email-already-in-use") {
        message = "This email is already registered. Please log in instead.";
      } else if (error.code === "auth/invalid-email") {
        message = "Please enter a valid email address.";
      } else if (error.code === "auth/too-many-requests") {
        message = "Too many attempts. Please try again later.";
      }

      Alert.alert("Error", message);
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setMode(isLogin ? "signup" : "login");
    setEmail("");
    setPassword("");
    setConfirmPassword("");
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="arrow-back" size={28} color="#111827" />
          </TouchableOpacity>

          <Text style={styles.title}>
            {isLogin ? "Welcome back" : "Create account"}
          </Text>
          <Text style={styles.subtitle}>
            {isLogin ? "Sign in to continue" : "Sign up to get started"}
          </Text>

          {/* Toggle */}
          <View style={styles.toggleContainer}>
            <TouchableOpacity
              style={[styles.toggleBtn, isLogin && styles.toggleBtnActive]}
              onPress={() => setMode("login")}
            >
              <Text
                style={[styles.toggleText, isLogin && styles.toggleTextActive]}
              >
                Login
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, !isLogin && styles.toggleBtnActive]}
              onPress={() => setMode("signup")}
            >
              <Text
                style={[
                  styles.toggleText,
                  !isLogin && styles.toggleTextActive,
                ]}
              >
                Sign Up
              </Text>
            </TouchableOpacity>
          </View>

          {/* Email */}
          <View style={styles.inputWrapper}>
            <Text style={styles.label}>Email Address</Text>
            <View style={styles.inputContainer}>
              <Ionicons
                name="mail-outline"
                size={20}
                color="#9ca3af"
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                placeholder="Enter your email"
                placeholderTextColor="#9ca3af"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>
          </View>

          {/* Password */}
          <View style={styles.inputWrapper}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.inputContainer}>
              <Ionicons
                name="lock-closed-outline"
                size={20}
                color="#9ca3af"
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                placeholder="Enter your password"
                placeholderTextColor="#9ca3af"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
              >
                <Ionicons
                  name={showPassword ? "eye-off-outline" : "eye-outline"}
                  size={20}
                  color="#9ca3af"
                />
              </TouchableOpacity>
            </View>
          </View>

          {!isLogin && (
            <View style={styles.inputWrapper}>
              <Text style={styles.label}>Confirm Password</Text>
              <View style={styles.inputContainer}>
                <Ionicons
                  name="lock-closed-outline"
                  size={20}
                  color="#9ca3af"
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Re-enter your password"
                  placeholderTextColor="#9ca3af"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showConfirmPassword}
                />
                <TouchableOpacity
                  onPress={() =>
                    setShowConfirmPassword(!showConfirmPassword)
                  }
                >
                  <Ionicons
                    name={
                      showConfirmPassword
                        ? "eye-off-outline"
                        : "eye-outline"
                    }
                    size={20}
                    color="#9ca3af"
                  />
                </TouchableOpacity>
              </View>
            </View>
          )}

          <TouchableOpacity
            style={[styles.button, loading && { opacity: 0.7 }]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                {isLogin ? "Login" : "Create Account"}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.switchBtn} onPress={switchMode}>
            <Text style={styles.switchText}>
              {isLogin
                ? "Don't have an account? "
                : "Already have an account? "}
              <Text style={styles.switchTextBold}>
                {isLogin ? "Sign Up" : "Login"}
              </Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}


const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { flexGrow: 1, paddingHorizontal: 25, paddingTop: 20, paddingBottom: 40 },
  backBtn: { marginBottom: 30 },
  title: { fontSize: 34, fontWeight: "bold", color: "#111827", marginBottom: 8 },
  subtitle: { fontSize: 15, color: "#6b7280", marginBottom: 30 },

  toggleContainer: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderRadius: 12,
    padding: 4,
    marginBottom: 30,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  toggleBtnActive: {
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  toggleText: { fontSize: 15, fontWeight: "600", color: "#9ca3af" },
  toggleTextActive: { color: "#79B531" },

  inputWrapper: { marginBottom: 18 },
  label: { fontSize: 14, fontWeight: "600", color: "#374151", marginBottom: 8 },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 12,
    paddingHorizontal: 15,
    height: 56,
    backgroundColor: "#fafafa",
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 15, color: "#111827" },

  button: {
    backgroundColor: "#79B531",
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 20,
  },
  buttonText: { color: "#fff", fontSize: 17, fontWeight: "bold" },

  switchBtn: { alignItems: "center" },
  switchText: { color: "#6b7280", fontSize: 14 },
  switchTextBold: { color: "#79B531", fontWeight: "bold" },
});