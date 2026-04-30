import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import PersonalInformationScreen from "../authentication/Driver/PersonalInformationScreen";
import IdentityVerificationScreen from "../authentication/Driver/IdentityVerificationScreen";
import VehicleDetailsScreen from "../authentication/Driver/VehicleDetailsScreen";
import PayoutDetailsScreen from "../authentication/Driver/PayoutDetailsScreen";
import ApplicationSummaryScreen from "../authentication/Driver/FinalReviewScreen";
import SubscriptionScreen from "../authentication/Driver/SubscriptionScreen";

const Stack = createNativeStackNavigator();

export default function DriverOnboardingStack({ setOnboardingStatus }) {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>

      <Stack.Screen name="PersonalInformation">
        {(props) => (
          <PersonalInformationScreen
            {...props}
            setOnboardingStatus={setOnboardingStatus}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="IdentityVerification">
        {(props) => (
          <IdentityVerificationScreen
            {...props}
            setOnboardingStatus={setOnboardingStatus}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="VehicleDetails">
        {(props) => (
          <VehicleDetailsScreen
            {...props}
            setOnboardingStatus={setOnboardingStatus}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="PayoutDetails">
        {(props) => (
          <PayoutDetailsScreen
            {...props}
            setOnboardingStatus={setOnboardingStatus}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="FinalReview">
        {(props) => (
          <ApplicationSummaryScreen
            {...props}
            setOnboardingStatus={setOnboardingStatus}
          />
        )}
      </Stack.Screen>

      {/* <Stack.Screen name="Subscription">
        {(props) => (
          <SubscriptionScreen
            {...props}
            setOnboardingStatus={setOnboardingStatus}
          />
        )}
      </Stack.Screen> */}


    </Stack.Navigator>
  );
}