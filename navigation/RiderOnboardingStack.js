import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import RiderProfileScreen from "../authentication/Rider/RiderProfileScreen";
import EnableLocationScreen from "../authentication/Rider/EnableLocationScreen";

const Stack = createNativeStackNavigator();

export default function RiderOnboardingStack({ onboardingStatus, setRiderOnboardingStatus }) {
// Someone who entered their name and then closed the app comes back to the
// location step, not to an empty name field.
const initialRouteName = onboardingStatus === "location" ? "EnableLocation" : "RiderProfile";
return (
<Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName={initialRouteName}>
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
