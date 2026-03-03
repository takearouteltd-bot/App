// navigation/DriverNavigator.js
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DriverOnboardingStack from "./DriverOnbaordingStack";
import DriverTabs from "./DriverTabs";



const Stack = createNativeStackNavigator();

export default function DriverNavigator({ onboardingStatus, setOnboardingStatus }) {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {onboardingStatus !== "approved" ? (
        <Stack.Screen name="DriverOnboarding">
          {(props) => (
            <DriverOnboardingStack
              {...props}
              setOnboardingStatus={setOnboardingStatus} // pass down so final screen can complete onboarding
            />
          )}
        </Stack.Screen>
      ) : (
        <Stack.Screen name="DriverTabs" component={DriverTabs} />
      )}
    </Stack.Navigator>
  );
}
