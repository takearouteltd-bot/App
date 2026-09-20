// One report: where it is in the process, the outcome once decided, and the
// conversation with support. The reporter can reply until the case is closed.
import React, { useEffect, useRef, useState } from 'react';
import {
  SafeAreaView, ScrollView, View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView,
  Platform, ActivityIndicator, Alert, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { auth, db } from '../../config/firebase';
import { COLORS, TYPE, ScreenHeader, Card, Loading, formatWhen } from '../../components/ui/kit';

const STEPS = [
  { key: 'open', label: 'Received' },
  { key: 'in_review', label: 'Investigating' },
  { key: 'resolved', label: 'Closed' },
];

export default function ReportDetailScreen({ navigation, route }) {
  const { reportId, role = 'rider' } = route.params || {};
  const [report, setReport] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!reportId) return undefined;
    const unsubReport = onSnapshot(doc(db, 'reports', reportId), (snap) => setReport(snap.exists() ? { id: snap.id, ...snap.data() } : {}));
    const unsubMessages = onSnapshot(
      query(collection(db, 'reports', reportId, 'messages'), orderBy('createdAt', 'asc')),
      (snap) => setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (error) => console.log('Messages load error:', error)
    );
    return () => { unsubReport(); unsubMessages(); };
  }, [reportId]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      await addDoc(collection(db, 'reports', reportId, 'messages'), {
        text: body,
        senderRole: role,
        senderId: auth.currentUser?.uid || null,
        senderName: auth.currentUser?.displayName || (role === 'driver' ? 'Driver' : 'Passenger'),
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'reports', reportId), {
        lastReplyAt: serverTimestamp(),
        lastReplyBy: role,
        updatedAt: serverTimestamp(),
      }).catch(() => {});
      setText('');
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
    } catch (error) {
      console.log('Reply error:', error);
      Alert.alert('Message not sent', 'Check your connection and try again.');
    } finally {
      setSending(false);
    }
  };

  if (!report) {
    return (
      <SafeAreaView style={styles.safe}>
        <Loading />
      </SafeAreaView>
    );
  }

  const status = report.status || 'open';
  const stepIndex = Math.max(0, STEPS.findIndex((s) => s.key === status));
  const closed = status === 'resolved';

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.content}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          <ScreenHeader
            title={report.subCategoryLabel || report.categoryLabel || 'Report'}
            subtitle={`Reported ${formatWhen(report.createdAt)}`}
            onBack={() => navigation.goBack()}
          />

          {/* Progress: a real sequence, so the steps are shown in order. */}
          <View style={styles.steps}>
            {STEPS.map((s, i) => {
              const done = i <= stepIndex;
              return (
                <View key={s.key} style={styles.step}>
                  <View style={[styles.stepBar, done && { backgroundColor: closed ? COLORS.green : COLORS.blue }]} />
                  <Text style={[styles.stepLabel, done && { color: COLORS.navy, fontWeight: '700' }]}>{s.label}</Text>
                </View>
              );
            })}
          </View>

          {report.outcome ? (
            <Card tone="success" style={{ marginTop: 20 }}>
              <Text style={[TYPE.heading, { color: '#3F6F12', marginBottom: 4 }]}>Outcome</Text>
              <Text style={TYPE.body}>{report.outcome}</Text>
            </Card>
          ) : null}

          <Card style={{ marginTop: 16 }}>
            <Text style={styles.metaLabel}>What you reported</Text>
            <Text style={TYPE.body}>{report.description}</Text>
            {report.tripSnapshot?.pickup ? (
              <Text style={[TYPE.small, { marginTop: 10 }]}>
                Trip from {report.tripSnapshot.pickup} to {report.tripSnapshot.dropoff}
              </Text>
            ) : null}
          </Card>

          <Text style={[TYPE.heading, { marginTop: 24, marginBottom: 10 }]}>Messages</Text>
          {messages.length === 0 ? (
            <Text style={TYPE.small}>
              {closed ? 'This case was closed without messages.' : 'Support will reply here. You can add more detail below.'}
            </Text>
          ) : (
            messages.map((m) => {
              const mine = m.senderRole !== 'admin';
              return (
                <View key={m.id} style={[styles.bubbleWrap, mine ? { alignItems: 'flex-end' } : { alignItems: 'flex-start' }]}>
                  <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                    <Text style={[TYPE.body, mine && { color: COLORS.white }]}>{m.text}</Text>
                  </View>
                  <Text style={styles.bubbleMeta}>
                    {mine ? 'You' : 'TakeARoute support'}, {formatWhen(m.createdAt)}
                  </Text>
                </View>
              );
            })
          )}
        </ScrollView>

        {closed ? (
          <View style={styles.closedBar}>
            <Ionicons name="lock-closed-outline" size={16} color={COLORS.muted} />
            <Text style={[TYPE.small, { marginLeft: 6 }]}>This case is closed. Report a new issue if you need more help.</Text>
          </View>
        ) : (
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              placeholder="Write a message to support"
              placeholderTextColor="#9CA3AF"
              value={text}
              onChangeText={setText}
              multiline
            />
            <TouchableOpacity style={[styles.sendBtn, !text.trim() && { opacity: 0.4 }]} onPress={send} disabled={!text.trim() || sending}>
              {sending ? <ActivityIndicator color={COLORS.white} /> : <Ionicons name="send" size={18} color={COLORS.white} />}
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.surface },
  content: { padding: 20, paddingBottom: 24 },
  steps: { flexDirection: 'row', gap: 6, marginTop: 20 },
  step: { flex: 1 },
  stepBar: { height: 6, borderRadius: 3, backgroundColor: COLORS.line, marginBottom: 6 },
  stepLabel: { fontSize: 12, color: COLORS.muted },
  metaLabel: { fontSize: 12, fontWeight: '700', color: COLORS.muted, marginBottom: 6 },
  bubbleWrap: { marginBottom: 12 },
  bubble: { maxWidth: '85%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16 },
  mine: { backgroundColor: COLORS.blue, borderBottomRightRadius: 4 },
  theirs: { backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line, borderBottomLeftRadius: 4 },
  bubbleMeta: { fontSize: 11, color: COLORS.muted, marginTop: 4 },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10, padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line, backgroundColor: COLORS.white,
  },
  input: {
    flex: 1, maxHeight: 120, minHeight: 44, borderWidth: 1, borderColor: COLORS.line, borderRadius: 14,
    paddingHorizontal: 14, paddingTop: 11, paddingBottom: 11, fontSize: 15, color: COLORS.ink,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 14, backgroundColor: COLORS.green, alignItems: 'center', justifyContent: 'center' },
  closedBar: {
    flexDirection: 'row', alignItems: 'center', padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line, backgroundColor: COLORS.white,
  },
});
