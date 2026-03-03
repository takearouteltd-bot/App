import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";

import DriverHomeScreen from "../screens/Driver/Home/DriverHomeScreen";
import DriverStack from "./DriverStack";
import DriverTripsScreen from "../screens/Driver/Trips/DriverTripsScreen";
import DriverTripsStack from "./Driver/DriverTripStack";
import EarningsScreen from "../screens/Driver/Earnings/EarningsScreen";
import DriverEarningsStack from "./Driver/DriverEarningsStack";
import SubscriptionScreen from "../screens/Driver/Subscription/SubscriptionScreen";
import DriverSubscriptionStack from "./Driver/DriverSubscriptionStack";
import DriverProfileScreen from "../screens/Driver/DriverProfile/DriverProfileScreen";
import DriverProfileStack from "./Driver/DriverProfileStack";

const Tab = createBottomTabNavigator();
const PRIMARY = "#79B531";

export default function DriverTabs() {
    return (
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: PRIMARY,
        }}
      >
        <Tab.Screen
          name="Home"
          component={DriverStack}
          options={{
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="car-outline" size={size} color={color} />
            ),
          }}
        />
  
        <Tab.Screen
          name="Trips"
          component={DriverTripsStack}
          options={{
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="map-outline" size={size} color={color} />
            ),
          }}
        />
  
        <Tab.Screen
          name="Earnings"
          component={DriverEarningsStack}

          options={{
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="cash-outline" size={size} color={color} />
            ),
          }}
        />
    
        <Tab.Screen
          name="Membership"
          component={DriverSubscriptionStack}
          options={{
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="star-outline" size={size} color={color} />
            ),
          }}
        />
        <Tab.Screen
          name="Account"
          component={DriverProfileStack}
          options={{
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="person-outline" size={size} color={color} />
            ),
          }}
        />
      </Tab.Navigator>
    );
  }
  
