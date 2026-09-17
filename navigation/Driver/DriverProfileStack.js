import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import SubscriptionScreen from "../../screens/Driver/Subscription/SubscriptionScreen";
import SubscriptionSuccessScreen from "../../screens/Driver/Subscription/SubscriptionSuccessfull";
import DriverProfileScreen from "../../screens/Driver/DriverProfile/DriverProfileScreen";
import DriverPersonalInformationScreen from "../../screens/Driver/DriverProfile/DriverPersonalInformationScreen";
import VehicleInformationScreen from "../../screens/Driver/VehicleInformation/VehicleInformationScreen";
import DriverSubscriptionStack from "./DriverSubscriptionStack";
import InboxScreen from "../../screens/Inbox/InboxScreen";

const Stack = createNativeStackNavigator();

export default function DriverProfileStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="DriverProfile" component={DriverProfileScreen} />
      <Stack.Screen name="DriverPersonalInformation" component={DriverPersonalInformationScreen} />
      <Stack.Screen name="VehicleInformation" component={VehicleInformationScreen} />
      <Stack.Screen name="SubscriptionDetails" component={DriverSubscriptionStack} />
      <Stack.Screen name="Inbox" component={InboxScreen} initialParams={{ role: "driver" }} />
    

    </Stack.Navigator>
  );
}
