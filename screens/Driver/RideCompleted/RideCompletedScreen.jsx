import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, useNavigation } from '@react-navigation/native';

export default function RideCompletedScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { fare = 0, distance = 0 } = route.params || {};

  const [rating, setRating] = useState(0);

  const baseFare = fare * 0.6;
  const distancePremium = fare * 0.4;

  const renderStars = () => {
    return [1, 2, 3, 4, 5].map((i) => (
      <TouchableOpacity key={i} onPress={() => setRating(i)}>
        <Ionicons
          name={i <= rating ? 'star' : 'star-outline'}
          size={32}
          color="#FFD700"
          style={{ marginHorizontal: 4 }}
        />
      </TouchableOpacity>
    ));
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Trip Summary</Text>
          <View style={{ width: 24 }} />
        </View>

        {/* Success Icon */}
        <View style={styles.successIcon}>
          <Ionicons name="checkmark" size={48} color="#fff" />
        </View>

        <Text style={styles.completedText}>Trip Completed</Text>

        {/* Fare Card */}
        <View style={styles.card}>
        <Text style={styles.fareAmount}>£{fare.toFixed(2)}</Text>


          <View style={styles.badge}>
            <Text style={styles.badgeText}>100% – NO COMMISSION</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Base Fare</Text>
            <Text style={styles.fareValue}>£{baseFare.toFixed(2)}</Text>

          </View>

          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Distance Premium</Text>
            <Text style={styles.fareValue}>£{distancePremium.toFixed(2)}</Text>

          </View>
        </View>

        <View style={styles.walletRow}>
  <Ionicons
    name="wallet-outline"
    size={18}
    color="#6B7280"
    style={{ marginRight: 6 }}
  />
  <Text style={styles.walletText}>
    £{fare.toFixed(2)} is added to your wallet balance
  </Text>
</View>


        {/* Rating */}
        <View style={styles.ratingSection}>
          <Text style={styles.ratingTitle}>Rate Rider</Text>
          <View style={styles.stars}>{renderStars()}</View>
        </View>

      </ScrollView>

      {/* Bottom Button */}
      <TouchableOpacity
        style={styles.nextRideBtn}
        onPress={() =>
          navigation.reset({
            index: 0,
            routes: [{ name: 'DriverHome' }],
          })
        }
      >
        <Text style={styles.nextRideText}>Ready for Next Ride</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FA',
  },
  content: {
    padding: 20,
    paddingBottom: 120,
    alignItems: 'center',
  },

  header: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 30,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
  },

  successIcon: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#235594',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },

  completedText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#235594',
    marginBottom: 24,
  },

  card: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    elevation: 4,
  },

  fareAmount: {
    fontSize: 36,
    fontWeight: '800',
    color: '#79B531',
    textAlign: 'center',
  },

  badge: {
    marginTop: 12,
    alignSelf: 'center',
    backgroundColor: '#E9F5DD',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },

  badgeText: {
    color: '#79B531',
    fontWeight: '700',
    fontSize: 14,
  },

  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 16,
  },

  fareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 6,
  },

  fareLabel: {
    fontSize: 16,
    color: '#6B7280',
  },

  fareValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },

  walletText: {
    marginTop: 16,
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },

  ratingSection: {
    marginTop: 32,
    alignItems: 'center',
  },

  ratingTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
  },

  stars: {
    flexDirection: 'row',
  },

  nextRideBtn: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
    backgroundColor: '#79B531',
    paddingVertical: 16,
    borderRadius: 28,
    alignItems: 'center',
  },

  nextRideText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  walletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
  },
  
  walletText: {
    fontSize: 14,
    color: '#6B7280',
  },
  
});
