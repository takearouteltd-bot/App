import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DriverTripsScreen from "../../screens/Driver/Trips/DriverTripsScreen";
import DriverTripDetailsScreen from "../../screens/Driver/Trips/DriverTripDetailsScreen";
import ReportIssueScreen from "../../screens/Report/ReportIssueScreen";
import MyReportsScreen from "../../screens/Reports/MyReportsScreen";
import ReportDetailScreen from "../../screens/Reports/ReportDetailScreen";

const Stack = createNativeStackNavigator();

export default function DriverTripsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="DriverTrips" component={DriverTripsScreen} />
      <Stack.Screen name="DriverTripDetails" component={DriverTripDetailsScreen} />
      <Stack.Screen name="ReportIssueScreen" component={ReportIssueScreen} />
      <Stack.Screen name="MyReports" component={MyReportsScreen} initialParams={{ role: "driver" }} />
      <Stack.Screen name="ReportDetail" component={ReportDetailScreen} />
      
    </Stack.Navigator>
  );
}
