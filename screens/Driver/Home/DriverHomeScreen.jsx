import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Dimensions,
  AppState,
  Easing,
} from 'react-native';
import { Alert } from '../../../components/ui/alert';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { getAuth } from 'firebase/auth';
import { useAppConfig, currencySymbol } from '../../../utils/appConfig';
import { expiryAlertsFor, describeExpiry } from '../../../constants/driverDocuments';
import { canServe, classLabel } from '../../../constants/vehicleClasses';
import { servesCity } from '../../../utils/cities';
import { biddingEnabled, counterSteps, offerSeconds, sendCounterOffer } from '../../../utils/bidding';
import { clearJobAlerts } from '../../../utils/notifications';
import {
  COLORS, TYPE, SPACE, RADIUS, SHADOW,
  Button, Chip, Banner, RouteLine, Loading, Sheet,
} from '../../../components/ui/kit';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Remembered between launches, so a driver who hides their earnings from
// passengers does not have to do it again every shift.
const HIDE_EARNINGS_KEY = 'driver.hideEarnings';

const { width } = Dimensions.get('window');

// "Online 2h 10m of 12h" while a shift limit applies.
function shiftLabel(startedMs, maxHours) {
  if (!startedMs) return null;
  const mins = Math.max(0, Math.floor((Date.now() - startedMs) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const online = h ? `${h}h ${m}m` : `${m}m`;
  return maxHours > 0 ? `Online ${online} of ${maxHours}h` : `Online ${online}`;
}

export default function DriverHomeScreen() {
  const mapRef = useRef(null);
  const slideAnim = useRef(new Animated.Value(width)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const navigation = useNavigation();

  const [location, setLocation] = useState(null);
  const appConfig = useAppConfig();
  const { dispatch: dispatchConfig, drivers: driverConfig } = appConfig;
  const maxShiftHours = driverConfig.maxShiftHours; // 0 means unlimited
  const searchRadiusKm = dispatchConfig.searchRadiusKm;

  const [shiftStartedAt, setShiftStartedAt] = useState(null);
  const [onRide, setOnRide] = useState(false);
  // Assume nothing until the driver record says otherwise, so the screen never
  // flashes "You are online" at someone who is not.
  const [isOnline, setIsOnline] = useState(false);
  const [isApproved, setIsApproved] = useState(false);
  // The class this driver's vehicle was approved as. Decides which jobs they
  // are shown; see constants/vehicleClasses.js.
  const [vehicleType, setVehicleType] = useState(null);
  const [membershipStatus, setMembershipStatus] = useState(null);
  const [workingCityId, setWorkingCityId] = useState(null);
  const [femaleVerified, setFemaleVerified] = useState(false);
  // What a passenger sees on this driver's counter-offers.
  const [driverCard, setDriverCard] = useState(null);
  // Counter-offers sent, by ride id, so the card can say it is waiting.
  const [sentOffers, setSentOffers] = useState({});
  const [sending, setSending] = useState(false);
  const takenOver = useRef(false);
  const [loading, setLoading] = useState(true);

  const [rideRequests, setRideRequests] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timer, setTimer] = useState(15);
  const [isAccepting, setIsAccepting] = useState(false);

  const [earningsToday, setEarningsToday] = useState(0);
  const [walletBalance, setWalletBalance] = useState(0);
  const [hideEarnings, setHideEarnings] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(HIDE_EARNINGS_KEY)
      .then((v) => setHideEarnings(v === '1'))
      .catch(() => {});
  }, []);

  const toggleHideEarnings = () => {
    setHideEarnings((hidden) => {
      AsyncStorage.setItem(HIDE_EARNINGS_KEY, hidden ? '0' : '1').catch(() => {});
      return !hidden;
    });
  };
  const [tripsToday, setTripsToday] = useState(0);
  const [documentAlerts, setDocumentAlerts] = useState([]);

  const auth = getAuth();
  const driverId = auth.currentUser?.uid;

  const [checkingRide, setCheckingRide] = useState(true);

  const updateDriverLocation = async (id, coords) => {
    try {
      await setDoc(
        doc(db, 'drivers', id),
        {
          location: { latitude: coords.latitude, longitude: coords.longitude },
          // Shown on the dashboard's Live drivers page. The phone reports speed
          // in m/s, or a negative number when it doesn't know.
          speedKph:
            typeof coords.speed === 'number' && coords.speed >= 0
              ? Math.round(coords.speed * 3.6)
              : null,
          heading:
            typeof coords.heading === 'number' && coords.heading >= 0
              ? Math.round(coords.heading)
              : null,
          lastUpdated: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      console.log('Location update error:', error);
    }
  };

  /* ================= DRIVER, WALLET, TODAY ================= */
  useEffect(() => {
    if (!driverId) return undefined;

    const driverRef = doc(db, 'drivers', driverId);
    const unsubDriver = onSnapshot(driverRef, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      setIsOnline(data.status === 'online');
      setIsApproved(data.approved === true);
      setOnRide(data.isOnRide === true);
      setVehicleType(data.vehicleType || null);
      setMembershipStatus(data.subscription?.status || null);
      setWorkingCityId(data.workingCityId || null);
      setFemaleVerified(data.femaleVerified === true);
      setDriverCard({
        name: data.firstName || (data.fullName || '').split(' ')[0] || 'Driver',
        rating: data.rating || null,
        ratingCount: data.ratingCount || 0,
        vehicle: [data.vehicleColor, data.makeModel].filter(Boolean).join(' ') || null,
        photoUrl: data.selfieUrl || null,
      });
      setDocumentAlerts(expiryAlertsFor(data));
      const started = data.shiftStartedAt?.toMillis?.() ?? null;
      setShiftStartedAt(started);
      // Online from before shift tracking existed: start the clock now.
      if (data.status === 'online' && !data.shiftStartedAt) {
        setDoc(driverRef, { shiftStartedAt: serverTimestamp() }, { merge: true }).catch(() => {});
      }
    });

    const unsubWallet = onSnapshot(doc(db, 'driverWallets', driverId), (snap) => {
      setWalletBalance(snap.exists() ? snap.data().availableBalance || 0 : 0);
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const unsubRides = onSnapshot(
      query(collection(db, 'rides'), where('driverId', '==', driverId)),
      (snapshot) => {
        let todayTotal = 0;
        let todayTrips = 0;

        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          if (data.route?.status !== 'completed' && data.status !== 'completed') return;

          const completedAt = data.completedAt;
          const completedDate = completedAt?.toDate
            ? completedAt.toDate()
            : completedAt
            ? new Date(completedAt)
            : null;
          if (!completedDate) return;

          const rideDate = new Date(completedDate);
          rideDate.setHours(0, 0, 0, 0);
          if (rideDate.getTime() === today.getTime()) {
            todayTotal += data.earnings?.driverEarning || data.fare?.total || 0;
            todayTrips += 1;
          }
        });

        setEarningsToday(todayTotal);
        setTripsToday(todayTrips);
      }
    );

    return () => {
      unsubDriver();
      unsubWallet();
      unsubRides();
    };
  }, [driverId]);

  /* ================= LOCATION ================= */
  useEffect(() => {
    let subscription;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLoading(false);
        return;
      }

      const loc = await Location.getCurrentPositionAsync({});
      setLocation(loc.coords);
      setLoading(false);
      if (driverId) await updateDriverLocation(driverId, loc.coords);

      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 4000 },
        async (newLoc) => {
          setLocation(newLoc.coords);
          if (driverId) await updateDriverLocation(driverId, newLoc.coords);
        }
      );
    })();

    return () => {
      if (subscription) subscription.remove();
    };
  }, [driverId]);

  /* ================= PUBLIC POSITION =================
     Passengers see nearby cars on their home map. They must never read the
     driver record itself (name, phone, documents), so an online driver also
     publishes a bare position to driverLocations/{uid}: coordinates, heading
     and whether they are free. It is taken down whenever they go offline or
     start a trip, whatever caused it, because it follows the same status the
     rest of this screen does. */
  const publishedFree = useRef(null);
  const isFree = isOnline && !onRide;
  useEffect(() => {
    if (!driverId) return;
    const ref = doc(db, 'driverLocations', driverId);

    if (isFree && location && Number.isFinite(location.latitude)) {
      publishedFree.current = true;
      setDoc(
        ref,
        {
          latitude: location.latitude,
          longitude: location.longitude,
          heading:
            typeof location.heading === 'number' && location.heading >= 0
              ? Math.round(location.heading)
              : null,
          vehicleType: vehicleType || null,
          online: true,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ).catch(() => {});
    } else if (publishedFree.current !== false) {
      // Only once per change to offline, not on every GPS tick.
      publishedFree.current = false;
      setDoc(ref, { online: false, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
    }
  }, [driverId, isFree, location, vehicleType]);

  /* ================= ONLINE / OFFLINE ================= */
  const toggleOnlineStatus = async () => {
    if (!driverId) return;
    const newStatus = !isOnline ? 'online' : 'offline';

    // An unpaid membership pauses the account (after a grace period).
    if (newStatus === 'online' && membershipStatus === 'suspended') {
      Alert.alert(
        'Your account is paused',
        'Your membership is unpaid. Pay it to go online again.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Pay now', onPress: () => navigation.navigate('Membership') },
        ]
      );
      return;
    }

    if (newStatus === 'online' && !isApproved) {
      Alert.alert(
        'Application under review',
        'You can go online as soon as your application has been approved.'
      );
      return;
    }

    try {
      // shiftStartedAt drives the maximum shift length set on the dashboard. It
      // is kept while the driver goes on and off trips, and cleared when they
      // go offline themselves.
      await setDoc(
        doc(db, 'drivers', driverId),
        newStatus === 'online'
          ? { status: newStatus, shiftStartedAt: serverTimestamp() }
          : { status: newStatus, shiftStartedAt: null },
        { merge: true }
      );
      setIsOnline(!isOnline);
    } catch (error) {
      console.log('Status update error:', error);
      Alert.alert('Could not update', 'Failed to change your status. Please try again.');
    }
  };

  /* ================= MAXIMUM SHIFT LENGTH =================
     Set on the dashboard (Settings, Drivers). When the limit is reached the
     driver is taken offline for safety. A driver on a trip finishes it first. */
  const shiftEndedRef = useRef(false);
  useEffect(() => {
    if (!driverId || !isOnline || !shiftStartedAt || !(maxShiftHours > 0)) return undefined;
    shiftEndedRef.current = false;

    const check = async () => {
      if (shiftEndedRef.current || onRide) return;
      if (Date.now() - shiftStartedAt < maxShiftHours * 60 * 60 * 1000) return;

      shiftEndedRef.current = true;
      try {
        await setDoc(
          doc(db, 'drivers', driverId),
          { status: 'offline', shiftStartedAt: null, lastShiftEndedAt: serverTimestamp() },
          { merge: true }
        );
        setIsOnline(false);
        Alert.alert(
          'Shift limit reached',
          `You have been online for ${maxShiftHours} hours, so you have been taken offline for your safety. Please take a break before driving again.`
        );
      } catch (error) {
        shiftEndedRef.current = false;
        console.log('Shift limit update error:', error);
      }
    };

    check();
    const id = setInterval(check, 60 * 1000);
    return () => clearInterval(id);
  }, [driverId, isOnline, shiftStartedAt, maxShiftHours, onRide]);

  /* ================= JOB OFFERS ================= */
  const animateCard = useCallback(() => {
    slideAnim.setValue(width);
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 380,
      useNativeDriver: true,
      easing: Easing.out(Easing.cubic),
    }).start();
  }, [slideAnim]);

  const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  };

  useEffect(() => {
    if (!isOnline || !location) return undefined;

    const q = query(collection(db, 'rides'), where('status', '==', 'searching'));

    return onSnapshot(q, (snapshot) => {
      const rides = [];

      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (!data.pickupLocation) return;
        // Jobs this driver already cancelled are not offered again.
        if (Array.isArray(data.declinedBy) && data.declinedBy.includes(driverId)) return;
        // Passengers who asked not to be matched with this driver.
        if (Array.isArray(data.blockedDriverIds) && data.blockedDriverIds.includes(driverId)) return;
        // Somebody who booked and paid for Executive does not get a Mini.
        if (!canServe(vehicleType, data.rideType)) return;
        // Chosen a working city? Then only that city's jobs.
        if (!servesCity(workingCityId, data.cityId)) return;
        // Passenger asked for a female driver: verified female drivers only.
        if (data.femaleDriverOnly === true && !femaleVerified) return;

        const distance = getDistanceFromLatLonInKm(
          location.latitude,
          location.longitude,
          data.pickupLocation.latitude,
          data.pickupLocation.longitude
        );

        // Straight-line distance only. We do not have a road route to the
        // pickup, so no arrival time is shown rather than a guessed one.
        if (distance <= searchRadiusKm) {
          rides.push({ id: docSnap.id, ...data, pickupDistanceKm: distance });
        }
      });

      rides.sort((a, b) => a.pickupDistanceKm - b.pickupDistanceKm);
      setRideRequests(rides);
      setCurrentIndex(0);
      if (rides.length) animateCard();
    });
  }, [isOnline, location, searchRadiusKm, driverId, vehicleType, workingCityId, femaleVerified, animateCard]);

  // Move to the next offer, or clear the queue when there are none left.
  const advanceQueue = useCallback(() => {
    setCurrentIndex((index) => {
      if (index < rideRequests.length - 1) {
        animateCard();
        return index + 1;
      }
      setRideRequests([]);
      return 0;
    });
  }, [rideRequests.length, animateCard]);

  useEffect(() => {
    if (isOnline) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.35, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
    return undefined;
  }, [isOnline, pulseAnim]);

  /* The offer countdown. When it runs out the job moves on, rather than
     sitting at "1s" forever as it used to. */
  useEffect(() => {
    if (!rideRequests.length) return undefined;

    const waitingOnCounter = sentOffers[rideRequests[currentIndex]?.id];
    setTimer(
      waitingOnCounter
        ? offerSeconds(appConfig)
        : Math.max(5, Math.round(dispatchConfig.requestTimeoutSeconds || 15))
    );

    const interval = setInterval(() => {
      setTimer((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          advanceQueue();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [currentIndex, rideRequests, dispatchConfig.requestTimeoutSeconds, advanceQueue, sentOffers, appConfig]);

  /* Bidding: offer the passenger a higher price instead of accepting theirs. */
  const handleCounter = async (ride, price) => {
    if (!driverId || !driverCard || sending) return;
    setSending(true);
    try {
      await sendCounterOffer(ride.id, { id: driverId, ...driverCard }, price, appConfig);
      setSentOffers((m) => ({ ...m, [ride.id]: price }));
    } catch (error) {
      Alert.alert('Offer not sent', 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  /* A passenger took this driver's counter-offer: the ride now names them as
     the driver. Claim it on the driver record and start the trip, just as
     accepting a fare does. */
  useEffect(() => {
    if (!driverId) return undefined;
    return onSnapshot(
      query(collection(db, 'rides'), where('driverId', '==', driverId), where('status', '==', 'accepted')),
      async (snap) => {
        const mine = snap.docs[0];
        if (!mine || takenOver.current || isAccepting) return;
        takenOver.current = true;
        try {
          await setDoc(
            doc(db, 'drivers', driverId),
            { isOnRide: true, currentRideId: mine.id, status: 'on_ride' },
            { merge: true }
          );
        } catch (error) {
          console.log('Could not claim the ride on the driver record:', error);
        }
        clearJobAlerts();
        navigation.replace('DriverRideInProgress', { rideId: mine.id });
      },
      () => {}
    );
  }, [driverId, navigation, isAccepting]);

  const handleAcceptRide = async (ride) => {
    if (isAccepting) return;
    takenOver.current = true;
    setIsAccepting(true);

    try {
      const rideRef = doc(db, 'rides', ride.id);
      const driverRef = doc(db, 'drivers', driverId);

      clearJobAlerts();

      await runTransaction(db, async (transaction) => {
        const rideDoc = await transaction.get(rideRef);
        if (!rideDoc.exists()) throw new Error('This job no longer exists.');
        if (rideDoc.data().status !== 'searching') throw new Error('Another driver took this job.');
        // Re-checked here because the list is only a filter: the class could
        // have changed, or the job could have arrived from a stale render.
        // Firestore rules enforce it properly, this is the friendly message.
        if (!canServe(vehicleType, rideDoc.data().rideType)) {
          throw new Error(
            `This is a ${classLabel(rideDoc.data().rideType)} job and your vehicle is registered as ${classLabel(vehicleType)}.`
          );
        }
        // The passenger may have switched "female driver only" on or off
        // since the list was drawn.
        if (rideDoc.data().femaleDriverOnly === true && !femaleVerified) {
          throw new Error('This passenger asked for a female driver.');
        }

        transaction.update(rideRef, {
          driverId,
          status: 'accepted',
          walletProcessed: false,
          acceptedAt: serverTimestamp(),
        });

        transaction.set(
          driverRef,
          { isOnRide: true, currentRideId: ride.id, status: 'on_ride' },
          { merge: true }
        );
      });

      navigation.replace('DriverRideInProgress', { rideId: ride.id });
    } catch (error) {
      console.log(error);
      takenOver.current = false;
      Alert.alert('Job not taken', error?.message || 'This job is no longer available.');
      advanceQueue();
    } finally {
      setIsAccepting(false);
    }
  };

  /* ================= RESUME AN ACTIVE JOB ================= */
  useEffect(() => {
    const checkOngoingRide = async () => {
      if (!driverId) {
        setCheckingRide(false);
        return;
      }

      try {
        const driverRef = doc(db, 'drivers', driverId);
        const driverSnap = await getDoc(driverRef);
        if (!driverSnap.exists()) {
          setCheckingRide(false);
          return;
        }

        const driverData = driverSnap.data();
        if (!driverData.isOnRide || !driverData.currentRideId) {
          setCheckingRide(false);
          return;
        }

        const rideSnap = await getDoc(doc(db, 'rides', driverData.currentRideId));
        if (!rideSnap.exists()) {
          setCheckingRide(false);
          return;
        }

        const rideData = rideSnap.data();
        const stillMine = rideData.driverId === driverId;
        let navigateTo = null;

        if (stillMine && (rideData.status === 'accepted' || rideData.status === 'arrived')) {
          navigateTo = 'DriverRideInProgress';
        } else if (stillMine && rideData.status === 'ongoing') {
          navigateTo = 'RideToDropoff';
        }

        if (navigateTo) {
          // Only one of this and the assignment listener may navigate.
          if (takenOver.current) return;
          takenOver.current = true;
          navigation.replace(navigateTo, { rideId: driverData.currentRideId });
          return; // leaving this screen
        }

        // Finished, cancelled, or handed to another driver: clear the pointer.
        await updateDoc(driverRef, { isOnRide: false, currentRideId: null }).catch(() => null);
        setCheckingRide(false);
      } catch (error) {
        console.error('Error checking ongoing ride:', error);
        setCheckingRide(false);
      }
    };

    checkOngoingRide();

    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') checkOngoingRide();
    });

    return () => subscription.remove();
  }, [driverId, navigation]);

  /* ================= RENDER ================= */
  if (checkingRide) {
    return (
      <SafeAreaView style={styles.container}>
        <Loading label="Checking for an active job…" />
      </SafeAreaView>
    );
  }

  if (loading || !location) {
    return (
      <SafeAreaView style={styles.container}>
        <Loading label="Finding your location…" />
      </SafeAreaView>
    );
  }

  const currentRide = rideRequests[currentIndex];
  const alert = documentAlerts[0];

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: location.latitude,
          longitude: location.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
        customMapStyle={mapStyle}
        showsCompass={false}
        toolbarEnabled={false}
      >
        <Marker coordinate={location} anchor={{ x: 0.5, y: 0.5 }} flat>
          <View style={styles.carMarker}>
            <Ionicons name="car-sport" size={18} color={COLORS.lime} />
          </View>
        </Marker>
      </MapView>

      {/* Status and the one control that matters. */}
      <SafeAreaView style={styles.topArea} pointerEvents="box-none">
        <View style={styles.header}>
          <View style={styles.presence}>
            {isOnline ? (
              <Animated.View style={[styles.presenceHalo, { transform: [{ scale: pulseAnim }] }]} />
            ) : null}
            <View style={[styles.presenceDot, { backgroundColor: isOnline ? COLORS.limeDeep : COLORS.faint }]} />
          </View>

          <View style={{ flex: 1 }}>
            <Text style={TYPE.subhead}>{isOnline ? 'Online' : 'Offline'}</Text>
            <Text style={TYPE.small} numberOfLines={1}>
              {isOnline
                ? shiftLabel(shiftStartedAt, maxShiftHours) || 'Waiting for jobs'
                : isApproved
                ? 'Go online to get jobs'
                : 'Application under review'}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.goBtn, isOnline ? styles.goBtnOff : styles.goBtnOn]}
            onPress={toggleOnlineStatus}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <Text style={[styles.goBtnText, isOnline && { color: COLORS.red }]}>
              {isOnline ? 'Stop' : 'Go'}
            </Text>
          </TouchableOpacity>
        </View>

        {alert ? (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigation.navigate('DriverDocuments')}
            style={styles.docAlert}
            accessibilityRole="button"
          >
            <Banner
              tone={alert.status === 'expired' ? 'danger' : 'warning'}
              icon={alert.status === 'expired' ? 'alert-circle' : 'time-outline'}
              title={`${alert.label}: ${describeExpiry(alert).toLowerCase()}${
                documentAlerts.length > 1 ? ` and ${documentAlerts.length - 1} more` : ''
              }`}
              body="Tap to see your documents"
            />
          </TouchableOpacity>
        ) : null}
      </SafeAreaView>

      {/* Today, and the wallet. Two numbers that matter, not a dashboard. */}
      {!currentRide ? (
        <View style={styles.bottom}>
          <TouchableOpacity
            style={styles.earnings}
            activeOpacity={0.9}
            onPress={() => navigation.navigate('EarningsScreen')}
          >
            <View style={{ flex: 1 }}>
              <View style={styles.earningsHead}>
                <Text style={styles.earningsLabel}>Earned today</Text>
                <TouchableOpacity
                  onPress={toggleHideEarnings}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityRole="button"
                  accessibilityLabel={hideEarnings ? 'Show earnings' : 'Hide earnings'}
                >
                  <Ionicons
                    name={hideEarnings ? 'eye-off-outline' : 'eye-outline'}
                    size={18}
                    color={COLORS.lime}
                  />
                </TouchableOpacity>
              </View>
              <Text style={styles.earningsValue}>
                {hideEarnings ? '••••' : `${currencySymbol()}${earningsToday.toFixed(2)}`}
              </Text>
              <Text style={styles.earningsSub}>
                {tripsToday} {tripsToday === 1 ? 'trip' : 'trips'}
              </Text>
            </View>

            <View style={styles.walletBox}>
              <Text style={styles.walletLabel}>Wallet</Text>
              <Text style={styles.walletValue}>
                {hideEarnings ? '••••' : `${currencySymbol()}${walletBalance.toFixed(2)}`}
              </Text>
            </View>

            <Ionicons name="chevron-forward" size={18} color={COLORS.lime} />
          </TouchableOpacity>

          {isOnline ? (
            <View style={styles.waiting}>
              <ActivityIndicator size="small" color={COLORS.midnight} />
              <Text style={styles.waitingText}>Waiting for jobs nearby</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* A job offer. */}
      {currentRide ? (
        <Animated.View style={[styles.offerWrap, { transform: [{ translateX: slideAnim }] }]}>
          <Sheet style={styles.offer} grabber={false}>
            <View style={styles.offerTop}>
              <View style={styles.tags}>
                <Chip label={classLabel(currentRide.rideType)} active />
                {currentRide.paymentMethod === 'cash' ? <Chip label="Cash" icon="cash-outline" /> : null}
                {currentRide.stops?.length ? (
                  <Chip
                    label={`${currentRide.stops.length} stop${currentRide.stops.length === 1 ? '' : 's'}`}
                    icon="flag-outline"
                  />
                ) : null}
                {currentRide.femaleDriverOnly ? <Chip label="Female driver" icon="female-outline" /> : null}
              </View>
              <Text style={TYPE.figure}>
                {currencySymbol()}
                {Number(currentRide.fareEstimate || 0).toFixed(2)}
              </Text>
            </View>

            <View style={styles.offerRoute}>
              <RouteLine
                compact
                pickup={currentRide.pickupLocation?.address}
                dropoff={currentRide.dropoffLocation?.address}
              />
            </View>

            <View style={styles.facts}>
              <View style={styles.fact}>
                <Ionicons name="navigate-outline" size={16} color={COLORS.muted} />
                <Text style={styles.factText}>{currentRide.pickupDistanceKm.toFixed(1)} km away</Text>
              </View>
              <View style={styles.fact}>
                <Ionicons name="time-outline" size={16} color={COLORS.muted} />
                <Text style={styles.factText}>
                  {currentRide.route?.distanceKm || 0} km · {Math.ceil(currentRide.route?.durationMinutes || 0)} min trip
                </Text>
              </View>
            </View>

            <Button
              title={
                isAccepting
                  ? 'Accepting…'
                  : currentRide.bidding
                  ? `Accept ${currencySymbol()}${Number(currentRide.fareEstimate || 0).toFixed(2)} · ${timer}s`
                  : `Accept · ${timer}s`
              }
              onPress={() => handleAcceptRide(currentRide)}
              disabled={isAccepting}
              loading={isAccepting}
            />

            {/* Bidding: counter with a higher price instead. */}
            {currentRide.bidding && biddingEnabled(appConfig) ? (
              sentOffers[currentRide.id] ? (
                <Text style={styles.counterSent}>
                  You offered {currencySymbol()}
                  {Number(sentOffers[currentRide.id]).toFixed(2)}. Waiting for the passenger…
                </Text>
              ) : (
                <View style={styles.counterRow}>
                  {counterSteps(Number(currentRide.fareEstimate || 0), appConfig).map((price) => (
                    <Button
                      key={price}
                      size="small"
                      variant="secondary"
                      title={`${currencySymbol()}${price.toFixed(2)}`}
                      onPress={() => handleCounter(currentRide, price)}
                      disabled={sending}
                      style={styles.counterChip}
                      accessibilityLabel={`Offer ${price.toFixed(2)}`}
                    />
                  ))}
                </View>
              )
            ) : null}

            <Button title="Decline" variant="ghost" onPress={advanceQueue} style={styles.decline} />
          </Sheet>
        </Animated.View>
      ) : null}
    </View>
  );
}

const mapStyle = [
  { elementType: 'geometry', stylers: [{ color: COLORS.surface }] },
  { elementType: 'labels.text.fill', stylers: [{ color: COLORS.muted }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: COLORS.white }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: COLORS.line }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: COLORS.fill }] },
];

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface },

  carMarker: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: COLORS.midnight,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: COLORS.white,
    ...SHADOW.float,
  },

  topArea: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: SPACE[4] },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[3],
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACE[4], paddingVertical: SPACE[3],
    marginTop: SPACE[3],
    ...SHADOW.float,
  },
  presence: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  presenceHalo: {
    position: 'absolute', width: 26, height: 26, borderRadius: 13,
    backgroundColor: COLORS.lime, opacity: 0.45,
  },
  presenceDot: { width: 11, height: 11, borderRadius: 6 },

  // Go is the one solid lime button in the app: the moment a shift starts.
  goBtn: {
    minWidth: 76, height: 44, borderRadius: RADIUS.pill,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5,
  },
  goBtnOn: { backgroundColor: COLORS.lime, borderColor: COLORS.lime },
  goBtnOff: { backgroundColor: COLORS.white, borderColor: COLORS.redSoft },
  goBtnText: { fontSize: 15, fontWeight: '800', color: COLORS.midnight, letterSpacing: -0.2 },

  docAlert: { marginTop: SPACE[2] },

  bottom: { position: 'absolute', left: SPACE[4], right: SPACE[4], bottom: SPACE[5], gap: SPACE[3] },
  earnings: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[4],
    backgroundColor: COLORS.midnight,
    borderRadius: RADIUS.lg,
    padding: SPACE[5],
    ...SHADOW.float,
  },
  earningsHead: { flexDirection: 'row', alignItems: 'center', gap: SPACE[2] },
  earningsLabel: { ...TYPE.label, color: COLORS.lime },
  earningsValue: { fontSize: 32, fontWeight: '800', color: COLORS.white, letterSpacing: -1, marginTop: 2 },
  earningsSub: { ...TYPE.small, color: COLORS.onDark, marginTop: 2 },
  walletBox: {
    alignItems: 'flex-end', paddingLeft: SPACE[4],
    borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: COLORS.midnightLine,
  },
  walletLabel: { ...TYPE.small, color: COLORS.onDark },
  walletValue: { fontSize: 17, fontWeight: '800', color: COLORS.white, marginTop: 2 },

  waiting: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE[2],
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.pill, paddingVertical: SPACE[3],
    ...SHADOW.float,
  },
  waitingText: { ...TYPE.small, fontWeight: '600', color: COLORS.inkSoft },

  offerWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  offer: { paddingTop: SPACE[5] },
  offerTop: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: SPACE[3],
  },
  tags: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: SPACE[2] },

  offerRoute: { marginTop: SPACE[5] },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE[4], marginTop: SPACE[4], marginBottom: SPACE[5] },
  fact: { flexDirection: 'row', alignItems: 'center', gap: SPACE[1] },
  factText: { ...TYPE.small, fontWeight: '600', color: COLORS.inkSoft },

  counterRow: { flexDirection: 'row', gap: SPACE[2], marginTop: SPACE[3] },
  counterChip: { flex: 1, backgroundColor: COLORS.limeSoft, borderColor: COLORS.midnight, borderWidth: 2 },
  counterSent: { ...TYPE.small, textAlign: 'center', marginTop: SPACE[3], color: COLORS.midnight, fontWeight: '600' },
  decline: { marginTop: SPACE[2] },
});
