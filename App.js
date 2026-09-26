import "./config/firebase";
import "react-native-gesture-handler";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { LogBox, View, Text } from "react-native";
import { NavigationContainer, createNavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { auth, db } from "./config/firebase";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

import AuthStack from "./navigation/AuthStack";
import RiderNavigator from "./navigation/RiderNavigator";
import DriverNavigator from "./navigation/DriverNavigator";
import { StripeProvider } from "@stripe/stripe-react-native";
import SplashScreen from "./Splash/SplashScreen";
import { AlertHost } from "./components/ui/alert";
import * as NativeSplash from "expo-splash-screen";
import { startAppConfigSync } from "./utils/appConfig";
import {
  registerForPushNotifications,
  onNotificationOpened,
  takeLaunchNotification,
  signOutEverywhere,
} from "./utils/notifications";
import { COLORS, SPACE, TYPE, Button } from './components/ui/kit';

const Stack = createNativeStackNavigator();

// Lets a notification tap navigate from outside any screen.
const navigationRef = createNavigationContainerRef();

// Keep the native launch screen up until our own splash has drawn over it;
// Splash/SplashScreen hides it. Without this it vanished on the first frame
// and showed white before the JS splash appeared.
NativeSplash.preventAutoHideAsync().catch(() => {});

LogBox.ignoreLogs([
  "Uncaught Error in snapshot listener",
  "permission-denied",
  "Missing or insufficient permissions",
]);

/* Where a tapped notification should take the person, by the `type` the
   Cloud Functions put in every push and the role they are signed in as.
   Anything unknown, or a mismatch of role, opens the home tab, which resumes
   a live ride by itself. */
function routeForNotification(data, role) {
  const type = data?.type;
  if (role === "driver") {
    const tab = (name, params) => ["DriverNavigator", { screen: "DriverTabs", params: { screen: name, params } }];
    if (type === "report" && data.reportId) {
      return tab("Account", { screen: "ReportDetail", params: { reportId: data.reportId, role: "driver" } });
    }
    if (type === "announcement") return tab("Account", { screen: "Inbox", params: { role: "driver" } });
    if (type === "change_request") return tab("Account", { screen: "DriverPersonalInformation" });
    if (type === "membership") return tab("Membership");
    // job_offer, trip, chat and anything else: the driver home resumes the
    // current job and shows new offers.
    return tab("Home", { screen: "DriverHome" });
  }
  if (role === "rider") {
    const tab = (name, params) => ["RiderNavigator", { screen: "RiderTabs", params: { screen: name, params } }];
    if (type === "report" && data.reportId) {
      return tab("Profile", { screen: "ReportDetail", params: { reportId: data.reportId, role: "rider" } });
    }
    if (type === "announcement") return tab("Profile", { screen: "Inbox", params: { role: "rider" } });
    if (type === "counter_offer" && data.rideId) {
      return tab("Home", { screen: "RideRequest", params: { rideId: data.rideId } });
    }
    if (type === "chat" && data.rideId) {
      // A chat push only exists once a driver is assigned; the tracking screen
      // hands over to the in-progress screen by itself.
      return tab("Home", { screen: "RideTracking", params: { rideId: data.rideId } });
    }
    // trip updates and anything else: the home screen shows the live ride.
    return tab("Home", { screen: "HomeScreen" });
  }
  return null;
}

export default function App() {
  const [initializing, setInitializing] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [userRole, setUserRole] = useState(null);
  const [riderOnboardingStatus, setRiderOnboardingStatus] = useState("not_started");
  const [driverOnboardingStatus, setDriverOnboardingStatus] = useState(null);
  // Set from the admin dashboard (Users > Block account).
  const [isBlocked, setIsBlocked] = useState(false);
  // Bumped on sign-out so the sign-in flow starts again from the first screen.
  const [authEpoch, setAuthEpoch] = useState(0);
  const [navReady, setNavReady] = useState(false);

  // Latest role for the notification handler, which lives outside React's
  // render cycle; and a tap that arrived before the app was ready to act.
  const roleRef = useRef(null);
  const pendingTap = useRef(null);
  const launchTapChecked = useRef(false);

  useEffect(() => {
    let unsubscribeUserDoc = null;
    let unsubscribeRoleDoc = null;
    let watchedRole = null;
    // Which account this phone's push token has been saved for.
    let pushRegisteredFor = null;

    const stopRoleDoc = () => {
      if (unsubscribeRoleDoc) {
        unsubscribeRoleDoc();
        unsubscribeRoleDoc = null;
      }
      watchedRole = null;
    };

    // The role record (riders/{uid} or drivers/{uid}) is watched live, so a
    // block, an approval or a finished sign-up step takes effect at once
    // instead of on the next launch.
    const watchRoleDoc = (uid, role) => {
      stopRoleDoc();
      const collection = role === "rider" ? "riders" : "drivers";
      unsubscribeRoleDoc = onSnapshot(
        doc(db, collection, uid),
        (snap) => {
          const data = snap.exists() ? snap.data() : null;
          setIsBlocked(data?.blocked === true);

          if (role === "rider") {
            if (!data || !data.fullName) {
              setRiderOnboardingStatus("profile");
            } else if (!data.locationEnabled) {
              setRiderOnboardingStatus("location");
            } else {
              setRiderOnboardingStatus("complete");
            }
          } else if (!data || !data.onboardingComplete) {
            setDriverOnboardingStatus("onboarding");
          } else if (data.onboardingStatus === "rejected") {
            setDriverOnboardingStatus("rejected");
          } else if (!data.approved) {
            setDriverOnboardingStatus("pending");
          } else {
            setDriverOnboardingStatus("complete");
          }
          setInitializing(false);
        },
        (error) => {
          // Sign-out races the listener; nothing to do.
          if (error.code !== "permission-denied") console.error("Role doc snapshot error:", error);
          setInitializing(false);
        }
      );
    };

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      // Clean up previous listeners
      if (unsubscribeUserDoc) {
        unsubscribeUserDoc();
        unsubscribeUserDoc = null;
      }
      stopRoleDoc();
      pushRegisteredFor = null;

      if (!user) {
        setSignedIn(false);
        setIsBlocked(false);
        setUserRole(null);
        roleRef.current = null;
        setDriverOnboardingStatus(null);
        setRiderOnboardingStatus("not_started");
        setAuthEpoch((n) => n + 1);
        setInitializing(false);
        return;
      }

      const uid = user.uid;
      setSignedIn(true);

      // Load admin settings (currency, prices, limits) once signed in.
      startAppConfigSync();

      unsubscribeUserDoc = onSnapshot(
        doc(db, "users", uid),
        (snap) => {
          if (!snap.exists()) {
            // An account whose record never got written (sign-up interrupted
            // offline, or an old orphaned login). Create it and let the
            // person pick how they use the app; merge, so a role written in
            // the meantime is kept.
            setDoc(
              doc(db, "users", uid),
              {
                email: user.email || null,
                phoneNumber: user.phoneNumber || null,
                role: null,
                createdAt: serverTimestamp(),
                authProvider: user.providerData?.[0]?.providerId || "unknown",
              },
              { merge: true }
            ).catch((error) => console.log("Could not create user record:", error));
            stopRoleDoc();
            setUserRole(null);
            roleRef.current = null;
            setIsBlocked(false);
            setInitializing(false);
            return;
          }

          const role = snap.data().role === "driver" ? "driver" : snap.data().role === "rider" ? "rider" : null;
          setUserRole(role);
          roleRef.current = role;

          if (!role) {
            stopRoleDoc();
            setIsBlocked(false);
            setInitializing(false);
            return;
          }

          // Save this phone for push notifications (job offers, trip updates,
          // messages) once there is a role to send them for. Asks permission
          // the first time.
          if (pushRegisteredFor !== uid) {
            pushRegisteredFor = uid;
            registerForPushNotifications(uid);
          }

          // The users record changes for other reasons too (updatedAt); only
          // start a new watch when the role itself changes.
          if (watchedRole !== role) {
            watchRoleDoc(uid, role);
            watchedRole = role;
          }
        },
        (error) => {
          if (error.code === "permission-denied") {
            console.log("User doc listener: permission denied");
            return;
          }
          console.error("User doc snapshot error:", error);
          setInitializing(false);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeUserDoc) unsubscribeUserDoc();
      stopRoleDoc();
    };
  }, []);

  // Belt and braces: whatever renders first, the native splash must not be
  // left covering the app.
  useEffect(() => {
    if (!initializing) NativeSplash.hideAsync().catch(() => {});
  }, [initializing]);

  /* ---------------- notification taps ---------------- */

  // Acts on a tapped notification, or keeps it until the app can.
  const openFromNotification = useCallback((data) => {
    if (!data) return;
    const role = roleRef.current;
    if (!navigationRef.isReady() || !role) {
      pendingTap.current = data;
      return;
    }
    const target = routeForNotification(data, role);
    if (target) navigationRef.navigate(...target);
  }, []);

  useEffect(() => onNotificationOpened(openFromNotification), [openFromNotification]);

  // Once navigation and the role are both ready: the tap that launched the
  // app from cold, then any tap that arrived while it was still loading.
  useEffect(() => {
    if (!navReady || !userRole || initializing) return;
    let cancelled = false;
    (async () => {
      if (!launchTapChecked.current) {
        launchTapChecked.current = true;
        const data = await takeLaunchNotification();
        if (cancelled) return;
        if (data) pendingTap.current = data;
      }
      const data = pendingTap.current;
      pendingTap.current = null;
      if (data) openFromNotification(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [navReady, userRole, initializing, openFromNotification]);

  if (initializing) {
    return <SplashScreen />;
  }

  if (isBlocked) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.surface, alignItems: "center", justifyContent: "center", padding: SPACE[7] }}>
        <Text style={[TYPE.title, { textAlign: "center", marginBottom: SPACE[3] }]}>
          Account suspended
        </Text>
        <Text style={[TYPE.body, { color: COLORS.muted, textAlign: "center", marginBottom: SPACE[6] }]}>
          Your TakeARoute account has been suspended. Please contact support if you think this is a mistake.
        </Text>
        <Button title="Sign out" variant="dark" onPress={() => signOutEverywhere().catch(() => {})} />
        <AlertHost />
      </View>
    );
  }

  return (
    <StripeProvider
      publishableKey="pk_test_51T4pFQEZ0ibzrAsgeuyTPpR8IZlV1Crsq1B5cLKaMo2UqLWmWENtmZqARrVpLnO7WCv3xv3JZaTFh3fES00qBgr100445BbowE"
    >
      <NavigationContainer ref={navigationRef} onReady={() => setNavReady(true)}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {!userRole && (
            // Signed in but no role chosen yet (the record was created but the
            // person closed the app): straight to the choice, not a second
            // sign-in. Remounted on sign-out so it starts at the first screen.
            <Stack.Screen name="Auth" key={`auth-${authEpoch}`}>
              {(props) => (
                <AuthStack
                  {...props}
                  initialRouteName={signedIn ? "SelectUserType" : "Landing"}
                  setUserRole={setUserRole}
                  setRiderOnboardingStatus={setRiderOnboardingStatus}
                  setDriverOnboardingStatus={setDriverOnboardingStatus}
                />
              )}
            </Stack.Screen>
          )}

          {userRole === "rider" && (
            <Stack.Screen name="RiderNavigator">
              {(props) => (
                <RiderNavigator
                  {...props}
                  onboardingStatus={riderOnboardingStatus}
                  setOnboardingStatus={setRiderOnboardingStatus}
                />
              )}
            </Stack.Screen>
          )}

          {userRole === "driver" && (
            <Stack.Screen name="DriverNavigator">
              {(props) => (
                <DriverNavigator
                  {...props}
                  onboardingStatus={driverOnboardingStatus}
                  setOnboardingStatus={setDriverOnboardingStatus}
                />
              )}
            </Stack.Screen>
          )}
        </Stack.Navigator>
      </NavigationContainer>
      <AlertHost />
    </StripeProvider>
  );
}
