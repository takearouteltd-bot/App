import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
  Image,
} from 'react-native';
import { Ionicons, MaterialIcons, Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import MapView, { Marker, Polyline } from 'react-native-maps';

export default function DriverTripDetailsScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { trip } = route.params;

  const isCompleted = trip.status === 'COMPLETED';
  const isCancelled = trip.status === 'CANCELLED';

  // Dummy rider info
  const rider = {
    name: 'John Doe',
    image: 'https://randomuser.me/api/portraits/men/32.jpg',
    rating: 4.8,
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={28} color="#235594" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Trip Details</Text>
        <View style={{ width: 28 }} /> {/* Placeholder */}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Map */}
        <View style={styles.mapContainer}>
          <MapView
            style={styles.map}
            initialRegion={{
              latitude: trip.pickupLat || 51.515,
              longitude: trip.pickupLng || -0.142,
              latitudeDelta: 0.05,
              longitudeDelta: 0.05,
            }}
            scrollEnabled={false}
            zoomEnabled={false}
          >
            <Marker
              coordinate={{
                latitude: trip.pickupLat || 51.515,
                longitude: trip.pickupLng || -0.142,
              }}
              pinColor="#79B531"
            />
            <Marker
              coordinate={{
                latitude: trip.destinationLat || 51.520,
                longitude: trip.destinationLng || -0.155,
              }}
              pinColor="#DC2626"
            />
            <Polyline
              coordinates={[
                {
                  latitude: trip.pickupLat || 51.515,
                  longitude: trip.pickupLng || -0.142,
                },
                {
                  latitude: trip.destinationLat || 51.520,
                  longitude: trip.destinationLng || -0.155,
                },
              ]}
              strokeColor="#235594"
              strokeWidth={3}
            />
          </MapView>
        </View>

        {/* Pickup */}
        <View style={styles.locationRow}>
          <Ionicons name="location-sharp" size={22} color="#79B531" />
          <View style={styles.locationText}>
            <Text style={styles.locationLabel}>Pickup</Text>
            <Text style={styles.locationValue}>{trip.pickup}</Text>
          </View>
        </View>

        {/* Destination */}
        <View style={styles.locationRow}>
          <Ionicons name="flag" size={22} color="#DC2626" />
          <View style={styles.locationText}>
            <Text style={styles.locationLabel}>Destination</Text>
            <Text style={styles.locationValue}>{trip.destination}</Text>
          </View>
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Rider Info */}
        <View style={styles.riderCard}>
          <Image source={{ uri: rider.image }} style={styles.riderImage} />
          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text style={styles.riderName}>{rider.name}</Text>
            <Text style={styles.riderSubtext}>Rider</Text>
          </View>
          <View style={styles.riderRating}>
            <Ionicons name="star" size={16} color="#FACC15" />
            <Text style={styles.ratingText}>{rider.rating}</Text>
          </View>
        </View>

        {/* Duration & Distance */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>DURATION</Text>
            <Text style={styles.statValue}>
              {trip.duration ? `${Math.ceil(trip.duration / 60)} min` : '18 mins'}
            </Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>DISTANCE</Text>
            <Text style={styles.statValue}>
              {trip.distance ? `${trip.distance} mi` : '4.5 miles'}
            </Text>
          </View>
        </View>

        {/* Earnings */}
        <View style={styles.fareCard}>
          <Text style={styles.fareTitle}>Earnings Breakdown</Text>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Fare Earned</Text>
            <Text style={styles.fareValue}>£{trip.fare.toFixed(2)}</Text>
          </View>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Platform Fee</Text>
            <Text style={styles.fareValue}>£0.00</Text>
          </View>
          <View style={[styles.fareRow, { marginTop: 12 }]}>
            <Text style={styles.totalFareLabel}>Net Earnings</Text>
            <Text style={styles.totalFareValue}>£{trip.fare.toFixed(2)}</Text>
          </View>
        </View>

        {/* Action Buttons */}
        <TouchableOpacity style={styles.actionBtn}>
          <Ionicons name="download-outline" size={20} color="#fff" />
          <Text style={styles.actionBtnText}>Download Receipt</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#79B531' }]}>
          <MaterialIcons name="report-problem" size={20} color="#fff" />
          <Text style={styles.actionBtnText}>Report an Issue</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,

    elevation: 2,
  },
  headerTitle: { fontSize: 20, fontWeight: '600', color: '#235594' },
  content: { padding: 16 },

  mapContainer: { height: 180, borderRadius: 16, overflow: 'hidden', marginBottom: 16 },
  map: { flex: 1 },

  locationRow: { flexDirection: 'row', marginBottom: 16, alignItems: 'center' },
  locationText: { marginLeft: 10, flex: 1 },
  locationLabel: { fontSize: 12, color: '#6B7280' },
  locationValue: { fontSize: 16, fontWeight: '600', color: '#111827', marginTop: 2 },
  divider: { height: 1, backgroundColor: '#E5E7EB', marginVertical: 16 },

  riderCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    alignItems: 'center',
    elevation: 2,
  },
  riderImage: { width: 50, height: 50, borderRadius: 25 },
  riderName: { fontSize: 16, fontWeight: '600', color: '#111827' },
  riderSubtext: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  riderRating: { flexDirection: 'row', alignItems: 'center' },
  ratingText: { fontSize: 14, fontWeight: '600', marginLeft: 4, color: '#111827' },

  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  statCard: {
    flex: 0.48,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    elevation: 2,
  },
  statLabel: { fontSize: 12, color: '#6B7280' },
  statValue: { fontSize: 22, fontWeight: '800', color: '#111827', marginTop: 4 },

  fareCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
  },
  fareTitle: { fontSize: 16, fontWeight: '600', color: '#235594', marginBottom: 12 },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 2 },
  fareLabel: { fontSize: 14, color: '#6B7280' },
  fareValue: { fontSize: 14, fontWeight: '600', color: '#111827' },
  totalFareLabel: { fontSize: 16, fontWeight: '700', color: '#111827' },
  totalFareValue: { fontSize: 22, fontWeight: '800', color: '#79B531' },

  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#79B531',
    paddingVertical: 14,
    borderRadius: 25,
    marginBottom: 12,
  },
  actionBtnText: { color: '#fff', fontWeight: '700', fontSize: 16, marginLeft: 8 },
});
