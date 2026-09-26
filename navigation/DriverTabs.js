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
import { TAB_BAR_OPTIONS, TabIcon } from '../components/ui/kit';

const Tab = createBottomTabNavigator();

export default function DriverTabs() {
    return (
      <Tab.Navigator
        screenOptions={TAB_BAR_OPTIONS}
      >
        <Tab.Screen
          name="Home"
          component={DriverStack}
          options={{
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="car-outline" focused={focused} color={color} />
            ),
          }}
        />
  
        <Tab.Screen
          name="Trips"
          component={DriverTripsStack}
          options={{
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="map-outline" focused={focused} color={color} />
            ),
          }}
        />
  
        <Tab.Screen
          name="Earnings"
          component={DriverEarningsStack}

          options={{
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="cash-outline" focused={focused} color={color} />
            ),
          }}
        />
    
        <Tab.Screen
          name="Membership"
          component={DriverSubscriptionStack}
          options={{
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="star-outline" focused={focused} color={color} />
            ),
          }}
        />
        <Tab.Screen
          name="Account"
          component={DriverProfileStack}
          options={{
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="person-outline" focused={focused} color={color} />
            ),
          }}
        />
      </Tab.Navigator>
    );
  }
  
