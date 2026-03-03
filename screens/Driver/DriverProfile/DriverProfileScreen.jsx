import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Image,
  ScrollView,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";

const PRIMARY = "#79B531";
const SECONDARY = "#235594";

export default function DriverProfileScreen({ navigation }) {
  const isOnline = true;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        
        {/* Header */}
        <View style={styles.header}>
          <View style={{ width: 24 }} />
          <Text style={styles.headerTitle}>Account</Text>
          <TouchableOpacity onPress={() => navigation.navigate('DriverPersonalInformation')}>
            <Ionicons name="settings" left={-20} size={24} color={SECONDARY} />
          </TouchableOpacity>
        </View>

        {/* Profile Section */}
        <View style={styles.profileSection}>
          <Image
            source={{ uri: "https://i.pravatar.cc/150?img=3" }}
            style={styles.avatar}
          />

          <Text style={styles.name}>Hassan Jamil</Text>

          {/* Badges */}
          <View style={styles.badgeRow}>
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: isOnline ? PRIMARY : "#ccc" },
              ]}
            >
              <Text style={styles.badgeText}>
                {isOnline ? "Online" : "Offline"}
              </Text>
            </View>

            <View style={styles.premiumBadge}>
              <MaterialCommunityIcons
                name="crown"
                size={14}
                color="#fff"
                style={{ marginRight: 4 }}
              />
              <Text style={styles.badgeText}>TakeARoute Premium</Text>
            </View>
          </View>
        </View>

        {/* Stats Container */}
        <View style={styles.statsContainer}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Ratings</Text>
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={16} color="#F5B300" />
              <Text style={styles.statNumber}>4.9</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Trips</Text>
            <Text style={styles.statNumber}>842</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Member</Text>
            <Text style={styles.statNumber}>2 Years</Text>
          </View>
        </View>

        {/* Vehicle Information */}
        <Text style={styles.sectionTitle}>Vehicle Information</Text>

        <View style={styles.card}>
          <MaterialCommunityIcons
            name="car"
            size={26}
            color={SECONDARY}
            style={{ marginRight: 15 }}
          />
          <View>
            <Text style={styles.cardTitle}>Silver Toyota Prius</Text>
            <Text style={styles.cardSubText}>LV70 ABC</Text>
          </View>
        </View>

        {/* Compliance Section */}
        <Text style={styles.sectionTitle}>Compliance and Documents</Text>

        {/* Driving License */}
        <View style={styles.documentCard}>
          <View style={styles.documentLeft}>
            <MaterialCommunityIcons
              name="card-account-details"
              size={22}
              color={SECONDARY}
              style={{ marginRight: 12 }}
            />
            <Text style={styles.documentTitle}>Driving License</Text>
          </View>

          <View style={styles.verifiedBadge}>
            <Ionicons name="checkmark-circle" size={16} color="#fff" />
            <Text style={styles.verifiedText}>Verified</Text>
          </View>
        </View>

        {/* PHV Insurance */}
        <View style={styles.documentCard}>
          <View style={styles.documentLeft}>
            <MaterialCommunityIcons
              name="shield-check"
              size={22}
              color={SECONDARY}
              style={{ marginRight: 12 }}
            />
            <Text style={styles.documentTitle}>PHV Insurance</Text>
          </View>

          <View style={styles.verifiedBadge}>
            <Ionicons name="checkmark-circle" size={16} color="#fff" />
            <Text style={styles.verifiedText}>Verified</Text>
          </View>
        </View>

        <View style={{ height: 40 }} />

        {/* Account Section */}
        <Text style={styles.sectionTitle}>Account</Text>

        <View style={styles.menuCard}>
          <TouchableOpacity style={styles.menuRow}>
            <View style={styles.menuLeft}>
              <Ionicons name="help-circle-outline" size={22} color={SECONDARY} />
              <Text style={styles.menuText}>Help and Support</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#999" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuRow}>
            <View style={styles.menuLeft}>
              <MaterialCommunityIcons
                name="diamond-outline"
                size={22}
                color={SECONDARY}
              />
              <Text style={styles.menuText}>Subscription Details</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#999" />
          </TouchableOpacity>

          <View style={styles.menuDivider} />

          <TouchableOpacity style={styles.logoutRow}>
            <Ionicons name="log-out-outline" size={22} color="#D32F2F" />
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 50 }} />

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    paddingHorizontal: 20,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
  },

  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: SECONDARY,
  },

  profileSection: {
    alignItems: "center",
    marginTop: 30,
  },

  avatar: {
    width: 110,
    height: 110,
    borderRadius: 55,
  },

  name: {
    fontSize: 20,
    fontWeight: "700",
    color: 'black',
    marginTop: 15,
  },

  badgeRow: {
    flexDirection: "row",
    marginTop: 15,
  },

  statusBadge: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    marginRight: 10,
  },

  premiumBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: SECONDARY,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
  },

  badgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },

  statsContainer: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 16,
    marginLeft: 43,   
    paddingVertical: 22,
    marginTop: 40,
    width: '80%',
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    alignItems: "center",
    justifyContent: "space-around",
  },

  statItem: {
    alignItems: "center",
    flex: 1,
  },

  statLabel: {
    fontSize: 13,
    color: "#777",
    marginBottom: 6,
    fontWeight: "500",
  },

  statNumber: {
    fontSize: 21,
    fontWeight: "700",
    color: "#000",
  },

  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },

  divider: {
    width: 1,
    height: 40,
    backgroundColor: "#eee",
  },

  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: 'black',
    marginTop: 35,
    margin: 15,
    marginBottom: 15,
  },

  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 18,
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
  },

  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#000",
  },

  cardSubText: {
    fontSize: 13,
    color: "#777",
    marginTop: 4,
  },

  documentCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 28,
    marginBottom: 15,
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
  },

  documentLeft: {
    flexDirection: "row",
    alignItems: "center",
  },

  documentTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#000",
  },

  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: PRIMARY,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 20,
  },

  verifiedText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 5,
  },
   menuCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    paddingVertical: 10,
    elevation: 4,
  },

  menuRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 14,
  },

  menuLeft: {
    flexDirection: "row",
    alignItems: "center",
  },

  menuText: {
    fontSize: 15,
    fontWeight: "500",
    marginLeft: 12,
    color: "#000",
  },

  menuDivider: {
    height: 1,
    backgroundColor: "#eee",
    marginHorizontal: 18,
  },

  logoutRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 16,
  },

  logoutText: {
    fontSize: 15,
    fontWeight: "600",
    marginLeft: 12,
    color: "#D32F2F",
  },
});
