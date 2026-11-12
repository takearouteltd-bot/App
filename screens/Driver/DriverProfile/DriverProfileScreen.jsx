import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, RefreshControl } from "react-native";
import { Alert } from "../../../components/ui/alert";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { getAuth } from "firebase/auth";
import { watchMyDriverRecord } from "../../../utils/driverPrivate";
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  query,
  where,
  getCountFromServer,
  setDoc,
} from "firebase/firestore";
import { money } from '../../../utils/appConfig';
import { jobChoices } from '../../../constants/vehicleClasses';
import appJson from '../../../app.json';
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
import { confirmDeleteAccount } from '../../../utils/deleteAccount';

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
  // "Automatic": the driver's Home screen moves the city to where they are.
  // "Any area": no city, so jobs nearby from every city (by search radius).
  const AUTO_CITY = "__auto";
  const ANY_CITY = "__any";
  const saveWorkingCity = async (choice) => {
    if (!user?.uid) return;
    const city = cities.find((c) => c.id === choice);
    const update =
      choice === AUTO_CITY
        ? { workingCityAuto: true }
        : { workingCityId: city?.id || null, workingCityName: city?.name || null, workingCityAuto: false };
    try {
      await setDoc(doc(db, "drivers", user.uid), update, { merge: true });
    } catch (error) {
      Alert.alert("Could not change city", "Please try again.");
    }
  };

  // Job categories this driver wants (drivers.jobTypes). Nothing saved means
  // every category their car allows. At least one stays ticked.
  const choices = jobChoices(driver?.vehicleType);
  const ticked = Array.isArray(driver?.jobTypes)
    ? choices.filter((c) => driver.jobTypes.includes(c.id)).map((c) => c.id)
    : choices.map((c) => c.id);
  const toggleJobType = (id) => {
    if (!user?.uid) return;
    const on = ticked.includes(id);
    if (on && ticked.length === 1) {
      Alert.alert("Keep one ticked", "You need at least one job type to get jobs. Tick another first, or go offline instead.");
      return;
    }
    const next = on ? ticked.filter((t) => t !== id) : [...ticked, id];
    setDoc(doc(db, "drivers", user.uid), { jobTypes: next }, { merge: true }).catch(() =>
      Alert.alert("Could not change it", "Please try again.")
    );
  };

  // Cash jobs on or off (drivers.cashJobs; off means no cash offers).
  const cashOn = driver?.cashJobs !== false;
  const toggleCash = () => {
    if (!user?.uid) return;
    const save = () =>
      setDoc(doc(db, "drivers", user.uid), { cashJobs: !cashOn }, { merge: true }).catch(() =>
        Alert.alert("Could not change it", "Please try again.")
      );
    if (!cashOn) return save();
    Alert.alert(
      "Turn cash jobs off?",
      "You won't be offered jobs the passenger pays in cash, including phone bookings from your fleet. Your office can still send you one by name.",
      [{ text: "Keep them on", style: "cancel" }, { text: "Turn off", style: "destructive", onPress: save }]
    );
  };

  useEffect(() => {
    if (!user?.uid) return;

    // Includes the private record: the emergency contact below lives there.
    const unsubscribe = watchMyDriverRecord(
      user.uid,
      (record) => setDriver(record),
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
    if (!timestamp) return "—";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return String(date.getFullYear());
  };

  const isOnline = driver?.status === "online";
  // Between accepting and finishing a job the status is "on_ride", which used
  // to read as "Approved, offline" here.
  const onJob = driver?.status === "on_ride" || driver?.isOnRide === true;
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
            <StatusPill
              status={isOnline || onJob ? "online" : "approved"}
              label={onJob ? "On a job" : isOnline ? "Online" : "Approved, offline"}
              dot
            />
          ) : driver?.onboardingStatus === "rejected" ? (
            <StatusPill status="rejected" label="Application not approved" />
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
          { value: driver?.createdAt ? formatMemberSince(driver.createdAt) : "—", label: "joined" },
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
            { icon: "car-outline", iconColor: COLORS.midnight, title: vehicle || "Vehicle", detail: driver?.registrationNumber ? driver.registrationNumber.toUpperCase() : "No vehicle on file", onPress: () => navigation.navigate("VehicleInformation") },
            { icon: "folder-open-outline", iconColor: COLORS.midnight, title: "My documents", detail: documentAlerts.length ? `${documentAlerts.length} need${documentAlerts.length === 1 ? "s" : ""} updating` : "Licence, insurance, MOT and more", onPress: () => navigation.navigate("DriverDocuments") },
            { icon: "ribbon-outline", iconColor: COLORS.midnight, title: "Membership", detail: driver?.subscription?.paymentMethod === "admin_granted" ? "Given by TakeARoute" : driver?.subscription?.paymentMethod === "fleet" ? `Paid by ${driver.fleetName || "your fleet"}` : ({ active: "Active", past_due: "Payment due", suspended: "Paused, payment needed" })[driver?.subscription?.status] || "Not set up", onPress: () => navigation.navigate("SubscriptionDetails") },
            { icon: "people-outline", iconColor: COLORS.midnight, title: "Fleet", detail: driver?.fleetId ? `You drive for ${driver.fleetName || "a fleet"}` : driver?.fleetInvite ? `${driver.fleetInvite.fleetName || "A fleet"} invited you` : driver?.fleetRequest ? `Waiting for ${driver.fleetRequest.fleetName || "the fleet"}` : "Drive for a taxi firm", onPress: () => navigation.navigate("DriverFleet") },
          ]}
        />

        {/* Working city: jobs are only offered from here once chosen (or
            Automatic / Any area). Hidden
            until the dashboard lists at least one city. */}
        {cities.length ? (
          <SelectField
            title="Where do you want to work?"
            value={driver?.workingCityAuto ? AUTO_CITY : driver?.workingCityId || ANY_CITY}
            options={[
              { value: AUTO_CITY, label: "Automatic (where I am)", detail: "Switches to the city you're driving in" },
              { value: ANY_CITY, label: "Any area", detail: "Jobs near you from every city" },
              ...cities.map((c) => ({ value: c.id, label: c.name, detail: "Jobs picked up here only" })),
            ]}
            onChange={saveWorkingCity}
            renderTrigger={(open, selected) => (
              <RowGroup
                style={{ marginTop: SPACE[3] }}
                items={[
                  {
                    icon: "navigate-outline",
                    iconColor: COLORS.midnight,
                    title: "Working city",
                    detail: driver?.workingCityAuto
                      ? `Automatic · now ${driver?.workingCityName || "any area"}`
                      : driver?.workingCityId
                      ? `${selected?.label || driver?.workingCityName || "One city"} · jobs picked up here only`
                      : "Any area · jobs near you from every city",
                    onPress: open,
                  },
                ]}
              />
            )}
          />
        ) : null}
      </Section>

      <Section title="Jobs I want">
        <RowGroup
          items={choices.map((c) => {
            const on = ticked.includes(c.id);
            return {
              key: c.id,
              icon: on ? "checkbox" : "square-outline",
              iconColor: on ? COLORS.midnight : COLORS.faint,
              title: c.id === "RouteXL" ? "6 seater" : c.label,
              detail: on ? "You get these jobs" : "Not offered to you",
              right: null,
              onPress: () => toggleJobType(c.id),
            };
          })}
        />
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
            { icon: "cash-outline", iconColor: cashOn ? COLORS.midnight : COLORS.red, title: "Cash jobs", detail: cashOn ? "On: you're offered cash jobs" : "Off: no cash jobs offered to you", onPress: toggleCash },
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
          {
            icon: "trash-outline",
            title: "Delete my account",
            detail: driver?.fleetId ? `Removes your account and takes you out of ${driver.fleetName || "your fleet"}` : "Removes your account and details",
            danger: true,
            onPress: loggingOut ? undefined : () => confirmDeleteAccount({ onBusy: setLoggingOut }),
          },
        ]}
      />

      <View style={styles.footer}>
        <Text style={TYPE.small}>TakeARoute Driver {appJson.expo.version}</Text>
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
