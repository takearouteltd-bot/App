import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import DestinationSearchScreen from "../screens/Destination/DestinationScreen";
import FareEstimationScreen from "../screens/FareEstimation/FareEstimationScreen";
import RideRequestScreen from "../screens/RideRequest/RideRequestScreen";
import RideTrackingScreen from "../screens/RideTrack/RideTrackingScreen";
import RideInProgressScreen from "../screens/RideInProgress/RideInProgressScreen";
import RiderRideCompletedScreen from "../screens/RideCompleted/RiderRideCompletedScreen";
import HomeScreen from "../screens/Home/HomeScreen";
import PickupPickerScreen from "../screens/Home/PickupPickerScreen";
import ChatScreen from "../screens/Chat/ChatScreen";
import RiderPaymentStack from "./Rider/RiderPaymentStack";

const Stack = createNativeStackNavigator();

export default function RiderHomeStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="HomeScreen" component={HomeScreen} />
      <Stack.Screen name="PickupPicker" component={PickupPickerScreen} />
      <Stack.Screen name="DestinationSearch" component={DestinationSearchScreen} />
      <Stack.Screen name="FareEstimation" component={FareEstimationScreen} />
      <Stack.Screen name="AddPayment" component={RiderPaymentStack} />
      <Stack.Screen name="RideRequest" component={RideRequestScreen} />
      <Stack.Screen name="ChatScreen" component={ChatScreen} />
      <Stack.Screen name="RideTracking" component={RideTrackingScreen} />
      <Stack.Screen name="RideInProgress" component={RideInProgressScreen} />
      <Stack.Screen name="RiderRideCompleted" component={RiderRideCompletedScreen} />
      
    </Stack.Navigator>
  );
}
