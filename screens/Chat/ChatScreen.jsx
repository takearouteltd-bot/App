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
  ActivityIndicator,
  Image,
  StatusBar,
  KeyboardAvoidingView,
  Modal,
  Alert,
} from 'react-native';
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
  deleteDoc,
} from 'firebase/firestore';
import { db } from '../../config/firebase';

const PRIMARY = '#79B531';
const SECONDARY = '#235594';

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
  const [selectedImage, setSelectedImage] = useState(null);
  const flatListRef = useRef(null);

  const messagesRef = collection(db, 'rides', rideId, 'messages');

  // Real-time messages listener
  useEffect(() => {
    const q = query(messagesRef, orderBy('timestamp', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
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

    await addDoc(messagesRef, {
      senderId: currentUser.uid,
      senderType: userType,
      text,
      timestamp: serverTimestamp(),
      read: false,
    });

    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  const handleLongPress = (message) => {
    const isMyMessage = message.senderId === currentUser.uid;
    
    const options = ['Report'];
    if (isMyMessage) options.push('Delete');
    options.push('Cancel');

    Alert.alert(
      'Message Options',
      null,
      options.map((option) => ({
        text: option,
        style: option === 'Cancel' ? 'cancel' : option === 'Delete' ? 'destructive' : 'default',
        onPress: () => {
          if (option === 'Delete') deleteMessage(message.id);
          if (option === 'Report') reportMessage(message);
        },
      }))
    );
  };

  const deleteMessage = async (messageId) => {
    try {
      await deleteDoc(doc(db, 'rides', rideId, 'messages', messageId));
    } catch (err) {
      Alert.alert('Error', 'Could not delete message');
    }
  };

  const reportMessage = (message) => {
    // In production, send to your backend or Firestore collection
    Alert.alert(
      'Report Message',
      'This message has been reported. Our team will review it.',
      [{ text: 'OK' }]
    );
    console.log('Reported message:', message.id);
  };

  const renderQuickMessage = (msg) => (
    <TouchableOpacity
      key={msg}
      style={styles.quickMessageChip}
      onPress={() => sendMessage(msg)}
    >
      <Text style={styles.quickMessageText}>{msg}</Text>
    </TouchableOpacity>
  );

  const renderMessage = ({ item }) => {
    const isMe = item.senderId === currentUser.uid;

    return (
      <TouchableOpacity
        activeOpacity={0.8}
        onLongPress={() => handleLongPress(item)}
        style={[
          styles.messageRow,
          isMe ? styles.myRow : styles.theirRow
        ]}
      >
        {!isMe && otherUserPhoto && (
          <Image source={{ uri: otherUserPhoto }} style={styles.messageAvatar} />
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
            <Text style={styles.timestamp}>
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
                color={item.read ? PRIMARY : '#999'} 
                style={styles.readIcon}
              />
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <StatusBar barStyle="light-content" backgroundColor="#17375E" />

      {/* ========== HEADER ========== */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backBtn} 
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>

        {otherUserPhoto ? (
          <Image source={{ uri: otherUserPhoto }} style={styles.headerAvatar} />
        ) : (
          <View style={[styles.headerAvatar, styles.headerAvatarPlaceholder]}>
            <Ionicons name="person" size={20} color="#fff" />
          </View>
        )}

        <View style={styles.headerInfo}>
          <Text style={styles.headerName} numberOfLines={1}>
            {otherUserName || (userType === 'rider' ? 'Driver' : 'Rider')}
          </Text>
          <Text style={styles.headerStatus}>
            {userType === 'rider' ? 'Your driver' : 'Your passenger'}
          </Text>
        </View>
      </View>

      {/* ========== QUICK MESSAGES ========== */}
      {showQuickMessages && (
        <View style={styles.quickMessagesContainer}>
          <Text style={styles.quickMessagesLabel}>Quick Replies</Text>
          <View style={styles.quickMessagesRow}>
            {QUICK_MESSAGES.map(renderQuickMessage)}
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
          style={styles.quickToggleBtn}
          onPress={() => setShowQuickMessages(!showQuickMessages)}
        >
          <Ionicons 
            name={showQuickMessages ? "close" : "flash"} 
            size={20} 
            color={SECONDARY} 
          />
        </TouchableOpacity>

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Type a message..."
            placeholderTextColor="#999"
            multiline
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={() => sendMessage()}
          />
          <TouchableOpacity 
            style={[
              styles.sendBtn, 
              !inputText.trim() && styles.sendBtnDisabled
            ]}
            onPress={() => sendMessage()}
            disabled={!inputText.trim()}
          >
            <Ionicons 
              name="send" 
              size={20} 
              color={inputText.trim() ? '#fff' : '#ccc'} 
            />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FA',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F7FA',
  },

  /* ========== HEADER ========== */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#17375E',
    paddingTop: Platform.OS === 'ios' ? 50 : StatusBar.currentHeight + 10,
    paddingBottom: 14,
    paddingHorizontal: 16,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  backBtn: {
    padding: 4,
  },
  headerAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    marginLeft: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  headerAvatarPlaceholder: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerInfo: {
    marginLeft: 12,
    flex: 1,
  },
  headerName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },
  headerStatus: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },

  /* ========== QUICK MESSAGES ========== */
  quickMessagesContainer: {
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E8E8',
  },
  quickMessagesLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  quickMessagesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickMessageChip: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#C7D2FE',
    marginBottom: 6,
    marginRight: 6,
  },
  quickMessageText: {
    fontSize: 13,
    color: SECONDARY,
    fontWeight: '500',
  },

  /* ========== MESSAGES ========== */
  messagesList: {
    paddingHorizontal: 12,
    paddingVertical: 16,
    flexGrow: 1,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginVertical: 6,
    maxWidth: '85%',
  },
  myRow: {
    alignSelf: 'flex-end',
  },
  theirRow: {
    alignSelf: 'flex-start',
  },
  messageAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 8,
    marginBottom: 4,
  },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    maxWidth: '100%',
  },
  myBubble: {
    backgroundColor: SECONDARY,
    borderBottomRightRadius: 4,
  },
  theirBubble: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20,
  },
  myMessageText: {
    color: '#fff',
  },
  theirMessageText: {
    color: '#1a1a1a',
  },
  messageMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  timestamp: {
    fontSize: 11,
    opacity: 0.7,
    color: '#888',
  },
  readIcon: {
    marginLeft: 4,
  },

  /* ========== INPUT ========== */
  inputWrapper: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#E8E8E8',
    paddingHorizontal: 12,
    paddingVertical: 10,
    paddingBottom: Platform.OS === 'ios' ? 30 : 16,
  },
  quickToggleBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F3F4',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 44,
    paddingHorizontal: 14,
    paddingTop: 11,
    paddingBottom: 11,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    fontSize: 15,
    color: '#1F2937',
    marginRight: 10,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: PRIMARY,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: '#E5E7EB',
  },
});

export default ChatScreen;