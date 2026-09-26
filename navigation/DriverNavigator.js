// navigation/DriverNavigator.js
import React from "react";
import {View, ActivityIndicator} from 'react-native';
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DriverOnboardingStack from "./DriverOnbaordingStack";
import DriverTabs from "./DriverTabs";



const Stack = createNativeStackNavigator();

export default function DriverNavigator({ onboardingStatus, setOnboardingStatus }) {

  if (onboardingStatus === null) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>

      {onboardingStatus === "onboarding" && (
        <Stack.Screen name="DriverOnboarding">
          {(props) => (
            <DriverOnboardingStack
              {...props}
              setOnboardingStatus={setOnboardingStatus}
            />
          )}
        </Stack.Screen>
      )}

      {(onboardingStatus === "pending" || onboardingStatus === "rejected" || onboardingStatus === "complete") && (
        <Stack.Screen name="DriverTabs" component={DriverTabs} />
      )}

    </Stack.Navigator>
  );
}