import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import SubscriptionScreen from "../../screens/Driver/Subscription/SubscriptionScreen";

const Stack = createNativeStackNavigator();

export default function DriverSubscriptionStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="SubscriptionScreen" component={SubscriptionScreen} />

    </Stack.Navigator>
  );
}
