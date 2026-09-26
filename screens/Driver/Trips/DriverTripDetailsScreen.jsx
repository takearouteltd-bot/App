import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { currencySymbol } from '../../../utils/appConfig';
import {
  COLORS, TYPE, SPACE, RADIUS,
  Screen, ScreenHeader, Card, Section, Avatar, Button, RouteLine, StatRow, StatusPill, Skeleton,
} from '../../../components/ui/kit';

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

  const statusLabel = status.charAt(0) + status.slice(1).toLowerCase();
  const pillStatus = isCompleted ? 'resolved' : isCancelled ? 'rejected' : 'pending';

  const fareLines = [
    ['Base Fare', trip.fare?.baseFare],
    ['Distance Fare', trip.fare?.distanceFare],
    ['Time Fare', trip.fare?.timeFare],
    trip.fare?.vat > 0 ? ['VAT', trip.fare?.vat] : null,
  ].filter(Boolean);

  return (
    <Screen>
      <ScreenHeader title="Trip Details" subtitle={formatDateTime(trip.timestamps?.createdAt)} />

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
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View style={styles.pickupPin} />
            </Marker>

            <Marker
              coordinate={{
                latitude: dropoff.latitude,
                longitude: dropoff.longitude,
              }}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View style={styles.dropoffPin} />
            </Marker>

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
              strokeColor={COLORS.midnight}
              strokeWidth={3}
            />
          </MapView>
        </View>
      ) : null}

      <Card style={styles.card}>
        <View style={styles.statusRow}>
          <StatusPill status={pillStatus} label={statusLabel} dot />
          <Text style={TYPE.figure}>
            {currency}{fareTotal.toFixed(2)}
          </Text>
        </View>
        <RouteLine
          pickup={pickup.address || 'Unknown pickup'}
          dropoff={dropoff.address || 'Unknown destination'}
        />
        <StatRow
          style={styles.stats}
          items={[
            { value: durationMinutes ? `${Math.ceil(durationMinutes)} min` : 'N/A', label: 'Duration' },
            { value: distanceMiles ? `${distanceMiles.toFixed(1)} mi` : 'N/A', label: 'Distance' },
            { value: paymentMethod === 'cash' ? 'Cash' : 'Card', label: 'Paid by' },
          ]}
        />
      </Card>

      <Section title="Passenger">
        {loadingRider ? (
          <Skeleton lines={2} />
        ) : (
          <Card>
            <View style={styles.riderRow}>
              <Avatar uri={rider?.image} name={rider?.name} size={52} />
              <View style={{ flex: 1 }}>
                <Text style={TYPE.subhead}>{rider?.name || 'Rider'}</Text>
                <Text style={TYPE.small}>Passenger</Text>
              </View>
              <View style={styles.rating}>
                <Ionicons name="star" size={14} color={COLORS.star} />
                <Text style={styles.ratingText}>{rider?.rating || 'New'}</Text>
              </View>
            </View>
          </Card>
        )}
      </Section>

      <Section title="Payment Summary">
        <Card>
          {fareLines.map(([label, value]) => (
            <View key={label} style={styles.paymentRow}>
              <Text style={[TYPE.body, { color: COLORS.inkSoft }]}>{label}</Text>
              <Text style={TYPE.callout}>
                {currency}{value?.toFixed(2) || '0.00'}
              </Text>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total Paid</Text>
            <Text style={styles.totalLabel}>
              {currency}{fareTotal.toFixed(2)}
            </Text>
          </View>
        </Card>
      </Section>

      <Button
        title="Report an Issue"
        icon="warning-outline"
        variant="danger"
        style={{ marginTop: SPACE[7] }}
        onPress={() => navigation.navigate('ReportIssueScreen', {
          trip: trip,
          reporterType: 'driver'
        })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  mapContainer: {
    height: 200,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    marginTop: SPACE[4],
  },
  map: { ...StyleSheet.absoluteFillObject },
  pickupPin: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: COLORS.lime, borderWidth: 3, borderColor: COLORS.midnight,
  },
  dropoffPin: {
    width: 16, height: 16, borderRadius: 4,
    backgroundColor: COLORS.midnight, borderWidth: 3, borderColor: COLORS.white,
  },
  card: { marginTop: SPACE[4] },
  statusRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: SPACE[4],
  },
  stats: {
    marginTop: SPACE[5], paddingTop: SPACE[4],
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
  },
  riderRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE[3] },
  rating: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.fill, paddingHorizontal: SPACE[3], paddingVertical: 6,
    borderRadius: RADIUS.pill,
  },
  ratingText: { fontSize: 13, fontWeight: '700', color: COLORS.ink },
  paymentRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: SPACE[2],
  },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: SPACE[2], paddingTop: SPACE[3],
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
  },
  totalLabel: { ...TYPE.subhead, fontSize: 17, fontWeight: '800', color: COLORS.midnight },
});
