import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DriverTripsScreen from "../../screens/Driver/Trips/DriverTripsScreen";
import DriverTripDetailsScreen from "../../screens/Driver/Trips/DriverTripDetailsScreen";

const Stack = createNativeStackNavigator();

export default function DriverTripsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="DriverTrips" component={DriverTripsScreen} />
      <Stack.Screen name="DriverTripDetails" component={DriverTripDetailsScreen} />
    </Stack.Navigator>
  );
}
