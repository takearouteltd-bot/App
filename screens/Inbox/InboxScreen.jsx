// screens/Inbox/InboxScreen.jsx
// Messages sent from the admin dashboard (Messages page). Works for both
// drivers and passengers. Pass { role: "driver" } or { role: "rider" } as a
// route param.
//
// Three small listeners are used instead of one combined query so that each
// one lines up exactly with the Firestore security rule for announcements.
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, SafeAreaView, FlatList } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { auth, db } from "../../config/firebase";

import { COLORS, TYPE, ScreenHeader, Card, EmptyState, Loading } from "../../components/ui/kit";

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
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={loading ? [] : messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={{ marginBottom: 16 }}>
            <ScreenHeader
              title="Messages"
              subtitle="Updates from TakeARoute."
              onBack={() => navigation.goBack()}
            />
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <Loading />
          ) : (
            <EmptyState
              icon="mail-open-outline"
              title="No messages yet"
              body="News and updates from TakeARoute will appear here."
            />
          )
        }
        renderItem={({ item }) => (
          <Card style={styles.card}>
            {item.audience === "user" ? <View style={styles.directMark} /> : null}
            <Text style={styles.title}>{item.title}</Text>
            <Text style={[TYPE.body, { marginTop: 6 }]}>{item.body}</Text>
            <Text style={[TYPE.small, { marginTop: 10 }]}>
              {item.audience === "user" ? "Sent to you" : "Sent to everyone"}, {formatWhen(item.createdAt)}
            </Text>
          </Card>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.surface },
  content: { padding: 20, paddingBottom: 48 },
  card: { marginBottom: 12, overflow: "hidden" },
  directMark: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, backgroundColor: COLORS.green },
  title: { fontSize: 16, fontWeight: "700", color: COLORS.navy },
});
