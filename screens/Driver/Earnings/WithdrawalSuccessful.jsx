import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

export default function WithdrawalSuccessScreen() {
  const navigation = useNavigation();
  const amount = 1245.75;
  const transactionId = 'TXN8493021';
  const date = 'Oct 18, 2026 • 14:32 PM';
  const maskedAccount = '****** 1234';

  return (
    <View style={styles.container}>

      {/* Top Blue Accent */}
      <View style={styles.topAccent} />

      <View style={styles.content}>

        {/* Success Icon */}
        <View style={styles.iconWrapper}>
          <View style={styles.circle}>
            <Ionicons name="checkmark" size={42} color="#fff" />
          </View>
        </View>

        {/* Title */}
        <Text style={styles.title}>Withdrawal Successful</Text>

        {/* Amount */}
        <Text style={styles.amount}>£{amount.toFixed(2)}</Text>

        <Text style={styles.subText}>
          is on its way to your bank account and should arrive within 2 hours.
        </Text>

        {/* Receipt Card */}
        <View style={styles.receiptCard}>
          <Text style={styles.receiptTitle}>Transaction Details</Text>

          <View style={styles.rowBetween}>
            <Text style={styles.label}>Transaction ID</Text>
            <Text style={styles.value}>{transactionId}</Text>
          </View>

          <View style={styles.rowBetween}>
            <Text style={styles.label}>Date</Text>
            <Text style={styles.value}>{date}</Text>
          </View>

          <View style={styles.rowBetween}>
            <Text style={styles.label}>Amount</Text>
            <Text style={[styles.value, styles.amountHighlight]}>
              £{amount.toFixed(2)}
            </Text>
          </View>

          <View style={styles.divider} />

          {/* Redesigned Bank Section */}
          <View style={styles.bankContainer}>
            <View style={styles.bankIconWrapper}>
              <Ionicons name="business" size={20} color="#235594" />
            </View>

            <View style={{ marginLeft: 12 }}>
              <Text style={styles.destinationLabel}>
                Destination Bank
              </Text>
              <Text style={styles.bankName}>
                Barclays Bank
              </Text>
              <Text style={styles.bankAccount}>
                {maskedAccount}
              </Text>
            </View>
          </View>
        </View>

        {/* Notify Info */}
        <View style={styles.notifyRow}>
          <Ionicons
            name="alert-circle-outline"
            size={16}
            color="#235594"
            style={{ marginRight: 6 }}
          />
          <Text style={styles.notifyText}>
            We will notify you when it hits your account.
          </Text>
        </View>

      </View>

      {/* Bottom Button */}
      <TouchableOpacity
      onPress={() => navigation.goBack()}
      style={styles.backBtn}>
        <Ionicons
          name="wallet-outline"
          size={20}
          color="#fff"
          style={{ marginRight: 8 }}
        />
        <Text style={styles.backBtnText}>Back to Wallet</Text>
      </TouchableOpacity>

    </View>
  );
}

const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: '#F8FAFC',
      justifyContent: 'space-between',
    },
  
    topAccent: {
      width: '100%',
      height: 6,
      backgroundColor: '#235594',
    },
  
    content: {
      paddingHorizontal: 24,
      alignItems: 'center',
    },
  
    iconWrapper: {
      marginTop: 40,
      marginBottom: 24,
    },
  
    circle: {
      width: 100,
      height: 100,
      borderRadius: 50,
      backgroundColor: '#79B531',
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: '#79B531',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.4,
      shadowRadius: 12,
      elevation: 8,
    },
  
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: '#235594',
      marginBottom: 8,
    },
  
    amount: {
      fontSize: 30,
      fontWeight: '800',
      color: '#235594',
      marginBottom: 10,
    },
  
    subText: {
      fontSize: 14,
      color: '#4B5563',
      textAlign: 'center',
      marginBottom: 30,
      paddingHorizontal: 10,
    },
  
    receiptCard: {
      width: '100%',
      backgroundColor: '#fff',
      borderRadius: 20,
      padding: 22,
      marginBottom: 20,
      borderTopWidth: 4,
      borderTopColor: '#235594',
      elevation: 4,
    },
  
    receiptTitle: {
      fontSize: 16,
      fontWeight: '700',
      marginBottom: 18,
      color: '#235594',
    },
  
    rowBetween: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 14,
    },
  
    label: {
      fontSize: 13,
      color: '#6B7280',
    },
  
    value: {
      fontSize: 13,
      fontWeight: '600',
      color: '#111827',
    },
  
    amountHighlight: {
      color: '#79B531',
    },
  
    divider: {
      height: 1,
      backgroundColor: '#E5E7EB',
      marginVertical: 16,
    },
  
    bankContainer: {
      flexDirection: 'row',
      alignItems: 'center',
    },
  
    bankIconWrapper: {
      width: 40,
      height: 40,
      borderRadius: 10,
      backgroundColor: '#EEF2FF',
      justifyContent: 'center',
      alignItems: 'center',
    },
  
    destinationLabel: {
      fontSize: 12,
      color: '#6B7280',
    },
  
    bankName: {
      fontSize: 14,
      fontWeight: '700',
      color: '#235594',
    },
  
    bankAccount: {
      fontSize: 13,
      fontWeight: '500',
      color: '#4B5563',
    },
  
    notifyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 20,
    },
  
    notifyText: {
      fontSize: 13,
      color: '#4B5563',
    },
  
    backBtn: {
      flexDirection: 'row',
      backgroundColor: '#79B531',
      paddingVertical: 16,
      borderRadius: 30,
      alignItems: 'center',
      justifyContent: 'center',
      marginHorizontal: 24,
      marginBottom: 30,
      shadowColor: '#79B531',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.4,
      shadowRadius: 10,
      elevation: 6,
    },
  
    backBtnText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '700',
    },
  });
  