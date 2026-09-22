import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DriverHomeScreen from "../screens/Driver/Home/DriverHomeScreen";
import DriverRideInProgressScreen from "../screens/Driver/DriverRideInProgress/DriverRideInProgressScreen";
import DriverRideToDropoffScreen from "../screens/Driver/DriverRideInProgress/DriverRideToDropoffScreen";
import RideCompletedScreen from "../screens/Driver/RideCompleted/RideCompletedScreen";
import ChatScreen from "../screens/Chat/ChatScreen";
import DriverDocumentsScreen from '../screens/Driver/Documents/DriverDocumentsScreen';


const Stack = createNativeStackNavigator();

export default function DriverStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {/* Home */}
        <Stack.Screen name='DriverHome' component={DriverHomeScreen} />
        <Stack.Screen name='DriverRideInProgress' component={DriverRideInProgressScreen} />
        <Stack.Screen name='ChatScreen' component={ChatScreen} />
        <Stack.Screen name='RideToDropoff' component={DriverRideToDropoffScreen} />
        <Stack.Screen name='RideCompleted' component={RideCompletedScreen} />
        <Stack.Screen name='DriverDocuments' component={DriverDocumentsScreen} />
      {/* Trips */}

    </Stack.Navigator>
  );
}
