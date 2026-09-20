import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, useNavigation } from '@react-navigation/native';
import { doc, onSnapshot, updateDoc, increment, setDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { currencySymbol } from '../../../utils/appConfig';

export default function RideCompletedScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { rideId } = route.params || {};

  const [ride, setRide] = useState(null);
  const [rating, setRating] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  /* ================= FETCH RIDE ================= */
  useEffect(() => {
    if (!rideId) return;

    const rideRef = doc(db, 'rides', rideId);

    const unsubscribe = onSnapshot(rideRef, (snap) => {
      if (snap.exists()) {
        setRide(snap.data());
      }
    });

    return () => unsubscribe();
  }, [rideId]);

  /* ================= SUBMIT RATING ================= */
  const handleSubmitRating = async () => {
    if (!rating) {
      Alert.alert("Please select a rating");
      return;
    }

    try {
      setSubmitting(true);

      const rideRef = doc(db, 'rides', rideId);

      // ✅ Update nested rating fields safely
      await updateDoc(rideRef, {
        "rating.driverToRider.rating": rating,
        "rating.driverToRider.createdAt": new Date(),
      });

      // ✅ Update rider aggregate rating
      if (ride?.riderId) {
        const riderRef = doc(db, 'riders', ride.riderId);

        await setDoc(
          riderRef,
          {
            rating: {
              count: increment(1),
            },
          },
          { merge: true }
        );
      }

      Alert.alert("Success", "Rating submitted");
    } catch (err) {
      console.log("Rating Error:", err);
      Alert.alert("Error", "Failed to submit rating");
    } finally {
      setSubmitting(false);
    }
  };

  /* ================= LOADING ================= */
  if (!ride) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#79B531" />
      </SafeAreaView>
    );
  }

  /* ================= SAFE DATA ================= */
  const fare = ride.fare || {};
  const routeData = ride.route || {};

  const baseFare = fare.baseFare || 0;
  // finalTotal (fare plus any waiting charge) is written by the payment
  // function a moment after completion; the estimate shows until then.
  const finalFare = Number(fare.finalTotal ?? ride.fareEstimate ?? 0);
  const waitingFee = Number(fare.waitingCharge || 0);
  const distancePremium = fare.distanceFare || 0;

  const distanceKm = routeData.distanceKm || 0;
  const durationMinutes = routeData.durationMinutes || 0;

  /* ================= STARS ================= */
  const renderStars = () => {
    return [1, 2, 3, 4, 5].map((i) => (
      <TouchableOpacity key={i} onPress={() => setRating(i)}>
        <Ionicons
          name={i <= rating ? 'star' : 'star-outline'}
          size={32}
          color="#FFD700"
          style={{ marginHorizontal: 4 }}
        />
      </TouchableOpacity>
    ));
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Trip Summary</Text>
          <View style={{ width: 24 }} />
        </View>

        {/* Success Icon */}
        <View style={styles.successIcon}>
          <Ionicons name="checkmark" size={48} color="#fff" />
        </View>

        <Text style={styles.completedText}>Trip Completed</Text>

        {/* Fare Card */}
        <View style={styles.card}>
          <Text style={styles.fareAmount}>
            {currencySymbol()}{finalFare.toFixed(2)}
          </Text>

          <View style={styles.badge}>
            <Text style={styles.badgeText}>100% – NO COMMISSION</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Base Fare</Text>
            <Text style={styles.fareValue}>{currencySymbol()}{baseFare.toFixed(2)}</Text>
          </View>

          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Distance Premium</Text>
            <Text style={styles.fareValue}>{currencySymbol()}{distancePremium.toFixed(2)}</Text>
          </View>

          {waitingFee > 0 && (
            <View style={styles.fareRow}>
              <Text style={styles.fareLabel}>Waiting charge</Text>
              <Text style={styles.fareValue}>{currencySymbol()}{waitingFee.toFixed(2)}</Text>
            </View>
          )}

          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Distance</Text>
            <Text style={styles.fareValue}>{distanceKm} km</Text>
          </View>

          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Duration</Text>
            <Text style={styles.fareValue}>
              {Math.ceil(durationMinutes)} min
            </Text>
          </View>
        </View>

        {/* Wallet */}
        <View style={styles.walletRow}>
          <Ionicons
            name="wallet-outline"
            size={18}
            color="#6B7280"
            style={{ marginRight: 6 }}
          />
          <Text style={styles.walletText}>
            {currencySymbol()}{finalFare.toFixed(2)} added to wallet
          </Text>
        </View>

        {/* Rating */}
        <View style={styles.ratingSection}>
          <Text style={styles.ratingTitle}>Rate Rider</Text>
          <View style={styles.stars}>{renderStars()}</View>

          <TouchableOpacity
            style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
            onPress={handleSubmitRating}
            disabled={submitting}
          >
            <Text style={styles.submitText}>
              {submitting ? "Submitting..." : "Submit Rating"}
            </Text>
          </TouchableOpacity>
        </View>

      </ScrollView>

      {/* Bottom Button */}
      <TouchableOpacity
        style={styles.nextRideBtn}
        onPress={() =>
          navigation.reset({
            index: 0,
            routes: [{ name: 'DriverHome' }],
          })
        }
      >
        <Text style={styles.nextRideText}>Ready for Next Ride</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}



const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FA',
  },
  content: {
    padding: 20,
    paddingBottom: 120,
    alignItems: 'center',
  },

  header: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 30,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
  },

  successIcon: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#235594',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },

  completedText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#235594',
    marginBottom: 24,
  },

  card: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    elevation: 4,
  },

  fareAmount: {
    fontSize: 36,
    fontWeight: '800',
    color: '#79B531',
    textAlign: 'center',
  },

  badge: {
    marginTop: 12,
    alignSelf: 'center',
    backgroundColor: '#E9F5DD',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },

  badgeText: {
    color: '#79B531',
    fontWeight: '700',
    fontSize: 14,
  },

  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 16,
  },

  fareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 6,
  },

  fareLabel: {
    fontSize: 16,
    color: '#6B7280',
  },

  fareValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },

  walletText: {
    marginTop: 16,
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },

  ratingSection: {
    marginTop: 32,
    alignItems: 'center',
  },

  ratingTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
  },

  stars: {
    flexDirection: 'row',
  },

  nextRideBtn: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
    backgroundColor: '#79B531',
    paddingVertical: 16,
    borderRadius: 28,
    alignItems: 'center',
  },

  nextRideText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  walletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
  },
  
  walletText: {
    fontSize: 14,
    color: '#6B7280',
  },
  
});
