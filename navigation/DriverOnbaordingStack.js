import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import PersonalInformationScreen from "../authentication/Driver/PersonalInformationScreen";
import IdentityVerificationScreen from "../authentication/Driver/IdentityVerificationScreen";
import VehicleDetailsScreen from "../authentication/Driver/VehicleDetailsScreen";
import PayoutDetailsScreen from "../authentication/Driver/PayoutDetailsScreen";
import ApplicationSummaryScreen from "../authentication/Driver/FinalReviewScreen";

const Stack = createNativeStackNavigator();

export default function DriverOnboardingStack({ setOnboardingStatus }) {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      
      <Stack.Screen
        name="PersonalInformation"
        component={PersonalInformationScreen}
      />

      <Stack.Screen
        name="IdentityVerification"
        component={IdentityVerificationScreen}
      />

      <Stack.Screen
        name="VehicleDetails"
        component={VehicleDetailsScreen}
      />

      <Stack.Screen
        name="PayoutDetails"
        component={PayoutDetailsScreen}
      />

      {/* 🔥 IMPORTANT FIX HERE */}
      <Stack.Screen name="FinalReview">
        {(props) => (
          <ApplicationSummaryScreen
            {...props}
            setOnboardingStatus={setOnboardingStatus}
          />
        )}
      </Stack.Screen>

    </Stack.Navigator>
  );
}
