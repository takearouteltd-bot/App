import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import PaymentsMethodScreen from "../../screens/Rider/PaymentMethods/PaymentMethodsScreen";
import AddPaymentMethodScreen from "../../screens/Rider/PaymentMethods/AddPaymentMethodScreen";
import SuccessfulCardScreen from "../../screens/Rider/PaymentMethods/PaymentMethodSuccessful";
import AllPaymentMethodsScreen from "../../screens/Rider/PaymentMethods/AllPaymentMethodsScreen";
import RiderProfileScreen from "../../screens/Rider/RiderProfile/RiderProfileScreen";
import EditProfileScreen from "../../screens/Rider/RiderProfile/EditProfileScreen";
import SavedPlacesScreen from "../../screens/Rider/RiderProfile/SavedPlacesScreen";
import MapPickerScreen from "../../screens/Rider/RiderProfile/MapPickerScreen";
import RiderPaymentStack from "./RiderPaymentStack";
import RiderTripsStack from "./RiderTripsStack";
import PreferencesScreen from "../../screens/Rider/RiderProfile/PreferencesScreen";

const Stack = createNativeStackNavigator();

export default function RiderProfileStack() {

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ProfileScreen" component={RiderProfileScreen} />
      <Stack.Screen name="EditProfile" component={EditProfileScreen} />
      <Stack.Screen name="SavedPlaces" component={SavedPlacesScreen} />
      <Stack.Screen name="MapPicker" component={MapPickerScreen} options={{ headerShown: false }} />
      <Stack.Screen name="PaymentMethods" component={RiderPaymentStack} options={{ headerShown: false }} />
      <Stack.Screen name="RideHistory" component={RiderTripsStack} options={{ headerShown: false }} />
      <Stack.Screen name="Preferences" component={PreferencesScreen} />

    
    </Stack.Navigator>
  );
}
