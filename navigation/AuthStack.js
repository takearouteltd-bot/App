import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import LandingScreen from "../Landing/LandingScreen";
import PhoneLoginScreen from "../authentication/Phone/PhoneLogin";
import VerifyPhone from "../authentication/Phone/VerifyPhone";
import EmailAuthScreen from "../authentication/Email/EmailLogin";
import SelectUserTypeScreen from "../authentication/Select/SelectUserType";

const Stack = createNativeStackNavigator();

export default function AuthStack({
setUserRole,
setIsLoggedIn, 
setRiderOnboardingStatus,
setDriverOnboardingStatus,
}) {
return (
<Stack.Navigator screenOptions={{ headerShown: false }}>
  {/* Landing */}
  <Stack.Screen name="Landing" component={LandingScreen} />

  {/* Phone Authentication */}
  <Stack.Screen name="PhoneLogin" component={PhoneLoginScreen} />
  <Stack.Screen name="VerifyPhone" component={VerifyPhone} />


  {/* Email Authentication (login + signup) */}
 <Stack.Screen name="EmailAuth">
  {(props) => (
    <EmailAuthScreen
      {...props}
      setIsLoggedIn={setIsLoggedIn}
      setUserRole={setUserRole}
      setRiderOnboardingStatus={setRiderOnboardingStatus}
      setDriverOnboardingStatus={setDriverOnboardingStatus}
    />
  )}
</Stack.Screen>

  {/* Select Role */}
  <Stack.Screen name="SelectUserType">
    {(props) => (
      <SelectUserTypeScreen
        {...props}
        setUserRole={setUserRole}
        setIsLoggedIn={setIsLoggedIn}
        setRiderOnboardingStatus={setRiderOnboardingStatus}
        setDriverOnboardingStatus={setDriverOnboardingStatus}
      />
    )}
  </Stack.Screen>

</Stack.Navigator>


);
}
