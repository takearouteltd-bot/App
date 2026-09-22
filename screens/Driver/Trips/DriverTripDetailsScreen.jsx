import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
} from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { currencySymbol } from '../../../utils/appConfig';
import { COLORS, Avatar } from '../../../components/ui/kit';

const PRIMARY = COLORS.green;
const SECONDARY = COLORS.blue;
const DANGER = COLORS.red;

export default function DriverTripDetailsScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { trip } = route.params;

  const [rider, setRider] = useState(null);
  const [loadingRider, setLoadingRider] = useState(true);

  // Fetch real RIDER data from Firestore (the person the driver picked up)
  useEffect(() => {
    const fetchRider = async () => {
      if (!trip.riderId) {
        setLoadingRider(false);
        return;
      }

      try {
        const riderDoc = await getDoc(doc(db, 'riders', trip.riderId));
        if (riderDoc.exists()) {
          const riderData = riderDoc.data();
          setRider({
            name: riderData.name || riderData.fullName || 'Rider',
            image: riderData.profileImage || riderData.selfieUrl,
            rating: riderData.rating || riderData.averageRating || null,
            phone: riderData.phone || '',
          });
        }
      } catch (error) {
        console.error('Error fetching rider:', error);
      } finally {
        setLoadingRider(false);
      }
    };

    fetchRider();
  }, [trip.riderId]);

  // Use route.status (same as the card), not trip.status
  const status = trip.route?.status?.toUpperCase() || 'PENDING';
  const isCompleted = status === 'COMPLETED';
  const isCancelled = status === 'CANCELLED';

  // Fare is an object — extract the total
  const fareTotal = trip.fare?.total ?? 0;
  const currency = currencySymbol(trip.fare?.currency);

  // Pickup & dropoff from nested location objects
  const pickup = trip.pickupLocation || {};
  const dropoff = trip.dropoffLocation || {};
  const hasRouteCoords =
    typeof pickup.latitude === 'number' &&
    typeof pickup.longitude === 'number' &&
    typeof dropoff.latitude === 'number' &&
    typeof dropoff.longitude === 'number';

  // Route stats from nested route object
  const routeInfo = trip.route || {};
  const distanceMiles = routeInfo.distanceMiles ?? (routeInfo.distanceKm ? routeInfo.distanceKm * 0.621371 : 0);
  const durationMinutes = routeInfo.durationMinutes ?? 0;

  // Payment info from nested payment object
  const payment = trip.payment || {};
  const paymentMethod = payment.method || 'card';

  // Format timestamps
  const formatDateTime = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
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
        {/* Map. Trips without saved coordinates simply have no map, rather
            than falling back to a fixed point on the other side of the world. */}
        {hasRouteCoords ? (
        <View style={styles.mapContainer}>
          <MapView
            style={styles.map}
            initialRegion={{
              latitude: pickup.latitude,
              longitude: pickup.longitude,
              latitudeDelta: 0.02,
              longitudeDelta: 0.02,
            }}
            scrollEnabled={false}
            zoomEnabled={false}
          >
            <Marker
              coordinate={{
                latitude: pickup.latitude,
                longitude: pickup.longitude,
              }}
              pinColor={PRIMARY}
            />

            <Marker
              coordinate={{
                latitude: dropoff.latitude,
                longitude: dropoff.longitude,
              }}
              pinColor={DANGER}
            />

            <Polyline
              coordinates={[
                {
                  latitude: pickup.latitude,
                  longitude: pickup.longitude,
                },
                {
                  latitude: dropoff.latitude,
                  longitude: dropoff.longitude,
                },
              ]}
              strokeColor={SECONDARY}
              strokeWidth={3}
            />
          </MapView>
        </View>
        ) : null}

        {/* Status Badge */}
        <View style={styles.statusRow}>
          <View style={[
            styles.statusBadge,
            {
              backgroundColor: isCompleted ? COLORS.greenSoft : isCancelled ? '#FDECEC' : '#E6F0FA',
            }
          ]}>
            <Text style={[
              styles.statusText,
              {
                color: isCompleted ? PRIMARY : isCancelled ? DANGER : SECONDARY,
              }
            ]}>
              {status}
            </Text>
          </View>
          <Text style={styles.dateText}>
            {formatDateTime(trip.timestamps?.createdAt)}
          </Text>
        </View>

        {/* Pickup */}
        <View style={styles.locationRow}>
          <Ionicons name="location-sharp" size={22} color={PRIMARY} />
          <View style={styles.locationText}>
            <Text style={styles.locationLabel}>Pickup</Text>
            <Text style={styles.locationValue}>{pickup.address || 'Unknown pickup'}</Text>
          </View>
        </View>

        {/* Destination */}
        <View style={styles.locationRow}>
          <Ionicons name="flag" size={22} color={DANGER} />
          <View style={styles.locationText}>
            <Text style={styles.locationLabel}>Destination</Text>
            <Text style={styles.locationValue}>{dropoff.address || 'Unknown destination'}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        {/* Rider Card — with real data */}
        <View style={styles.riderCard}>
          {loadingRider ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={PRIMARY} />
              <Text style={styles.loadingText}>Loading rider info...</Text>
            </View>
          ) : (
            <>
              <Avatar uri={rider?.image} name={rider?.name} size={52} />

              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={styles.riderName}>{rider?.name || 'Rider'}</Text>
                <Text style={styles.riderSubtext}>Passenger</Text>
              </View>

              <View style={styles.riderRating}>
                <Ionicons name="star" size={16} color={COLORS.star} />
                <Text style={styles.ratingText}>{rider?.rating || 'New'}</Text>
              </View>
            </>
          )}
        </View>

        {/* Duration & Distance */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>DURATION</Text>
            <Text style={styles.statValue}>
              {durationMinutes ? `${Math.ceil(durationMinutes)} min` : 'N/A'}
            </Text>
          </View>

          <View style={styles.statCard}>
            <Text style={styles.statLabel}>DISTANCE</Text>
            <Text style={styles.statValue}>
              {distanceMiles ? `${distanceMiles.toFixed(1)} mi` : 'N/A'}
            </Text>
          </View>
        </View>

        {/* Payment Summary */}
        <View style={styles.paymentCard}>
          <Text style={styles.paymentTitle}>Payment Summary</Text>

          <View style={styles.paymentRow}>
            <Text style={styles.paymentLabel}>Base Fare</Text>
            <Text style={styles.paymentValue}>
              {currency}{trip.fare?.baseFare?.toFixed(2) || '0.00'}
            </Text>
          </View>

          <View style={styles.paymentRow}>
            <Text style={styles.paymentLabel}>Distance Fare</Text>
            <Text style={styles.paymentValue}>
              {currency}{trip.fare?.distanceFare?.toFixed(2) || '0.00'}
            </Text>
          </View>

          <View style={styles.paymentRow}>
            <Text style={styles.paymentLabel}>Time Fare</Text>
            <Text style={styles.paymentValue}>
              {currency}{trip.fare?.timeFare?.toFixed(2) || '0.00'}
            </Text>
          </View>

          {trip.fare?.vat > 0 && (
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>VAT</Text>
              <Text style={styles.paymentValue}>
                {currency}{trip.fare?.vat?.toFixed(2)}
              </Text>
            </View>
          )}

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total Paid</Text>
            <Text style={styles.totalValue}>
              {currency}{fareTotal.toFixed(2)}
            </Text>
          </View>
        </View>

        {/* Buttons */}
        <TouchableOpacity 
        onPress={() => navigation.navigate('ReportIssueScreen', { 
            trip: trip,
            reporterType: 'driver'
          })}
        style={styles.dangerBtn}>
          <MaterialIcons name="report-problem" size={20} color={COLORS.white} />
          <Text style={styles.primaryBtnText}>Report an Issue</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: SECONDARY,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  mapContainer: {
    height: 200,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  statusBadge: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  dateText: {
    fontSize: 13,
    color: COLORS.muted,
    fontWeight: '500',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
    gap: 12,
  },
  locationText: {
    flex: 1,
  },
  locationLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.muted,
    marginBottom: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  locationValue: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.ink,
    lineHeight: 20,
  },
  divider: {
    height: 1,
    backgroundColor: '#F2F2F7',
    marginVertical: 8,
  },
  riderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  loadingText: {
    fontSize: 14,
    color: COLORS.muted,
    fontWeight: '500',
  },
  riderImage: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: COLORS.white,
  },
  riderName: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.ink,
  },
  riderSubtext: {
    fontSize: 13,
    color: COLORS.muted,
    marginTop: 2,
    fontWeight: '500',
  },
  riderRating: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 4,
  },
  ratingText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.ink,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.muted,
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.ink,
  },
  paymentCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
  },
  paymentTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.ink,
    marginBottom: 14,
  },
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  paymentLabel: {
    fontSize: 14,
    color: COLORS.muted,
    fontWeight: '500',
  },
  paymentValue: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.ink,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E5EA',
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.ink,
  },
  totalValue: {
    fontSize: 18,
    fontWeight: '900',
    color: PRIMARY,
  },
  dangerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DANGER,
    paddingVertical: 16,
    borderRadius: 16,
    gap: 8,
    marginTop: 8,
  },
  primaryBtnText: {
    color: COLORS.white,
    fontWeight: '800',
    fontSize: 16,
  },
});