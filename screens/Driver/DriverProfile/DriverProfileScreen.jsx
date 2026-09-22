import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  Image,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { getAuth, signOut } from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
} from "firebase/firestore";
import { money } from '../../../utils/appConfig';
import { COLORS, TYPE, Card, ListRow, StatusPill, Button, Loading } from '../../../components/ui/kit';
import ModeSwitchRow from '../../../components/ModeSwitchRow';
import { openTerms, openPrivacy } from '../../../utils/legal';
import { expiryAlertsFor, describeExpiry } from '../../../constants/driverDocuments';

const PRIMARY = COLORS.green;
const SECONDARY = COLORS.blue;
const DANGER = COLORS.red;
const BG = COLORS.surface;

export default function DriverProfileScreen() {
  const navigation = useNavigation();
  const auth = getAuth();
  const db = getFirestore();
  const user = auth.currentUser;

  const [driver, setDriver] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [tripCount, setTripCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (!user?.uid) return;

    const driverRef = doc(db, "drivers", user.uid);
    const unsubscribe = onSnapshot(
      driverRef,
      (snap) => {
        if (snap.exists()) {
          setDriver(snap.data());
        } else {
          setDriver(null);
        }
      },
      (error) => {
        console.error("Error listening to driver profile:", error);
      }
    );

    return unsubscribe;
  }, [db, user?.uid]);

  const fetchData = async () => {
    if (!user) return;

    try {
      // Fetch wallet
      const walletRef = doc(db, "driverWallets", user.uid);
      const walletSnap = await getDoc(walletRef);
      if (walletSnap.exists()) {
        setWallet(walletSnap.data());
      } else {
        setWallet({ availableBalance: 0, totalEarned: 0, pendingBalance: 0 });
      }

      // Fetch rides and count completed trips (in-memory filter)
      const ridesQ = query(
        collection(db, "rides"),
        where("driverId", "==", user.uid)
      );
      const ridesSnap = await getDocs(ridesQ);

      let completedTrips = 0;
      ridesSnap.forEach((doc) => {
        const data = doc.data();
        if (data.route?.status === "completed" || data.status === "completed") {
          completedTrips += 1;
        }
      });
      setTripCount(completedTrips);
    } catch (error) {
      console.error("Error fetching driver data:", error);
      Alert.alert("Error", "Failed to load profile data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [user]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          setLoggingOut(true);
          try {
            await signOut(auth);
          } catch (error) {
            Alert.alert("Error", "Failed to sign out. Please try again.");
            setLoggingOut(false);
          }
        },
      },
    ]);
  };

  // Year they joined, e.g. "2026". Used in the facts row.
  const formatMemberSince = (timestamp) => {
    if (!timestamp) return "2026";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return String(date.getFullYear());
  };

  const isOnline = driver?.status === "online";
  const isApproved = driver?.approved === true && driver?.onboardingComplete === true;

  const availableBalance = wallet?.availableBalance || 0;
  const totalEarned = wallet?.totalEarned || 0;

  const rating = driver?.rating ? Number(driver.rating).toFixed(1) : null;
  const documentAlerts = driver ? expiryAlertsFor(driver) : [];
  const vehicle = [driver?.vehicleColor, driver?.makeModel].filter(Boolean).join(" ");

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <Loading />
      </SafeAreaView>
    );
  }

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
        {/* Identity */}
        <View style={styles.identity}>
          <View>
            {driver?.selfieUrl ? (
              <Image source={{ uri: driver.selfieUrl }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarEmpty]}>
                <Text style={styles.initial}>{(driver?.fullName || driver?.firstName || "D").charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <View style={[styles.presence, { backgroundColor: isOnline ? COLORS.green : COLORS.faint }]} />
          </View>
          <Text style={styles.name}>{driver?.fullName || [driver?.firstName, driver?.lastName].filter(Boolean).join(" ") || "Driver"}</Text>
          <View style={{ marginTop: 8 }}>
            {isApproved ? (
              <StatusPill status="approved" label={isOnline ? "Online" : "Approved, offline"} />
            ) : (
              <StatusPill status="pending" label="Application under review" />
            )}
          </View>
        </View>

        {/* Three facts */}
        <View style={styles.facts}>
          <View style={styles.fact}>
            <Text style={styles.factValue}>{tripCount}</Text>
            <Text style={TYPE.small}>{tripCount === 1 ? "trip" : "trips"}</Text>
          </View>
          <View style={styles.factRule} />
          <View style={styles.fact}>
            <Text style={styles.factValue}>{rating || "New"}</Text>
            <Text style={TYPE.small}>rating</Text>
          </View>
          <View style={styles.factRule} />
          <View style={styles.fact}>
            <Text style={styles.factValue}>{driver?.createdAt ? formatMemberSince(driver.createdAt) : "2026"}</Text>
            <Text style={TYPE.small}>joined</Text>
          </View>
        </View>

        {/* Earnings: the one bold element. */}
        <TouchableOpacity activeOpacity={0.9} style={styles.earnings} onPress={() => navigation.navigate("EarningsScreen")}>
          <View style={{ flex: 1 }}>
            <Text style={styles.earningsLabel}>Available to withdraw</Text>
            <Text style={styles.earningsValue}>{money(availableBalance)}</Text>
            <Text style={styles.earningsSub}>{money(totalEarned)} earned in total</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color={COLORS.onDark} />
        </TouchableOpacity>

        {documentAlerts.length ? (
          <Card tone={documentAlerts[0].status === "expired" ? "danger" : "warning"} style={{ marginTop: 12 }} onPress={() => navigation.navigate("DriverDocuments")}>
            <Text style={[TYPE.body, { fontWeight: "700" }]}>
              {documentAlerts[0].label}: {describeExpiry(documentAlerts[0]).toLowerCase()}
            </Text>
            <Text style={TYPE.small}>
              {documentAlerts.length > 1 ? `and ${documentAlerts.length - 1} more. ` : ""}Tap to upload a replacement.
            </Text>
          </Card>
        ) : null}

        <Text style={styles.groupTitle}>Driving</Text>
        {group([
          { icon: "car-outline", title: vehicle || "Vehicle", detail: driver?.registrationNumber ? driver.registrationNumber.toUpperCase() : "Add your vehicle details", onPress: () => navigation.navigate("VehicleInformation") },
          { icon: "folder-open-outline", title: "My documents", detail: documentAlerts.length ? `${documentAlerts.length} need${documentAlerts.length === 1 ? "s" : ""} updating` : "Licence, insurance, MOT and more", onPress: () => navigation.navigate("DriverDocuments") },
          { icon: "ribbon-outline", title: "Subscription", detail: driver?.subscription?.status === "active" ? "Active" : driver?.subscription?.status === "suspended" ? "Suspended, top up your wallet" : "Not set up", onPress: () => navigation.navigate("SubscriptionDetails") },
        ])}

        <Text style={styles.groupTitle}>Account</Text>
        {group([
          { icon: "person-outline", title: "Personal details", detail: "Name, phone, email and address", onPress: () => navigation.navigate("DriverPersonalInformation") },
          { icon: "mail-outline", title: "Messages", detail: "Updates from TakeARoute", onPress: () => navigation.navigate("Inbox", { role: "driver" }) },
        ])}

        {/* Same account, other mode. Hidden until it knows what to offer. */}
        <View style={{ marginTop: 26 }}>
          <ModeSwitchRow uid={user?.uid} currentRole="driver" />
        </View>

        <Text style={styles.groupTitle}>Help and safety</Text>
        {group([
          { icon: "chatbubbles-outline", title: "My reports", detail: "Issues, lost property and replies from support", onPress: () => navigation.navigate("MyReports", { role: "driver" }) },
          { icon: "shield-checkmark-outline", iconColor: COLORS.red, title: "Safety", detail: driver?.emergencyContact?.name ? `Emergency contact: ${driver.emergencyContact.name}` : "Add your next of kin", onPress: () => navigation.navigate("EmergencyContact", { role: "driver" }) },
          { icon: "document-text-outline", title: "Terms of use", onPress: openTerms },
          { icon: "lock-closed-outline", title: "Privacy policy", onPress: openPrivacy },
        ])}

        <Button title="Sign out" variant="secondary" style={{ marginTop: 28 }} loading={loggingOut} onPress={handleLogout} />

        <View style={styles.footer}>
          <Text style={TYPE.small}>TakeARoute Driver 1.0</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.surface },
  content: { padding: 20, paddingBottom: 40 },
  identity: { alignItems: "center", paddingTop: 20, paddingBottom: 6 },
  avatar: { width: 108, height: 108, borderRadius: 36 },
  avatarEmpty: { backgroundColor: COLORS.navy, alignItems: "center", justifyContent: "center" },
  initial: { fontSize: 44, fontWeight: "800", color: COLORS.white },
  presence: {
    position: "absolute", right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11,
    borderWidth: 3, borderColor: COLORS.surface,
  },
  name: { fontSize: 26, fontWeight: "800", color: COLORS.navy, letterSpacing: -0.4, marginTop: 14 },
  facts: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 20, marginBottom: 18 },
  fact: { alignItems: "center", paddingHorizontal: 22, minWidth: 90 },
  factValue: { fontSize: 22, fontWeight: "800", color: COLORS.navy, letterSpacing: -0.3 },
  factRule: { width: 1, height: 36, backgroundColor: COLORS.line },
  earnings: {
    flexDirection: "row", alignItems: "center", backgroundColor: COLORS.navy,
    borderRadius: 22, padding: 22,
  },
  earningsLabel: { fontSize: 14, fontWeight: "600", color: COLORS.onDark },
  earningsValue: { fontSize: 36, fontWeight: "800", color: COLORS.white, letterSpacing: -1, marginTop: 2 },
  earningsSub: { fontSize: 13, color: COLORS.onDark, marginTop: 2 },
  groupTitle: { ...TYPE.heading, marginTop: 26, marginBottom: 10 },
  footer: { alignItems: "center", marginTop: 36 },
});
