import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { currencySymbol } from '../../../utils/appConfig';

const PRIMARY = '#79B531';
const SECONDARY = '#235594';

export default function TripCard({ item }) {
  const navigation = useNavigation();

  // ✅ Use route.status for the ride status, NOT driverResponse
  const status = item.status?.toUpperCase() || 'PENDING';
  
  const isCompleted = status === 'COMPLETED';
  const isCancelled = status === 'CANCELLED';

  // Format date from timestamps.createdAt
  const formatDateLabel = (timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    return isToday ? 'TODAY' : date.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
  };

  // Format time from timestamps.createdAt
  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  // ✅ Get fare from nested structure
  const fareTotal = item.fare?.total ?? 0;
  const currency = currencySymbol(item.fare?.currency);

  // ✅ Pickup & dropoff from correct nested fields
  const pickupAddress = item.pickupLocation?.address || 'Unknown pickup';
  const dropoffAddress = item.dropoffLocation?.address || 'Unknown destination';

  return (
    <View style={styles.tripCard}>
      {/* Top Row */}
      <View style={styles.topRow}>
        <Text style={styles.dateText}>
          {formatDateLabel(item.timestamps?.createdAt)}, {formatTime(item.timestamps?.createdAt)}
        </Text>

        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor: isCompleted
                ? '#E9F5DD'
                : isCancelled
                ? '#FDECEC'
                : '#E6F0FA',
            },
          ]}
        >
          <Text
            style={[
              styles.statusText,
              {
                color: isCompleted
                  ? PRIMARY
                  : isCancelled
                  ? '#DC2626'
                  : SECONDARY,
              },
            ]}
          >
            {status}
          </Text>
        </View>
      </View>

      {/* Pickup */}
      <View style={styles.locationRow}>
        <Ionicons name="location-sharp" size={18} color={PRIMARY} />
        <View style={styles.locationText}>
          <Text style={styles.locationLabel}>Pickup</Text>
          <Text style={styles.locationValue} numberOfLines={2}>
            {pickupAddress}
          </Text>
        </View>
      </View>

      {/* Destination */}
      <View style={styles.locationRow}>
        <Ionicons name="flag" size={18} color="#DC2626" />
        <View style={styles.locationText}>
          <Text style={styles.locationLabel}>Destination</Text>
          <Text style={styles.locationValue} numberOfLines={2}>
            {dropoffAddress}
          </Text>
        </View>
      </View>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Bottom Row */}
      <View style={styles.bottomRow}>
        <View>
          <Text style={styles.fareLabel}>
            {isCancelled ? 'Fare' : 'Fare Earned'}
          </Text>
          <Text
            style={[
              styles.fareAmount,
              {
                color: isCancelled ? '#9CA3AF' : '#111827',
              },
            ]}
          >
            {currency}{fareTotal.toFixed(2)}
          </Text>
        </View>

        <TouchableOpacity
          style={[
            styles.detailsBtn,
            {
              backgroundColor: isCancelled ? '#D1D5DB' : SECONDARY,
            },
          ]}
          onPress={() =>
            navigation.navigate('DriverTripDetails', { trip: item })
          }
          disabled={isCancelled}
        >
          <Text
            style={[
              styles.detailsText,
              {
                color: isCancelled ? '#6B7280' : '#fff',
              },
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
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
    flex: 1,
    marginRight: 8,
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
    alignItems: 'flex-start',
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
    lineHeight: 20,
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
    marginTop: 2,
  },

  detailsBtn: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 10,
  },

  detailsText: {
    fontWeight: '700',
    fontSize: 14,
  },
});