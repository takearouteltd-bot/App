import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, RefreshControl } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { getAuth } from "firebase/auth";
import { doc, getDoc, getFirestore } from "firebase/firestore";
import {
  COLORS, TYPE, SPACE, RADIUS,
  Screen, ScreenHeader, Section, Card, RowGroup, StatRow, StatusPill, Loading,
} from '../../../components/ui/kit';
import { VEHICLE_CLASSES } from '../../../constants/vehicleClasses';

// The one class table the app matches jobs with, plus an icon per class.
const CLASS_ICONS = {
  RouteMini: "car-hatchback",
  RoutePlus: "car",
  RouteXL: "car-estate",
  RouteEco: "leaf",
  RouteExecutive: "car-sports",
};

const formatValue = (value, fallback = "Not provided") => {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
};

export default function VehicleInformationScreen({ navigation }) {
  const auth = getAuth();
  const db = getFirestore();
  const user = auth.currentUser;

  const [driver, setDriver] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchVehicleInfo = async () => {
    if (!user?.uid) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      const driverRef = doc(db, "drivers", user.uid);
      const snap = await getDoc(driverRef);
      if (snap.exists()) {
        setDriver(snap.data());
      } else {
        setDriver(null);
      }
    } catch (error) {
      console.error("Error fetching vehicle information:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchVehicleInfo();
  }, [user?.uid]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchVehicleInfo();
  };

  const make = driver?.vehicleMake || driver?.make;
  const model = driver?.vehicleModel || driver?.model;
  const makeModel = driver?.makeModel || [make, model].filter(Boolean).join(" ");
  const registration = driver?.registrationNumber || driver?.plateNumber;
  const year = driver?.vehicleYear || driver?.year;
  const type = driver?.vehicleType || driver?.bodyType;
  const typeMeta = VEHICLE_CLASSES.find((c) => c.id === type) || null;
  const seats = driver?.seats || driver?.vehicleSeats || typeMeta?.seats;
  const heroIcon = CLASS_ICONS[type] || "car-sport";
  const heroLabel = typeMeta?.label || "Vehicle category not set";
  const heroDescription =
    typeMeta?.description || "Update onboarding details to select a ride category.";

  if (loading) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.midnight} colors={[COLORS.midnight]} />
      }
    >
      <ScreenHeader title="Vehicle Information" onBack={() => navigation.goBack()} />

      <Card tone="dark" style={styles.hero}>
        <View style={styles.heroTopRow}>
          <View style={styles.heroIconWrap}>
            <MaterialCommunityIcons name={heroIcon} size={30} color={COLORS.lime} />
          </View>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>{heroLabel}</Text>
          </View>
        </View>
        <Text style={styles.heroTitle}>{formatValue(makeModel, "Vehicle not set")}</Text>
        <Text style={styles.heroSubtitle}>{formatValue(registration, "No registration added")}</Text>
        <Text style={styles.heroDescription}>{heroDescription}</Text>
        <StatRow
          tone="onDark"
          style={styles.heroStats}
          items={[
            { value: formatValue(seats, "-"), label: "Seats" },
            { value: formatValue(year, "-"), label: "Year" },
            { value: driver?.approved ? "Live" : driver?.onboardingStatus === "rejected" ? "Declined" : "Review", label: "Status" },
          ]}
        />
      </Card>

      <Section title="Ride Category">
        <Card>
          <View style={styles.categoryHeader}>
            <View style={styles.categoryIconWrap}>
              <MaterialCommunityIcons name={heroIcon} size={22} color={COLORS.midnight} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={TYPE.subhead}>{heroLabel}</Text>
              <Text style={[TYPE.small, { marginTop: 2 }]}>{heroDescription}</Text>
            </View>
          </View>
          <View style={styles.categoryFooter}>
            <Text style={styles.categoryFooterText}>
              Best for {formatValue(seats, "4")} passengers
            </Text>
          </View>
        </Card>
      </Section>

      <Section title="Vehicle Details">
        <RowGroup
          items={[
            { icon: "car-outline", iconColor: COLORS.midnight, title: "Make & Model", detail: formatValue(makeModel) },
            { icon: "card-outline", iconColor: COLORS.midnight, title: "Registration", detail: formatValue(registration) },
            { icon: "calendar-outline", iconColor: COLORS.midnight, title: "Year", detail: formatValue(year) },
            { icon: "pricetag-outline", iconColor: COLORS.midnight, title: "Ride Category", detail: formatValue(heroLabel) },
            { icon: "people-outline", iconColor: COLORS.midnight, title: "Seats", detail: formatValue(seats) },
          ]}
        />
      </Section>

      <Section title="Status">
        <Card>
          <StatusPill
            status={driver?.approved ? "approved" : driver?.onboardingStatus === "rejected" ? "rejected" : "pending"}
            label={driver?.approved ? "Approved Vehicle" : driver?.onboardingStatus === "rejected" ? "Not approved" : "Pending Review"}
            dot
          />
          <Text style={[TYPE.body, { color: COLORS.muted, marginTop: SPACE[3] }]}>
            Keep your vehicle details up to date so your account stays compliant.
          </Text>
        </Card>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { marginTop: SPACE[4] },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: SPACE[4],
  },
  heroIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.midnightSoft,
    justifyContent: "center",
    alignItems: "center",
  },
  heroBadge: {
    backgroundColor: COLORS.lime,
    paddingHorizontal: SPACE[3],
    paddingVertical: SPACE[2],
    borderRadius: RADIUS.pill,
  },
  heroBadgeText: { color: COLORS.midnight, fontSize: 12, fontWeight: "800" },
  heroTitle: { ...TYPE.heading, color: COLORS.white },
  heroSubtitle: { ...TYPE.callout, color: COLORS.lime, marginTop: SPACE[1] },
  heroDescription: { ...TYPE.small, color: COLORS.onDark, marginTop: SPACE[2] },
  heroStats: { marginTop: SPACE[5], justifyContent: "space-between" },
  categoryHeader: { flexDirection: "row", alignItems: "center", gap: SPACE[3] },
  categoryIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: COLORS.limeSoft,
    justifyContent: "center",
    alignItems: "center",
  },
  categoryFooter: {
    marginTop: SPACE[4],
    paddingTop: SPACE[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.line,
  },
  categoryFooterText: { ...TYPE.label, color: COLORS.limeInk },
});
