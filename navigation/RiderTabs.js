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
import { TAB_BAR_OPTIONS, TabIcon } from '../components/ui/kit';

const Tab = createBottomTabNavigator();

export default function RiderTabs() {
  return (
    <Tab.Navigator
      screenOptions={TAB_BAR_OPTIONS}
    >
      <Tab.Screen
        name="Home"
        component={RiderHomeStack}
        options={{
          tabBarIcon: ({ color, focused }) => (
              <TabIcon name="home-outline" focused={focused} color={color} />
            ),
        }}
      />

      <Tab.Screen
        name="Trips"
        component={RiderTripsStack}
        options={{
          tabBarIcon: ({ color, focused }) => (
              <TabIcon name="time-outline" focused={focused} color={color} />
            ),
        }}
      />

      <Tab.Screen
        name="Wallet"
        component={RiderPaymentStack}
        options={{
          tabBarIcon: ({ color, focused }) => (
              <TabIcon name="wallet-outline" focused={focused} color={color} />
            ),
        }}
      />

  


      <Tab.Screen
        name="Profile"
        component={RiderProfileStack}
        options={{
          tabBarIcon: ({ color, focused }) => (
              <TabIcon name="person-outline" focused={focused} color={color} />
            ),
        }}
      />
    </Tab.Navigator>
  );
}
