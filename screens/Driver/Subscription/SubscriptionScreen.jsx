import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function SubscriptionScreen({ navigation }) {
  const nextBillingDate = 'Nov 18, 2026';
  const upgradePrice = '£74.99/month';
  const [showModal, setShowModal] = useState(false);

  const ConfirmPay = () => {
    setShowModal(false);
    navigation.navigate("SubscriptionSuccess")
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={22} color="#235594" />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>Subscription Management</Text>

        <View style={{ width: 22 }} /> 
      </View>

      {/* Current Plan Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Current Plan</Text>
        <View style={styles.planCard}>
          <View style={styles.planHeaderRow}>
            <Text style={styles.planTitle}>Pro Driver</Text>
            <View style={styles.activeBadge}>
              <Text style={styles.activeBadgeText}>Active</Text>
            </View>
          </View>
          <Text style={styles.planSubtitle}>Refined Professional Tier</Text>
          <View style={styles.divider} />
          <View style={styles.billingRow}>
            <Ionicons name="calendar-outline" size={16} color="#235594" style={{ marginRight: 6 }} />
            <Text style={styles.billingText}>Next billing date: {nextBillingDate}</Text>
          </View>
        </View>
      </View>

      {/* Upgrade Plan Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Upgrade Your Plan</Text>
        <View style={styles.upgradeCard}>
          <View style={styles.upgradeHeaderRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="diamond-outline" size={20} color="#79B531" style={{ marginRight: 6 }} />
              <Text style={styles.upgradeTitle}>Elite Driver</Text>
            </View>
            <View style={styles.recommendedBadge}>
              <Text style={styles.recommendedText}>Recommended</Text>
            </View>
          </View>
          <Text style={styles.upgradeSubtitle}>
            Unlock the full potential of your route with exclusive perks
          </Text>

          {/* Perks */}
          <View style={styles.perksRow}>
            <Ionicons name="flash-outline" size={20} color="#79B531" style={{ marginRight: 6 }} />
            <Text style={styles.perkText}>Top Priority Dispatch</Text>
          </View>
          <View style={styles.perksRow}>
            <Ionicons name="cash-outline" size={20} color="#79B531" style={{ marginRight: 6 }} />
            <Text style={styles.perkText}>Unlimited 100% Earnings</Text>
          </View>
          <View style={styles.perksRow}>
            <Ionicons name="headset-outline" size={20} color="#79B531" style={{ marginRight: 6 }} />
            <Text style={styles.perkText}>Premium Support</Text>
          </View>
          <View style={styles.perksRow}>
            <Ionicons name="heart-outline" size={20} color="#79B531" style={{ marginRight: 6 }} />
            <Text style={styles.perkText}>Health & Wellness Perks</Text>
          </View>

          {/* Price Badge */}
          <View style={styles.priceBadge}>
            <Text style={styles.priceText}>{upgradePrice}</Text>
          </View>

          {/* Switch Button */}
          <TouchableOpacity style={styles.switchBtn} onPress={() => setShowModal(true)}>
            <Text style={styles.switchBtnText}>Switch to Elite</Text>
          </TouchableOpacity>
        </View>

        {/* Manage Payment Method */}
        <TouchableOpacity style={styles.paymentRow}>
          <Ionicons name="wallet-outline" size={20} color="#235594" style={{ marginRight: 10 }} />
          <Text style={styles.paymentText}>Manage Payment Method</Text>
        </TouchableOpacity>
      </View>

      {/* Modal */}
      <Modal visible={showModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            {/* Same card inside modal */}
            <View style={styles.upgradeCard}>
              <View style={styles.upgradeHeaderRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="diamond-outline" size={20} color="#79B531" style={{ marginRight: 6 }} />
                  <Text style={styles.upgradeTitle}>Elite Driver</Text>
                </View>
                <View style={styles.recommendedBadge}>
                  <Text style={styles.recommendedText}>Recommended</Text>
                </View>
              </View>
              <Text style={styles.upgradeSubtitle}>
                Unlock the full potential of your route with exclusive perks
              </Text>
              <View style={styles.perksRow}>
                <Ionicons name="flash-outline" size={20} color="#79B531" style={{ marginRight: 6 }} />
                <Text style={styles.perkText}>Top Priority Dispatch</Text>
              </View>
              <View style={styles.perksRow}>
                <Ionicons name="cash-outline" size={20} color="#79B531" style={{ marginRight: 6 }} />
                <Text style={styles.perkText}>Unlimited 100% Earnings</Text>
              </View>
              <View style={styles.perksRow}>
                <Ionicons name="headset-outline" size={20} color="#79B531" style={{ marginRight: 6 }} />
                <Text style={styles.perkText}>Premium Support</Text>
              </View>
              <View style={styles.perksRow}>
                <Ionicons name="heart-outline" size={20} color="#79B531" style={{ marginRight: 6 }} />
                <Text style={styles.perkText}>Health & Wellness Perks</Text>
              </View>
              <View style={styles.priceBadge}>
                <Text style={styles.priceText}>{upgradePrice}</Text>
              </View>

              {/* Confirm & Pay Button */}
              <TouchableOpacity style={styles.confirmPayBtn} onPress={ConfirmPay}>
                <Text style={styles.switchBtnText}>Confirm & Pay</Text>
              </TouchableOpacity>
            </View>

            {/* Close modal */}
            <TouchableOpacity
              style={{ marginTop: 12, alignSelf: 'center' }}
              onPress={() => setShowModal(false)}
            >
              <Text style={{ color: '#235594', fontWeight: '700' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', paddingHorizontal: 20, paddingTop: 60 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 30 },
  backButton: { padding: 6 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#235594' },

  section: { marginTop: 10, marginBottom: 20 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#6B7280', marginBottom: 14 },

  planCard: { backgroundColor: '#fff', borderRadius: 18, padding: 20, borderWidth: 2, borderColor: '#79B531', elevation: 4 },
  planHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  planTitle: { fontSize: 21, fontWeight: '700', color: '#235594' },
  activeBadge: { backgroundColor: '#79B531', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 20 },
  activeBadgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  planSubtitle: { fontSize: 14, color: '#4B5563', marginTop: 8, marginBottom: 16 },
  divider: { height: 1, backgroundColor: '#E5E7EB', marginBottom: 16 },
  billingRow: { flexDirection: 'row', alignItems: 'center' },
  billingText: { fontSize: 13, color: '#235594', fontWeight: '500' },

  upgradeCard: { backgroundColor: '#fff', borderRadius: 18, padding: 20, borderWidth: 2, borderColor: '#235594', elevation: 4 },
  upgradeHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  upgradeTitle: { fontSize: 21, fontWeight: '700', color: '#235594' },
  recommendedBadge: { backgroundColor: '#79B531', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 20 },
  recommendedText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  upgradeSubtitle: { fontSize: 14, color: '#4B5563', marginBottom: 14 },
  perksRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  perkText: { fontSize: 13, color: '#111827', fontWeight: '500' },
  priceBadge: { backgroundColor: '#79B531', alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, marginTop: 12, marginBottom: 14 },
  priceText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  switchBtn: { backgroundColor: '#79B531', paddingVertical: 14, borderRadius: 25, alignItems: 'center' },
  switchBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  paymentRow: { flexDirection: 'row', alignItems: 'center', marginTop: 18 },
  paymentText: { fontSize: 14, color: '#235594', fontWeight: '600' },

  /* Modal Styles */
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 20 },
  modalContainer: { backgroundColor: '#f5f5f5', borderRadius: 20, padding: 20 },
  confirmPayBtn: { backgroundColor: '#79B531', paddingVertical: 14, borderRadius: 25, alignItems: 'center', marginTop: 12 },
});
