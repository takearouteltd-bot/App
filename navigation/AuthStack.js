import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import LandingScreen from "../Landing/LandingScreen";
import PhoneLoginScreen from "../authentication/Phone/PhoneLogin";
import VerifyPhone from "../authentication/Phone/VerifyPhone";
import Login from "../authentication/Login";
import Signup from "../authentication/Signup";
import SelectUserTypeScreen from "../authentication/Select/SelectUserType";

const Stack = createNativeStackNavigator();

export default function AuthStack({ setUserRole, setIsLoggedIn }) {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Landing" component={LandingScreen} />
      <Stack.Screen name="PhoneLogin" component={PhoneLoginScreen} />
      <Stack.Screen name="VerifyPhone" component={VerifyPhone} />
      <Stack.Screen name="Login" component={Login} />
      <Stack.Screen name="Signup" component={Signup} />

      {/* 👇 FIXED PART */}
      <Stack.Screen name="SelectUserType">
        {(props) => (
          <SelectUserTypeScreen
            {...props}
            setUserRole={setUserRole}
            setIsLoggedIn={setIsLoggedIn}
          />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
