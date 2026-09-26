import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Alert } from '../../../components/ui/alert';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { arrayRemove, arrayUnion, doc, getDoc, onSnapshot, setDoc, deleteField } from 'firebase/firestore';
import { auth, db } from '../../../config/firebase';
import { currencySymbol } from '../../../utils/appConfig';
import EmailReceiptButton from '../../../components/EmailReceiptButton';
import {
  COLORS, TYPE, SPACE, RADIUS, Screen, ScreenHeader, Card, Button, Avatar, StatusPill, StatRow,
  RouteLine,
} from '../../../components/ui/kit';

export default function RiderTripDetailsScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { trip } = route.params;

  const [driver, setDriver] = useState(null);
  const [loadingDriver, setLoadingDriver] = useState(true);
  const [blockedDrivers, setBlockedDrivers] = useState([]);
  const riderId = auth.currentUser?.uid;

  // Drivers this passenger asked not to be matched with.
  useEffect(() => {
    if (!riderId) return undefined;
    return onSnapshot(doc(db, 'riders', riderId), (snap) => {
      const list = snap.exists() ? snap.data().blockedDrivers : null;
      setBlockedDrivers(Array.isArray(list) ? list : []);
    });
  }, [riderId]);

  const isBlocked = trip.driverId ? blockedDrivers.includes(trip.driverId) : false;

  const toggleBlockDriver = () => {
    if (!riderId || !trip.driverId) return;
    const name = driver?.fullName || driver?.firstName || 'this driver';
    if (isBlocked) {
      setDoc(
        doc(db, 'riders', riderId),
        { blockedDrivers: arrayRemove(trip.driverId), blockedDriverInfo: { [trip.driverId]: deleteField() } },
        { merge: true }
      ).catch(() => Alert.alert('Not saved', 'Please try again.'));
      return;
    }
    Alert.alert(
      "Don't match me with this driver?",
      `You won't be offered ${name} on future trips. You can undo this from Profile, Safety.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: "Don't match again",
          style: 'destructive',
          onPress: () =>
            setDoc(
              doc(db, 'riders', riderId),
              {
                blockedDrivers: arrayUnion(trip.driverId),
                blockedDriverInfo: {
                  [trip.driverId]: {
                    name: driver?.fullName || driver?.firstName || 'Driver',
                    registration: driver?.registrationNumber || '',
                    at: new Date().toISOString(),
                  },
                },
              },
              { merge: true }
            ).catch(() => Alert.alert('Not saved', 'Please try again.')),
        },
      ]
    );
  };

  // Opens the fare screen with the same pickup and drop-off.
  const bookAgain = () => {
    const p = trip.pickupLocation;
    const d = trip.dropoffLocation;
    if (!p?.latitude || !d?.latitude) {
      Alert.alert('Book again', 'This trip has no saved locations.');
      return;
    }
    navigation.navigate('Home', {
      screen: 'FareEstimation',
      params: {
        origin: { latitude: p.latitude, longitude: p.longitude, address: p.address },
        destination: { latitude: d.latitude, longitude: d.longitude, address: d.address, description: d.address },
      },
    });
  };

  // Fetch real driver data from Firestore
  useEffect(() => {
    const fetchDriver = async () => {
      if (!trip.driverId) {
        setLoadingDriver(false);
        return;
      }

      try {
        const driverDoc = await getDoc(doc(db, 'drivers', trip.driverId));
        if (driverDoc.exists()) {
          const driverData = driverDoc.data();
          setDriver({
            name: driverData.name || driverData.fullName || 'Driver',
            image: driverData.profileImage || driverData.selfieUrl,
            rating: driverData.rating || driverData.averageRating || null,
            vehicle: driverData
              ? `${driverData.makeModel || ''} ${driverData.registrationNumber || ''} `.trim()
              : 'Vehicle',
            phone: driverData.phone || '',
          });
        }
      } catch (error) {
        console.error('Error fetching driver:', error);
      } finally {
        setLoadingDriver(false);
      }
    };

    fetchDriver();
  }, [trip.driverId]);

  // ✅ Use route.status (same as the card), not trip.status
  const status = trip.route?.status?.toUpperCase() || 'PENDING';
  const isCompleted = status === 'COMPLETED';
  const isCancelled = status === 'CANCELLED';
  // The pill's colour: green for done, red for cancelled, amber otherwise.
  const pillStatus = isCompleted ? 'approved' : isCancelled ? 'rejected' : 'pending';

  // ✅ Fare is an object — extract the total
  const fareTotal = trip.fare?.total ?? 0;
  const currency = currencySymbol(trip.fare?.currency);

  // ✅ Pickup & dropoff from nested location objects
  const pickup = trip.pickupLocation || {};
  const dropoff = trip.dropoffLocation || {};
  const hasRouteCoords =
    typeof pickup.latitude === 'number' &&
    typeof pickup.longitude === 'number' &&
    typeof dropoff.latitude === 'number' &&
    typeof dropoff.longitude === 'number';

  // ✅ Route stats from nested route object
  const routeInfo = trip.route || {};
  const distanceMiles = routeInfo.distanceMiles ?? (routeInfo.distanceKm ? routeInfo.distanceKm * 0.621371 : 0);
  const durationMinutes = routeInfo.durationMinutes ?? 0;

  // ✅ Format timestamps
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

  const fareRows = [
    ['Base Fare', trip.fare?.baseFare?.toFixed(2) || '0.00'],
    ['Distance Fare', trip.fare?.distanceFare?.toFixed(2) || '0.00'],
    ['Time Fare', trip.fare?.timeFare?.toFixed(2) || '0.00'],
    trip.fare?.vat > 0 ? ['VAT', trip.fare?.vat?.toFixed(2)] : null,
  ].filter(Boolean);

  return (
    <Screen>
      <ScreenHeader title="Trip Details" subtitle={formatDateTime(trip.timestamps?.createdAt)} />

      <View style={styles.statusRow}>
        <StatusPill status={pillStatus} label={status} dot />
      </View>

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
            pinColor={COLORS.primary}
          />

          <Marker
            coordinate={{
              latitude: dropoff.latitude,
              longitude: dropoff.longitude,
            }}
            pinColor={COLORS.red}
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
            strokeColor={COLORS.midnight}
            strokeWidth={3}
          />
        </MapView>
      </View>
      ) : null}

      {/* Journey */}
      <Card style={{ marginTop: SPACE[4] }}>
        <RouteLine
          pickup={pickup.address || 'Unknown pickup'}
          dropoff={dropoff.address || 'Unknown destination'}
        />
      </Card>

      {/* Driver Card — with real data */}
      <Card style={styles.driverCard}>
        {loadingDriver ? (
          <ActivityIndicator size="small" color={COLORS.midnight} />
        ) : (
          <>
            <Avatar uri={driver?.image} name={driver?.name} size={52} />

            <View style={{ marginLeft: SPACE[3], flex: 1 }}>
              <Text style={styles.driverName}>{driver?.name || 'Driver'}</Text>
              <Text style={[TYPE.small, { marginTop: 2 }]}>{driver?.vehicle || 'Vehicle'}</Text>
            </View>

            <View style={styles.driverRating}>
              <Ionicons name="star" size={16} color={COLORS.star} />
              <Text style={styles.ratingText}>{driver?.rating || 'New'}</Text>
            </View>
          </>
        )}
      </Card>

      {/* Duration & Distance */}
      <Card style={{ marginTop: SPACE[3] }}>
        <StatRow
          items={[
            { value: durationMinutes ? `${Math.ceil(durationMinutes)} min` : 'N/A', label: 'Duration' },
            { value: distanceMiles ? `${distanceMiles.toFixed(1)} mi` : 'N/A', label: 'Distance' },
          ]}
        />
      </Card>

      {/* Payment Summary */}
      <Card style={{ marginTop: SPACE[3] }}>
        <Text style={[TYPE.label, { marginBottom: SPACE[2] }]}>Payment Summary</Text>

        {fareRows.map(([label, value]) => (
          <View key={label} style={styles.paymentRow}>
            <Text style={TYPE.small}>{label}</Text>
            <Text style={TYPE.callout}>{currency}{value}</Text>
          </View>
        ))}

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total Paid</Text>
          <Text style={styles.totalValue}>
            {currency}{fareTotal.toFixed(2)}
          </Text>
        </View>
      </Card>

      {/* Buttons */}
      <View style={styles.actions}>
        {isCompleted ? (
          <EmailReceiptButton rideId={trip.id} />
        ) : null}

        <Button title="Book this trip again" icon="refresh" onPress={bookAgain} />

        {trip.driverId ? (
          <Button
            title={isBlocked ? 'Allow this driver again' : "Don't match me with this driver"}
            icon={isBlocked ? 'person-add-outline' : 'person-remove-outline'}
            variant="secondary"
            onPress={toggleBlockDriver}
          />
        ) : null}

        <Button
          title="Report an Issue"
          icon="warning-outline"
          variant="danger"
          onPress={() => navigation.navigate('ReportIssueScreen', {
            trip: trip,
            reporterType: 'rider'
          })}
        />
      </View>
    </Screen>
  );
}


const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: SPACE[3] },

  mapContainer: {
    height: 180,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    marginTop: SPACE[4],
  },
  map: { flex: 1 },

  driverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SPACE[3],
    minHeight: 87,
  },
  driverName: { ...TYPE.subhead, fontSize: 17, color: COLORS.midnight },
  driverRating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingText: { ...TYPE.callout, color: COLORS.inkSoft },

  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACE[2],
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: SPACE[2],
    paddingTop: SPACE[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.line,
  },
  totalLabel: { ...TYPE.subhead, color: COLORS.midnight },
  totalValue: { ...TYPE.figure, fontSize: 20 },

  actions: { marginTop: SPACE[6], gap: SPACE[3], paddingBottom: SPACE[4] },
});
