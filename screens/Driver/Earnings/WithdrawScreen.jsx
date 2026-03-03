import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

export default function WithdrawScreen() {
  const navigation = useNavigation();
  const withdrawAmount = 1245.75;

  return (
    <View style={styles.container}>
      {/* Upper Blue Section */}
      <View style={styles.upperContainer}>
        <View style={styles.header}>
          {/* Back Button */}
          <TouchableOpacity>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>

          <Text style={styles.headerTitle}>Withdraw Funds</Text>

          {/* Question Mark Icon */}
          <TouchableOpacity>
            <Ionicons name="help-circle-outline" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>AVAILABLE BALANCE</Text>
          <Text style={styles.balanceValue}>
            £{withdrawAmount.toFixed(2)}
          </Text>
        </View>
      </View>

      {/* Lower Section */}
      <View style={styles.bottomContainer}>
        
        {/* Amount to Withdraw */}
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.label}>Amount to Withdraw</Text>

            <View style={styles.maxBadge}>
              <Text style={styles.maxText}>MAX</Text>
            </View>
          </View>

          <Text style={styles.amount}>
            £{withdrawAmount.toFixed(2)}
          </Text>
        </View>

        {/* Bank Details */}
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View>
              <Text style={styles.label}>Bank Account</Text>
              <Text style={styles.bankName}>Barclays Bank</Text>
              <Text style={styles.accountNumber}>****** 1234</Text>
            </View>

            <TouchableOpacity>
              <Text style={styles.changeBtn}>Change</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Processing Time */}
        <View style={styles.card}>
          <Text style={styles.label}>Processing Time</Text>
          <Text style={styles.value}>
            Instant (within 15 minutes)
          </Text>
        </View>

        {/* Transaction Fee */}
        <View style={styles.card}>
          <Text style={styles.label}>Transaction Fee</Text>
          <Text style={styles.freeText}>£0.00</Text>
          <Text style={styles.subNote}>
            Free with your active subscription
          </Text>
        </View>
      </View>

      {/* Sticky Bottom Button */}
      <View style={styles.footer}>
        <TouchableOpacity
        onPress={() => navigation.navigate('WithdrawSuccess')}
        style={styles.confirmBtn}>
          <Text style={styles.confirmText}>
            Confirm Withdrawal
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: '#f5f5f5',
    },
  
    upperContainer: {
      backgroundColor: '#235594',
      height: '28%',
      borderBottomLeftRadius: 20,
      borderBottomRightRadius: 20,
      paddingHorizontal: 16,
      paddingTop: 50,
    },
  
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 20,
    },
  
    headerTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: '#fff',
    },
  
    balanceCard: {
      backgroundColor: '#D0E6FF',
      borderRadius: 18,
      padding: 18,
    },
  
    balanceLabel: {
      fontSize: 12,
      color: '#6B7280',
      fontWeight: '600',
    },
  
    balanceValue: {
      fontSize: 26,
      fontWeight: '800',
      color: '#111827',
      marginTop: 4,
    },
  
    bottomContainer: {
      flex: 1,
      padding: 16,
    },
  
    card: {
      backgroundColor: '#fff',
      borderRadius: 16,
      padding: 16,
      marginBottom: 14,
    },
  
    label: {
      fontSize: 12,
      fontWeight: '600',
      color: '#6B7280',
      marginBottom: 6,
    },
  
    amount: {
      fontSize: 24,
      fontWeight: '700',
      color: '#235594',
      marginTop: 6,
    },
  
    bankName: {
      fontSize: 16,
      fontWeight: '600',
      color: '#111827',
    },
  
    accountNumber: {
      fontSize: 14,
      color: '#6B7280',
      marginTop: 4,
    },
  
    changeBtn: {
      color: '#235594',
      fontWeight: '600',
    },
  
    rowBetween: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
  
    value: {
      fontSize: 14,
      fontWeight: '600',
      color: '#111827',
    },
  
    freeText: {
      fontSize: 16,
      fontWeight: '700',
      color: '#16A34A',
    },
  
    subNote: {
      fontSize: 12,
      color: '#6B7280',
      marginTop: 4,
    },
  
    maxBadge: {
      backgroundColor: '#79B531',
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: 12,
    },
  
    maxText: {
      color: '#fff',
      fontSize: 10,
      fontWeight: '700',
    },
  
    footer: {
      padding: 16,
      backgroundColor: '#f5f5f5',
    },
  
    confirmBtn: {
      backgroundColor: '#79B531',
      paddingVertical: 16,
      borderRadius: 30,
      alignItems: 'center',
    },
  
    confirmText: {
      color: '#fff',
      fontWeight: '700',
      fontSize: 16,
    },
  });
  
