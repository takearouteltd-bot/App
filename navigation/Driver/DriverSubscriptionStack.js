import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import SubscriptionScreen from "../../screens/Driver/Subscription/SubscriptionScreen";
import SubscriptionSuccessScreen from "../../screens/Driver/Subscription/SubscriptionSuccessfull";

const Stack = createNativeStackNavigator();

export default function DriverSubscriptionStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="SubscriptionScreen" component={SubscriptionScreen} />
      <Stack.Screen name="SubscriptionSuccess" component={SubscriptionSuccessScreen} />

    </Stack.Navigator>
  );
}
