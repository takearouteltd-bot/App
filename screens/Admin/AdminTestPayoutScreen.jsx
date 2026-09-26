import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { Alert } from '../../components/ui/alert';
import { Ionicons } from '@expo/vector-icons';
import { getFirestore, collection, query, where, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getAuth } from 'firebase/auth';
import { currencySymbol } from '../../utils/appConfig';
import { COLORS } from '../../components/ui/kit';

export default function AdminPayoutTestScreen() {
  const db = getFirestore();
  const functions = getFunctions();
  const auth = getAuth();

  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const [referenceInputs, setReferenceInputs] = useState({});
    const driverId = auth.currentUser ? auth.currentUser.uid : null

  useEffect(() => {
    const q = query(
      collection(db, 'driverPayouts'),
      where('driverId', '==', driverId),
      where('status', '==', 'pending_admin')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
      setPayouts(list);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleComplete = async (payoutId) => {
    const reference = referenceInputs[payoutId];
    
    if (!reference || reference.trim() === '') {
      Alert.alert('Error', 'Enter bank transaction reference');
      return;
    }

    setProcessingId(payoutId);

    try {
      const completePayout = httpsCallable(functions, 'completeDriverPayout');
      await completePayout({
        payoutId: payoutId,
        transactionReference: reference.trim(),
      });

      Alert.alert('Success', 'Payout marked as completed');
      
      // Clear input
      setReferenceInputs(prev => ({ ...prev, [payoutId]: '' }));

    } catch (error) {
      console.error('Complete failed:', error);
      Alert.alert('Error', error.message || 'Failed to complete payout');
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (payoutId) => {
    Alert.alert(
      'Reject Payout',
      'Are you sure? This will refund the driver.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            setProcessingId(payoutId);
            try {
              const rejectPayout = httpsCallable(functions, 'rejectDriverPayout');
              await rejectPayout({
                payoutId: payoutId,
                reason: 'Rejected by admin',
              });
              Alert.alert('Success', 'Payout rejected and refunded');
            } catch (error) {
              Alert.alert('Error', error.message || 'Failed to reject');
            } finally {
              setProcessingId(null);
            }
          }
        }
      ]
    );
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-GB', { 
      day: 'numeric', 
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const renderPayout = ({ item }) => {
    const bank = item.bankDetails || {};
    
    return (
      <View style={styles.payoutCard}>
        <View style={styles.payoutHeader}>
          <Text style={styles.driverId}>Driver: {item.driverId.slice(-6)}</Text>
          <Text style={styles.amount}>{currencySymbol()}{item.amount.toFixed(2)}</Text>
        </View>

        <View style={styles.bankDetails}>
          <Text style={styles.bankText}>Holder: {bank.accountHolder}</Text>
          <Text style={styles.bankText}>Sort Code: {bank.sortCode}</Text>
          <Text style={styles.bankText}>Account: {bank.accountNumber}</Text>
        </View>

        <Text style={styles.date}>Requested: {formatDate(item.requestedAt)}</Text>

        <TextInput
          style={styles.input}
          placeholder="Enter bank reference (e.g. BACS-001)"
          value={referenceInputs[item.id] || ''}
          onChangeText={(text) => setReferenceInputs(prev => ({ 
            ...prev, 
            [item.id]: text 
          }))}
        />

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.completeBtn, processingId === item.id && styles.disabledBtn]}
            onPress={() => handleComplete(item.id)}
            disabled={processingId === item.id}
          >
            {processingId === item.id ? (
              <ActivityIndicator color={COLORS.white} size="small" />
            ) : (
              <Text style={styles.btnText}>Mark Paid</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.rejectBtn}
            onPress={() => handleReject(item.id)}
            disabled={processingId === item.id}
          >
            <Text style={styles.rejectText}>Reject</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={COLORS.blue} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Admin - Pending Payouts</Text>
        <Text style={styles.count}>{payouts.length} pending</Text>
      </View>

      <FlatList
        data={payouts}
        keyExtractor={item => item.id}
        renderItem={renderPayout}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={
          <Text style={styles.empty}>No pending payouts</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.surface,
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    backgroundColor: COLORS.blue,
    paddingTop: 50,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.white,
  },
  count: {
    fontSize: 14,
    color: '#D0E6FF',
    marginTop: 4,
  },
  payoutCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  payoutHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  driverId: {
    fontSize: 14,
    color: COLORS.muted,
  },
  amount: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.blue,
  },
  bankDetails: {
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  bankText: {
    fontSize: 13,
    color: COLORS.inkSoft,
    marginBottom: 2,
  },
  date: {
    fontSize: 12,
    color: COLORS.faint,
    marginBottom: 12,
  },
  input: { color: COLORS.ink,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    marginBottom: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  completeBtn: {
    flex: 1,
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  disabledBtn: {
    opacity: 0.6,
  },
  btnText: {
    color: COLORS.white,
    fontWeight: '700',
  },
  rejectBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.red,
  },
  rejectText: {
    color: COLORS.red,
    fontWeight: '600',
  },
  empty: {
    textAlign: 'center',
    color: COLORS.muted,
    marginTop: 40,
    fontSize: 16,
  },
});