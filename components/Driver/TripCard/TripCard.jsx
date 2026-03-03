import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

export default function TripCard({ item }) {
  const navigation = useNavigation();
  const isCompleted = item.status === 'COMPLETED';
  const isCancelled = item.status === 'CANCELLED';

  return (
    <View style={styles.tripCard}>
      {/* Top Row */}
      <View style={styles.topRow}>
        <Text style={styles.dateText}>
          {item.dateLabel}, {item.time}
        </Text>

        <View
          style={[
            styles.statusBadge,
            { backgroundColor: isCompleted ? '#E9F5DD' : '#FDECEC' },
          ]}
        >
          <Text
            style={[
              styles.statusText,
              { color: isCompleted ? '#79B531' : '#DC2626' },
            ]}
          >
            {item.status}
          </Text>
        </View>
      </View>

      {/* Pickup */}
      <View style={styles.locationRow}>
        <Ionicons name="location-sharp" size={18} color="#79B531" />
        <View style={styles.locationText}>
          <Text style={styles.locationLabel}>Pickup</Text>
          <Text style={styles.locationValue}>{item.pickup}</Text>
        </View>
      </View>

      {/* Destination */}
      <View style={styles.locationRow}>
        <Ionicons name="flag" size={18} color="#DC2626" />
        <View style={styles.locationText}>
          <Text style={styles.locationLabel}>Destination</Text>
          <Text style={styles.locationValue}>{item.destination}</Text>
        </View>
      </View>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Bottom Row */}
      <View style={styles.bottomRow}>
        <View>
          <Text style={styles.fareLabel}>Fare Earned</Text>
          <Text
            style={[
              styles.fareAmount,
              { color: isCancelled ? '#9CA3AF' : '#79B531' },
            ]}
          >
            £{item.fare.toFixed(2)}
          </Text>
        </View>

        <TouchableOpacity
          style={[
            styles.detailsBtn,
            { backgroundColor: isCancelled ? '#D1D5DB' : '#235594' },
          ]}
          onPress={() => navigation.navigate('DriverTripDetails', { trip: item })}
          disabled={isCancelled}
        >
          <Text
            style={[
              styles.detailsText,
              { color: isCancelled ? '#6B7280' : '#fff' },
            ]}
          >
            Details
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tripCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    elevation: 3,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  dateText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '800',
  },
  locationRow: {
    flexDirection: 'row',
    marginTop: 10,
  },
  locationText: {
    marginLeft: 10,
    flex: 1,
  },
  locationLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  locationValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 14,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fareLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  fareAmount: {
    fontSize: 22,
    fontWeight: '800',
    color: '#79B531',
    marginTop: 2,
  },
  detailsBtn: {
    backgroundColor: '#235594',
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 10,
  },
  detailsText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
});
