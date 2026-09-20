import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import PaymentsMethodScreen from "../../screens/Rider/PaymentMethods/PaymentMethodsScreen";
import AddPaymentMethodScreen from "../../screens/Rider/PaymentMethods/AddPaymentMethodScreen";
import SuccessfulCardScreen from "../../screens/Rider/PaymentMethods/PaymentMethodSuccessful";
import RiderTripsScreen from "../../screens/Rider/RiderTripDetails/RiderTripsScreen";
import RiderTripDetailsScreen from "../../screens/Rider/RiderTripDetails/RiderTripDetailsScreen";
import ReportIssueScreen from "../../screens/Report/ReportIssueScreen";
import MyReportsScreen from "../../screens/Reports/MyReportsScreen";
import ReportDetailScreen from "../../screens/Reports/ReportDetailScreen";

const Stack = createNativeStackNavigator();

export default function RiderTripsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="RiderTripsScreen" component={RiderTripsScreen} />
      <Stack.Screen name="RiderTripDetails" component={RiderTripDetailsScreen} />
      <Stack.Screen name="ReportIssueScreen" component={ReportIssueScreen} />
      <Stack.Screen name="MyReports" component={MyReportsScreen} initialParams={{ role: "rider" }} />
      <Stack.Screen name="ReportDetail" component={ReportDetailScreen} />
    </Stack.Navigator>
  );
}
