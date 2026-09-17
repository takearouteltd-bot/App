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

const PRIMARY = "#79B531";
const SECONDARY = "#235594";
const DANGER = "#D32F2F";
const BG = "#F6F7F9";

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

  const formatMemberSince = (timestamp) => {
    if (!timestamp) return "New Driver";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diffYears = now.getFullYear() - date.getFullYear();
    if (diffYears < 1) return "< 1 Year";
    return `${diffYears} Year${diffYears > 1 ? "s" : ""}`;
  };

  const isOnline = driver?.status === "online";
  const isApproved = driver?.approved === true && driver?.onboardingComplete === true;

  const availableBalance = wallet?.availableBalance || 0;
  const totalEarned = wallet?.totalEarned || 0;

  const documents = [
    {
      title: "Driving License (Front)",
      icon: "card-account-details",
      url: driver?.driverLicenseFrontUrl || driver?.driverLicenseUrl,
      verified: isApproved,
    },
    {
      title: "Driving License (Back)",
      icon: "card-account-details-outline",
      url: driver?.driverLicenseBackUrl || driver?.driverLicenseUrl,
      verified: isApproved,
    },
    {
      title: "PHV Insurance",
      icon: "shield-check",
      url: driver?.insuranceUrl,
      verified: isApproved,
    },
    {
      title: "MOT Certificate",
      icon: "file-certificate",
      url: driver?.motUrl,
      verified: isApproved,
    },
    {
      title: "PCO License",
      icon: "badge-account",
      url: driver?.pcoLicenseUrl,
      verified: isApproved,
    },
    {
      title: "V5 Logbook",
      icon: "car-info",
      url: driver?.v5Url,
      verified: isApproved,
    },
  ];

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
        {/* Header */}
        <View style={styles.header}>
          <View style={{ width: 24 }} />
          <Text style={styles.headerTitle}>Driver Account</Text>
          <TouchableOpacity
            onPress={() => navigation.navigate("DriverPersonalInformation")}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="settings-outline" size={24} color={SECONDARY} />
          </TouchableOpacity>
        </View>

        {/* Profile Card */}
        <View style={styles.profileCard}>
          <Image
            source={{
              uri: driver?.selfieUrl || "https://i.pravatar.cc/150?img=3",
            }}
            style={styles.avatar}
          />
          <Text style={styles.name}>{driver?.fullName || "Driver"}</Text>

          <View style={styles.badgeRow}>
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: isOnline ? PRIMARY : "#9E9E9E" },
              ]}
            >
              <View style={[styles.dot, { backgroundColor: "#fff" }]} />
              <Text style={styles.badgeText}>
                {isOnline ? "Online" : "Offline"}
              </Text>
            </View>

            {driver?.accountDetails?.subscription === "premium" && (
              <View style={styles.premiumBadge}>
                <MaterialCommunityIcons name="crown" size={13} color="#fff" />
                <Text style={styles.badgeText}>Premium</Text>
              </View>
            )}
          </View>
        </View>

        {/* Stats Row */}
        <View style={styles.statsContainer}>
          <View style={[styles.statItem, styles.hiddenStat]}>
            <Text style={styles.statNumber}>4.9</Text>
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={14} color="#F5B300" />
              <Text style={styles.statLabel}>Rating</Text>
            </View>
          </View>

          <View style={[styles.divider, styles.hiddenStat]} />

          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{tripCount}</Text>
            <Text style={styles.statLabel}>Trips</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.statItem}>
            <Text style={styles.statNumber}>
              {formatMemberSince(driver?.createdAt)}
            </Text>
            <Text style={styles.statLabel}>Member</Text>
          </View>
        </View>

        {/* Earnings Card */}
         {/* Earnings Card */}
        <TouchableOpacity
          style={styles.earningsCard}
          onPress={() => navigation.navigate("EarningsScreen")}
          activeOpacity={0.9}
        >
          <View>
            <Text style={styles.earningsLabel}>Total Earnings</Text>
            <Text style={styles.earningsValue}>
              £{totalEarned.toFixed(2)}
            </Text>
            <Text style={styles.earningsSubtext}>
              Available: £{availableBalance.toFixed(2)}
            </Text>
          </View>
          <View style={styles.earningsButton}>
            <Text style={styles.earningsButtonText}>View</Text>
            <Ionicons name="arrow-forward" size={16} color={PRIMARY} />
          </View>
        </TouchableOpacity>
        {/* Vehicle Information */}
        <Text style={styles.sectionTitle}>Vehicle Information</Text>
        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.85}
          onPress={() => navigation.navigate("VehicleInformation")}
        >
          <View style={styles.cardIconWrap}>
            <MaterialCommunityIcons name="car" size={24} color={SECONDARY} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>
              {driver?.makeModel || "Vehicle not set"}
            </Text>
            <Text style={styles.cardSubText}>
              {driver?.registrationNumber || "No registration"}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#C5C5C7" />
        </TouchableOpacity>

        {/* Messages from TakeARoute */}
        <Text style={styles.sectionTitle}>Messages</Text>
        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.85}
          onPress={() => navigation.navigate("Inbox", { role: "driver" })}
        >
          <View style={styles.cardIconWrap}>
            <Ionicons name="mail-outline" size={24} color={SECONDARY} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Inbox</Text>
            <Text style={styles.cardSubText}>Updates & offers from TakeARoute</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#C5C5C7" />
        </TouchableOpacity>

        {/* Compliance Section */}
        <Text style={styles.sectionTitle}>Compliance & Documents</Text>
        {documents.map((docItem, index) => (
          <View key={index} style={styles.documentCard}>
            <View style={styles.documentLeft}>
              <View style={styles.docIconWrap}>
                <MaterialCommunityIcons
                  name={docItem.icon}
                  size={20}
                  color={SECONDARY}
                />
              </View>
              <View>
                <Text style={styles.documentTitle}>{docItem.title}</Text>
                <Text style={styles.documentMeta}>
                  {docItem.url ? "Uploaded" : "Not uploaded"}
                </Text>
              </View>
            </View>

            <View
              style={[
                styles.verifiedBadge,
                { backgroundColor: docItem.verified ? PRIMARY : "#E0E0E0" },
              ]}
            >
              <Ionicons
                name={docItem.verified ? "checkmark-circle" : "time-outline"}
                size={14}
                color="#fff"
              />
              <Text style={styles.verifiedText}>
                {docItem.verified ? "Verified" : "Pending"}
              </Text>
            </View>
          </View>
        ))}

        {/* Account Section */}
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.menuCard}>
          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => navigation.navigate("SubscriptionDetails")}

          >
            <View style={styles.menuLeft}>
              <View style={styles.menuIconWrap}>
                <MaterialCommunityIcons
                  name="diamond-outline"
                  size={20}
                  color={SECONDARY}
                />
              </View>
              <Text style={styles.menuText}>Subscription Details</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#C5C5C7" />
          </TouchableOpacity>

          <View style={styles.menuDivider} />

          <TouchableOpacity
            style={styles.logoutRow}
            onPress={handleLogout}
            disabled={loggingOut}
          >
            {loggingOut ? (
              <ActivityIndicator color={DANGER} />
            ) : (
              <>
                <Ionicons name="log-out-outline" size={22} color={DANGER} />
                <Text style={styles.logoutText}>Sign Out</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
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
    paddingBottom: 10,
  },

  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: SECONDARY,
    letterSpacing: -0.3,
  },

  profileCard: {
    alignItems: "center",
    marginTop: 10,
    marginHorizontal: 20,
    backgroundColor: "#fff",
    borderRadius: 20,
    paddingVertical: 28,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },

  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: PRIMARY + "20",
  },

  name: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1A1A1A",
    marginTop: 14,
  },

  badgeRow: {
    flexDirection: "row",
    marginTop: 14,
    gap: 10,
  },

  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    gap: 6,
  },

  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },

  premiumBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: SECONDARY,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    gap: 6,
  },

  badgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },

  statsContainer: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 16,
    marginHorizontal: 20,
    paddingVertical: 20,
    marginTop: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
    alignItems: "center",
  },

  statItem: {
    alignItems: "center",
    flex: 1,
  },

  statLabel: {
    fontSize: 12,
    color: "#8E8E93",
    marginTop: 6,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  statNumber: {
    fontSize: 20,
    fontWeight: "800",
    color: "#1A1A1A",
  },

  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },

  hiddenStat: {
    display: "none",
  },

  divider: {
    width: 1,
    height: 36,
    backgroundColor: "#E5E5EA",
  },

  earningsCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: SECONDARY,
    marginHorizontal: 20,
    marginTop: 16,
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 18,
    shadowColor: SECONDARY,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },

  earningsLabel: {
    fontSize: 12,
    color: "rgba(255,255,255,0.8)",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  earningsValue: {
    fontSize: 24,
    fontWeight: "800",
    color: "#fff",
    marginTop: 4,
  },

  earningsSubtext: {
    fontSize: 12,
    color: "rgba(255,255,255,0.7)",
    marginTop: 4,
    fontWeight: "500",
  },

  earningsButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 6,
  },

  earningsButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: PRIMARY,
  },

  sectionTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#1A1A1A",
    marginTop: 28,
    marginHorizontal: 20,
    marginBottom: 12,
  },

  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },

  cardIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: SECONDARY + "10",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },

  cardTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1A1A1A",
  },

  cardSubText: {
    fontSize: 13,
    color: "#8E8E93",
    marginTop: 3,
    fontWeight: "500",
  },

  documentCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 20,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },

  documentLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },

  docIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: SECONDARY + "10",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },

  documentTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1A1A1A",
  },

  documentMeta: {
    fontSize: 12,
    color: "#8E8E93",
    marginTop: 2,
    fontWeight: "500",
  },

  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 20,
    gap: 4,
  },

  verifiedText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },

  menuCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    marginHorizontal: 20,
    paddingVertical: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },

  menuRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },

  menuLeft: {
    flexDirection: "row",
    alignItems: "center",
  },

  menuIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: SECONDARY + "10",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },

  menuText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1A1A1A",
  },

  menuDivider: {
    height: 1,
    backgroundColor: "#F2F2F7",
    marginHorizontal: 16,
    marginVertical: 4,
  },

  logoutRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },

  logoutText: {
    fontSize: 15,
    fontWeight: "700",
    color: DANGER,
  },
});
