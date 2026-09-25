import React, { useEffect, useState, useCallback } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Alert } from "../../../components/ui/alert";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { db, auth } from "../../../config/firebase";
import { money } from '../../../utils/appConfig';
import { COLORS, TYPE, Card, ListRow, Button, Loading } from '../../../components/ui/kit';
import ModeSwitchRow from '../../../components/ModeSwitchRow';
import { openTerms, openPrivacy } from '../../../utils/legal';

const PRIMARY = COLORS.green;
const SECONDARY = COLORS.blue;
const DANGER = COLORS.red;
const BG = COLORS.surface;

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
            await auth.signOut();
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
      <SafeAreaView style={styles.safe}>
        <Loading />
      </SafeAreaView>
    );
  }

  if (!currentUser) {
    return (
      <SafeAreaView style={[styles.safe, styles.centered]}>
        <Ionicons name="person-circle-outline" size={64} color={COLORS.line} />
        <Text style={[TYPE.heading, { marginTop: 12 }]}>You are signed out</Text>
        <Button title="Sign in" style={{ marginTop: 20, alignSelf: 'stretch' }} onPress={() => navigation.navigate("Login")} />
      </SafeAreaView>
    );
  }

  const displayName = riderData?.fullName || currentUser.displayName || "Passenger";
  const photoURL = riderData?.profileImage;
  const memberSince = riderData?.createdAt
    ? new Date(riderData.createdAt.toDate()).toLocaleDateString("en-GB", { month: "long", year: "numeric" })
    : currentUser.metadata?.creationTime
    ? new Date(currentUser.metadata.creationTime).toLocaleDateString("en-GB", { month: "long", year: "numeric" })
    : null;

  const group = (items) => (
    <Card style={{ paddingVertical: 0 }}>
      {items.map((item, i) => (
        <ListRow key={item.title} {...item} last={i === items.length - 1} />
      ))}
    </Card>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.green} />}
      >
        {/* Identity. The photo is the one large element on the screen. */}
        <View style={styles.identity}>
          <TouchableOpacity onPress={() => navigation.navigate("EditProfile", { riderData })} activeOpacity={0.85}>
            {photoURL ? (
              <Image source={{ uri: photoURL }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarEmpty]}>
                <Text style={styles.initial}>{displayName.charAt(0).toUpperCase()}</Text>
              </View>
            )}
          </TouchableOpacity>
          <Text style={styles.name}>{displayName}</Text>
          <Text style={TYPE.small}>
            {memberSince ? `Riding with TakeARoute since ${memberSince}` : "Riding with TakeARoute"}
          </Text>
        </View>

        {/* Two facts, not a dashboard. */}
        <View style={styles.facts}>
          <View style={styles.fact}>
            <Text style={styles.factValue}>{stats.totalRides}</Text>
            <Text style={TYPE.small}>{stats.totalRides === 1 ? "trip" : "trips"}</Text>
          </View>
          <View style={styles.factRule} />
          <View style={styles.fact}>
            <Text style={styles.factValue}>{money(stats.totalSpent)}</Text>
            <Text style={TYPE.small}>spent</Text>
          </View>
        </View>

        <Text style={styles.groupTitle}>Account</Text>
        {group([
          { icon: "person-outline", title: "Personal details", detail: "Name, phone, email and photo", onPress: () => navigation.navigate("EditProfile", { riderData }) },
          { icon: "location-outline", title: "Saved places", detail: "Home, work and regular destinations", onPress: () => navigation.navigate("SavedPlaces") },
          { icon: "card-outline", title: "Payment", detail: riderData?.defaultPaymentMethodId ? "Card saved" : "Add a card to book", onPress: () => navigation.navigate("PaymentMethods") },
          { icon: "time-outline", title: "Trip history", detail: "Past trips and receipts", onPress: () => navigation.navigate("RideHistory") },
          { icon: "mail-outline", title: "Messages", detail: "Updates from TakeARoute", onPress: () => navigation.navigate("Inbox", { role: "rider" }) },
        ])}

        {/* Same account, other mode. Hidden until it knows what to offer. */}
        <View style={{ marginTop: 26 }}>
          <ModeSwitchRow uid={currentUser.uid} currentRole="rider" />
        </View>

        <Text style={styles.groupTitle}>Help and safety</Text>
        {group([
          { icon: "chatbubbles-outline", title: "My reports", detail: "Issues, lost property and replies from support", onPress: () => navigation.navigate("MyReports", { role: "rider" }) },
          { icon: "shield-checkmark-outline", iconColor: COLORS.red, title: "Safety", detail: riderData?.emergencyContact?.name ? `Emergency contact: ${riderData.emergencyContact.name}` : "Add an emergency contact", onPress: () => navigation.navigate("EmergencyContact", { role: "rider" }) },
          { icon: "document-text-outline", title: "Terms of use", onPress: openTerms },
          { icon: "lock-closed-outline", title: "Privacy policy", onPress: openPrivacy },
        ])}

        <Button title="Sign out" variant="secondary" style={{ marginTop: 28 }} onPress={handleLogout} />

        <View style={styles.footer}>
          <Image source={require("../../../assets/myicon.png")} style={styles.footerLogo} resizeMode="contain" />
          <Text style={TYPE.small}>TakeARoute 1.0</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.surface },
  centered: { alignItems: "center", justifyContent: "center", padding: 32 },
  content: { padding: 20, paddingBottom: 40 },
  identity: { alignItems: "center", paddingTop: 20, paddingBottom: 8 },
  avatar: { width: 108, height: 108, borderRadius: 36 },
  avatarEmpty: { backgroundColor: COLORS.navy, alignItems: "center", justifyContent: "center" },
  initial: { fontSize: 44, fontWeight: "800", color: COLORS.white },
  name: { fontSize: 26, fontWeight: "800", color: COLORS.navy, letterSpacing: -0.4, marginTop: 14 },
  facts: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    marginTop: 22, marginBottom: 6,
  },
  fact: { alignItems: "center", paddingHorizontal: 28 },
  factValue: { fontSize: 22, fontWeight: "800", color: COLORS.navy, letterSpacing: -0.3 },
  factRule: { width: 1, height: 36, backgroundColor: COLORS.line },
  groupTitle: { ...TYPE.heading, marginTop: 26, marginBottom: 10 },
  footer: { alignItems: "center", marginTop: 36, gap: 6 },
  footerLogo: { width: 40, height: 40, opacity: 0.6 },
});
