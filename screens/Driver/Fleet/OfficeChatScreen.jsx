// screens/Driver/Fleet/OfficeChatScreen.jsx
// Messages between a fleet driver and their taxi firm's office. The office
// writes from the fleet dashboard; the driver replies here. Server:
// functions/fleet.js (messageFleetOffice, markFleetChatRead); the thread is
// fleets/{fleetId}/driverChats/{driverId}/messages.
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
import { Ionicons } from '@expo/vector-icons';
import { collection, doc, onSnapshot, orderBy, query, limit } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '../../../config/firebase';
import { Alert } from '../../../components/ui/alert';
import {
  COLORS, TYPE, SPACE, RADIUS, SHADOW, ScreenHeader, Loading, EmptyState, formatWhen,
} from '../../../components/ui/kit';

const call = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);

export default function OfficeChatScreen() {
  const uid = auth.currentUser?.uid;
  const [fleet, setFleet] = useState(undefined); // {id, name} or null
  const [messages, setMessages] = useState(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  // Which fleet: from the driver record, live (they may join or leave).
  useEffect(() => {
    if (!uid) return undefined;
    return onSnapshot(
      doc(db, 'drivers', uid),
      (s) => {
        const d = s.data() || {};
        setFleet(d.fleetId ? { id: d.fleetId, name: d.fleetName || 'Your taxi firm' } : null);
      },
      () => setFleet(null)
    );
  }, [uid]);

  useEffect(() => {
    if (!uid || !fleet?.id) return undefined;
    call('markFleetChatRead', {}).catch(() => {});
    return onSnapshot(
      // The newest 300, shown oldest first. Ascending with a limit stopped
      // loading new messages after the 300th.
      query(collection(db, 'fleets', fleet.id, 'driverChats', uid, 'messages'), orderBy('createdAt', 'desc'), limit(300)),
      (s) => {
        setMessages(s.docs.map((d) => ({ id: d.id, ...d.data() })).reverse());
        call('markFleetChatRead', {}).catch(() => {});
      },
      () => setMessages([])
    );
  }, [uid, fleet?.id]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      await call('messageFleetOffice', { text: body });
      setText('');
    } catch (e) {
      Alert.alert('Not sent', e?.message?.replace(/^.*?:\s*/, '') || 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  if (fleet === undefined) return <Loading />;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.content}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          <ScreenHeader title="Messages" subtitle={fleet ? `With ${fleet.name}'s office` : 'With your taxi firm'} />
          {!fleet ? (
            <EmptyState icon="chatbubbles-outline" title="Not in a fleet" body="Messages with a taxi firm's office appear here once you drive for one." />
          ) : messages === null ? (
            <Loading />
          ) : messages.length === 0 ? (
            <EmptyState icon="chatbubbles-outline" title="No messages yet" body="Write to the office below. They see it on their screen straight away." />
          ) : (
            messages.map((m) => {
              const mine = m.from === 'driver';
              return (
                <View key={m.id} style={[styles.bubbleWrap, mine ? { alignItems: 'flex-end' } : { alignItems: 'flex-start' }]}>
                  <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                    <Text style={[TYPE.body, mine && { color: COLORS.white }]}>{m.text}</Text>
                  </View>
                  <Text style={styles.bubbleMeta}>
                    {mine ? 'You' : m.byName ? `${m.byName}, office` : 'Office'}, {formatWhen(m.createdAt || m.at)}
                  </Text>
                </View>
              );
            })
          )}
        </ScrollView>
        {fleet ? (
          <View style={styles.composer}>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                placeholder="Write to the office"
                placeholderTextColor={COLORS.faint}
                selectionColor={COLORS.midnight}
                value={text}
                onChangeText={setText}
                maxLength={1000}
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
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.surface },
  content: { padding: SPACE[5], paddingBottom: SPACE[6], flexGrow: 1 },
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
});
