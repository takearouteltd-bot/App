// One report: where it is in the process, the outcome once decided, and the
// conversation with support. The reporter can reply until the case is closed.
import React, { useEffect, useRef, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Alert } from '../../components/ui/alert';
import { Ionicons } from '@expo/vector-icons';
import {
  addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { auth, db } from '../../config/firebase';
import {
  COLORS, TYPE, SPACE, RADIUS, SHADOW, ScreenHeader, Card, Loading, formatWhen,
} from '../../components/ui/kit';

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
          <Card style={{ marginTop: SPACE[5] }}>
            <View style={styles.steps}>
              {STEPS.map((s, i) => {
                const done = i <= stepIndex;
                const current = i === stepIndex;
                const last = i === STEPS.length - 1;
                return (
                  <View key={s.key} style={styles.step}>
                    <View style={styles.stepTrack}>
                      <View style={[styles.stepDot, done && styles.stepDotDone, current && styles.stepDotCurrent]}>
                        {done && !current ? <Ionicons name="checkmark" size={12} color={COLORS.midnight} /> : null}
                      </View>
                      {!last ? <View style={[styles.stepLine, i < stepIndex && styles.stepLineDone]} /> : null}
                    </View>
                    <Text style={[styles.stepLabel, done && styles.stepLabelDone]} numberOfLines={1}>{s.label}</Text>
                  </View>
                );
              })}
            </View>
          </Card>

          {report.outcome ? (
            <Card tone="success" style={{ marginTop: SPACE[4] }}>
              <Text style={[TYPE.heading, { color: COLORS.success, marginBottom: SPACE[1] }]}>Outcome</Text>
              <Text style={TYPE.body}>{report.outcome}</Text>
            </Card>
          ) : null}

          <Card style={{ marginTop: SPACE[4] }}>
            <Text style={[TYPE.label, { marginBottom: SPACE[2] }]}>What you reported</Text>
            <Text style={TYPE.body}>{report.description}</Text>
            {report.tripSnapshot?.pickup ? (
              <Text style={[TYPE.small, { marginTop: SPACE[3] }]}>
                Trip from {report.tripSnapshot.pickup} to {report.tripSnapshot.dropoff}
              </Text>
            ) : null}
          </Card>

          <Text style={[TYPE.heading, { marginTop: SPACE[6], marginBottom: SPACE[3] }]}>Messages</Text>
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
            <Text style={[TYPE.small, { marginLeft: SPACE[2], flex: 1 }]}>This case is closed. Report a new issue if you need more help.</Text>
          </View>
        ) : (
          <View style={styles.composer}>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                placeholder="Write a message to support"
                placeholderTextColor={COLORS.faint}
                selectionColor={COLORS.midnight}
                value={text}
                onChangeText={setText}
                multiline
              />
            </View>
            <TouchableOpacity
              style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]}
              onPress={send}
              disabled={!text.trim() || sending}
              accessibilityRole="button"
              accessibilityLabel="Send"
            >
              {sending ? (
                <ActivityIndicator color={COLORS.lime} />
              ) : (
                <Ionicons name="send" size={18} color={text.trim() ? COLORS.lime : COLORS.faint} />
              )}
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.surface },
  content: { padding: SPACE[5], paddingBottom: SPACE[6] },

  steps: { flexDirection: 'row' },
  step: { flex: 1 },
  stepTrack: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACE[2] },
  stepDot: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: COLORS.fill,
    alignItems: 'center', justifyContent: 'center',
  },
  stepDotDone: { backgroundColor: COLORS.lime },
  stepDotCurrent: { backgroundColor: COLORS.lime, borderWidth: 3, borderColor: COLORS.midnight },
  stepLine: { flex: 1, height: 3, borderRadius: 2, backgroundColor: COLORS.fill, marginHorizontal: SPACE[1] },
  stepLineDone: { backgroundColor: COLORS.midnight },
  stepLabel: { ...TYPE.caption, color: COLORS.muted },
  stepLabelDone: { color: COLORS.midnight, fontWeight: '700' },

  bubbleWrap: { marginBottom: SPACE[3] },
  bubble: { maxWidth: '85%', paddingHorizontal: SPACE[4], paddingVertical: SPACE[3], borderRadius: RADIUS.lg },
  mine: { backgroundColor: COLORS.midnight, borderBottomRightRadius: RADIUS.sm },
  theirs: { backgroundColor: COLORS.white, borderBottomLeftRadius: RADIUS.sm, ...SHADOW.card },
  bubbleMeta: { ...TYPE.caption, marginTop: SPACE[1] },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: SPACE[2],
    paddingHorizontal: SPACE[3], paddingVertical: SPACE[3],
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line, backgroundColor: COLORS.white,
  },
  inputWrap: {
    flex: 1, backgroundColor: COLORS.fill, borderRadius: RADIUS.pill, minHeight: 48, justifyContent: 'center',
  },
  input: {
    maxHeight: 120, minHeight: 48,
    paddingHorizontal: SPACE[4],
    paddingTop: Platform.OS === 'ios' ? 14 : 12, paddingBottom: Platform.OS === 'ios' ? 14 : 12,
    fontSize: 16, color: COLORS.ink,
  },
  sendBtn: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.midnight,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: COLORS.fill },
  closedBar: {
    flexDirection: 'row', alignItems: 'center', padding: SPACE[4],
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line, backgroundColor: COLORS.white,
  },
});
