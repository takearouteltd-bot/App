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
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import MapView, { Marker, Polyline } from 'react-native-maps';

const PRIMARY = '#79B531';
const SECONDARY = '#235594';
const DANGER = '#DC2626';

export default function RiderTripDetailsScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { trip } = route.params;

  const isCompleted = trip.status === 'COMPLETED';
  const isCancelled = trip.status === 'CANCELLED';

  // Dummy DRIVER info (correct for rider view)
  const driver = {
    name: trip.driverName || 'Michael Brown',
    image:
      trip.driverImage ||
      'https://randomuser.me/api/portraits/men/45.jpg',
    rating: trip.driverRating || 4.9,
    vehicle: trip.vehicle || 'Toyota Prius • AB12 XYZ',
  };

  return (
    <SafeAreaView style={styles.container}>
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={26} color={SECONDARY} />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>Trip Details</Text>

        <View style={{ width: 26 }} />
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
              pinColor={PRIMARY}
            />

            <Marker
              coordinate={{
                latitude: trip.destinationLat || 51.520,
                longitude: trip.destinationLng || -0.155,
              }}
              pinColor={DANGER}
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
              strokeColor={SECONDARY}
              strokeWidth={3}
            />
          </MapView>
        </View>

        {/* Pickup */}
        <View style={styles.locationRow}>
          <Ionicons name="location-sharp" size={22} color={PRIMARY} />
          <View style={styles.locationText}>
            <Text style={styles.locationLabel}>Pickup</Text>
            <Text style={styles.locationValue}>{trip.pickup}</Text>
          </View>
        </View>

        {/* Destination */}
        <View style={styles.locationRow}>
          <Ionicons name="flag" size={22} color={DANGER} />
          <View style={styles.locationText}>
            <Text style={styles.locationLabel}>Destination</Text>
            <Text style={styles.locationValue}>{trip.destination}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        {/* Driver Card */}
        <View style={styles.driverCard}>
          <Image source={{ uri: driver.image }} style={styles.driverImage} />

          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text style={styles.driverName}>{driver.name}</Text>
            <Text style={styles.driverSubtext}>{driver.vehicle}</Text>
          </View>

          <View style={styles.driverRating}>
            <Ionicons name="star" size={16} color="#FACC15" />
            <Text style={styles.ratingText}>{driver.rating}</Text>
          </View>
        </View>

        {/* Duration & Distance */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>DURATION</Text>
            <Text style={styles.statValue}>
              {trip.duration
                ? `${Math.ceil(trip.duration / 60)} min`
                : '18 min'}
            </Text>
          </View>

          <View style={styles.statCard}>
            <Text style={styles.statLabel}>DISTANCE</Text>
            <Text style={styles.statValue}>
              {trip.distance
                ? `${trip.distance} mi`
                : '4.5 mi'}
            </Text>
          </View>
        </View>

        {/* Payment Summary */}
        <View style={styles.paymentCard}>
          <Text style={styles.paymentTitle}>Payment Summary</Text>

          <View style={styles.paymentRow}>
            <Text style={styles.paymentLabel}>Trip Fare</Text>
            <Text style={styles.paymentValue}>
              £{trip.fare.toFixed(2)}
            </Text>
          </View>

          <View style={styles.paymentRow}>
            <Text style={styles.paymentLabel}>Payment Method</Text>
            <Text style={styles.paymentValue}>
              Visa •••• {trip.lastFour || '1234'}
            </Text>
          </View>

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total Paid</Text>
            <Text style={styles.totalValue}>
              £{trip.fare.toFixed(2)}
            </Text>
          </View>
        </View>

        {/* Buttons */}
        <TouchableOpacity style={styles.primaryBtn}>
          <Ionicons name="download-outline" size={20} color="#fff" />
          <Text style={styles.primaryBtnText}>Download Receipt</Text>
        </TouchableOpacity>

        {isCompleted && (
          <TouchableOpacity style={styles.secondaryBtn}>
            <MaterialIcons name="star-rate" size={20} color="#fff" />
            <Text style={styles.primaryBtnText}>Rate Driver</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.dangerBtn}>
          <MaterialIcons name="report-problem" size={20} color="#fff" />
          <Text style={styles.primaryBtnText}>Report an Issue</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: '#F4F6F9',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    elevation: 3,
  },

  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },

  content: {
    padding: 20,
  },

  mapContainer: {
    height: 180,
    borderRadius: 18,
    overflow: 'hidden',
    marginBottom: 20,
  },

  map: {
    flex: 1,
  },

  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
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
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginTop: 2,
  },

  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 20,
  },

  driverCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    marginBottom: 20,
    alignItems: 'center',
    elevation: 3,
  },

  driverImage: {
    width: 55,
    height: 55,
    borderRadius: 28,
  },

  driverName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },

  driverSubtext: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },

  driverRating: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  ratingText: {
    marginLeft: 4,
    fontWeight: '600',
    fontSize: 14,
  },

  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },

  statCard: {
    flex: 0.48,
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    alignItems: 'center',
    elevation: 3,
  },

  statLabel: {
    fontSize: 12,
    color: '#6B7280',
  },

  statValue: {
    fontSize: 22,
    fontWeight: '800',
    marginTop: 4,
    color: '#111827',
  },

  paymentCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    marginBottom: 20,
    elevation: 3,
  },

  paymentTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: SECONDARY,
    marginBottom: 14,
  },

  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 4,
  },

  paymentLabel: {
    fontSize: 14,
    color: '#6B7280',
  },

  paymentValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },

  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
  },

  totalLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },

  totalValue: {
    fontSize: 22,
    fontWeight: '800',
    color: PRIMARY,
  },

  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SECONDARY,
    paddingVertical: 14,
    borderRadius: 30,
    marginBottom: 12,
  },

  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PRIMARY,
    paddingVertical: 14,
    borderRadius: 30,
    marginBottom: 12,
  },

  dangerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DANGER,
    paddingVertical: 14,
    borderRadius: 30,
    marginBottom: 40,
  },

  primaryBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
    marginLeft: 8,
  },
});
