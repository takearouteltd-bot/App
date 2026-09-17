// screens/Inbox/InboxScreen.jsx
// Messages sent from the admin dashboard (Messages page). Works for both
// drivers and passengers. Pass { role: "driver" } or { role: "rider" } as a
// route param.
//
// Three small listeners are used instead of one combined query so that each
// one lines up exactly with the Firestore security rule for announcements.
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { auth, db } from "../../config/firebase";

const PRIMARY = "#79B531";
const SECONDARY = "#235594";

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value.seconds) return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatWhen(value) {
  const ms = toMillis(value);
  if (!ms) return "";
  return new Date(ms).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function InboxScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const role = route.params?.role === "driver" ? "driver" : "rider";
  const uid = auth.currentUser?.uid;

  const [groups, setGroups] = useState({ all: [], role: [], direct: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return undefined;
    }

    const base = collection(db, "announcements");
    const sources = [
      ["all", query(base, where("audience", "==", "all"))],
      ["role", query(base, where("audience", "==", role === "driver" ? "drivers" : "riders"))],
      ["direct", query(base, where("audience", "==", "user"), where("userId", "==", uid))],
    ];

    let pending = sources.length;
    const settle = () => {
      pending -= 1;
      if (pending <= 0) setLoading(false);
    };

    const unsubs = sources.map(([key, source]) => {
      let first = true;
      return onSnapshot(
        source,
        (snapshot) => {
          setGroups((current) => ({
            ...current,
            [key]: snapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
          }));
          if (first) {
            first = false;
            settle();
          }
        },
        () => {
          if (first) {
            first = false;
            settle();
          }
        }
      );
    });

    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, [uid, role]);

  const messages = useMemo(
    () =>
      [...groups.all, ...groups.role, ...groups.direct].sort(
        (a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)
      ),
    [groups]
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={22} color="#1A1A1A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Messages</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={messages.length ? styles.list : styles.emptyWrap}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="mail-open-outline" size={42} color="#C5C5C7" />
              <Text style={styles.emptyTitle}>No messages yet</Text>
              <Text style={styles.emptyCopy}>Updates and offers from TakeARoute will appear here.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                {item.audience === "user" ? (
                  <View style={styles.pill}>
                    <Text style={styles.pillText}>For you</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.cardBody}>{item.body}</Text>
              <Text style={styles.cardWhen}>{formatWhen(item.createdAt)}</Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8F9FA" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#EEF0F2",
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontWeight: "700", color: "#1A1A1A" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  list: { padding: 16 },
  emptyWrap: { flexGrow: 1 },
  emptyTitle: { marginTop: 12, fontSize: 16, fontWeight: "700", color: "#1A1A1A" },
  emptyCopy: { marginTop: 6, fontSize: 14, lineHeight: 20, color: "#888", textAlign: "center" },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#EEF0F2",
  },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: "700", color: "#1A1A1A" },
  cardBody: { fontSize: 14, lineHeight: 21, color: "#444" },
  cardWhen: { marginTop: 10, fontSize: 12, color: "#999" },
  pill: { marginLeft: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: `${SECONDARY}15` },
  pillText: { fontSize: 11, fontWeight: "700", color: SECONDARY },
});
