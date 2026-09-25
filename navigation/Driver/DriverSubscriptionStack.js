import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import SubscriptionScreen from "../../screens/Driver/Subscription/SubscriptionScreen";
import AllPaymentMethodsScreen from "../../screens/Rider/PaymentMethods/AllPaymentMethodsScreen";
import AddPaymentMethodScreen from "../../screens/Rider/PaymentMethods/AddPaymentMethodScreen";

const Stack = createNativeStackNavigator();

// The card screens are shared with passengers: a card is saved on the account,
// and the membership falls back to it when the wallet is short.
export default function DriverSubscriptionStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="SubscriptionScreen" component={SubscriptionScreen} />
      <Stack.Screen name="AllPaymentMethods" component={AllPaymentMethodsScreen} />
      <Stack.Screen name="AddPaymentMethod" component={AddPaymentMethodScreen} />
    </Stack.Navigator>
  );
}
