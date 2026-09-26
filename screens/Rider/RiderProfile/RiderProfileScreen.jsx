import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, Image, RefreshControl } from "react-native";
import { Alert } from "../../../components/ui/alert";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { db, auth } from "../../../config/firebase";
import { money } from '../../../utils/appConfig';
import {
  COLORS,
  TYPE,
  SPACE,
  Screen,
  Section,
  RowGroup,
  Button,
  Loading,
  Avatar,
  StatRow,
  EmptyState,
} from '../../../components/ui/kit';
import ModeSwitchRow from '../../../components/ModeSwitchRow';
import { openTerms, openPrivacy } from '../../../utils/legal';
import { signOutEverywhere } from '../../../utils/notifications';

export default function RiderProfileScreen() {
  const navigation = useNavigation();
  const [currentUser, setCurrentUser] = useState(null);
  const [riderData, setRiderData] = useState(null);
  const [stats, setStats] = useState({ totalRides: 0, rating: "New", totalSpent: "0.00" });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });
    return unsubscribe;
  }, []);

const fetchRiderData = useCallback(async () => {
  if (!currentUser?.uid) {
    setLoading(false);
    return;
  }

  try {
    const riderRef = doc(db, "riders", currentUser.uid);
    const riderSnap = await getDoc(riderRef);

    if (riderSnap.exists()) {
      setRiderData(riderSnap.data());
    }

    const ridesQuery = query(
      collection(db, "rides"),
      where("riderId", "==", currentUser.uid),
      where("status", "==", "completed")
    );
    const ridesSnap = await getDocs(ridesQuery);

    let totalRides = 0;
    let totalRating = 0;
    let ratedRides = 0;
    let totalSpent = 0;

    ridesSnap.forEach((docSnap) => {
      const ride = docSnap.data();
      totalRides++;
      totalSpent += ride.fare?.total || 0;

      if (ride.rating?.driverToRider && typeof ride.rating.driverToRider === "number") {
        totalRating += ride.rating.driverToRider;
        ratedRides++;
      }
    });

    setStats({
      totalRides,
      rating: ratedRides > 0 ? (totalRating / ratedRides).toFixed(1) : "New",
      totalSpent: totalSpent.toFixed(2),
    });
  } catch (error) {
    // Silently ignore permission-denied during sign-out
    if (error.code === "permission-denied") {
      console.log("Permission denied — likely signing out");
      return;
    }
    console.error("Error fetching rider data:", error);
    Alert.alert("Error", "Failed to load profile data. Please try again.");
  } finally {
    setLoading(false);
    setRefreshing(false);
  }
}, [currentUser]);

  // Fetch data when user is available or screen is focused
  useEffect(() => {
    if (currentUser) {
      fetchRiderData();
    } else {
      setLoading(false);
    }
  }, [currentUser, fetchRiderData]);

  useFocusEffect(
    useCallback(() => {
      if (currentUser) {
        fetchRiderData();
      }
    }, [currentUser, fetchRiderData])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchRiderData();
  };


  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        onPress: async () => {
          try {
            // Drops this phone's push token first, so the next account on
            // this phone does not receive this one's alerts.
            await signOutEverywhere();
            // Navigation to login should be handled by your auth state listener in App.js
          } catch (error) {
            Alert.alert("Error", "Failed to sign out. Please try again.");
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  if (!currentUser) {
    return (
      <Screen scroll={false} style={{ justifyContent: 'center' }}>
        <EmptyState
          icon="person-circle-outline"
          title="You are signed out"
          action={<Button title="Sign in" onPress={() => navigation.navigate("Login")} />}
        />
      </Screen>
    );
  }

  const displayName = riderData?.fullName || currentUser.displayName || "Passenger";
  const photoURL = riderData?.profileImage;
  const memberSince = riderData?.createdAt
    ? new Date(riderData.createdAt.toDate()).toLocaleDateString("en-GB", { month: "long", year: "numeric" })
    : currentUser.metadata?.creationTime
    ? new Date(currentUser.metadata.creationTime).toLocaleDateString("en-GB", { month: "long", year: "numeric" })
    : null;

  const openEdit = () => navigation.navigate("EditProfile", { riderData });

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.midnight} />}
    >
      {/* Identity. The photo is the one large element on the screen. */}
      <View style={styles.hero}>
        <Avatar uri={photoURL} name={displayName} size={72} />
        <View style={{ flex: 1 }}>
          <Text style={TYPE.title} numberOfLines={2}>{displayName}</Text>
          <Text style={[TYPE.small, { marginTop: SPACE[1] }]}>
            {memberSince ? `Riding with TakeARoute since ${memberSince}` : "Riding with TakeARoute"}
          </Text>
        </View>
      </View>
      <Button title="Edit" variant="secondary" size="small" icon="create-outline" style={styles.editBtn} onPress={openEdit} />

      {/* Two facts, not a dashboard. */}
      <StatRow
        style={styles.facts}
        items={[
          { value: stats.totalRides, label: stats.totalRides === 1 ? "trip" : "trips" },
          { value: money(stats.totalSpent), label: "spent" },
        ]}
      />

      <Section title="Account">
        <RowGroup
          items={[
            { icon: "person-outline", title: "Personal details", detail: "Name, phone, email and photo", onPress: openEdit },
            { icon: "location-outline", title: "Saved places", detail: "Home, work and regular destinations", onPress: () => navigation.navigate("SavedPlaces") },
            { icon: "time-outline", title: "Trip history", detail: "Past trips and receipts", onPress: () => navigation.navigate("RideHistory") },
            { icon: "mail-outline", title: "Messages", detail: "Updates from TakeARoute", onPress: () => navigation.navigate("Inbox", { role: "rider" }) },
          ]}
        />
      </Section>

      <Section title="Payments">
        <RowGroup
          items={[
            { icon: "card-outline", title: "Payment", detail: riderData?.defaultPaymentMethodId ? "Card saved" : "Add a card to book", onPress: () => navigation.navigate("PaymentMethods") },
          ]}
        />
      </Section>

      {/* Same account, other mode. Hidden until it knows what to offer. */}
      <View style={{ marginTop: SPACE[7] }}>
        <ModeSwitchRow uid={currentUser.uid} currentRole="rider" />
      </View>

      <Section title="Safety">
        <RowGroup
          items={[
            { icon: "shield-checkmark-outline", iconColor: COLORS.red, title: "Safety", detail: riderData?.emergencyContact?.name ? `Emergency contact: ${riderData.emergencyContact.name}` : "Add an emergency contact", onPress: () => navigation.navigate("EmergencyContact", { role: "rider" }) },
          ]}
        />
      </Section>

      <Section title="Support">
        <RowGroup
          items={[
            { icon: "chatbubbles-outline", title: "My reports", detail: "Issues, lost property and replies from support", onPress: () => navigation.navigate("MyReports", { role: "rider" }) },
            { icon: "document-text-outline", title: "Terms of use", onPress: openTerms },
            { icon: "lock-closed-outline", title: "Privacy policy", onPress: openPrivacy },
          ]}
        />
      </Section>

      <Section>
        <RowGroup items={[{ icon: "log-out-outline", title: "Sign out", danger: true, onPress: handleLogout }]} />
      </Section>

      <View style={styles.footer}>
        <Image source={require("../../../assets/myicon.png")} style={styles.footerLogo} resizeMode="contain" />
        <Text style={TYPE.small}>TakeARoute 1.0</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: "row", alignItems: "center", gap: SPACE[4], paddingTop: SPACE[2] },
  editBtn: { alignSelf: "flex-start", marginTop: SPACE[4] },
  facts: { marginTop: SPACE[6] },
  footer: { alignItems: "center", marginTop: SPACE[10], gap: SPACE[2] },
  footerLogo: { width: 40, height: 40, opacity: 0.6 },
});
