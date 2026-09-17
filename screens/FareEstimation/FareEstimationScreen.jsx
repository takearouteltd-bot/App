import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  FlatList,
  Dimensions,
  Alert,
  ActivityIndicator,
  Animated,
  ScrollView,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import MapViewDirections from 'react-native-maps-directions';
import { useNavigation } from '@react-navigation/native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { db } from '../../config/firebase';
import { addDoc, collection, serverTimestamp, doc, updateDoc, getDoc, onSnapshot, getDocs } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useAppConfig } from '../../utils/appConfig';

const { width, height } = Dimensions.get('window');
const PRIMARY = '#79B531';
const SECONDARY = '#235594';
const DANGER = '#D32F2F';
const BG = '#F8F9FA';

export default function FareEstimationScreen({ route }) {
  const navigation = useNavigation();
  const { origin, destination } = route.params;
  const mapRef = useRef(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  const auth = getAuth();
  const currentUser = auth.currentUser;

  const appConfig = useAppConfig();
  const [distance, setDistance] = useState(0);
  const [duration, setDuration] = useState(0);
  const [selectedRide, setSelectedRide] = useState('RouteMini');
  const [loading, setLoading] = useState(false);
  const [routeReady, setRouteReady] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [promoApplied, setPromoApplied] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [savedPlaces, setSavedPlaces] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [routeCalculated, setRouteCalculated] = useState(false);

  const GOOGLE_MAPS_API_KEY = 'AIzaSyBtmcvJE-m_v44Z2lLDm8wDgI6GGYLXimQ'; // replace with your key


  const [savedCards, setSavedCards] = useState([]);
const [defaultCard, setDefaultCard] = useState(null);

// Add to your existing useEffect or create a new one
useEffect(() => {
  if (!currentUser) return;

  const cardsRef = collection(db, 'riders', currentUser.uid, 'cards');
  
  const unsubscribe = onSnapshot(cardsRef, (snapshot) => {
    const cards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    setSavedCards(cards);
    
    // Find default card, or use first card as fallback
    const defaultCard = cards.find(c => c.isDefault) || cards[0] || null;
    setDefaultCard(defaultCard);
  });

  return unsubscribe;
}, [currentUser]);

  useEffect(() => {
  const checkPaymentMethod = async () => {
    if (!currentUser) return;
    
    const cardsRef = collection(db, 'riders', currentUser.uid, 'cards');
    const cardsSnap = await getDocs(cardsRef);
    
    if (cardsSnap.empty) {
      Alert.alert(
        "Payment Required",
        "Please add a payment method to continue.",
        [
          { 
            text: "Add Card", 
            onPress: () => navigation.replace('AddPayment') 
          }
        ]
      );
    }
  };
  
  checkPaymentMethod();
}, [currentUser]);
  
  // Fetch saved places for quick destination swap
  React.useEffect(() => {
    if (!currentUser) return;
    const placesRef = collection(db, 'riders', currentUser.uid, 'savedPlaces');
    const unsubscribe = onSnapshot(
      placesRef,
      (snapshot) => {
        const places = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setSavedPlaces(places);
      },
      (error) => { if (error.code !== 'permission-denied') console.error(error); }
    );
    return unsubscribe;
  }, [currentUser]);

  const rideOptions = [
    { 
      id: 'RouteMini', 
      label: 'RouteMini', 
      multiplier: 1.0,
      icon: 'car',
      description: 'Affordable everyday rides',
      passengers: 4,
      eta: '3 min',
    },
    { 
      id: 'RoutePlus', 
      label: 'RoutePlus', 
      multiplier: 1.2,
      icon: 'car',
      description: 'Comfortable sedans',
      passengers: 4,
      eta: '5 min',
    },
    { 
      id: 'RouteXL', 
      label: 'RouteXL', 
      multiplier: 1.5,
      icon: 'car-estate',
      description: 'Spacious SUVs for groups',
      passengers: 6,
      eta: '7 min',
    },
    { 
      id: 'RouteEco', 
      label: 'RouteEco', 
      multiplier: 0.9,
      icon: 'leaf',
      description: 'Eco-friendly hybrid rides',
      passengers: 4,
      eta: '4 min',
    },
    { 
      id: 'RouteExecutive', 
      label: 'Executive', 
      multiplier: 2.0,
      icon: 'car-wash',
      description: 'Premium luxury experience',
      passengers: 4,
      eta: '8 min',
    },
  ];

  const calculateFareDetails = useCallback((multiplier = 1) => {
    // Rates come from the admin dashboard (config/app), with the original
    // values as fallback.
    const baseFare = appConfig.fares.baseFare;
    const ratePerMile = appConfig.fares.ratePerMile;
    const ratePerMin = appConfig.fares.ratePerMinute;
    const minFare = appConfig.fares.minimumFare;
    const surge = 1;
    const vatRate = appConfig.fares.vatPercent / 100;

    const distanceInMiles = distance * 0.621371;

    const distanceFare = distanceInMiles * ratePerMile;
    const timeFare = duration * ratePerMin;

    const subtotal = (baseFare + distanceFare + timeFare) * multiplier * surge;
    const fareBeforeVAT = Math.max(subtotal, minFare);
    
    // Apply promo discount
    const discountedFare = promoApplied ? fareBeforeVAT * (1 - discount) : fareBeforeVAT;
    
    const vatAmount = discountedFare * vatRate;
    const total = discountedFare + vatAmount;

    return {
      currency: 'GBP',
      baseFare: Number(baseFare.toFixed(2)),
      distanceFare: Number(distanceFare.toFixed(2)),
      timeFare: Number(timeFare.toFixed(2)),
      surgeMultiplier: surge,
      rideMultiplier: multiplier,
      vat: Number(vatAmount.toFixed(2)),
      total: Number(total.toFixed(2)),
      distanceInMiles: Number(distanceInMiles.toFixed(2)),
      subtotal: Number(discountedFare.toFixed(2)),
    };
  }, [distance, duration, promoApplied, discount, appConfig]);

  const handleConfirmRide = async () => {
    if (!currentUser) {
      Alert.alert("Error", "Please sign in to book a ride");
      return;
    }

    // ✅ Check if user has a saved card
  try {
    const cardsRef = collection(db, 'riders', currentUser.uid, 'cards');
    const cardsSnap = await getDocs(cardsRef);
    
    if (cardsSnap.empty) {
      Alert.alert(
        "Payment Required",
        "You need to add a payment method before booking a ride.",
        [
          { text: "Cancel", style: "cancel" },
          { 
            text: "Add Card", 
            onPress: () => navigation.navigate('AddPaymentMethod') 
          }
        ]
      );
      return;
    }
  } catch (err) {
    console.error("Error checking cards:", err);
  }

    setLoading(true);

    try {
      const selectedOption = rideOptions.find(r => r.id === selectedRide);
      const fareDetails = calculateFareDetails(selectedOption.multiplier);

      const rideData = {
        riderId: currentUser.uid,
        driverId: null,
        status: "searching",
        rideType: selectedRide,

        pickupLocation: {
          latitude: origin.latitude,
          longitude: origin.longitude,
          address: origin.address || "Pickup location",
        },

        dropoffLocation: {
          latitude: destination.latitude,
          longitude: destination.longitude,
          address: destination.description || destination.address || "Dropoff location",
        },

        route: {
          distanceKm: Number(distance.toFixed(2)),
          distanceMiles: fareDetails.distanceInMiles,
          durationMinutes: Number(duration.toFixed(2)),
          status: 'calculated',
        },

        fare: {
          ...fareDetails,
          promoCode: promoApplied ? promoCode : null,
          discount: promoApplied ? discount : 0,
        },
        
        fareEstimate: fareDetails.total,

        payment: {
          method: paymentMethod,
          status: "pending",
          transactionId: null,
        },

        timestamps: {
          createdAt: serverTimestamp(),
          acceptedAt: null,
          startedAt: null,
          completedAt: null,
        },

        cancellation: {
          by: null,
          reason: null,
          at: null,
        },

        rating: {
          riderToDriver: null,
          driverToRider: null,
          feedback: null,
        },

        expiresAt: new Date(Date.now() + 60 * 1000),
      };

      const rideRef = await addDoc(collection(db, 'rides'), rideData);

      await updateDoc(doc(db, 'riders', currentUser.uid), {
        currentRideId: rideRef.id
      });

      // Save to recent searches
      const recentRef = collection(db, 'riders', currentUser.uid, 'recentSearches');
      await addDoc(recentRef, {
        description: destination.description || destination.address,
        address: destination.address || destination.description,
        latitude: destination.latitude,
        longitude: destination.longitude,
        placeId: destination.placeId || null,
        searchedAt: serverTimestamp(),
      });

      setLoading(false);
      navigation.navigate('RideRequest', { rideId: rideRef.id });

    } catch (err) {
      console.error(err);
      setLoading(false);
      Alert.alert("Error", "Failed to request ride. Please try again.");
    }
  };

  const selectedOption = rideOptions.find(r => r.id === selectedRide);
  const fare = calculateFareDetails(selectedOption.multiplier);

  // Header animation
  const headerOpacity = scrollY.interpolate({
    inputRange: [0, 100],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  return (
    <SafeAreaView style={styles.container}>

      {/* Animated Header */}
      <Animated.View style={[styles.animatedHeader, { opacity: headerOpacity }]}>
        <Text style={styles.animatedHeaderText}>Choose Your Ride</Text>
      </Animated.View>

      {/* MAP */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={{
            latitude: (origin.latitude + destination.latitude) / 2,
            longitude: (origin.longitude + destination.longitude) / 2,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          }}
        >
          <Marker coordinate={origin}>
            <View style={styles.originMarker}>
              <View style={styles.originDot} />
              <View style={styles.originRing} />
            </View>
          </Marker>
          
          <Marker coordinate={destination}>
            <View style={styles.destMarker}>
              <Ionicons name="location" size={28} color={SECONDARY} />
            </View>
          </Marker>

            <MapViewDirections
              origin={origin}
              destination={destination}
              apikey={GOOGLE_MAPS_API_KEY}
              strokeWidth={5}
              strokeColor={PRIMARY}
              onReady={result => {
                  setDistance(result.distance);
                  setDuration(result.duration);
                  setRouteCalculated(true);   // use this for UI state
                  setRouteReady(true);        // keep if needed for button enable

                 
                }}
              
            />
       
        </MapView>

        {/* Top Bar */}
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.iconButton} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color={DARK} />
          </TouchableOpacity>
          
          <View style={styles.routeInfoPill}>
            <Ionicons name="time-outline" size={14} color={PRIMARY} />
            <Text style={styles.routeInfoText}>{Math.ceil(duration)} min</Text>
            <View style={styles.dotSeparator} />
            <Ionicons name="navigate-outline" size={14} color={SECONDARY} />
            <Text style={styles.routeInfoText}>{fare.distanceInMiles} mi</Text>
          </View>

          <TouchableOpacity style={styles.iconButton}>
            <Ionicons name="share-outline" size={22} color={DARK} />
          </TouchableOpacity>
        </View>
      </View>

      {/* BOTTOM SHEET */}
      <Animated.View style={styles.bottomSheet}>
        <View style={styles.sheetHandle} />

        {/* Route Summary */}
        <View style={styles.routeSummary}>
          <View style={styles.routePoint}>
            <View style={[styles.routeDot, { backgroundColor: PRIMARY }]} />
            <Text style={styles.routeAddress} numberOfLines={1}>{origin.address}</Text>
          </View>
          <View style={styles.routeLine} />
          <View style={styles.routePoint}>
            <View style={[styles.routeDot, { backgroundColor: SECONDARY }]} />
            <Text style={styles.routeAddress} numberOfLines={1}>{destination.description || destination.address}</Text>
          </View>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
        >
          {/* Ride Selection */}
          <Text style={styles.sectionTitle}>Select Ride Type</Text>
          
          <FlatList
            data={rideOptions}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.rideList}
            renderItem={({ item }) => {
              const itemFare = calculateFareDetails(item.multiplier);
              const isSelected = item.id === selectedRide;

              return (
                <TouchableOpacity
                  style={[
                    styles.rideCard,
                    isSelected && styles.rideCardSelected,
                  ]}
                  onPress={() => setSelectedRide(item.id)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.rideIconContainer, isSelected && { backgroundColor: 'rgba(121,180,49,0.15)' }]}>
                    <MaterialCommunityIcons name={item.icon} size={28} color={isSelected ? PRIMARY : '#888'} />
                  </View>
                  
                  <Text style={[styles.rideLabel, isSelected && { color: PRIMARY }]}>{item.label}</Text>
                  <Text style={styles.rideDescription}>{item.description}</Text>
                  
                  <View style={styles.rideMeta}>
                    <Ionicons name="person-outline" size={12} color="#999" />
                    <Text style={styles.rideMetaText}>{item.passengers}</Text>
                    <View style={styles.dotSeparator} />
                    <Text style={styles.rideEta}>{item.eta}</Text>
                  </View>

                  <View style={styles.ridePriceRow}>
                    <Text style={[styles.rideFare, isSelected && { color: PRIMARY }]}>£{itemFare.total}</Text>
                    {isSelected && <Ionicons name="checkmark-circle" size={20} color={PRIMARY} />}
                  </View>
                </TouchableOpacity>
              );
            }}
          />

          {/* Payment Method */}

         <View style={styles.paymentSection}>
            <Text style={styles.sectionTitle}>Payment</Text>
            
            <TouchableOpacity 
              style={styles.paymentRow}
              onPress={() => navigation.navigate('PaymentsMethod')}
            >
              <View style={styles.paymentIcon}>
                <Ionicons name="card-outline" size={20} color={SECONDARY} />
              </View>
              
              <View style={styles.paymentText}>
                {defaultCard ? (
                  <>
                    <Text style={styles.paymentLabel}>
                      {defaultCard.brand?.toUpperCase() || 'Card'} •••• {defaultCard.last4}
                    </Text>
                    <Text style={styles.paymentSub}>
                      Expires {defaultCard.exp_month}/{defaultCard.exp_year}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.paymentLabel}>No payment method</Text>
                    <Text style={styles.paymentSub}>Tap to add a card</Text>
                  </>
                )}
              </View>
              
              <Ionicons name="chevron-forward" size={18} color="#ccc" />
            </TouchableOpacity>
          </View>

          {/* Fare Breakdown */}
          <View style={styles.breakdownCard}>
            <Text style={styles.sectionTitle}>Fare Breakdown</Text>
            
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Base fare</Text>
              <Text style={styles.breakdownValue}>£{fare.baseFare}</Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Distance ({fare.distanceInMiles} mi)</Text>
              <Text style={styles.breakdownValue}>£{fare.distanceFare}</Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Time ({Math.ceil(duration)} min)</Text>
              <Text style={styles.breakdownValue}>£{fare.timeFare}</Text>
            </View>
            
            {promoApplied && (
              <View style={styles.breakdownRow}>
                <Text style={[styles.breakdownLabel, { color: PRIMARY }]}>Promo discount ({discount * 100}%)</Text>
                <Text style={[styles.breakdownValue, { color: PRIMARY }]}>-£{(fare.subtotal * discount / (1 - discount)).toFixed(2)}</Text>
              </View>
            )}

            <View style={styles.breakdownDivider} />
            
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Subtotal</Text>
              <Text style={styles.breakdownValue}>£{fare.subtotal}</Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>VAT (20%)</Text>
              <Text style={styles.breakdownValue}>£{fare.vat}</Text>
            </View>

            <View style={styles.breakdownDivider} />
            
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>£{fare.total}</Text>
            </View>
          </View>


          {/* Safety Note */}
          <View style={styles.safetyNote}>
            <Ionicons name="shield-checkmark-outline" size={16} color={SECONDARY} />
            <Text style={styles.safetyText}>Your ride is insured and tracked in real-time</Text>
          </View>
        </ScrollView>

        {/* Confirm Button */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.confirmButton, loading && styles.confirmButtonDisabled]}
            onPress={handleConfirmRide}
            disabled={loading || !routeCalculated}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Text style={styles.confirmText}>Confirm {selectedOption.label}</Text>
                <View style={styles.confirmPricePill}>
                  <Text style={styles.confirmPrice}>£{fare.total}</Text>
                </View>
              </>
            )}
          </TouchableOpacity>
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

const DARK = '#1a1a1a';

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#fff' 
  },

  // Animated Header
  animatedHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    backgroundColor: '#fff',
    paddingTop: 50,
    paddingBottom: 12,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  animatedHeaderText: {
    fontSize: 17,
    fontWeight: '700',
    color: DARK,
    textAlign: 'center',
  },

  // Map
  mapContainer: { 
    flex: 1 
  },
  map: { 
    width: '100%', 
    height: '100%' 
  },

  // Markers
  originMarker: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  originDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: PRIMARY,
    borderWidth: 3,
    borderColor: '#fff',
  },
  originRing: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: PRIMARY,
    opacity: 0.3,
  },
  destMarker: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },

  // Top Bar
  topBar: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  routeInfoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    gap: 6,
  },
  routeInfoText: {
    fontSize: 13,
    fontWeight: '600',
    color: DARK,
  },
  dotSeparator: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ccc',
    marginHorizontal: 4,
  },

  // Bottom Sheet
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: height * 0.65,
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 20,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ddd',
    marginBottom: 12,
  },

  // Route Summary
  routeSummary: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  routePoint: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  routeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
  },
  routeLine: {
    width: 2,
    height: 20,
    backgroundColor: '#ddd',
    marginLeft: 4,
  },
  routeAddress: {
    fontSize: 14,
    fontWeight: '500',
    color: DARK,
    flex: 1,
  },

  // Section
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: DARK,
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 12,
  },

  // Ride List
  rideList: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  rideCard: {
    width: width * 0.38,
    marginHorizontal: 4,
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#f0f0f0',
  },
  rideCardSelected: {
    borderColor: PRIMARY,
    backgroundColor: 'rgba(121,180,49,0.05)',
  },
  rideIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  rideLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: DARK,
    marginBottom: 4,
  },
  rideDescription: {
    fontSize: 11,
    color: '#888',
    marginBottom: 8,
  },
  rideMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  rideMetaText: {
    fontSize: 11,
    color: '#999',
    marginLeft: 4,
  },
  rideEta: {
    fontSize: 11,
    color: PRIMARY,
    fontWeight: '600',
  },
  ridePriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rideFare: {
    fontSize: 18,
    fontWeight: '700',
    color: DARK,
  },

  // Payment
  paymentSection: {
    marginTop: 8,
  },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    padding: 14,
    backgroundColor: BG,
    borderRadius: 14,
  },
  paymentIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#E3F2FD',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  paymentText: {
    flex: 1,
  },
  paymentLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: DARK,
  },
  paymentSub: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },

  // Breakdown
  breakdownCard: {
    marginHorizontal: 20,
    marginTop: 16,
    padding: 16,
    backgroundColor: BG,
    borderRadius: 16,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  breakdownLabel: {
    fontSize: 14,
    color: '#666',
  },
  breakdownValue: {
    fontSize: 14,
    fontWeight: '600',
    color: DARK,
  },
  breakdownDivider: {
    height: 1,
    backgroundColor: '#e0e0e0',
    marginVertical: 8,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 4,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: DARK,
  },
  totalValue: {
    fontSize: 22,
    fontWeight: '800',
    color: PRIMARY,
  },

  // Promo
  promoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 16,
    padding: 14,
    backgroundColor: '#F0F7E6',
    borderRadius: 14,
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: PRIMARY,
  },
  promoText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: PRIMARY,
    marginLeft: 10,
  },

  // Safety
  safetyNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 100,
    padding: 12,
    backgroundColor: '#EBF2FA',
    borderRadius: 12,
    gap: 8,
  },
  safetyText: {
    fontSize: 12,
    color: SECONDARY,
    fontWeight: '500',
  },

  // Button
  buttonContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingBottom: 30,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  confirmButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: PRIMARY,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 16,
  },
  confirmButtonDisabled: {
    backgroundColor: '#ccc',
  },
  confirmText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  confirmPricePill: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  confirmPrice: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});