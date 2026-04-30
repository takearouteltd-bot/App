import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";

import HomeScreen from "../screens/Home/HomeScreen";
import RiderHomeStack from "./RiderHomeStack";
import RiderProfileScreen from "../screens/Rider/RiderProfile/RiderProfileScreen";
import PaymentsMethodScreen from "../screens/Rider/PaymentMethods/PaymentMethodsScreen";
import RiderPaymentStack from "./Rider/RiderPaymentStack";
import RiderTripsStack from "./Rider/RiderTripsStack";
import RiderProfileStack from "./Rider/RiderProfileStack";

const Tab = createBottomTabNavigator();
const PRIMARY = "#79B531";

export default function RiderTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: PRIMARY,
      }}
    >
      <Tab.Screen
        name="Home"
        component={RiderHomeStack}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />

      <Tab.Screen
        name="Trips"
        component={RiderTripsStack}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="time-outline" size={size} color={color} />
          ),
        }}
      />

      <Tab.Screen
        name="Wallet"
        component={RiderPaymentStack}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="wallet-outline" size={size} color={color} />
          ),
        }}
      />

  


      <Tab.Screen
        name="Profile"
        component={RiderProfileStack}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}
