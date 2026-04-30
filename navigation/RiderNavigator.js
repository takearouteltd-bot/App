import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ActivityIndicator, SafeAreaView, Text } from "react-native";

import RiderTabs from "./RiderTabs";
import RiderOnboardingStack from "./RiderOnboardingStack";

const Stack = createNativeStackNavigator();

export default function RiderNavigator({ onboardingStatus, setOnboardingStatus }) {
  // 🔹 Wait until onboardingStatus is loaded
  if (!onboardingStatus || onboardingStatus === "not_started") {
    return (
      <SafeAreaView style={{ flex:1, justifyContent:"center", alignItems:"center" }}>
        <ActivityIndicator size={'small'} color={'#79B431'} />
      </SafeAreaView>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {onboardingStatus === "complete" ? (
        <Stack.Screen name="RiderTabs" component={RiderTabs} />
      ) : (
        <Stack.Screen name="RiderOnboarding">
          {(props) => (
            <RiderOnboardingStack
              {...props}
              setRiderOnboardingStatus={setOnboardingStatus}
            />
          )}
        </Stack.Screen>
      )}
    </Stack.Navigator>
  );
}