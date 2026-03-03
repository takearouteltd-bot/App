import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import EarningsScreen from "../../screens/Driver/Earnings/EarningsScreen";
import WithdrawScreen from "../../screens/Driver/Earnings/WithdrawScreen";
import WithdrawalSuccessScreen from "../../screens/Driver/Earnings/WithdrawalSuccessful";

const Stack = createNativeStackNavigator();

export default function DriverEarningsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="EarningsScreen" component={EarningsScreen} />
      <Stack.Screen name="WithdrawScreen" component={WithdrawScreen} />
      <Stack.Screen name="WithdrawSuccess" component={WithdrawalSuccessScreen} />

    </Stack.Navigator>
  );
}
