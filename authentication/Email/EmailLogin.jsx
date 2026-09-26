import React, { useState } from "react";
import {
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Alert } from "../../components/ui/alert";
import { Ionicons } from "@expo/vector-icons";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { auth, db } from "../../config/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import {
  COLORS,
  SPACE,
  TYPE,
  Button,
  Field,
  Screen,
  ScreenHeader,
  Segmented,
} from '../../components/ui/kit';

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

  // The eye that shows or hides a password, inside its field.
  const eye = (shown, toggle) => (
    <TouchableOpacity
      onPress={toggle}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={shown ? "Hide password" : "Show password"}
    >
      <Ionicons name={shown ? "eye-off-outline" : "eye-outline"} size={20} color={COLORS.muted} />
    </TouchableOpacity>
  );

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <ScreenHeader
            title={isLogin ? "Welcome back" : "Create account"}
            subtitle={isLogin ? "Sign in to continue" : "Sign up to get started"}
            onBack={() => navigation.goBack()}
          />

          <Segmented
            style={styles.toggle}
            value={mode}
            onChange={setMode}
            options={[
              { value: "login", label: "Login" },
              { value: "signup", label: "Sign Up" },
            ]}
          />

          <Field
            label="Email Address"
            left="mail-outline"
            placeholder="Enter your email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <Field
            label="Password"
            left="lock-closed-outline"
            placeholder="Enter your password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            right={eye(showPassword, () => setShowPassword(!showPassword))}
          />

          {!isLogin && (
            <Field
              label="Confirm Password"
              left="lock-closed-outline"
              placeholder="Re-enter your password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry={!showConfirmPassword}
              right={eye(showConfirmPassword, () => setShowConfirmPassword(!showConfirmPassword))}
            />
          )}

          <Button
            title={isLogin ? "Login" : "Create Account"}
            onPress={handleSubmit}
            loading={loading}
            style={{ marginTop: SPACE[2] }}
          />

          <TouchableOpacity
            style={styles.switchBtn}
            onPress={switchMode}
            accessibilityRole="button"
          >
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
    </Screen>
  );
}


const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: SPACE[5], paddingBottom: SPACE[10] },
  toggle: { marginTop: SPACE[5], marginBottom: SPACE[6] },
  switchBtn: { alignItems: "center", paddingVertical: SPACE[5] },
  switchText: { ...TYPE.small, color: COLORS.muted },
  switchTextBold: { color: COLORS.midnight, fontWeight: "800" },
});
