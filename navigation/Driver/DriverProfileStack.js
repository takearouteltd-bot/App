import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import SubscriptionScreen from "../../screens/Driver/Subscription/SubscriptionScreen";
import SubscriptionSuccessScreen from "../../screens/Driver/Subscription/SubscriptionSuccessfull";
import DriverProfileScreen from "../../screens/Driver/DriverProfile/DriverProfileScreen";
import DriverPersonalInformationScreen from "../../screens/Driver/DriverProfile/DriverPersonalInformationScreen";

const Stack = createNativeStackNavigator();

export default function DriverProfileStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="DriverProfile" component={DriverProfileScreen} />
      <Stack.Screen name="DriverPersonalInformation" component={DriverPersonalInformationScreen} />

    </Stack.Navigator>
  );
}
