import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import PaymentsMethodScreen from "../../screens/Rider/PaymentMethods/PaymentMethodsScreen";
import AddPaymentMethodScreen from "../../screens/Rider/PaymentMethods/AddPaymentMethodScreen";
import AllPaymentMethodsScreen from "../../screens/Rider/PaymentMethods/AllPaymentMethodsScreen";

const Stack = createNativeStackNavigator();

export default function RiderPaymentStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="PaymentsScreen" component={PaymentsMethodScreen} />
      <Stack.Screen name="AllPaymentMethods" component={AllPaymentMethodsScreen} />
      <Stack.Screen name="AddPaymentMethod" component={AddPaymentMethodScreen} />

    </Stack.Navigator>
  );
}
