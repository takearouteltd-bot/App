import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import PaymentsMethodScreen from "../../screens/Rider/PaymentMethods/PaymentMethodsScreen";
import AddPaymentMethodScreen from "../../screens/Rider/PaymentMethods/AddPaymentMethodScreen";
import AllPaymentMethodsScreen from "../../screens/Rider/PaymentMethods/AllPaymentMethodsScreen";
import RiderProfileScreen from "../../screens/Rider/RiderProfile/RiderProfileScreen";
import EditProfileScreen from "../../screens/Rider/RiderProfile/EditProfileScreen";
import SavedPlacesScreen from "../../screens/Rider/RiderProfile/SavedPlacesScreen";
import MapPickerScreen from "../../screens/Rider/RiderProfile/MapPickerScreen";
import RiderPaymentStack from "./RiderPaymentStack";
import RiderTripsStack from "./RiderTripsStack";
import PreferencesScreen from "../../screens/Rider/RiderProfile/PreferencesScreen";
import InboxScreen from "../../screens/Inbox/InboxScreen";
import MyReportsScreen from "../../screens/Reports/MyReportsScreen";
import ReportDetailScreen from "../../screens/Reports/ReportDetailScreen";
import ReportIssueScreen from "../../screens/Report/ReportIssueScreen";
import EmergencyContactScreen from "../../screens/Safety/EmergencyContactScreen";

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
      <Stack.Screen name="Inbox" component={InboxScreen} initialParams={{ role: "rider" }} />
      <Stack.Screen name="MyReports" component={MyReportsScreen} initialParams={{ role: "rider" }} />
      <Stack.Screen name="ReportDetail" component={ReportDetailScreen} />
      <Stack.Screen name="ReportIssueScreen" component={ReportIssueScreen} initialParams={{ reporterType: "rider" }} />
      <Stack.Screen name="EmergencyContact" component={EmergencyContactScreen} initialParams={{ role: "rider" }} />

    
    </Stack.Navigator>
  );
}
