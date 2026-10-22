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
  Linking,
} from 'react-native';
import { Alert } from '../../../components/ui/alert';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
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
import { useDriverPosition, requestDriverPosition } from '../../../utils/driverLocation';
import { db } from '../../../config/firebase';
import { getAuth } from 'firebase/auth';
import { useAppConfig, currencySymbol } from '../../../utils/appConfig';
import { expiryAlertsFor, describeExpiry } from '../../../constants/driverDocuments';
import { canServe, classLabel } from '../../../constants/vehicleClasses';
import { servesCity } from '../../../utils/cities';
import { biddingEnabled, counterSteps, offerSeconds, sendCounterOffer } from '../../../utils/bidding';
import { clearJobAlerts, ringForNewJob, stopJobRing } from '../../../utils/notifications';
import PaymentTypeBanner from '../../../components/PaymentTypeBanner';
import { formatHours, formatRestEnd, restEndsAt, workedInLastDay } from '../../../utils/driverHours';
import {
  COLORS, TYPE, SPACE, RADIUS, SHADOW,
  Button, Chip, Banner, RouteLine, Loading, Sheet, EmptyState,
} from '../../../components/ui/kit';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Remembered between launches, so a driver who hides their earnings from
// passengers does not have to do it again every shift.
const HIDE_EARNINGS_KEY = 'driver.hideEarnings';

const { width } = Dimensions.get('window');

// "Online 2h 10m of 12h today": time online in the last 24 hours, across
// every time they went on and off, against the dashboard's limit.
function hoursLabel(hoursDoc, maxHours, now) {
  if (!hoursDoc) return null;
  const online = formatHours(workedInLastDay(hoursDoc, now));
  return maxHours > 0 ? `Online ${online} of ${maxHours}h today` : `Online ${online} today`;
}

export default function DriverHomeScreen() {
  const mapRef = useRef(null);
  const slideAnim = useRef(new Animated.Value(width)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const navigation = useNavigation();

  // Position from the session-wide watcher (utils/driverLocation.js), which
  // keeps running on the ride screens after this one is replaced.
  const { coords: location, status: locationStatus } = useDriverPosition();
  const appConfig = useAppConfig();
  const { dispatch: dispatchConfig, drivers: driverConfig } = appConfig;
  const maxShiftHours = driverConfig.maxShiftHours; // 0 means unlimited
  const searchRadiusKm = dispatchConfig.searchRadiusKm;

  // workLog, restUntil and status, kept by the server (enforceDriverHours).
  const [hoursDoc, setHoursDoc] = useState(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => clearInterval(id);
  }, []);
  const restUntil = restEndsAt(hoursDoc, now);
  const wasOnlineRef = useRef(null);
  const maxShiftHoursRef = useRef(maxShiftHours);
  maxShiftHoursRef.current = maxShiftHours;
  const [onRide, setOnRide] = useState(false);
  // Read inside the offers listener without restarting it.
  const onRideRef = useRef(false);
  onRideRef.current = onRide;
  // Assume nothing until the driver record says otherwise, so the screen never
  // flashes "You are online" at someone who is not.
  const [isOnline, setIsOnline] = useState(false);
  const [isApproved, setIsApproved] = useState(false);
  // Set when an admin declined the application; holds the reason they gave.
  const [rejection, setRejection] = useState(null);
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
  // Jobs already rung for, so each offer rings once, not on every update.
  const rungFor = useRef(new Set());
  // Jobs on screen now, for the edge-of-radius allowance.
  const shownIds = useRef(new Set());
  const [searchingRides, setSearchingRides] = useState([]);

  const [rideRequests, setRideRequests] = useState([]);
  // The offer being shown, by ride id, so a change to some other searching
  // ride does not throw the driver back to the first card.
  const [currentRideId, setCurrentRideId] = useState(null);
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

  // Bring the map to the driver once there is a fix. On a fresh install the
  // first fix often takes longer than the position request allows, so the
  // map mounts on the fallback region (London) and, without this, stays
  // there while the car sits off-screen. Once only, so it never fights a
  // driver who has panned away.
  const centredOnDriver = useRef(false);
  useEffect(() => {
    if (!location) {
      centredOnDriver.current = false;
      return;
    }
    if (centredOnDriver.current) return;
    centredOnDriver.current = true;
    mapRef.current?.animateToRegion(
      { latitude: location.latitude, longitude: location.longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 },
      600
    );
  }, [location]);

  /* ================= DRIVER, WALLET, TODAY ================= */
  useEffect(() => {
    if (!driverId) return undefined;

    const driverRef = doc(db, 'drivers', driverId);
    const unsubDriver = onSnapshot(driverRef, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      setIsOnline(data.status === 'online');
      setIsApproved(data.approved === true);
      setRejection(
        data.onboardingStatus === 'rejected'
          ? data.rejectionReason || 'Contact support to find out why.'
          : null
      );
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
      setHoursDoc({
        workLog: data.workLog,
        restUntil: data.restUntil,
        status: data.status,
        shiftStartedAt: data.shiftStartedAt,
      });
      // Taken offline by the server at the hours limit: say so once.
      const resting = restEndsAt(data);
      if (wasOnlineRef.current === true && data.status === 'offline' && resting) {
        Alert.alert(
          'Time for a rest',
          `You've reached your ${maxShiftHoursRef.current} hours online for today, so you've been taken offline for your safety. You can go online again at ${formatRestEnd(resting)}.`
        );
      }
      wasOnlineRef.current = data.status === 'online' || data.status === 'on_ride';
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

  /* ================= ONLINE / OFFLINE ================= */
  const toggleOnlineStatus = async () => {
    if (!driverId) return;
    const newStatus = !isOnline ? 'online' : 'offline';

    // Resting after the hours limit: the server won't let them back on yet.
    if (newStatus === 'online' && restUntil) {
      Alert.alert(
        'You’re resting',
        `You’ve reached your hours online for today. For your safety you can go online again at ${formatRestEnd(restUntil)}.`
      );
      return;
    }

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
        rejection ? 'Application not approved' : 'Application under review',
        rejection || 'You can go online as soon as your application has been approved.'
      );
      return;
    }

    // An expired licence, insurance or MOT means no driving until it is
    // replaced. The server stops offering jobs to such drivers as well.
    const expired = documentAlerts.filter((a) => a.status === 'expired');
    if (newStatus === 'online' && expired.length) {
      Alert.alert(
        'Document expired',
        `${expired[0].label} has expired. Upload a new one to go online.`,
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Update', onPress: () => navigation.navigate('DriverDocuments') },
        ]
      );
      return;
    }

    // Driving needs an active membership; nothing else starts it.
    if (newStatus === 'online' && (!membershipStatus || membershipStatus === 'cancelled')) {
      Alert.alert(
        'Activate your membership first',
        'You need an active membership to go online and take jobs.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Activate', onPress: () => navigation.navigate('Membership') },
        ]
      );
      return;
    }

    try {
      // shiftStartedAt tells the server's hours log when this spell online
      // began. It is kept while the driver goes on and off trips, and cleared
      // when they go offline themselves.
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

  /* ================= HOURS LIMIT =================
     Enforced on the server (enforceDriverHours): it counts time online over
     the last 24 hours and takes the driver offline to rest at the limit, so
     it works with the app closed too. The snapshot above shows the result. */

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

  // Every job still looking for a driver. One listener for as long as the
  // driver is online: it used to restart on every location update (every 4
  // seconds), which made jobs vanish and reappear and held back price offers.
  useEffect(() => {
    if (!isOnline || !isApproved) {
      setSearchingRides([]);
      return undefined;
    }
    const q = query(collection(db, 'rides'), where('status', '==', 'searching'));
    return onSnapshot(q, (snapshot) => {
      setSearchingRides(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, [isOnline, isApproved]);

  // The jobs on offer to this driver, nearest first, worked out again when
  // the jobs or the driver's position change.
  useEffect(() => {
    // No jobs for anyone who is not approved, whatever their status says.
    if (!isOnline || !location || !isApproved) return;

    const rides = [];
    searchingRides.forEach((data) => {
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
      // A job already on screen stays until it is a quarter beyond the
      // radius, so a driver near the edge does not see it blink in and out.
      const limit = shownIds.current.has(data.id) ? searchRadiusKm * 1.25 : searchRadiusKm;
      if (distance <= limit) {
        rides.push({ ...data, pickupDistanceKm: distance });
      }
    });

    rides.sort((a, b) => a.pickupDistanceKm - b.pickupDistanceKm);
    shownIds.current = new Set(rides.map((r) => r.id));
    // Ring for jobs this phone has not seen yet. Not while on a job.
    const fresh = rides.filter((r) => !rungFor.current.has(r.id));
    fresh.forEach((r) => rungFor.current.add(r.id));
    if (fresh.length && !onRideRef.current) ringForNewJob(fresh[0]);
    // Nothing left to take: stop ringing.
    if (!rides.length) stopJobRing();
    setRideRequests(rides);
    // Keep the card the driver is reading; only start again when it is gone.
    setCurrentRideId((current) => {
      if (current && rides.some((r) => r.id === current)) return current;
      const next = rides[0]?.id || null;
      if (next) animateCard();
      return next;
    });
  }, [searchingRides, isOnline, location, isApproved, searchRadiusKm, driverId, vehicleType, workingCityId, femaleVerified, animateCard]);

  // Going offline takes the offer card down with it.
  useEffect(() => {
    if (isOnline) return;
    stopJobRing();
    setRideRequests([]);
    setCurrentRideId(null);
  }, [isOnline]);

  // Move to the next offer, or clear the queue when there are none left.
  const advanceQueue = useCallback(() => {
    // The driver has dealt with this offer (declined it, or it went), so the
    // ring and its notification stop with it. Later new jobs ring again.
    clearJobAlerts();
    setCurrentRideId((current) => {
      const index = rideRequests.findIndex((r) => r.id === current);
      const next = rideRequests[index + 1];
      if (next) {
        animateCard();
        return next.id;
      }
      setRideRequests([]);
      return null;
    });
  }, [rideRequests, animateCard]);

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
  const waitingOnCounter = !!(currentRideId && sentOffers[currentRideId]);
  useEffect(() => {
    if (!currentRideId) return undefined;

    setTimer(
      waitingOnCounter
        ? offerSeconds(appConfig)
        : Math.max(5, Math.round(dispatchConfig.requestTimeoutSeconds || 15))
    );

    const interval = setInterval(() => {
      setTimer((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          // The counter-offer has expired: forget it, so the chips come back
          // if this job is shown again, instead of "Waiting for the
          // passenger" for ever.
          if (waitingOnCounter) {
            setSentOffers((m) => {
              const next = { ...m };
              delete next[currentRideId];
              return next;
            });
          }
          advanceQueue();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
    // Restart only for a new card or a counter-offer on it, not on every
    // change to the list behind it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRideId, waitingOnCounter, dispatchConfig.requestTimeoutSeconds, appConfig]);

  /* Bidding: offer the passenger a higher price instead of accepting theirs. */
  const handleCounter = async (ride, price) => {
    if (!driverId || sending) return;
    if (!driverCard) {
      // The driver record has not loaded yet: say so rather than ignore the tap.
      Alert.alert('One moment', 'Your profile is still loading. Please try again.');
      return;
    }
    setSending(true);
    try {
      await sendCounterOffer(ride.id, { id: driverId, ...driverCard }, price, appConfig);
      setSentOffers((m) => ({ ...m, [ride.id]: price }));
    } catch (error) {
      // The rules refuse an offer on a job that is no longer searching: it
      // was taken or cancelled while the card was on screen.
      if (error?.code === 'permission-denied') {
        Alert.alert('Job gone', 'This job has already been taken or cancelled.', [
          { text: 'OK', onPress: advanceQueue },
        ]);
      } else {
        Alert.alert('Offer not sent', 'Please check your connection and try again.');
      }
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
    if (!isApproved) {
      Alert.alert('Not approved', 'Your application must be approved before you can take jobs.');
      return;
    }
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
        // The server hands a job back (card declined, or the passenger's
        // search timed out), so a ride that is searching, cancelled or now
        // someone else's is no longer this driver's.
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

        // Finished, cancelled, back to searching, or handed to another driver:
        // clear the pointer and let the driver take new jobs.
        takenOver.current = false;
        // Back to "online" too: new jobs are only pushed to online drivers,
        // and a driver left on "on_ride" after a cancel was offered nothing.
        await updateDoc(driverRef, {
          isOnRide: false,
          currentRideId: null,
          ...(driverData.status === 'on_ride' ? { status: 'online' } : {}),
        }).catch(() => null);
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

  const locationProblem = !location && ['denied', 'timeout', 'error'].includes(locationStatus);
  if (!location && !locationProblem) {
    return (
      <SafeAreaView style={styles.container}>
        <Loading label="Finding your location…" />
      </SafeAreaView>
    );
  }

  const currentRide = rideRequests.find((r) => r.id === currentRideId) || null;
  const alert = documentAlerts[0];

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={
          location
            ? { latitude: location.latitude, longitude: location.longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 }
            : FALLBACK_REGION
        }
        customMapStyle={mapStyle}
        showsCompass={false}
        toolbarEnabled={false}
      >
        {location ? (
          <Marker coordinate={location} anchor={{ x: 0.5, y: 0.5 }} flat>
            <View style={styles.carMarker}>
              <Ionicons name="car-sport" size={18} color={COLORS.lime} />
            </View>
          </Marker>
        ) : null}
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
                ? hoursLabel(hoursDoc, maxShiftHours, now) || 'Waiting for jobs'
                : restUntil
                ? `Resting · back online at ${formatRestEnd(restUntil, now)}`
                : isApproved
                ? 'Go online to get jobs'
                : rejection
                ? 'Application not approved'
                : 'Application under review'}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.goBtn, isOnline ? styles.goBtnOff : restUntil ? styles.goBtnRest : styles.goBtnOn]}
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

      {/* No position: say why, and what to do, instead of spinning. */}
      {locationProblem ? (
        <View style={styles.bottom}>
          <View style={styles.locationCard}>
            <EmptyState
              icon="locate-outline"
              title={locationStatus === 'denied' ? 'Location is switched off' : 'Could not find your location'}
              body={
                locationStatus === 'denied'
                  ? 'TakeARoute needs your location to offer you jobs nearby. Allow it in Settings.'
                  : 'Check that Location is on and you have a clear view of the sky, then try again.'
              }
              action={
                <View style={styles.locationActions}>
                  {locationStatus === 'denied' ? (
                    <Button
                      title="Open Settings"
                      variant="secondary"
                      style={{ flex: 1 }}
                      onPress={() => Linking.openSettings().catch(() => {})}
                    />
                  ) : null}
                  <Button
                    title="Try again"
                    style={{ flex: 1 }}
                    onPress={() => requestDriverPosition(driverId)}
                  />
                </View>
              }
            />
          </View>
        </View>
      ) : null}

      {/* Today, and the wallet. Two numbers that matter, not a dashboard. */}
      {!currentRide && !locationProblem ? (
        <View style={styles.bottom}>
          <TouchableOpacity
            style={styles.earnings}
            activeOpacity={0.9}
            onPress={() => navigation.navigate('Earnings', { screen: 'EarningsScreen' })}
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
            <PaymentTypeBanner method={currentRide.paymentMethod} style={{ marginBottom: SPACE[4] }} />
            <View style={styles.offerTop}>
              <View style={styles.tags}>
                <Chip label={classLabel(currentRide.rideType)} active />
                {currentRide.stops?.length ? (
                  <Chip
                    label={`${currentRide.stops.length} stop${currentRide.stops.length === 1 ? '' : 's'}`}
                    icon="flag-outline"
                  />
                ) : null}
                {currentRide.femaleDriverOnly ? <Chip label="Female driver" icon="female-outline" /> : null}
                {Number(currentRide.fare?.surgeMultiplier) > 1 ? (
                  <Chip label={`${currentRide.fare.surgeMultiplier}× busy`} icon="flash" />
                ) : null}
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

// Somewhere sensible to draw the map while there is no fix yet.
const FALLBACK_REGION = { latitude: 51.5074, longitude: -0.1278, latitudeDelta: 0.2, longitudeDelta: 0.2 };

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
  goBtnRest: { backgroundColor: COLORS.white, borderColor: COLORS.faint, opacity: 0.6 },
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

  locationCard: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.lg, paddingHorizontal: SPACE[2],
    ...SHADOW.float,
  },
  locationActions: { flexDirection: 'row', gap: SPACE[2] },

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
