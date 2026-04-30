import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import RiderProfileScreen from "../authentication/Rider/RiderProfileScreen";
import EnableLocationScreen from "../authentication/Rider/EnableLocationScreen";

const Stack = createNativeStackNavigator();

export default function RiderOnboardingStack({ setRiderOnboardingStatus }) {
return (
<Stack.Navigator screenOptions={{ headerShown: false }}>
  {/* Step 1: Profile */}
  <Stack.Screen name="RiderProfile">
    {(props) => (
      <RiderProfileScreen
        {...props}
        setOnboardingStatus={() => setRiderOnboardingStatus("location")}
      />
    )}
  </Stack.Screen>

  {/* Step 2: Enable Location */}
  <Stack.Screen name="EnableLocation">
    {(props) => (
      <EnableLocationScreen
        {...props}
        setOnboardingStatus={() => setRiderOnboardingStatus("complete")}
      />
    )}
  </Stack.Screen>

</Stack.Navigator>

);
}
