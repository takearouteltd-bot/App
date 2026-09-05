import "./config/firebase";
import "react-native-gesture-handler";
import React, { useState, useEffect } from "react";
import { LogBox, View, ActivityIndicator } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { auth, db } from "./config/firebase";
import { doc, onSnapshot, getDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

import AuthStack from "./navigation/AuthStack";
import RiderNavigator from "./navigation/RiderNavigator";
import DriverNavigator from "./navigation/DriverNavigator";
import { StripeProvider } from "@stripe/stripe-react-native";
import SplashScreen from "./Splash/SplashScreen";

const Stack = createNativeStackNavigator();

LogBox.ignoreLogs([
  "Uncaught Error in snapshot listener",
  "permission-denied",
  "Missing or insufficient permissions",
]);




export default function App() {
  const [initializing, setInitializing] = useState(true);
  const [userRole, setUserRole] = useState(null);
  const [riderOnboardingStatus, setRiderOnboardingStatus] = useState("not_started");
  const [driverOnboardingStatus, setDriverOnboardingStatus] = useState(null);

  useEffect(() => {
    let unsubscribeUserDoc = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      // Clean up previous listener
      if (unsubscribeUserDoc) {
        unsubscribeUserDoc();
        unsubscribeUserDoc = null;
      }

      if (!user) {
        setUserRole(null);
        setDriverOnboardingStatus(null);
        setRiderOnboardingStatus("not_started");
        setInitializing(false);
        return;
      }

      const uid = user.uid;

      unsubscribeUserDoc = onSnapshot(
        doc(db, "users", uid),
        async (snap) => {
          if (!snap.exists()) {
            setUserRole(null);
            setInitializing(false);
            return;
          }

          const role = snap.data().role;
          setUserRole(role);

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

          if (role === "driver") {
            const driverDoc = await getDoc(doc(db, "drivers", uid));
            if (!driverDoc.exists()) {
              setDriverOnboardingStatus("onboarding");
            } else {
              const data = driverDoc.data();
              if (!data.onboardingComplete) {
                setDriverOnboardingStatus("onboarding");
              } else if (!data.approved) {
                setDriverOnboardingStatus("pending");
              } else {
                setDriverOnboardingStatus("complete");
              }
            }
          }

          setInitializing(false);
        },
        (error) => {
          if (error.code === "permission-denied") {
            console.log("User doc listener: permission denied");
            return;
          }
          console.error("User doc snapshot error:", error);
          setInitializing(false);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeUserDoc) unsubscribeUserDoc();
    };
  }, []);

  if (initializing) {
    return <SplashScreen />;
  }

  return (
    <StripeProvider
      publishableKey="pk_test_51T4pFQEZ0ibzrAsgeuyTPpR8IZlV1Crsq1B5cLKaMo2UqLWmWENtmZqARrVpLnO7WCv3xv3JZaTFh3fES00qBgr100445BbowE"
    >
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {!userRole && (
            <Stack.Screen name="Auth">
              {(props) => (
                <AuthStack
                  {...props}
                  setUserRole={setUserRole}
                  setRiderOnboardingStatus={setRiderOnboardingStatus}
                  setDriverOnboardingStatus={setDriverOnboardingStatus}
                />
              )}
            </Stack.Screen>
          )}

          {userRole === "rider" && (
            <Stack.Screen name="RiderNavigator">
              {(props) => (
                <RiderNavigator
                  {...props}
                  onboardingStatus={riderOnboardingStatus}
                  setOnboardingStatus={setRiderOnboardingStatus}
                />
              )}
            </Stack.Screen>
          )}

          {userRole === "driver" && (
            <Stack.Screen name="DriverNavigator">
              {(props) => (
                <DriverNavigator
                  {...props}
                  onboardingStatus={driverOnboardingStatus}
                  setOnboardingStatus={setDriverOnboardingStatus}
                />
              )}
            </Stack.Screen>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </StripeProvider>
  );
}
