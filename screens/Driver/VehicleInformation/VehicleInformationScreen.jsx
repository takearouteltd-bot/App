import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { getAuth } from "firebase/auth";
import { doc, getDoc, getFirestore } from "firebase/firestore";
import { COLORS } from '../../../components/ui/kit';

const PRIMARY = COLORS.primary;
const SECONDARY = COLORS.blue;
const BG = COLORS.surface;
const VEHICLE_TYPE_META = {
  RouteMini: {
    label: "RouteMini",
    description: "Affordable everyday rides",
    icon: "car",
    passengers: 4,
  },
  RoutePlus: {
    label: "RoutePlus",
    description: "Comfortable sedans",
    icon: "car",
    passengers: 4,
  },
  RouteXL: {
    label: "RouteXL",
    description: "Spacious SUVs for groups",
    icon: "car-estate",
    passengers: 6,
  },
  RouteEco: {
    label: "RouteEco",
    description: "Eco-friendly hybrid rides",
    icon: "leaf",
    passengers: 4,
  },
  RouteExecutive: {
    label: "Executive",
    description: "Premium luxury experience",
    icon: "car-wash",
    passengers: 4,
  },
};

const formatValue = (value, fallback = "Not provided") => {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
};

const InfoRow = ({ icon, label, value }) => (
  <View style={styles.infoRow}>
    <View style={styles.infoIconWrap}>
      <MaterialCommunityIcons name={icon} size={20} color={SECONDARY} />
    </View>
    <View style={styles.infoContent}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{formatValue(value)}</Text>
    </View>
  </View>
);

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
  const color = driver?.vehicleColor || driver?.color;
  const registration = driver?.registrationNumber || driver?.plateNumber;
  const year = driver?.vehicleYear || driver?.year;
  const type = driver?.vehicleType || driver?.bodyType;
  const typeMeta = VEHICLE_TYPE_META[type] || null;
  const seats = driver?.seats || driver?.vehicleSeats || typeMeta?.passengers;
  const heroIcon = typeMeta?.icon || "car-sport";
  const heroLabel = typeMeta?.label || "Vehicle category not set";
  const heroDescription =
    typeMeta?.description || "Update onboarding details to select a ride category.";

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
        }
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={24} color={SECONDARY} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Vehicle Information</Text>
          <View style={{ width: 24 }} />
        </View>

        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroIconWrap}>
              <MaterialCommunityIcons name={heroIcon} size={34} color={SECONDARY} />
            </View>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>{heroLabel}</Text>
            </View>
          </View>
          <Text style={styles.heroTitle}>{formatValue(makeModel, "Vehicle not set")}</Text>
          <Text style={styles.heroSubtitle}>
            {formatValue(registration, "No registration added")}
          </Text>
          <Text style={styles.heroDescription}>{heroDescription}</Text>
          <View style={styles.heroMetaRow}>
            <View style={styles.heroMetaCard}>
              <Text style={styles.heroMetaValue}>{formatValue(seats, "-")}</Text>
              <Text style={styles.heroMetaLabel}>Seats</Text>
            </View>
            <View style={styles.heroMetaCard}>
              <Text style={styles.heroMetaValue}>{formatValue(year, "-")}</Text>
              <Text style={styles.heroMetaLabel}>Year</Text>
            </View>
            <View style={styles.heroMetaCard}>
              <Text style={styles.heroMetaValue}>{driver?.approved ? "Live" : "Review"}</Text>
              <Text style={styles.heroMetaLabel}>Status</Text>
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Ride Category</Text>
        <View style={styles.categoryCard}>
          <View style={styles.categoryHeader}>
            <View style={styles.categoryIconWrap}>
              <MaterialCommunityIcons name={heroIcon} size={22} color={PRIMARY} />
            </View>
            <View style={styles.categoryContent}>
              <Text style={styles.categoryTitle}>{heroLabel}</Text>
              <Text style={styles.categoryDescription}>{heroDescription}</Text>
            </View>
          </View>
          <View style={styles.categoryFooter}>
            <Text style={styles.categoryFooterText}>
              Best for {formatValue(seats, "4")} passengers
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Vehicle Details</Text>
        <View style={styles.sectionCard}>
          <InfoRow icon="car-info" label="Make & Model" value={makeModel} />
          <InfoRow icon="card-text-outline" label="Registration" value={registration} />
          <InfoRow icon="palette-outline" label="Color" value={color} />
          <InfoRow icon="calendar-outline" label="Year" value={year} />
          <InfoRow icon="car-estate" label="Ride Category" value={heroLabel} />
          <InfoRow icon="seat-passenger" label="Seats" value={seats} />
        </View>

        <Text style={styles.sectionTitle}>Status</Text>
        <View style={styles.statusCard}>
          <View style={[styles.statusPill, { backgroundColor: driver?.approved ? PRIMARY : "#9E9E9E" }]}>
            <Text style={styles.statusPillText}>
              {driver?.approved ? "Approved Vehicle" : "Pending Review"}
            </Text>
          </View>
          <Text style={styles.statusDescription}>
            Keep your vehicle details up to date so your account stays compliant.
          </Text>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  centered: {
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: SECONDARY,
  },
  heroCard: {
    marginHorizontal: 20,
    marginTop: 10,
    backgroundColor: COLORS.white,
    borderRadius: 20,
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  heroTopRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  heroIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: SECONDARY + "12",
    justifyContent: "center",
    alignItems: "center",
  },
  heroBadge: {
    backgroundColor: COLORS.limeSoft,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  heroBadgeText: {
    color: PRIMARY,
    fontSize: 12,
    fontWeight: "800",
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: COLORS.ink,
    textAlign: "center",
  },
  heroSubtitle: {
    fontSize: 14,
    color: "#7A7A7A",
    marginTop: 6,
    textAlign: "center",
  },
  heroDescription: {
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.muted,
    textAlign: "center",
    marginTop: 10,
  },
  heroMetaRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
  },
  heroMetaCard: {
    flex: 1,
    backgroundColor: BG,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: "center",
  },
  heroMetaValue: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.ink,
  },
  heroMetaLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#8E8E93",
    textTransform: "uppercase",
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.ink,
    marginTop: 24,
    marginHorizontal: 20,
    marginBottom: 12,
  },
  categoryCard: {
    marginHorizontal: 20,
    backgroundColor: COLORS.white,
    borderRadius: 18,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  categoryHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  categoryIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: COLORS.limeSoft,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  categoryContent: {
    flex: 1,
  },
  categoryTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.ink,
  },
  categoryDescription: {
    fontSize: 13,
    color: "#777",
    marginTop: 4,
    lineHeight: 18,
  },
  categoryFooter: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "#EFEFF4",
  },
  categoryFooterText: {
    fontSize: 12,
    fontWeight: "700",
    color: PRIMARY,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  sectionCard: {
    marginHorizontal: 20,
    backgroundColor: COLORS.white,
    borderRadius: 18,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    gap: 12,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  infoIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: SECONDARY + "10",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#8E8E93",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.ink,
    marginTop: 4,
  },
  statusCard: {
    marginHorizontal: 20,
    backgroundColor: COLORS.white,
    borderRadius: 18,
    padding: 18,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  statusPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  statusPillText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: "700",
  },
  statusDescription: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.muted,
    marginTop: 12,
  },
});
