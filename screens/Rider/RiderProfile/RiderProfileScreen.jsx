import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { db, auth } from "../../../config/firebase";
import { currencySymbol } from '../../../utils/appConfig';

const PRIMARY = "#79B531";
const SECONDARY = "#235594";
const DANGER = "#D32F2F";
const BG = "#F8F9FA";

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
  

  
  const StatCard = ({ icon, value, label, color }) => (
    <View style={[styles.statCard, { borderTopColor: color }]}>
      <Ionicons name={icon} size={22} color={color} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );

  const MenuItem = ({ icon, title, subtitle, danger, onPress, badge }) => (
    <TouchableOpacity style={styles.menuItem} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.menuLeft}>
        <View style={[styles.menuIcon, danger && { backgroundColor: "#FEE2E2" }]}>
          <Ionicons name={icon} size={20} color={danger ? DANGER : PRIMARY} />
        </View>
        <View style={styles.menuTextContainer}>
          <Text style={[styles.menuTitle, danger && { color: DANGER }]}>{title}</Text>
          {subtitle && <Text style={styles.menuSubtitle}>{subtitle}</Text>}
        </View>
      </View>
      <View style={styles.menuRight}>
        {badge && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        )}
        <Ionicons name="chevron-forward" size={18} color="#C1C1C1" />
      </View>
    </TouchableOpacity>
  );

  const SectionHeader = ({ title }) => (
    <Text style={styles.sectionHeader}>{title}</Text>
  );

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  if (!currentUser) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Ionicons name="person-circle-outline" size={64} color="#ccc" />
        <Text style={styles.notSignedInText}>Not signed in</Text>
        <TouchableOpacity
          style={styles.signInButton}
          onPress={() => navigation.navigate("Login")}
        >
          <Text style={styles.signInButtonText}>Sign In</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Data resolution priority: Firestore rider data > Firebase Auth user data
  const displayName = riderData?.fullName || currentUser.displayName || "Rider";
  const photoURL = riderData?.profileImage;
  const memberSince = riderData?.createdAt
    ? new Date(riderData.createdAt.toDate()).toLocaleDateString("en-GB", {
        month: "short",
        year: "numeric",
      })
    : currentUser.metadata?.creationTime
    ? new Date(currentUser.metadata.creationTime).toLocaleDateString("en-GB", {
        month: "short",
        year: "numeric",
      })
    : "Recently";

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PRIMARY} />
        }
      >
        {/* Header */}
        <View style={styles.header}>

          <View style={styles.profileSection}>
            <View style={styles.avatarContainer}>
              {photoURL ? (
                <Image source={{ uri: photoURL }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <Text style={styles.avatarInitial}>{displayName.charAt(0).toUpperCase()}</Text>
                </View>
              )}
              <View style={styles.verifiedBadge}>
                <Ionicons name="checkmark-circle" size={18} color={PRIMARY} />
              </View>
            </View>

            <Text style={styles.name}>{displayName}</Text>

            <View style={styles.metaRow}>
              <View style={styles.metaItem}>
                <Ionicons name="calendar-outline" size={12} color="rgba(255,255,255,0.7)" />
                <Text style={styles.metaText}>Member since {memberSince}</Text>
              </View>
            </View>

            {riderData?.locationEnabled && (
              <View style={styles.locationBadge}>
                <Ionicons name="location" size={10} color="#fff" />
                <Text style={styles.locationText}>Location On</Text>
              </View>
            )}
          </View>
        </View>

        {/* Stats Dashboard */}
        <View style={styles.statsContainer}>
          <StatCard icon="car-outline" value={stats.totalRides} label="Rides" color={PRIMARY} />
          <StatCard icon="wallet-outline" value={`${currencySymbol()}stats.totalSpent}`} label="Spent" color={SECONDARY} />
        </View>

        {/* Menu Sections */}
        <View style={styles.content}>
          <SectionHeader title="Account" />

          <MenuItem
            icon="person-outline"
            title="Personal Information"
            subtitle="Name, phone, email & photo"
            onPress={() => navigation.navigate("EditProfile", { riderData })}
          />

          <MenuItem
            icon="location-outline"
            title="Saved Places"
            subtitle="Home, work & frequent destinations"
            onPress={() => navigation.navigate("SavedPlaces")}
          />

          <MenuItem
            icon="card-outline"
            title="Payment Methods"
            subtitle="Cards, wallet & billing history"
            badge={riderData?.defaultPaymentMethodId ? "Active" : null}
            onPress={() => navigation.navigate("PaymentMethods")}
          />

          <MenuItem
            icon="receipt-outline"
            title="Ride History"
            subtitle="View past trips & receipts"
            onPress={() => navigation.navigate("RideHistory")}
          />

          <MenuItem
            icon="mail-outline"
            title="Messages"
            subtitle="Updates & offers from TakeARoute"
            onPress={() => navigation.navigate("Inbox", { role: "rider" })}
          />

          <SectionHeader title="Help & safety" />

          <MenuItem
            icon="chatbubbles-outline"
            title="My Reports"
            subtitle="Issues, lost property & replies from support"
            onPress={() => navigation.navigate("MyReports", { role: "rider" })}
          />

          <MenuItem
            icon="shield-checkmark-outline"
            title="Safety"
            subtitle={riderData?.emergencyContact?.name ? `Emergency contact: ${riderData.emergencyContact.name}` : "Add an emergency contact"}
            onPress={() => navigation.navigate("EmergencyContact", { role: "rider" })}
          />
          <SectionHeader title="Account Actions" />

          <MenuItem icon="log-out-outline" title="Sign Out" danger onPress={handleLogout} />

        
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Image
            source={require("../../../assets/myicon.png")}
            style={styles.footerLogo}
            resizeMode="contain"
          />
          <Text style={styles.versionText}>TakeARoute v1.0 (UK-STABLE)</Text>
          <Text style={styles.legalText}>Terms • Privacy • Licenses</Text>
        </View>
      </ScrollView>
    </View>
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
    padding: 40,
  },

  // Not signed in state
  notSignedInText: {
    fontSize: 16,
    color: "#888",
    marginTop: 12,
    marginBottom: 20,
  },
  signInButton: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 24,
  },
  signInButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },

  // Header
  header: {
    backgroundColor: SECONDARY,
    paddingTop: 50,
    paddingBottom: 35,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    shadowColor: SECONDARY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  profileSection: {
    alignItems: "center",
  },
  avatarContainer: {
    position: "relative",
    marginBottom: 12,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.3)",
  },
  avatarPlaceholder: {
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarInitial: {
    fontSize: 40,
    fontWeight: "700",
    color: "#fff",
  },
  verifiedBadge: {
    position: "absolute",
    bottom: 2,
    right: 2,
    backgroundColor: "#fff",
    borderRadius: 10,
  },
  name: {
    fontSize: 22,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
  },
  locationBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(121,181,49,0.3)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 10,
    gap: 4,
  },
  locationText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
  },

  // Stats
  statsContainer: {
    flexDirection: "row",
    marginHorizontal: 20,
    marginTop: -25,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: "center",
    borderTopWidth: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  statValue: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1a1a1a",
    marginTop: 6,
  },
  statLabel: {
    fontSize: 12,
    color: "#888",
    marginTop: 2,
    fontWeight: "500",
  },

  // Content
  content: {
    padding: 20,
    paddingTop: 25,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: "700",
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 10,
    marginTop: 20,
  },

  // Menu Items
  menuItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  menuLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  menuIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: "#F0F7E6",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  menuTextContainer: {
    flex: 1,
  },
  menuTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  menuSubtitle: {
    fontSize: 12,
    color: "#999",
    marginTop: 2,
  },
  menuRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  badge: {
    backgroundColor: "#E8F5E9",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: PRIMARY,
  },

  // Footer
  footer: {
    alignItems: "center",
    paddingVertical: 30,
    paddingHorizontal: 20,
  },
  footerLogo: {
    width: 72,
    height: 72,
    marginBottom: 10,
  },
  versionText: {
    fontSize: 12,
    color: "#bbb",
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  legalText: {
    fontSize: 12,
    color: "#ccc",
    marginTop: 6,
  },
});