import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, RefreshControl } from "react-native";
import { Alert } from "../../../components/ui/alert";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  query,
  where,
  getCountFromServer,
  onSnapshot,
  setDoc,
} from "firebase/firestore";
import { money } from '../../../utils/appConfig';
import {
  COLORS,
  TYPE,
  SPACE,
  Screen,
  Section,
  Card,
  RowGroup,
  StatusPill,
  StatRow,
  Avatar,
  PresenceDot,
  Loading,
} from '../../../components/ui/kit';
import ModeSwitchRow from '../../../components/ModeSwitchRow';
import SelectField from '../../../components/ui/SelectField';
import { useCities } from '../../../utils/cities';
import { openTerms, openPrivacy } from '../../../utils/legal';
import { expiryAlertsFor, describeExpiry } from '../../../constants/driverDocuments';
import { signOutEverywhere } from '../../../utils/notifications';

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

  const cities = useCities();
  const saveWorkingCity = async (cityId) => {
    if (!user?.uid) return;
    const city = cities.find((c) => c.id === cityId);
    try {
      await setDoc(
        doc(db, "drivers", user.uid),
        { workingCityId: cityId, workingCityName: city?.name || null },
        { merge: true }
      );
    } catch (error) {
      Alert.alert("Could not change city", "Please try again.");
    }
  };

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

      // Count completed trips on the server rather than downloading them all.
      const ridesQ = query(
        collection(db, "rides"),
        where("driverId", "==", user.uid),
        where("status", "==", "completed")
      );
      const countSnap = await getCountFromServer(ridesQ);
      setTripCount(countSnap.data().count || 0);
    } catch (error) {
      // Offline, or the listener outliving sign-out: nothing to tell the driver.
      if (error?.code === "unavailable" || error?.code === "permission-denied") return;
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
            // Drops this phone's push token first, so the next account on
            // this phone does not receive this one's job alerts.
            await signOutEverywhere();
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
  const vehicle = driver?.makeModel || "";
  const name = driver?.fullName || [driver?.firstName, driver?.lastName].filter(Boolean).join(" ") || "Driver";

  if (loading) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.midnight} />}
    >
      {/* Identity */}
      <View style={styles.identity}>
        <Avatar uri={driver?.selfieUrl} name={name} size={88} badge={<PresenceDot online={isOnline} size={22} />} />
        <Text style={styles.name}>{name}</Text>
        <View style={{ marginTop: SPACE[2] }}>
          {isApproved ? (
            <StatusPill status={isOnline ? "online" : "approved"} label={isOnline ? "Online" : "Approved, offline"} dot />
          ) : (
            <StatusPill status="pending" label="Application under review" />
          )}
        </View>
      </View>

      {/* Three facts */}
      <StatRow
        style={styles.facts}
        items={[
          { value: String(tripCount), label: tripCount === 1 ? "trip" : "trips" },
          { value: rating || "New", label: "rating" },
          { value: driver?.createdAt ? formatMemberSince(driver.createdAt) : "2026", label: "joined" },
        ]}
      />

      {/* Earnings: the one bold element. */}
      {/* The screen lives in the Earnings tab's stack; naming the tab first
          works before that tab has ever been opened. */}
      <Card tone="dark" onPress={() => navigation.navigate("Earnings", { screen: "EarningsScreen" })}>
        <View style={styles.earnings}>
          <View style={{ flex: 1 }}>
            <Text style={styles.earningsLabel}>Available balance</Text>
            <Text style={styles.earningsValue}>{money(availableBalance)}</Text>
            <Text style={styles.earningsSub}>{money(totalEarned)} earned in total</Text>
          </View>
          <View style={styles.earningsArrow}>
            <Ionicons name="arrow-forward" size={20} color={COLORS.midnight} />
          </View>
        </View>
      </Card>

      {documentAlerts.length ? (
        <Card tone={documentAlerts[0].status === "expired" ? "danger" : "warning"} style={{ marginTop: SPACE[3] }} onPress={() => navigation.navigate("DriverDocuments")}>
          <Text style={TYPE.callout}>
            {documentAlerts[0].label}: {describeExpiry(documentAlerts[0]).toLowerCase()}
          </Text>
          <Text style={TYPE.small}>
            {documentAlerts.length > 1 ? `and ${documentAlerts.length - 1} more. ` : ""}Tap to upload a replacement.
          </Text>
        </Card>
      ) : null}

      <Section title="Driving">
        <RowGroup
          items={[
            { icon: "car-outline", iconColor: COLORS.midnight, title: vehicle || "Vehicle", detail: driver?.registrationNumber ? driver.registrationNumber.toUpperCase() : "Add your vehicle details", onPress: () => navigation.navigate("VehicleInformation") },
            { icon: "folder-open-outline", iconColor: COLORS.midnight, title: "My documents", detail: documentAlerts.length ? `${documentAlerts.length} need${documentAlerts.length === 1 ? "s" : ""} updating` : "Licence, insurance, MOT and more", onPress: () => navigation.navigate("DriverDocuments") },
            { icon: "ribbon-outline", iconColor: COLORS.midnight, title: "Membership", detail: ({ active: "Active", past_due: "Payment due", suspended: "Paused, payment needed" })[driver?.subscription?.status] || "Not set up", onPress: () => navigation.navigate("SubscriptionDetails") },
          ]}
        />

        {/* Working city: jobs are only offered from here once chosen. Hidden
            until the dashboard lists at least one city. */}
        {cities.length ? (
          <SelectField
            title="Where do you want to work?"
            value={driver?.workingCityId || null}
            options={cities.map((c) => ({ value: c.id, label: c.name }))}
            onChange={saveWorkingCity}
            renderTrigger={(open, selected) => (
              <RowGroup
                style={{ marginTop: SPACE[3] }}
                items={[
                  {
                    icon: "navigate-outline",
                    iconColor: COLORS.midnight,
                    title: "Working city",
                    detail: selected ? `${selected.label} · jobs picked up here only` : "Any area, choose a city",
                    onPress: open,
                  },
                ]}
              />
            )}
          />
        ) : null}
      </Section>

      <Section title="Account">
        <RowGroup
          items={[
            { icon: "person-outline", iconColor: COLORS.midnight, title: "Personal details", detail: "Name, phone, email and address", onPress: () => navigation.navigate("DriverPersonalInformation") },
            { icon: "mail-outline", iconColor: COLORS.midnight, title: "Messages", detail: "Updates from TakeARoute", onPress: () => navigation.navigate("Inbox", { role: "driver" }) },
          ]}
        />
      </Section>

      {/* Same account, other mode. Hidden until it knows what to offer. */}
      <View style={{ marginTop: SPACE[7] }}>
        <ModeSwitchRow uid={user?.uid} currentRole="driver" />
      </View>

      <Section title="Help and safety">
        <RowGroup
          items={[
            { icon: "chatbubbles-outline", iconColor: COLORS.midnight, title: "My reports", detail: "Issues, lost property and replies from support", onPress: () => navigation.navigate("MyReports", { role: "driver" }) },
            { icon: "shield-checkmark-outline", iconColor: COLORS.red, title: "Safety", detail: driver?.emergencyContact?.name ? `Emergency contact: ${driver.emergencyContact.name}` : "Add your next of kin", onPress: () => navigation.navigate("EmergencyContact", { role: "driver" }) },
            { icon: "document-text-outline", iconColor: COLORS.midnight, title: "Terms of use", onPress: openTerms },
            { icon: "lock-closed-outline", iconColor: COLORS.midnight, title: "Privacy policy", onPress: openPrivacy },
          ]}
        />
      </Section>

      <RowGroup
        style={{ marginTop: SPACE[7] }}
        items={[
          {
            icon: "log-out-outline",
            title: "Sign out",
            danger: true,
            onPress: loggingOut ? undefined : handleLogout,
            right: loggingOut ? <ActivityIndicator color={COLORS.red} /> : undefined,
          },
        ]}
      />

      <View style={styles.footer}>
        <Text style={TYPE.small}>TakeARoute Driver 1.0</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { alignItems: "center", paddingTop: SPACE[5], paddingBottom: SPACE[2] },
  name: { ...TYPE.title, marginTop: SPACE[4], textAlign: "center" },
  facts: { marginTop: SPACE[5], marginBottom: SPACE[5] },
  earnings: { flexDirection: "row", alignItems: "center", gap: SPACE[3] },
  earningsLabel: { ...TYPE.label, color: COLORS.lime },
  earningsValue: { ...TYPE.display, fontSize: 36, color: COLORS.white, marginTop: SPACE[1] },
  earningsSub: { ...TYPE.small, color: COLORS.onDark, marginTop: 2 },
  earningsArrow: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.lime,
    alignItems: "center", justifyContent: "center",
  },
  footer: { alignItems: "center", marginTop: SPACE[8] },
});
