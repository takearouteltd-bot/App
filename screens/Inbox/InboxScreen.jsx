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

import {
  COLORS, TYPE, SPACE, ScreenHeader, Card, StatusPill, EmptyState, Loading,
} from "../../components/ui/kit";

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
          <View style={{ marginBottom: SPACE[4] }}>
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
        renderItem={({ item }) => {
          const direct = item.audience === "user";
          return (
            <Card style={styles.card}>
              <View style={styles.top}>
                <View style={styles.titleRow}>
                  {direct ? <View style={styles.directDot} /> : null}
                  <Text style={[styles.title, direct && { fontWeight: "800" }]} numberOfLines={2}>
                    {item.title}
                  </Text>
                </View>
                <StatusPill status={direct ? "direct" : "everyone"} label={direct ? "For you" : "Everyone"} />
              </View>
              <Text style={[TYPE.body, { marginTop: SPACE[2] }]}>{item.body}</Text>
              <Text style={[TYPE.small, { marginTop: SPACE[3] }]}>
                {direct ? "Sent to you" : "Sent to everyone"}, {formatWhen(item.createdAt)}
              </Text>
            </Card>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.surface },
  content: { padding: SPACE[5], paddingBottom: SPACE[12] },
  card: { marginBottom: SPACE[3] },
  top: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: SPACE[3] },
  titleRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: SPACE[2] },
  directDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.limeDeep },
  title: { ...TYPE.subhead, flex: 1, color: COLORS.midnight },
});
