// My reports: every issue this person has reported, with the status set by
// TakeARoute support (received, investigating, closed) and any replies.
import React, { useEffect, useState } from 'react';
import { SafeAreaView, FlatList, View, Text, StyleSheet } from 'react-native';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { auth, db } from '../../config/firebase';
import {
  COLORS, TYPE, SPACE, ScreenHeader, Card, StatusPill, Button, EmptyState, Loading, formatWhen,
} from '../../components/ui/kit';

export default function MyReportsScreen({ navigation, route }) {
  const role = route?.params?.role || 'rider';
  const uid = auth.currentUser?.uid;
  const [reports, setReports] = useState(null);

  useEffect(() => {
    if (!uid) return undefined;
    // No orderBy here so no composite index is needed; sorted below.
    const q = query(collection(db, 'reports'), where('reporterId', '==', uid));
    return onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        setReports(rows);
      },
      (error) => {
        console.log('Reports load error:', error);
        setReports([]);
      }
    );
  }, [uid]);

  const newReport = () => navigation.navigate('ReportIssueScreen', { reporterType: role });

  const renderItem = ({ item }) => {
    const hasReply = item.lastReplyBy === 'admin';
    return (
      <Card style={{ marginBottom: SPACE[3] }} onPress={() => navigation.navigate('ReportDetail', { reportId: item.id, role })}>
        <View style={styles.rowTop}>
          <Text style={styles.title} numberOfLines={1}>{item.subCategoryLabel || item.categoryLabel || 'Report'}</Text>
          <StatusPill status={item.status || 'open'} />
        </View>
        <Text style={TYPE.small} numberOfLines={2}>{item.description}</Text>
        <View style={styles.rowBottom}>
          <Text style={TYPE.small}>{formatWhen(item.createdAt)}</Text>
          {hasReply ? (
            <View style={styles.replyRow}>
              <View style={styles.replyDot} />
              <Text style={styles.reply}>New reply from support</Text>
            </View>
          ) : null}
        </View>
      </Card>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={reports || []}
        keyExtractor={(r) => r.id}
        renderItem={renderItem}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={{ marginBottom: SPACE[5] }}>
            <ScreenHeader
              title="My reports"
              subtitle="Issues you have raised and what support has done."
              onBack={() => navigation.goBack()}
            />
            {reports && reports.length ? (
              <Button title="Report a new issue" icon="add" variant="secondary" style={{ marginTop: SPACE[4] }} onPress={newReport} />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          reports === null ? (
            <Loading />
          ) : (
            <EmptyState
              icon="chatbubbles-outline"
              title="No reports yet"
              body="If something goes wrong on a trip, or you leave something behind, report it here and support will reply."
              action={<Button title="Report an issue" onPress={newReport} />}
            />
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.surface },
  content: { padding: SPACE[5], paddingBottom: SPACE[12] },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE[3], marginBottom: SPACE[2] },
  title: { ...TYPE.subhead, flex: 1, color: COLORS.midnight },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: SPACE[3] },
  replyRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE[2] },
  replyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.limeDeep },
  reply: { fontSize: 13, fontWeight: '700', color: COLORS.limeInk },
});
