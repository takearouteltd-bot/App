// ChatScreen.js
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Platform,
  SafeAreaView,
  KeyboardAvoidingView,
} from 'react-native';
import { Alert } from '../../components/ui/alert';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../../config/firebase';
import {
  COLORS, TYPE, SPACE, RADIUS, SHADOW,
  ScreenHeader, Avatar, Chip, Loading,
} from '../../components/ui/kit';

// Predefined quick messages for safer driving
const QUICK_MESSAGES = [
  "I'm here",
  "Running 2 mins late",
  "Can't find you",
  "At the wrong pin?",
  "Be there shortly",
];

const ChatScreen = ({ route }) => {
  const navigation = useNavigation();
  const {
    rideId,
    currentUser,
    userType,
    otherUserName,
    otherUserPhoto
  } = route.params;

  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [showQuickMessages, setShowQuickMessages] = useState(false);
  const flatListRef = useRef(null);

  const messagesRef = collection(db, 'rides', rideId, 'messages');

  // Real-time messages listener
  useEffect(() => {
    const q = query(messagesRef, orderBy('timestamp', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      // Estimate the server time for a message still on its way up, so it
      // sorts at the bottom instead of jumping to the top until it lands.
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data({ serverTimestamps: 'estimate' }),
      }));
      setMessages(msgs);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [rideId]);

  // Mark messages as read
  useEffect(() => {
    const unreadMessages = messages.filter(
      msg => msg.senderId !== currentUser.uid && !msg.read
    );

    unreadMessages.forEach(async (msg) => {
      try {
        await updateDoc(doc(db, 'rides', rideId, 'messages', msg.id), {
          read: true,
        });
      } catch (err) {
        // Ignore
      }
    });
  }, [messages, currentUser.uid, rideId]);

  const sendMessage = async (textOverride = null) => {
    const text = textOverride || inputText.trim();
    if (!text) return;

    setInputText('');
    setShowQuickMessages(false);

    try {
      await addDoc(messagesRef, {
        senderId: currentUser.uid,
        senderType: userType,
        text,
        timestamp: serverTimestamp(),
        read: false,
      });
    } catch (err) {
      // Put the words back so nothing typed is lost.
      if (!textOverride) setInputText(text);
      Alert.alert('Message not sent', 'Check your connection and try again.');
      return;
    }

    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  // Messages cannot be deleted (the rules keep the record for support).
  const handleLongPress = (message) => {
    Alert.alert('Message Options', null, [
      { text: 'Report', onPress: () => reportMessage(message) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  /* Writes a real report into the same `reports` collection the Report an
     issue screen uses, so it reaches the admin dashboard and the person gets
     replies under My reports. It used to only console.log while telling the
     user their report had been received. */
  const reportMessage = (message) => {
    Alert.alert(
      'Report this message?',
      'Our support team will read it and get back to you.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Report',
          style: 'destructive',
          onPress: async () => {
            try {
              await addDoc(collection(db, 'reports'), {
                reporterId: currentUser.uid,
                reporterType: userType,
                rideId,
                otherPartyId: message.senderId,
                category: 'chat',
                subCategory: 'inappropriate_message',
                categoryLabel: 'Chat',
                subCategoryLabel: 'Inappropriate message',
                description: `Reported message: "${String(message.text || '').slice(0, 500)}"`,
                severity: 'high',
                status: 'open',
                priority: 'normal',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                resolvedAt: null,
                assignedTo: null,
                adminNotes: '',
                reportedMessageId: message.id,
              });
              Alert.alert('Reported', 'Thank you. Support will review this and reply under My reports.');
            } catch (error) {
              console.error('Could not report message:', error);
              Alert.alert('Could not report', 'Please try again, or use Report an issue in your account.');
            }
          },
        },
      ]
    );
  };

  const otherName = otherUserName || (userType === 'rider' ? 'Driver' : 'Rider');

  // Messages from different days get a small pill between them.
  const dayLabel = (ts) => {
    const d = ts?.toDate?.();
    if (!d) return null;
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  };

  const renderMessage = ({ item, index }) => {
    const isMe = item.senderId === currentUser.uid;
    const label = dayLabel(item.timestamp);
    const prevLabel = index > 0 ? dayLabel(messages[index - 1].timestamp) : null;
    const showDay = label && label !== prevLabel;

    return (
      <>
        {showDay ? (
          <View style={styles.dayWrap}>
            <Text style={styles.dayPill}>{label}</Text>
          </View>
        ) : null}
        <TouchableOpacity
          activeOpacity={0.8}
          onLongPress={() => handleLongPress(item)}
          style={[
            styles.messageRow,
            isMe ? styles.myRow : styles.theirRow
          ]}
        >
          {!isMe && (
            <Avatar uri={otherUserPhoto} name={otherName} size={28} style={styles.messageAvatar} />
          )}

          <View style={[
            styles.bubble,
            isMe ? styles.myBubble : styles.theirBubble
          ]}>
            <Text style={[
              styles.messageText,
              isMe ? styles.myMessageText : styles.theirMessageText
            ]}>
              {item.text}
            </Text>
            <View style={styles.messageMeta}>
              <Text style={[styles.timestamp, isMe && { color: COLORS.onDark }]}>
                {item.timestamp?.toDate?.()
                  ? item.timestamp.toDate().toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })
                  : 'Sending...'}
              </Text>
              {isMe && (
                <Ionicons
                  name={item.read ? "checkmark-done" : "checkmark"}
                  size={14}
                  color={item.read ? COLORS.lime : COLORS.onDark}
                  style={styles.readIcon}
                />
              )}
            </View>
          </View>
        </TouchableOpacity>
      </>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <Loading />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* ========== HEADER ========== */}
        <View style={styles.header}>
          <ScreenHeader
            compact
            onBack={() => navigation.goBack()}
            title={otherName}
            subtitle={userType === 'rider' ? 'Your driver' : 'Your passenger'}
            right={<Avatar uri={otherUserPhoto} name={otherName} size={40} />}
          />
        </View>

        {/* ========== QUICK MESSAGES ========== */}
        {showQuickMessages && (
          <View style={styles.quickMessagesContainer}>
            <Text style={TYPE.label}>Quick Replies</Text>
            <View style={styles.quickMessagesRow}>
              {QUICK_MESSAGES.map((msg) => (
                <Chip key={msg} label={msg} onPress={() => sendMessage(msg)} />
              ))}
            </View>
          </View>
        )}

        {/* ========== MESSAGES ========== */}
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.messagesList}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: false })
          }
          showsVerticalScrollIndicator={false}
        />

        {/* ========== INPUT ========== */}
        <View style={styles.inputWrapper}>
          <TouchableOpacity
            style={[styles.quickToggleBtn, showQuickMessages && styles.quickToggleBtnOn]}
            onPress={() => setShowQuickMessages(!showQuickMessages)}
            accessibilityRole="button"
            accessibilityLabel={showQuickMessages ? 'Hide quick replies' : 'Show quick replies'}
          >
            <Ionicons
              name={showQuickMessages ? "close" : "flash"}
              size={20}
              color={showQuickMessages ? COLORS.lime : COLORS.midnight}
            />
          </TouchableOpacity>

          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              value={inputText}
              onChangeText={setInputText}
              placeholder="Type a message..."
              placeholderTextColor={COLORS.faint}
              selectionColor={COLORS.midnight}
              multiline
              maxLength={500}
              returnKeyType="send"
              submitBehavior="submit"
              onSubmitEditing={() => sendMessage()}
            />
          </View>

          <TouchableOpacity
            style={[
              styles.sendBtn,
              !inputText.trim() && styles.sendBtnDisabled
            ]}
            onPress={() => sendMessage()}
            disabled={!inputText.trim()}
            accessibilityRole="button"
            accessibilityLabel="Send"
          >
            <Ionicons
              name="send"
              size={20}
              color={inputText.trim() ? COLORS.lime : COLORS.faint}
            />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.surface,
  },

  /* ========== HEADER ========== */
  header: {
    backgroundColor: COLORS.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.line,
  },

  /* ========== QUICK MESSAGES ========== */
  quickMessagesContainer: {
    backgroundColor: COLORS.white,
    paddingHorizontal: SPACE[4],
    paddingVertical: SPACE[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.line,
  },
  quickMessagesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACE[2],
    marginTop: SPACE[2],
  },

  /* ========== MESSAGES ========== */
  messagesList: {
    paddingHorizontal: SPACE[4],
    paddingVertical: SPACE[4],
    flexGrow: 1,
  },
  dayWrap: { alignItems: 'center', marginVertical: SPACE[3] },
  dayPill: {
    ...TYPE.caption,
    fontWeight: '700',
    color: COLORS.muted,
    backgroundColor: COLORS.fill,
    paddingHorizontal: SPACE[3],
    paddingVertical: SPACE[1],
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginVertical: SPACE[1],
    maxWidth: '85%',
  },
  myRow: {
    alignSelf: 'flex-end',
  },
  theirRow: {
    alignSelf: 'flex-start',
  },
  messageAvatar: {
    marginRight: SPACE[2],
    marginBottom: SPACE[1],
  },
  bubble: {
    paddingHorizontal: SPACE[4],
    paddingVertical: SPACE[3],
    borderRadius: RADIUS.lg,
    maxWidth: '100%',
  },
  myBubble: {
    backgroundColor: COLORS.midnight,
    borderBottomRightRadius: RADIUS.sm,
  },
  theirBubble: {
    backgroundColor: COLORS.white,
    borderBottomLeftRadius: RADIUS.sm,
    ...SHADOW.card,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 21,
  },
  myMessageText: {
    color: COLORS.white,
  },
  theirMessageText: {
    color: COLORS.ink,
  },
  messageMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SPACE[1],
    alignSelf: 'flex-end',
  },
  timestamp: {
    ...TYPE.caption,
    color: COLORS.muted,
  },
  readIcon: {
    marginLeft: SPACE[1],
  },

  /* ========== INPUT ========== */
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SPACE[2],
    backgroundColor: COLORS.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.line,
    paddingHorizontal: SPACE[3],
    paddingVertical: SPACE[3],
  },
  quickToggleBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.fill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickToggleBtnOn: {
    backgroundColor: COLORS.midnight,
  },
  inputContainer: {
    flex: 1,
    backgroundColor: COLORS.fill,
    borderRadius: RADIUS.pill,
    minHeight: 48,
    justifyContent: 'center',
  },
  input: {
    maxHeight: 120,
    minHeight: 48,
    paddingHorizontal: SPACE[4],
    paddingTop: Platform.OS === 'ios' ? 14 : 12,
    paddingBottom: Platform.OS === 'ios' ? 14 : 12,
    fontSize: 16,
    color: COLORS.ink,
  },
  sendBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.midnight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: COLORS.fill,
  },
});

export default ChatScreen;
