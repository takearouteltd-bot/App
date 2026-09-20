import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Animated,
  Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, useNavigation } from '@react-navigation/native';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { currencySymbol } from '../../utils/appConfig';
import EmailReceiptButton from '../../components/EmailReceiptButton';

const PRIMARY = '#79B431';
const SECONDARY = '#235594';
const DARK = '#1a1a1a';
const BG = '#F8F9FA';

export default function RiderRideCompletedScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { rideId } = route.params || {};

  const [ride, setRide] = useState(null);
  const [rating, setRating] = useState(0);

  /* ================= ANIMATION REFS ================= */
  const checkScale = useRef(new Animated.Value(0)).current;
  const checkRotate = useRef(new Animated.Value(0)).current;
  const cardSlide = useRef(new Animated.Value(50)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const shimmerAnim = useRef(new Animated.Value(-200)).current;

const paymentStatus = ride?.payment?.status || ride?.paymentStatus || 'pending';
const isPaid = ['captured', 'authorized', 'paid', 'succeeded'].includes(paymentStatus);
const isFailed = paymentStatus === 'failed';
const isPending = !isPaid && !isFailed;

  /* ================= FETCH RIDE ================= */
  useEffect(() => {
    if (!rideId) return;

    const rideRef = doc(db, 'rides', rideId);

    const unsubscribe = onSnapshot(rideRef, (snap) => {
      if (!snap.exists()) return;
      setRide(snap.data());
    });

    return () => unsubscribe();
  }, [rideId]);

  /* ================= ENTRANCE ANIMATIONS ================= */
  useEffect(() => {
    Animated.parallel([
      Animated.timing(cardSlide, { toValue: 0, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 1, duration: 500, delay: 200, useNativeDriver: true }),
    ]).start();
  }, []);

  /* ================= SUCCESS ANIMATION ================= */
  useEffect(() => {
    if (isPaid) {
      Animated.sequence([
        Animated.timing(checkScale, { toValue: 1.2, duration: 400, easing: Easing.out(Easing.back(2)), useNativeDriver: true }),
        Animated.timing(checkScale, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();

      Animated.timing(checkRotate, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [isPaid]);

  /* ================= PENDING PULSE ANIMATION ================= */
  useEffect(() => {
    if (isPending) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [isPending]);

  /* ================= SHIMMER ANIMATION ================= */
  useEffect(() => {
    if (isPending) {
      const shimmer = Animated.loop(
        Animated.timing(shimmerAnim, { toValue: 400, duration: 1500, useNativeDriver: true })
      );
      shimmer.start();
      return () => shimmer.stop();
    }
  }, [isPending]);

  /* ================= LOADING ================= */
  if (!ride) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={PRIMARY} />
          <Text style={styles.loadingText}>Loading trip details…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Includes any waiting charge once the payment function has run.
  const fare = Number(ride.fare?.finalTotal ?? ride.fareEstimate ?? 0);
  const distance = ride.route?.distanceKm || 0;
  const duration = ride.route?.durationMinutes || 0;

  const renderStars = () => {
    return [1, 2, 3, 4, 5].map((i) => (
      <TouchableOpacity key={i} onPress={() => setRating(i)} activeOpacity={0.7}>
        <Animated.View style={{ transform: [{ scale: i <= rating ? 1.1 : 1 }] }}>
          <Ionicons
            name={i <= rating ? 'star' : 'star-outline'}
            size={36}
            color={i <= rating ? '#FFD700' : '#ddd'}
            style={{ marginHorizontal: 6 }}
          />
        </Animated.View>
      </TouchableOpacity>
    ));
  };

  const getStatusConfig = () => {
    if (isPaid) return {
      icon: 'checkmark-circle',
      color: PRIMARY,
      bgColor: 'rgba(121,180,49,0.1)',
      title: 'Payment Successful',
      subtitle: 'Your card has been charged successfully',
      badgeBg: PRIMARY,
    };
    if (isFailed) return {
      icon: 'close-circle',
      color: '#DC2626',
      bgColor: 'rgba(220,38,38,0.1)',
      title: 'Payment Failed',
      subtitle: 'Payment failed. Please update your card.',
      badgeBg: '#DC2626',
    };
    return {
      icon: 'time',
      color: '#F59E0B',
      bgColor: 'rgba(245,158,11,0.1)',
      title: 'Processing Payment',
      subtitle: 'We are processing your payment…',
      badgeBg: '#F59E0B',
    };
  };

  const statusConfig = getStatusConfig();

  const spin = checkRotate.interpolate({ inputRange: [0, 1], outputRange: ['-180deg', '0deg'] });

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Trip Summary</Text>
        </View>

        {/* Success / Status Icon */}
        <Animated.View style={[styles.iconWrap, { transform: [{ scale: isPending ? pulseAnim : 1 }] }]}>
          <View style={[styles.statusIcon, { backgroundColor: statusConfig.bgColor }]}>
            {isPaid ? (
              <Animated.View style={{ transform: [{ scale: checkScale }, { rotate: spin }] }}>
                <Ionicons name="checkmark" size={48} color={statusConfig.color} />
              </Animated.View>
            ) : (
              <Ionicons name={statusConfig.icon} size={48} color={statusConfig.color} />
            )}
          </View>
        </Animated.View>

        <Text style={[styles.completedText, { color: statusConfig.color }]}>
          {isPaid ? 'Trip Completed' : statusConfig.title}
        </Text>

        {/* Fare Card */}
        <Animated.View style={[styles.card, { transform: [{ translateY: cardSlide }], opacity: cardOpacity }]}>
          <Text style={styles.fareAmount}>{currencySymbol()}{fare.toFixed(2)}</Text>

          {/* Shimmer effect for pending */}
          {isPending && (
            <View style={styles.shimmerContainer}>
              <Animated.View style={[styles.shimmer, { transform: [{ translateX: shimmerAnim }] }]} />
            </View>
          )}

          <View style={[styles.badge, { backgroundColor: statusConfig.badgeBg }]}>
            <Text style={styles.badgeText}>{statusConfig.title}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.fareRow}>
            <View style={styles.fareIconBox}>
              <Ionicons name="navigate-outline" size={16} color={SECONDARY} />
            </View>
            <Text style={styles.fareLabel}>Distance</Text>
            <Text style={styles.fareValue}>{distance.toFixed(1)} km</Text>
          </View>

          <View style={styles.fareRow}>
            <View style={styles.fareIconBox}>
              <Ionicons name="time-outline" size={16} color={SECONDARY} />
            </View>
            <Text style={styles.fareLabel}>Duration</Text>
            <Text style={styles.fareValue}>{Math.ceil(duration)} min</Text>
          </View>

          <View style={styles.fareRow}>
            <View style={styles.fareIconBox}>
              <Ionicons name="card-outline" size={16} color={SECONDARY} />
            </View>
            <Text style={styles.fareLabel}>Payment</Text>
            <Text style={styles.fareValue}>{ride?.payment?.method || 'Card'}</Text>
          </View>

          {ride.pickupLocation?.address && (
            <View style={styles.fareRow}>
              <View style={styles.fareIconBox}>
                <Ionicons name="location-outline" size={16} color={PRIMARY} />
              </View>
              <Text style={styles.fareLabel}>Pickup</Text>
              <Text style={styles.fareValue} numberOfLines={1}>
                {ride.pickupLocation.address}
              </Text>
            </View>
          )}

          {ride.dropoffLocation?.address && (
            <View style={styles.fareRow}>
              <View style={styles.fareIconBox}>
                <Ionicons name="flag-outline" size={16} color={SECONDARY} />
              </View>
              <Text style={styles.fareLabel}>Dropoff</Text>
              <Text style={styles.fareValue} numberOfLines={1}>
                {ride.dropoffLocation.address}
              </Text>
            </View>
          )}
        </Animated.View>

        {/* Payment Info */}
        <View style={styles.infoRow}>
          <View style={[styles.infoIconBox, { backgroundColor: statusConfig.bgColor }]}>
            <Ionicons name="card-outline" size={18} color={statusConfig.color} />
          </View>
          <Text style={styles.infoText}>{statusConfig.subtitle}</Text>
        </View>

        {/* Rating */}
        <View style={styles.ratingSection}>
          <Text style={styles.ratingTitle}>How was your ride?</Text>
          <Text style={styles.ratingSub}>Rate your driver</Text>
          <View style={styles.stars}>{renderStars()}</View>
        </View>

      </ScrollView>

      {/* Bottom Button */}
      <View style={styles.buttonContainer}>
        {!isPending && rideId ? (
          <EmailReceiptButton rideId={rideId} style={{ marginBottom: 10 }} />
        ) : null}
        <TouchableOpacity
          style={[styles.nextRideBtn, isPending && { opacity: 0.6 }]}
          onPress={() =>
            navigation.reset({
              index: 0,
              routes: [{ name: 'HomeScreen' }],
            })
          }
          disabled={isPending}
        >
          <Text style={styles.nextRideText}>
            {isPending ? 'Processing…' : 'Book Another Ride'}
          </Text>
          {!isPending && <Ionicons name="arrow-forward" size={18} color="#fff" />}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  loadingOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: '#888',
    fontWeight: '500',
  },
  content: {
    padding: 20,
    paddingBottom: 140,
    alignItems: 'center',
  },

  /* Header */
  header: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 24,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: DARK,
  },

  /* Status Icon */
  iconWrap: {
    marginBottom: 16,
  },
  statusIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  completedText: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 24,
  },

  /* Card */
  card: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
    overflow: 'hidden',
  },
  shimmerContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
    borderRadius: 20,
  },
  shimmer: {
    width: 100,
    height: '100%',
    backgroundColor: 'rgba(255,255,255,0.4)',
    transform: [{ skewX: '-20deg' }],
  },
  fareAmount: {
    fontSize: 40,
    fontWeight: '900',
    color: PRIMARY,
    textAlign: 'center',
  },
  badge: {
    marginTop: 12,
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 20,
  },
  badgeText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.3,
  },
  divider: {
    height: 1,
    backgroundColor: '#f0f0f0',
    marginVertical: 16,
  },
  fareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
  },
  fareIconBox: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#E3F2FD',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  fareLabel: {
    fontSize: 14,
    color: '#888',
    flex: 1,
  },
  fareValue: {
    fontSize: 14,
    fontWeight: '700',
    color: DARK,
    textAlign: 'right',
    maxWidth: '50%',
  },

  /* Info Row */
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 14,
    width: '100%',
    gap: 12,
  },
  infoIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
    flex: 1,
  },

  /* Rating */
  ratingSection: {
    marginTop: 32,
    alignItems: 'center',
  },
  ratingTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: DARK,
  },
  ratingSub: {
    fontSize: 14,
    color: '#888',
    marginTop: 4,
    marginBottom: 16,
  },
  stars: {
    flexDirection: 'row',
  },

  /* Bottom Button */
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
  nextRideBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PRIMARY,
    paddingVertical: 16,
    borderRadius: 16,
    gap: 8,
  },
  nextRideText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});