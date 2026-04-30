import React, { createContext, useContext, useState, useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../config/firebase";

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userRole, setUserRole] = useState(null);
  const [driverOnboardingStatus, setDriverOnboardingStatus] = useState("not_started");
  const [riderOnboardingStatus, setRiderOnboardingStatus] = useState("not_started");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          // Check driver
          const driverDoc = await getDoc(doc(db, "drivers", user.uid));
          if (driverDoc.exists()) {
            const data = driverDoc.data();
            setUserRole("driver");
            setDriverOnboardingStatus(data.onboardingCompleted ? "approved" : "not_started");
            setIsLoggedIn(true);
            setLoading(false);
            return;
          }

          // Check rider
          const riderDoc = await getDoc(doc(db, "riders", user.uid));
          if (riderDoc.exists()) {
            const data = riderDoc.data();
            setUserRole("rider");
            setRiderOnboardingStatus(data.onboardingStatus || "not_started");
            setIsLoggedIn(true);
            setLoading(false);
            return;
          }

          // ✅ User authenticated but no role yet (new signup)
          // Don't log them in — let SelectUserType handle it
          // Just set loading to false so the auth stack stays visible
          setIsLoggedIn(false);
          setUserRole(null);

        } catch (error) {
          console.log("Auth state error:", error);
          setIsLoggedIn(false);
        }
      } else {
        setIsLoggedIn(false);
        setUserRole(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" }}>
        <ActivityIndicator size="large" color="#79B531" />
      </View>
    );
  }

  return (
    <AuthContext.Provider value={{
      isLoggedIn, setIsLoggedIn,
      userRole, setUserRole,
      driverOnboardingStatus, setDriverOnboardingStatus,
      riderOnboardingStatus, setRiderOnboardingStatus,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}