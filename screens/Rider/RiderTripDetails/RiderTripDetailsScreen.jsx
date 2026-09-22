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
  Alert,
} from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { arrayRemove, arrayUnion, doc, getDoc, onSnapshot, setDoc, deleteField } from 'firebase/firestore';
import { auth, db } from '../../../config/firebase';
import { currencySymbol } from '../../../utils/appConfig';
import EmailReceiptButton from '../../../components/EmailReceiptButton';
import { COLORS, Avatar, RADIUS } from '../../../components/ui/kit';

const PRIMARY = COLORS.green;
const SECONDARY = COLORS.blue;
const DANGER = COLORS.red;

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

  // ✅ Payment info from nested payment object
  const payment = trip.payment || {};
  const paymentMethod = payment.method || 'card';
  // Written onto the ride by chargeOnRideCompletion from the card Stripe
  // actually charged. Older trips predate it, so they just say "Card" rather
  // than inventing digits.
  const cardLabel = trip.cardLast4
    ? `${(trip.cardBrand || 'Card').replace(/^./, (c) => c.toUpperCase())} ···· ${trip.cardLast4}`
    : 'Card';

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

        {/* Driver Card — with real data */}
        <View style={styles.driverCard}>
          {loadingDriver ? (
            <ActivityIndicator size="small" color={PRIMARY} />
          ) : (
            <>
              <Avatar uri={driver?.image} name={driver?.name} size={52} />

              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={styles.driverName}>{driver?.name || 'Driver'}</Text>
                <Text style={styles.driverSubtext}>{driver?.vehicle || 'Vehicle'}</Text>
              </View>

              <View style={styles.driverRating}>
                <Ionicons name="star" size={16} color={COLORS.star} />
                <Text style={styles.ratingText}>{driver?.rating || 'New'}</Text>
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

        {/* Payment Method */}
        {/* <View style={styles.paymentMethodCard}>
          <Ionicons 
            name={paymentMethod === 'card' ? 'card-outline' : 'cash-outline'} 
            size={24} 
            color={SECONDARY} 
          />
          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text style={styles.paymentMethodLabel}>Payment Method</Text>
            <Text style={styles.paymentMethodValue}>
              {paymentMethod === 'card' ? cardLabel : 'Cash'}
            </Text>
          </View>
          <Text style={[
            styles.paymentStatus,
            { color: payment.status === 'paid' ? PRIMARY : DANGER }
          ]}>
            {payment.status?.toUpperCase() || 'PENDING'}
          </Text>
        </View> */}

        {/* Buttons */}
        {isCompleted ? (
          <EmailReceiptButton rideId={trip.id} style={{ marginBottom: 12, borderRadius: 30, minHeight: 50 }} />
        ) : null}

        <TouchableOpacity onPress={bookAgain} style={styles.secondaryBtn}>
          <Ionicons name="refresh" size={20} color={COLORS.white} />
          <Text style={styles.primaryBtnText}>Book this trip again</Text>
        </TouchableOpacity>

        {trip.driverId ? (
          <TouchableOpacity onPress={toggleBlockDriver} style={styles.outlineBtn}>
            <Ionicons name={isBlocked ? 'person-add-outline' : 'person-remove-outline'} size={20} color={SECONDARY} />
            <Text style={[styles.primaryBtnText, { color: SECONDARY }]}>
              {isBlocked ? 'Allow this driver again' : "Don't match me with this driver"}
            </Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity 
        onPress={() => navigation.navigate('ReportIssueScreen', { 
            trip: trip,
            reporterType: 'rider'
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
    color: COLORS.ink,
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

  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },

  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },

  statusText: {
    fontSize: 12,
    fontWeight: '800',
  },

  dateText: {
    fontSize: 14,
    color: COLORS.muted,
    fontWeight: '500',
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
    color: COLORS.muted,
  },

  locationValue: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.ink,
    marginTop: 2,
  },

  divider: {
    height: 1,
    backgroundColor: COLORS.line,
    marginVertical: 20,
  },

  driverCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    borderRadius: 18,
    padding: 16,
    marginBottom: 20,
    alignItems: 'center',
    elevation: 3,
    minHeight: 87,
  },

  driverImage: {
    width: 55,
    height: 55,
    borderRadius: 28,
  },

  driverName: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.ink,
  },

  driverSubtext: {
    fontSize: 13,
    color: COLORS.muted,
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
    backgroundColor: COLORS.white,
    borderRadius: 18,
    padding: 18,
    alignItems: 'center',
    elevation: 3,
  },

  statLabel: {
    fontSize: 12,
    color: COLORS.muted,
  },

  statValue: {
    fontSize: 22,
    fontWeight: '800',
    marginTop: 4,
    color: COLORS.ink,
  },

  paymentCard: {
    backgroundColor: COLORS.white,
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
    color: COLORS.muted,
  },

  paymentValue: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.ink,
  },

  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
  },

  totalLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.ink,
  },

  totalValue: {
    fontSize: 22,
    fontWeight: '800',
    color: PRIMARY,
  },

  paymentMethodCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    borderRadius: 18,
    padding: 18,
    marginBottom: 20,
    alignItems: 'center',
    elevation: 3,
  },

  paymentMethodLabel: {
    fontSize: 12,
    color: COLORS.muted,
  },

  paymentMethodValue: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.ink,
    marginTop: 2,
  },

  paymentStatus: {
    fontSize: 14,
    fontWeight: '700',
  },

  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SECONDARY,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    marginBottom: 12,
  },

  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PRIMARY,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    marginBottom: 12,
  },

  outlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: '#D5DCE6',
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    marginBottom: 12,
  },

  dangerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DANGER,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    marginBottom: 40,
  },

  primaryBtnText: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: 16,
    marginLeft: 8,
  },
});