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
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import StaticMarker from '../../../components/StaticMarker';
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
  arrayUnion,
} from 'firebase/firestore';
import { useDriverPosition, requestDriverPosition } from '../../../utils/driverLocation';
import { db, functions } from '../../../config/firebase';
import { httpsCallable } from 'firebase/functions';
import { getAuth } from 'firebase/auth';
import { useAppConfig, currencySymbol } from '../../../utils/appConfig';
import { expiryAlertsFor, describeExpiry } from '../../../constants/driverDocuments';
import { canServe, classLabel, vehicleLabel, wantsJobType, jobChoices } from '../../../constants/vehicleClasses';
import { servesCity, useCities, cityFor } from '../../../utils/cities';
import { useBookedJobs, bookedWhen } from '../../../utils/followOn';
import { biddingEnabled, counterSteps, offerSeconds, sendCounterOffer, withdrawCounterOffer } from '../../../utils/bidding';
import { clearJobAlerts, ringForNewJob, stopJobRing } from '../../../utils/notifications';
import PaymentTypeBanner from '../../../components/PaymentTypeBanner';
import { formatHours, formatRestEnd, restEndsAt, workedInLastDay, cancelBlockEndsAt } from '../../../utils/driverHours';
import {
  COLORS, TYPE, SPACE, RADIUS, SHADOW,
  Button, Chip, Banner, RouteLine, Loading, Sheet, EmptyState, isCoord,
} from '../../../components/ui/kit';
import RouteDirections from '../../../components/RouteDirections';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { distanceText } from '../../../utils/routes';
import { DRIVER_MAP_STYLE } from '../../../utils/driverMapStyle';

// Remembered between launches, so a driver who hides their earnings from
// passengers does not have to do it again every shift.
const HIDE_EARNINGS_KEY = 'driver.hideEarnings';

const { width, height } = Dimensions.get('window');
// A job whose timer ran out stays off the list this long before it can be
// shown again (it won't ring again).
const MISSED_SNOOZE_MS = 60000;
// The price on the table for a job (the passenger's offer when bidding).
const fareOf = (ride) => Number(ride?.fareEstimate) || 0;
/* BID JOBs (functions/bidJobs.js): a job nobody was taking, opened to
   drivers further out. It is shown out to its own radius, rings again once,
   and comes back even if its timer ran out here before (not if declined). */
const bidRadiusKm = (ride, normalKm) =>
  ride?.bidJob ? Math.max(normalKm, Number(ride.bidJob.radiusKm) || 0) : normalKm;
const ringKey = (ride) => (ride?.bidJob ? `${ride.id}#bid` : ride?.id);
const snoozeHolds = (snooze, ride) =>
  Boolean(snooze && snooze.until > Date.now() && !(ride?.bidJob && !snooze.bid && snooze.until !== Infinity));
// A fleet's own answer time for zone-queue jobs is not on the ride or readable
// by drivers, so the countdown uses the default (functions/fleet.js).
const DEFAULT_QUEUE_OFFER_SECONDS = 45;

// "14:30" today, or "Tue 4 Nov, 14:30" for a booking on another day.
/* 1st, 2nd, 3rd, 4th… 11th, 12th, 13th, 21st. */
function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
}

function formatPickupTime(ts) {
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return time;
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}

// "Online 2h 10m of 12h, last 24h": time online in the last 24 hours, across
// every time they went on and off, against the dashboard's limit.
function hoursLabel(hoursDoc, maxHours, now) {
  if (!hoursDoc) return null;
  const online = formatHours(workedInLastDay(hoursDoc, now));
  return maxHours > 0 ? `Online ${online} of ${maxHours}h, last 24h` : `Online ${online}, last 24h`;
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
  const cancelBlockUntil = cancelBlockEndsAt(hoursDoc, now);
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
  // Where a driver still under review stands with a fleet, for the hint below.
  const [fleetHint, setFleetHint] = useState(null);
  // The class this driver's vehicle was approved as. Decides which jobs they
  // are shown; see constants/vehicleClasses.js.
  const [vehicleType, setVehicleType] = useState(null);
  const [membershipStatus, setMembershipStatus] = useState(null);
  const [firstMonthOwed, setFirstMonthOwed] = useState(false);
  // The penalty end this phone has already explained, so it is said once.
  const penaltyExplained = useRef(null);
  const [workingCityId, setWorkingCityId] = useState(null);
  const [workingCityName, setWorkingCityName] = useState(null);
  // Follow-on jobs while a passenger is on board (utils/followOn.js). On
  // unless the driver switched them off; this app saves true the first
  // time, which is also how the server knows the app can show them.
  const [followOnJobs, setFollowOnJobs] = useState(true);
  const followOnSaved = useRef(false);
  // "Automatic (where I am)" in Account: the city follows the driver.
  const [workingCityAuto, setWorkingCityAuto] = useState(false);
  // Cities the driver said "Keep" to while online, so they are asked once.
  const keptCity = useRef(new Set());
  const [femaleVerified, setFemaleVerified] = useState(false);
  // Off: this driver isn't offered jobs paid in cash (server and here).
  const [cashJobs, setCashJobs] = useState(true);
  // Job categories the driver ticked in Account (null = all their car allows).
  const [jobTypes, setJobTypes] = useState(null);
  // The taxi firm this driver works for, if any (functions/fleet.js).
  const [fleetId, setFleetId] = useState(null);
  // What a passenger sees on this driver's counter-offers.
  const [driverCard, setDriverCard] = useState(null);
  // Counter-offers sent, by ride id, so the card can say it is waiting.
  const [sentOffers, setSentOffers] = useState({});
  const [sending, setSending] = useState(false);
  const takenOver = useRef(false);
  // Jobs already rung for, so each offer rings once, not on every update.
  // Jobs on screen now, for the edge-of-radius allowance.
  const shownIds = useRef(new Set());
  // Jobs kept off the list until a time (ms): declined, or just missed.
  // Each keeps the price it had, so a passenger raising it brings it back.
  const snoozed = useRef(new Map());
  // Jobs this phone has rung for, with the price at the time.
  const rungFor = useRef(new Map());
  // The jobs list last put on screen, to skip redraws that change nothing.
  const lastJobs = useRef(null);
  const [searchingRides, setSearchingRides] = useState([]);
  const [fleetRides, setFleetRides] = useState([]);
  // This driver's place in their fleet's zone queue, if any.
  const [queueSpot, setQueueSpot] = useState(null);

  const [rideRequests, setRideRequests] = useState([]);
  // The offer being shown, by ride id, so a change to some other searching
  // ride does not throw the driver back to the first card.
  const [currentRideId, setCurrentRideId] = useState(null);
  const currentRideIdRef = useRef(null);
  currentRideIdRef.current = currentRideId;
  const [timer, setTimer] = useState(15);
  // The countdown's starting value, for the bar on the Accept button.
  const [timerTotal, setTimerTotal] = useState(15);
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
      setFleetHint(
        data.approved === true || data.onboardingStatus === 'rejected'
          ? null
          : data.fleetId
          ? `${data.fleetName || 'Your fleet'} or TakeARoute will check your documents and approve you.`
          : data.fleetRequest
          ? `${data.fleetRequest.fleetName || 'The fleet'} will check your documents and approve you.`
          : data.fleetInvite
          ? `${data.fleetInvite.fleetName || 'A fleet'} invited you. Accept it in Account > Fleet, and they can approve you.`
          : 'Driving for a taxi firm? Enter its join code in Account > Fleet, and the firm can approve you.'
      );
      setOnRide(data.isOnRide === true);
      setVehicleType(data.vehicleType || null);
      setMembershipStatus(data.subscription?.status || null);
      setFirstMonthOwed(
        data.subscription?.paymentMethod !== 'fleet' &&
        Number(data.subscription?.debtAmount) > 0 &&
        !data.subscription?.lastPaidAt
      );
      setWorkingCityId(data.workingCityId || null);
      setWorkingCityName(data.workingCityName || null);
      setWorkingCityAuto(data.workingCityAuto === true);
      setFemaleVerified(data.femaleVerified === true);
      setCashJobs(data.cashJobs !== false);
      setFollowOnJobs(data.followOnJobs !== false);
      if (data.followOnJobs === undefined && data.approved === true && !followOnSaved.current) {
        followOnSaved.current = true;
        updateDoc(doc(db, 'drivers', snap.id), { followOnJobs: true }).catch(() => {
          followOnSaved.current = false;
        });
      }
      setJobTypes(Array.isArray(data.jobTypes) ? data.jobTypes : null);
      setFleetId(data.fleetId || null);
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
        cancelBlockedUntil: data.cancelBlockedUntil,
        status: data.status,
        shiftStartedAt: data.shiftStartedAt,
      });
      // Taken offline by the server at the hours limit: say so once.
      const resting = restEndsAt(data);
      if (wasOnlineRef.current === true && data.status === 'offline' && resting) {
        Alert.alert(
          'Time for a rest',
          `You've reached your limit of ${maxShiftHoursRef.current} hours online in 24 hours, so you've been taken offline for your safety. You can go online again at ${formatRestEnd(resting)}.`
        );
      }
      // Taken offline by the server as a time penalty for cancelling a job.
      const blockedUntil = cancelBlockEndsAt(data);
      if (data.status === 'offline' && blockedUntil && penaltyExplained.current !== blockedUntil) {
        penaltyExplained.current = blockedUntil;
        Alert.alert(
          'You are offline for now',
          `You cancelled a job you had accepted, so you can't go online or take jobs until ${formatRestEnd(blockedUntil)}.`
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
    if (newStatus === 'online' && cancelBlockUntil) {
      Alert.alert(
        'You can’t go online yet',
        `You cancelled a job you had accepted, so you can go online again at ${formatRestEnd(cancelBlockUntil)}.`
      );
      return;
    }
    if (newStatus === 'online' && restUntil) {
      Alert.alert(
        'You’re resting',
        `You’ve reached your limit of hours online in 24 hours. For your safety you can go online again at ${formatRestEnd(restUntil)}.`
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

    // The first month is paid before the first time online (the rules
    // enforce this as well).
    if (newStatus === 'online' && firstMonthOwed) {
      Alert.alert(
        'Pay your membership first',
        'Your first month must be paid before you can go online.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Pay now', onPress: () => navigation.navigate('Membership') },
        ]
      );
      return;
    }

    // Driving needs an active membership; nothing else starts it.
    if (newStatus === 'online' && (!membershipStatus || membershipStatus === 'cancelled' || membershipStatus === 'inactive')) {
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

  // A fleet driver also gets their fleet's phone bookings, which use their
  // own status ("dispatching") so that only drivers of that fleet see them.
  useEffect(() => {
    if (!isOnline || !isApproved || !fleetId) {
      setFleetRides([]);
      return undefined;
    }
    // From fleetJobOffers, the ride without the customer's phone number
    // (functions/privacy.js). The number comes on the ride once they take it.
    const q = query(collection(db, 'fleetJobOffers'), where('fleetId', '==', fleetId));
    return onSnapshot(
      q,
      (snapshot) => setFleetRides(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setFleetRides([])
    );
  }, [isOnline, isApproved, fleetId]);

  // Fleets with zones keep a queue per zone (functions/fleet.js
  // runFleetQueues); show the driver where they stand.
  useEffect(() => {
    if (!isOnline || !isApproved || !fleetId || !driverId) {
      setQueueSpot(null);
      return undefined;
    }
    return onSnapshot(
      doc(db, 'fleetQueues', fleetId),
      (snap) => {
        const zones = snap.exists() ? snap.data().zones || {} : {};
        const names = snap.exists() ? snap.data().zoneNames || {} : {};
        let spot = null;
        Object.keys(zones).forEach((zoneId) => {
          const i = (zones[zoneId] || []).findIndex((e) => e.driverId === driverId);
          if (i >= 0) spot = { name: names[zoneId] || null, position: i + 1, of: zones[zoneId].length };
        });
        setQueueSpot(spot);
      },
      () => setQueueSpot(null)
    );
  }, [isOnline, isApproved, fleetId, driverId]);

  // The jobs on offer to this driver, nearest first, worked out again when
  // the jobs or the driver's position change.
  useEffect(() => {
    // No jobs for anyone who is not approved, whatever their status says.
    if (!isOnline || !location || !isApproved) return;

    const rides = [];
    // Phone bookings from this driver's fleet: one sent to this driver comes
    // whatever the distance (the operator chose them); one sent to the whole
    // fleet follows the usual radius.
    fleetRides.forEach((data) => {
      if (!data.pickupLocation || data.fleetId !== fleetId) return;
      const target = data.dispatch?.driverId || null;
      if (target && target !== driverId) return;
      // Cash jobs off: only one the office sent to this driver by name.
      if (!cashJobs && !target && !['account', 'card', 'online'].includes(data.collectBy)) return;
      if (Array.isArray(data.declinedBy) && data.declinedBy.includes(driverId)) return;
      if (snoozeHolds(snoozed.current.get(data.id), data)) return;
      if (!canServe(vehicleType, data.rideType)) return;
      // Unticked categories: only one the office sent to this driver by name.
      if (!target && !wantsJobType(jobTypes, data.rideType)) return;
      const distance = getDistanceFromLatLonInKm(
        location.latitude,
        location.longitude,
        data.pickupLocation.latitude,
        data.pickupLocation.longitude
      );
      if (!target && distance > bidRadiusKm(data, searchRadiusKm) * (shownIds.current.has(data.id) ? 1.25 : 1)) return;
      rides.push({ ...data, pickupDistanceKm: distance, forMe: Boolean(target) });
    });
    searchingRides.forEach((data) => {
      if (!data.pickupLocation) return;
      // Shown once the server has checked the price (a second or two after
      // booking); before that the job cannot be taken (firestore.rules).
      if (data.pricing !== 'checked') return;
      // Declined here, or its timer just ran out: don't put it straight back,
      // unless the passenger has raised the price since.
      const snooze = snoozed.current.get(data.id);
      const raised = Boolean(snooze && fareOf(data) > snooze.fare);
      // Jobs this driver already cancelled or declined are not offered
      // again, unless the passenger has raised their price since.
      if (Array.isArray(data.declinedBy) && data.declinedBy.includes(driverId) && !raised) return;
      if (snoozeHolds(snooze, data) && !raised) return;
      // Passengers who asked not to be matched with this driver.
      if (Array.isArray(data.blockedDriverIds) && data.blockedDriverIds.includes(driverId)) return;
      // Somebody who booked and paid for Executive does not get a Mini.
      if (!canServe(vehicleType, data.rideType)) return;
      // Job categories the driver unticked in Account.
      if (!wantsJobType(jobTypes, data.rideType)) return;
      // Cash jobs switched off.
      if (!cashJobs && data.paymentMethod === 'cash') return;
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
      const radius = bidRadiusKm(data, searchRadiusKm);
      const limit = shownIds.current.has(data.id) ? radius * 1.25 : radius;
      if (distance <= limit) {
        rides.push({ ...data, pickupDistanceKm: distance });
      }
    });

    // A job the fleet sent to this driver by name comes first.
    rides.sort((a, b) => (b.forMe ? 1 : 0) - (a.forMe ? 1 : 0) || a.pickupDistanceKm - b.pickupDistanceKm);
    shownIds.current = new Set(rides.map((r) => r.id));
    // Ring for jobs this phone has not seen yet. Not while on a job.
    // A job whose price went up since it rang counts as new.
    const fresh = rides.filter((r) => !rungFor.current.has(ringKey(r)) || fareOf(r) > rungFor.current.get(ringKey(r)));
    fresh.forEach((r) => rungFor.current.set(ringKey(r), fareOf(r)));
    if (fresh.length && !onRideRef.current) ringForNewJob(fresh[0]);
    // Nothing left to take: stop ringing.
    if (!rides.length) stopJobRing();
    // A new GPS fix alone, with the same jobs at about the same distance,
    // changes nothing on screen: skip it, so the screen (and its map) isn't
    // redrawn every few seconds while the driver waits or uses other tabs.
    const sig = rides.map((r) => `${ringKey(r)}@${r.pickupDistanceKm.toFixed(1)}`).join('|');
    const last = lastJobs.current;
    const same = last && last.searching === searchingRides && last.fleet === fleetRides && last.sig === sig;
    lastJobs.current = { searching: searchingRides, fleet: fleetRides, sig };
    if (!same) setRideRequests(rides);
    // Keep the card the driver is reading; only start again when it is gone.
    setCurrentRideId((current) => {
      if (current && rides.some((r) => r.id === current)) return current;
      const next = rides[0]?.id || null;
      if (next) animateCard();
      return next;
    });
  }, [searchingRides, fleetRides, fleetId, isOnline, location, isApproved, searchRadiusKm, driverId, vehicleType, workingCityId, femaleVerified, cashJobs, jobTypes, animateCard]);

  // Going offline takes the offer card down with it.
  useEffect(() => {
    if (isOnline) return;
    snoozed.current.clear();
    lastJobs.current = null;
    stopJobRing();
    setRideRequests([]);
    setCurrentRideId(null);
  }, [isOnline]);

  // Move to the next offer, or clear the queue when there are none left.
  // snoozeMs keeps the current job off the list for a while (Decline: for
  // the rest of this online spell), otherwise the next GPS fix, every few
  // seconds, would bring the same card straight back.
  const advanceQueue = useCallback((snoozeMs = 0) => {
    if (snoozeMs > 0 && currentRideIdRef.current) {
      const ride = rideRequests.find((r) => r.id === currentRideIdRef.current);
      snoozed.current.set(currentRideIdRef.current, { until: Date.now() + snoozeMs, fare: fareOf(ride), bid: Boolean(ride?.bidJob) });
    }
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
  // The countdown below keeps one interval per card, so it calls the latest
  // advanceQueue through this rather than the one from when it started.
  const advanceRef = useRef(advanceQueue);
  advanceRef.current = advanceQueue;

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

  /* Working city vs where the driver is. A driver set to Birmingham who is
     online in Redditch gets no Redditch jobs (servesCity here and in
     offerRideToDrivers), often without knowing it. So:
       - Automatic: the app moves the city to wherever they are (no city
         when outside every city, so they get jobs nearby by radius);
       - otherwise: ask once per city per online spell, never during a trip.
     Outside every city nothing is asked. */
  const cities = useCities();
  const hereCity = isOnline && location ? cityFor(cities, location) : null;
  const hereCityId = hereCity?.id || null;
  const hereCityName = hereCity?.name || null;
  const cityLabel = workingCityName || cities.find((c) => c.id === workingCityId)?.name || null;
  useEffect(() => {
    if (!isOnline) keptCity.current.clear();
  }, [isOnline]);
  useEffect(() => {
    if (!isOnline || !isApproved || !driverId || onRide || !location) return;
    const save = (id, name) =>
      updateDoc(doc(db, 'drivers', driverId), { workingCityId: id, workingCityName: name }).catch(() =>
        Alert.alert('Could not change your city', 'Check your connection, or change it in Account.')
      );
    if (workingCityAuto) {
      if (!cities.length || hereCityId === workingCityId) return;
      save(hereCityId, hereCityName);
      return;
    }
    if (!hereCityId || !workingCityId || hereCityId === workingCityId) return;
    if (keptCity.current.has(hereCityId)) return;
    keptCity.current.add(hereCityId);
    const current = cityLabel || 'another city';
    Alert.alert(
      `You're in ${hereCityName}`,
      `You only get ${current} jobs at the moment, so ${hereCityName} jobs won't reach you. Switch to ${hereCityName}?`,
      [
        { text: `Keep ${current}`, style: 'cancel' },
        { text: `Switch to ${hereCityName}`, onPress: () => save(hereCityId, hereCityName) },
      ]
    );
  }, [isOnline, isApproved, driverId, onRide, hereCityId, hereCityName, workingCityId, workingCityAuto, cityLabel, cities.length, location]);

  /* Cash jobs on or off: the server stops offering cash jobs when off. */
  const toggleCashJobs = useCallback(() => {
    if (!driverId) return;
    const next = !cashJobs;
    const save = () => {
      setCashJobs(next);
      updateDoc(doc(db, 'drivers', driverId), { cashJobs: next }).catch(() => {
        setCashJobs(!next);
        Alert.alert('Could not change it', 'Check your connection and try again.');
      });
    };
    if (next) return save();
    Alert.alert(
      'Turn cash jobs off?',
      "You won't be offered jobs the passenger pays in cash, including phone bookings from your fleet. Your office can still send you one by name.",
      [{ text: 'Keep them on', style: 'cancel' }, { text: 'Turn off', style: 'destructive', onPress: save }]
    );
  }, [driverId, cashJobs]);

  /* Follow-on jobs on or off. */
  const toggleFollowOn = useCallback(() => {
    if (!driverId) return;
    const next = !followOnJobs;
    setFollowOnJobs(next);
    updateDoc(doc(db, 'drivers', driverId), { followOnJobs: next }).catch(() => {
      setFollowOnJobs(!next);
      Alert.alert('Could not change it', 'Check your connection and try again.');
    });
  }, [driverId, followOnJobs]);

  // Pre-booked jobs the office gave this driver.
  const bookedJobs = useBookedJobs(driverId, fleetId);

  /* The job on offer on the map, like Uber: the route from the driver to the
     pickup (grey) and on to the drop-off (black), framed above the card.
     The driver's start point is frozen when the card appears, so GPS
     movement doesn't refetch the route (each fetch is a paid Routes call).
     The real drive to the pickup also replaces the estimate on the card. */
  const [offerMap, setOfferMap] = useState(null);
  const [pickupLeg, setPickupLeg] = useState(null);
  const offerMapId = useRef(null);
  useEffect(() => {
    const ride = currentRideId ? rideRequests.find((r) => r.id === currentRideId) : null;
    if (!ride || !isCoord(ride.pickupLocation)) {
      if (offerMapId.current) {
        offerMapId.current = null;
        setOfferMap(null);
        setPickupLeg(null);
        if (location) {
          mapRef.current?.animateToRegion(
            { latitude: location.latitude, longitude: location.longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 },
            500
          );
        }
      }
      return;
    }
    if (offerMapId.current === ride.id) return;
    offerMapId.current = ride.id;
    setPickupLeg(null);
    const from = isCoord(location) ? { latitude: location.latitude, longitude: location.longitude } : null;
    const dropoff = isCoord(ride.dropoffLocation) ? ride.dropoffLocation : null;
    setOfferMap({ id: ride.id, from, pickup: ride.pickupLocation, dropoff, stops: (ride.stops || []).filter(isCoord) });
    const points = [from, ride.pickupLocation, dropoff].filter(Boolean);
    setTimeout(() => {
      mapRef.current?.fitToCoordinates(points, {
        edgePadding: { top: 140, right: 60, bottom: Math.round(height * 0.55), left: 60 },
        animated: true,
      });
    }, 50);
    // Only when the card changes; location is read as it is at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRideId, rideRequests]);

  /* The offer countdown. When it runs out the job moves on, rather than
     sitting at "1s" forever as it used to. */
  const waitingOnCounter = !!(currentRideId && sentOffers[currentRideId]);
  useEffect(() => {
    if (!currentRideId) return undefined;

    // A zone-queue job sent to this driver is timed by the server, which moves
    // it on after the fleet's own answer time (runFleetQueues). The phone used
    // to pass it on at its shorter countdown, capping that time.
    const ride = rideRequests.find((r) => r.id === currentRideId);
    const queueJob = !waitingOnCounter && ride?.source === 'phone' &&
      ride.dispatch?.mode === 'queue' && ride.dispatch?.driverId === driverId;
    const offeredAt = ride?.dispatch?.offeredAt?.toMillis?.();
    const queueSeconds = Math.max(1, Math.min(DEFAULT_QUEUE_OFFER_SECONDS,
      offeredAt ? Math.ceil((offeredAt + DEFAULT_QUEUE_OFFER_SECONDS * 1000 - Date.now()) / 1000) : DEFAULT_QUEUE_OFFER_SECONDS));

    const startAt = waitingOnCounter
      ? offerSeconds(appConfig)
      : queueJob
      ? queueSeconds
      : Math.max(5, Math.round(dispatchConfig.requestTimeoutSeconds || 15));
    setTimer(startAt);
    setTimerTotal(queueJob ? DEFAULT_QUEUE_OFFER_SECONDS : startAt);

    const interval = setInterval(() => {
      setTimer((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          // Left on the card: the server takes it away when its time is up.
          if (queueJob) return 0;
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
          advanceRef.current(MISSED_SNOOZE_MS);
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
          { text: 'OK', onPress: () => advanceQueue() },
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
        // A follow-on job waits until the trip before it ends (the server
        // then stamps followOn.startedAt), so a restart mid-trip goes back
        // to that trip, not to the next job.
        const mine = snap.docs.find((d) => !(d.data().followOn && !d.data().followOn.startedAt));
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

  /* Decline: off this driver's list for the rest of the shift. A fleet's
     phone booking also records it, so the office sees the answer at once. A
     counter-offer already sent is taken back, so the passenger can't pick it. */
  const declineCurrent = (ride) => {
    if (ride?.id && sentOffers[ride.id] && driverId) {
      withdrawCounterOffer(ride.id, driverId).catch(() => {});
      setSentOffers((m) => {
        const next = { ...m };
        delete next[ride.id];
        return next;
      });
    }
    // App jobs too: when nobody else is left the server opens it as a BID
    // JOB for drivers further out (functions/bidJobs.js).
    if (ride?.id && driverId) {
      updateDoc(doc(db, 'rides', ride.id), { declinedBy: arrayUnion(driverId) }).catch(() => {});
    }
    advanceQueue(Infinity);
  };

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

      // One account on two phones: the other phone may already have taken
      // a job. Only a ride that is really still live and ours blocks this;
      // a stale pointer must not lock the driver out. Checked before the
      // transaction, not inside it: this phone writes the driver record every
      // few seconds with its position, and a transaction that reads a record
      // which changes before it commits fails ("stored version does not
      // match"), so accepting kept failing for a driver on the move.
      const me = (await getDoc(driverRef)).data() || {};
      if (me.isOnRide && me.currentRideId && me.currentRideId !== ride.id) {
        // A ride that has gone back to the office can no longer be read: not ours.
        const other = await getDoc(doc(db, 'rides', me.currentRideId)).catch(() => null);
        const o = other?.exists() ? other.data() : null;
        if (o && o.driverId === driverId && ['accepted', 'arrived', 'ongoing'].includes(o.status)) {
          throw new Error('You are already on a job. Finish it before taking another.');
        }
      }

      await runTransaction(db, async (transaction) => {
        // A phone job is read from its offer (no customer number until it is
        // taken); firestore.rules checks the real ride when it is updated.
        const rideDoc = await transaction.get(
          ride.source === 'phone' ? doc(db, 'fleetJobOffers', ride.id) : rideRef
        );
        if (!rideDoc.exists()) throw new Error('This job no longer exists.');
        // Fleet phone bookings wait in "dispatching", app jobs in "searching".
        const phoneJob = rideDoc.data().source === 'phone';
        if (rideDoc.data().status !== (phoneJob ? 'dispatching' : 'searching')) {
          throw new Error(
            phoneJob && rideDoc.data().status === 'cancelled'
              ? 'The office cancelled this booking.'
              : 'Another driver took this job.'
          );
        }
        const target = rideDoc.data().dispatch?.driverId;
        if (phoneJob && target && target !== driverId) {
          throw new Error('The office has sent this job to another driver.');
        }
        // Re-checked here because the list is only a filter: the class could
        // have changed, or the job could have arrived from a stale render.
        // Firestore rules enforce it properly, this is the friendly message.
        if (!canServe(vehicleType, rideDoc.data().rideType)) {
          throw new Error(
            `This is a ${classLabel(rideDoc.data().rideType)} job and your vehicle is registered as ${vehicleLabel(vehicleType)}.`
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
      // A refusal from the database rules: the job has gone, or something on
      // the account is stopping new jobs.
      Alert.alert(
        'Job not taken',
        error?.code === 'permission-denied' || /insufficient permissions/i.test(error?.message || '')
          ? 'You can’t take this job right now. It may have gone to another driver, or you may be on a rest or penalty break.'
          : error?.message || 'This job is no longer available.'
      );
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
        customMapStyle={DRIVER_MAP_STYLE}
        showsCompass={false}
        toolbarEnabled={false}
      >
        {offerMap?.from ? (
          <RouteDirections
            key={`to-${offerMap.id}`}
            origin={offerMap.from}
            destination={offerMap.pickup}
            strokeWidth={4}
            strokeColor="#8a9099"
            onReady={(r) => setPickupLeg({ id: offerMap.id, minutes: r.duration, km: r.distance })}
          />
        ) : null}
        {offerMap?.dropoff ? (
          <RouteDirections
            key={`trip-${offerMap.id}`}
            origin={offerMap.pickup}
            waypoints={offerMap.stops}
            destination={offerMap.dropoff}
            strokeWidth={5}
            strokeColor={COLORS.midnight}
          />
        ) : null}
        {offerMap ? (
          <StaticMarker coordinate={offerMap.pickup} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.offerPickupPin}>
              <Ionicons name="person" size={14} color={COLORS.white} />
            </View>
          </StaticMarker>
        ) : null}
        {offerMap?.dropoff ? (
          <StaticMarker coordinate={offerMap.dropoff} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.offerDropPin}>
              <View style={styles.offerDropDot} />
            </View>
          </StaticMarker>
        ) : null}
        {location ? (
          <StaticMarker coordinate={location} anchor={{ x: 0.5, y: 0.5 }} flat>
            <View style={styles.carMarker}>
              <Ionicons name="car-sport" size={18} color={COLORS.lime} />
            </View>
          </StaticMarker>
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
                : cancelBlockUntil
                ? `Cancelled a job · back online at ${formatRestEnd(cancelBlockUntil, now)}`
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
            style={[styles.goBtn, isOnline ? styles.goBtnOff : restUntil || cancelBlockUntil ? styles.goBtnRest : styles.goBtnOn]}
            onPress={toggleOnlineStatus}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <Text style={[styles.goBtnText, isOnline && { color: COLORS.red }]}>
              {isOnline ? 'Stop' : 'Go'}
            </Text>
          </TouchableOpacity>
        </View>

        {isApproved ? (
          <View style={styles.toggleRow}>
          <TouchableOpacity
            style={[styles.cashToggle, !cashJobs && styles.cashToggleOff]}
            onPress={toggleCashJobs}
            activeOpacity={0.85}
            accessibilityRole="switch"
            accessibilityState={{ checked: cashJobs }}
            accessibilityLabel="Cash jobs"
          >
            <Ionicons name="cash-outline" size={16} color={cashJobs ? COLORS.midnight : COLORS.red} />
            <Text style={[styles.cashToggleText, !cashJobs && { color: COLORS.red }]}>
              {cashJobs ? 'Cash jobs on' : 'Cash jobs off'}
            </Text>
          </TouchableOpacity>
          {/* Offered the next job near the drop-off while on a trip. */}
          <TouchableOpacity
            style={styles.cashToggle}
            onPress={toggleFollowOn}
            activeOpacity={0.85}
            accessibilityRole="switch"
            accessibilityState={{ checked: followOnJobs }}
            accessibilityLabel="Follow-on jobs"
          >
            <Ionicons name="arrow-redo-outline" size={16} color={followOnJobs ? COLORS.midnight : COLORS.muted} />
            <Text style={[styles.cashToggleText, !followOnJobs && { color: COLORS.muted }]}>
              {followOnJobs ? 'Follow-on jobs on' : 'Follow-on jobs off'}
            </Text>
          </TouchableOpacity>
          {bookedJobs.length ? (
            <TouchableOpacity
              style={[styles.cashToggle, styles.bookedChip]}
              onPress={() => navigation.navigate('DriverBookedJobs')}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Booked jobs"
            >
              <Ionicons name="calendar-outline" size={16} color={COLORS.lime} />
              <Text style={[styles.cashToggleText, { color: COLORS.white }]}>
                {bookedJobs.length === 1 ? '1 booked job' : `${bookedJobs.length} booked jobs`} · next {bookedWhen(bookedJobs[0].pickupAt)}
              </Text>
            </TouchableOpacity>
          ) : null}
          {/* Which job categories they get; ticked in Account. */}
          <TouchableOpacity
            style={styles.cashToggle}
            onPress={() => navigation.navigate('Account', { screen: 'DriverProfile' })}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Job types"
          >
            <Ionicons name="options-outline" size={16} color={COLORS.midnight} />
            <Text style={styles.cashToggleText}>
              {(() => {
                const all = jobChoices(vehicleType);
                const on = jobTypes ? all.filter((c) => jobTypes.includes(c.id)).length : all.length;
                return on === all.length ? 'All job types' : `${on} of ${all.length} job types`;
              })()}
            </Text>
          </TouchableOpacity>
          {/* Where they get jobs; chosen in Account. */}
          {cities.length ? (
            <TouchableOpacity
              style={[styles.cashToggle, hereCityId && workingCityId && hereCityId !== workingCityId && styles.cashToggleOff]}
              onPress={() => navigation.navigate('Account', { screen: 'DriverProfile' })}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Working city"
            >
              <Ionicons name="navigate-outline" size={16} color={COLORS.midnight} />
              <Text style={styles.cashToggleText}>
                {workingCityId ? `${cityLabel || 'One city'} jobs only` : 'Jobs from any city'}
                {workingCityAuto ? ' (auto)' : ''}
              </Text>
            </TouchableOpacity>
          ) : null}
          </View>
        ) : null}

        {fleetHint ? (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Account', { screen: 'DriverFleet' })}
            style={styles.docAlert}
            accessibilityRole="button"
          >
            <Banner tone="info" icon="people-outline" title="Approval through a fleet" body={fleetHint} />
          </TouchableOpacity>
        ) : null}

        {rejection ? (
          <View style={styles.docAlert}>
            <Banner
              tone="danger"
              title="Application not approved"
              body={`${rejection} Email support@takearoute.ltd if you need help.`}
              action={
                <Button
                  size="small"
                  title="Correct and resubmit"
                  onPress={() => httpsCallable(functions, 'resubmitDriverApplication')().catch(() => Alert.alert('Could not reopen your application', 'Please try again, or email support@takearoute.ltd.'))}
                />
              }
            />
          </View>
        ) : null}

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
              body={
                alert.status === 'expired'
                  ? isOnline
                    ? 'Job alerts have stopped, and once you go offline you can’t come back online until you replace it. Tap to upload a new one.'
                    : 'Tap to upload a new one so you can go online.'
                  : 'Upload a new one before it expires to keep getting jobs. Tap to see your documents.'
              }
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
                <Text style={styles.earningsLabel}>Fares today</Text>
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
              <Text style={styles.waitingText}>
                {queueSpot
                  ? `${ordinal(queueSpot.position)} of ${queueSpot.of} in the ${queueSpot.name || 'zone'} queue`
                  : 'Waiting for jobs nearby'}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* A job offer. */}
      {currentRide ? (
        <Animated.View style={[styles.offerWrap, { transform: [{ translateX: slideAnim }] }]}>
          <Sheet style={[styles.offer, currentRide.bidJob && styles.bidOffer]} grabber={false}>
            {currentRide.bidJob ? (
              <View style={styles.bidBanner} accessibilityRole="header">
                <Text style={styles.bidTitle}>BID JOB</Text>
                <Text style={styles.bidText} numberOfLines={2}>
                  {distanceText(currentRide.pickupDistanceKm)} from you
                  {bidCounters(currentRide) ? ' · take it or offer your price' : ' · no driver nearer took it'}
                </Text>
              </View>
            ) : null}
            <PaymentTypeBanner method={currentRide.paymentMethod} collectBy={currentRide.collectBy} account={currentRide.account} style={{ marginBottom: SPACE[4] }} />
            {currentRide.source === 'phone' ? (
              <View style={styles.fleetBanner}>
                <Ionicons name="call-outline" size={16} color={COLORS.midnight} />
                <Text style={styles.fleetBannerText} numberOfLines={2}>
                  {currentRide.forMe && currentRide.dispatch?.mode === 'queue'
                    ? `Your turn${currentRide.dispatch?.zoneName ? ` in the ${currentRide.dispatch.zoneName} queue` : ''} · `
                    : currentRide.forMe
                    ? 'Sent to you by '
                    : 'Phone booking from '}
                  {currentRide.fleetName || 'your fleet'}
                  {currentRide.pickupAt ? ` · pickup ${formatPickupTime(currentRide.pickupAt)}` : ''}
                  {currentRide.notes ? `\n${currentRide.notes}` : ''}
                </Text>
              </View>
            ) : null}
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
                {currentRide.riderId ? <RiderRatingChip riderId={currentRide.riderId} /> : null}
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
                <Text style={styles.factText}>
                  {pickupLeg?.id === currentRide.id
                    ? `${Math.max(1, Math.ceil(pickupLeg.minutes))} min (${distanceText(pickupLeg.km)})`
                    : `About ${pickupMinutes(currentRide.pickupDistanceKm)} min (${distanceText(currentRide.pickupDistanceKm)})`}{' '}
                  to pickup
                </Text>
              </View>
              <View style={styles.fact}>
                <Ionicons name="time-outline" size={16} color={COLORS.muted} />
                <Text style={styles.factText}>
                  {Math.ceil(currentRide.route?.durationMinutes || 0)} min ({distanceText(currentRide.route?.distanceKm || 0)}) trip
                </Text>
              </View>
            </View>

            <View style={styles.acceptWrap}>
            <Button
              title={
                isAccepting
                  ? 'Accepting…'
                  : currentRide.bidding || bidCounters(currentRide)
                  ? `Accept ${currencySymbol()}${Number(currentRide.fareEstimate || 0).toFixed(2)}${timer > 0 ? ` · ${timer}s` : ''}`
                  : timer > 0 ? `Accept · ${timer}s` : 'Accept'
              }
              onPress={() => handleAcceptRide(currentRide)}
              disabled={isAccepting}
              loading={isAccepting}
            />
            {timer > 0 && !isAccepting ? (
              <View pointerEvents="none" style={styles.countdownTrack}>
                <View style={[styles.countdownFill, { width: `${Math.min(100, (timer / Math.max(1, timerTotal)) * 100)}%` }]} />
              </View>
            ) : null}
            </View>

            {/* Bidding: counter with a higher price instead. */}
            {(currentRide.bidding && biddingEnabled(appConfig)) || bidCounters(currentRide) ? (
              sentOffers[currentRide.id] ? (
                <Text style={styles.counterSent}>
                  You offered {currencySymbol()}
                  {Number(sentOffers[currentRide.id]).toFixed(2)}. Waiting for the passenger…
                </Text>
              ) : (
                <View style={styles.counterRow}>
                  {counterChoices(currentRide, appConfig).map((price) => (
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

            <Button title="Decline" variant="ghost" onPress={() => declineCurrent(currentRide)} style={styles.decline} />
          </Sheet>
        </Animated.View>
      ) : null}
    </View>
  );
}

// Somewhere sensible to draw the map while there is no fix yet.
const FALLBACK_REGION = { latitude: 51.5074, longitude: -0.1278, latitudeDelta: 0.2, longitudeDelta: 0.2 };


/* Rough drive time to the pickup from the straight-line distance (roads
   are about a third longer; about 30 km/h in town), as offers don't carry
   a route to the pickup. At least 1 minute. */
function pickupMinutes(km) {
  return Math.max(1, Math.ceil((Number(km) || 0) * 1.35 * 2));
}

/* A BID JOB the driver may counter (app jobs only; the cap is on the ride). */
function bidCounters(ride) {
  return Boolean(ride?.bidJob?.allowCounter && ride.source !== 'phone');
}

/* The prices offered on the counter chips. A bidding job uses the Bidding
   settings; a BID JOB its own cap, from the fare the server checked (the
   rules allow at most that much above fare.total). */
function counterChoices(ride, config) {
  if (ride?.bidding) return counterSteps(Number(ride.fareEstimate || 0), config);
  const base = Number(ride?.fare?.total ?? ride?.fareEstimate ?? 0);
  return counterSteps(base, { bidding: { maxCounterPercent: Number(ride?.bidJob?.maxCounterPercent) || 0 } });
}

/* The passenger's rating on a job offer, from riderPublic (drivers may read
   it). Nothing until they have been rated. */
function RiderRatingChip({ riderId }) {
  const [rating, setRating] = useState(null);
  useEffect(() => {
    let live = true;
    setRating(null);
    getDoc(doc(db, 'riderPublic', riderId))
      .then((snap) => {
        const r = snap.exists() ? Number(snap.data().rating) : NaN;
        if (live && r > 0) setRating(r);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [riderId]);
  if (!rating) return null;
  return <Chip label={rating.toFixed(2)} icon="star" />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface },

  toggleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE[2] },
  bookedChip: { backgroundColor: COLORS.midnight, borderColor: COLORS.midnight },
  cashToggle: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[2], alignSelf: 'flex-start',
    backgroundColor: COLORS.white, borderRadius: RADIUS.pill,
    paddingHorizontal: SPACE[3], paddingVertical: SPACE[2], marginTop: SPACE[2], ...SHADOW.float,
  },
  cashToggleOff: { borderWidth: 1, borderColor: COLORS.red },
  cashToggleText: { fontSize: 13, fontWeight: '700', color: COLORS.midnight },
  acceptWrap: { borderRadius: RADIUS.pill, overflow: 'hidden' },
  countdownTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 5, backgroundColor: 'rgba(255,255,255,0.18)' },
  countdownFill: { height: 5, backgroundColor: COLORS.lime },
  offerPickupPin: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: '#2f6fde',
    borderWidth: 3, borderColor: COLORS.white, alignItems: 'center', justifyContent: 'center', ...SHADOW.float,
  },
  offerDropPin: {
    width: 26, height: 26, borderRadius: 6, backgroundColor: COLORS.midnight,
    borderWidth: 3, borderColor: COLORS.white, alignItems: 'center', justifyContent: 'center', ...SHADOW.float,
  },
  offerDropDot: { width: 8, height: 8, borderRadius: 2, backgroundColor: COLORS.white },

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
  bidOffer: { borderWidth: 3, borderColor: COLORS.lime },
  bidBanner: {
    backgroundColor: COLORS.midnight,
    borderRadius: RADIUS.md,
    paddingVertical: SPACE[2],
    paddingHorizontal: SPACE[3],
    marginBottom: SPACE[3],
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE[2],
  },
  bidTitle: { color: COLORS.lime, fontWeight: '900', fontSize: 16, letterSpacing: 1 },
  bidText: { color: COLORS.white, fontSize: 13, fontWeight: '600', flex: 1 },
  counterChip: { flex: 1, backgroundColor: COLORS.limeSoft, borderColor: COLORS.midnight, borderWidth: 2 },
  counterSent: { ...TYPE.small, textAlign: 'center', marginTop: SPACE[3], color: COLORS.midnight, fontWeight: '600' },
  decline: { marginTop: SPACE[2] },
  fleetBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACE[2],
    backgroundColor: COLORS.lime,
    borderRadius: 12,
    paddingVertical: SPACE[2],
    paddingHorizontal: SPACE[3],
    marginBottom: SPACE[3],
  },
  fleetBannerText: { flex: 1, color: COLORS.midnight, fontWeight: '600' },
});
