import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import PaymentsMethodScreen from "../../screens/Rider/PaymentMethods/PaymentMethodsScreen";
import AddPaymentMethodScreen from "../../screens/Rider/PaymentMethods/AddPaymentMethodScreen";
import SuccessfulCardScreen from "../../screens/Rider/PaymentMethods/PaymentMethodSuccessful";
import RiderTripsScreen from "../../screens/Rider/RiderTripDetails/RiderTripsScreen";
import RiderTripDetailsScreen from "../../screens/Rider/RiderTripDetails/RiderTripDetailsScreen";

const Stack = createNativeStackNavigator();

export default function RiderTripsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="RiderTripsScreen" component={RiderTripsScreen} />
      <Stack.Screen name="RiderTripDetails" component={RiderTripDetailsScreen} />
    </Stack.Navigator>
  );
}
