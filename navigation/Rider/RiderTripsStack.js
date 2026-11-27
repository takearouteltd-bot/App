import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import PaymentsMethodScreen from "../../screens/Rider/PaymentMethods/PaymentMethodsScreen";
import AddPaymentMethodScreen from "../../screens/Rider/PaymentMethods/AddPaymentMethodScreen";
import RiderTripsScreen from "../../screens/Rider/RiderTripDetails/RiderTripsScreen";
import RiderTripDetailsScreen from "../../screens/Rider/RiderTripDetails/RiderTripDetailsScreen";
import ReportIssueScreen from "../../screens/Report/ReportIssueScreen";
import MyReportsScreen from "../../screens/Reports/MyReportsScreen";
import ReportDetailScreen from "../../screens/Reports/ReportDetailScreen";
import BookedRidesScreen from "../../screens/BookedRides/BookedRidesScreen";

const Stack = createNativeStackNavigator();

export default function RiderTripsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="RiderTripsScreen" component={RiderTripsScreen} />
      <Stack.Screen name="RiderTripDetails" component={RiderTripDetailsScreen} />
      {/* "Add a card" from a trip's tip card (RiderTripDetails): without it
          here the button did nothing unless the Wallet tab had been opened. */}
      <Stack.Screen name="AddPaymentMethod" component={AddPaymentMethodScreen} />
      <Stack.Screen name="ReportIssueScreen" component={ReportIssueScreen} />
      <Stack.Screen name="MyReports" component={MyReportsScreen} initialParams={{ role: "rider" }} />
      <Stack.Screen name="ReportDetail" component={ReportDetailScreen} />
      {/* A ride booked for later, tapped in the trips list. */}
      <Stack.Screen name="BookedRides" component={BookedRidesScreen} />
    </Stack.Navigator>
  );
}
