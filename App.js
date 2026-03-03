import "react-native-gesture-handler";
import React, { useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import AuthStack from "./navigation/AuthStack";
import DriverNavigator from "./navigation/DriverNavigator";
import RiderTabs from './navigation/RiderTabs'

const Stack = createNativeStackNavigator();

export default function App() {
  // 🔹 App state (no Redux)
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userRole, setUserRole] = useState(null); // "driver" | "rider"
  const [onboardingStatus, setOnboardingStatus] = useState("not_started"); 
  // "not_started" | "approved"

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {/* 1️⃣ Auth flow */}
        {!isLoggedIn && (
          <Stack.Screen name="Auth">
            {(props) => (
              <AuthStack
                {...props}
                setIsLoggedIn={setIsLoggedIn}
                setUserRole={setUserRole}
              />
            )}
          </Stack.Screen>
        )}

        {/* 2️⃣ Driver flow */}
        {isLoggedIn && userRole === "driver" && (
          <Stack.Screen name="DriverNavigator">
            {(props) => (
              <DriverNavigator
                {...props}
                onboardingStatus={onboardingStatus}
                setOnboardingStatus={setOnboardingStatus}
              />
            )}
          </Stack.Screen>
        )}

        {/* 3️⃣ Rider flow */}
        {isLoggedIn && userRole === "rider" && (
          <Stack.Screen name="RiderNavigator" component={RiderTabs} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
