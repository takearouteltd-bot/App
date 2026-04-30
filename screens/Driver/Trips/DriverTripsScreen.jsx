import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../../../config/firebase';

import { Ionicons } from '@expo/vector-icons'
import TripCard from '../../../components/Driver/TripCard/TripCard';

const FILTERS = ['Today', 'This Week', 'This Month'];

export default function DriverTripsScreen() {
  const [activeFilter, setActiveFilter] = useState('Today');
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setLoading(false);
      return;
    }

    const ridesQuery = query(
      collection(db, 'rides'),
      where('driverId', '==', user.uid),
      orderBy('timestamps.createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      ridesQuery,
      (snapshot) => {
        const ridesData = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        console.log('Fetched rides:', ridesData.length, ridesData);
        setTrips(ridesData);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching rides:', error);
        setLoading(false);
        if (error.message.includes('requires an index')) {
          Alert.alert(
            'Database Setup Required',
            'Please create the required index in Firebase Console. Check the console for the link.'
          );
        } else {
          Alert.alert('Error', 'Failed to load trips. Please try again.');
        }
      }
    );

    return () => unsubscribe();
  }, []);

  // ✅ Fixed: Proper date parsing that handles Firestore Timestamps
  const getTripDate = (trip) => {
    const ts = trip.timestamps?.createdAt;
    if (!ts) return null;
    // Handle Firestore Timestamp
    if (ts.toDate) return ts.toDate();
    // Handle seconds/nanoseconds format
    if (ts.seconds) return new Date(ts.seconds * 1000);
    // Handle ISO string or number
    return new Date(ts);
  };

  // ✅ Fixed: Proper filter logic with correct date boundaries
  const getFilteredTrips = () => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    const startOfWeek = new Date(startOfToday);
    const day = startOfWeek.getDay(); // 0 = Sunday
    const diff = startOfWeek.getDate() - day;
    startOfWeek.setDate(diff);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    return trips.filter((trip) => {
      const tripDate = getTripDate(trip);
      if (!tripDate) return false;

      switch (activeFilter) {
        case 'Today':
          return tripDate >= startOfToday;
        case 'This Week':
          return tripDate >= startOfWeek;
        case 'This Month':
          return tripDate >= startOfMonth;
        default:
          return true;
      }
    });
  };

  const renderFilter = (item) => {
    const isActive = activeFilter === item;

    return (
      <TouchableOpacity
        style={[
          styles.filterChip,
          isActive && styles.filterChipActive,
        ]}
        onPress={() => setActiveFilter(item)}
        activeOpacity={0.7}
      >
        <Text
          style={[
            styles.filterText,
            isActive && styles.filterTextActive,
          ]}
        >
          {item}
        </Text>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#79B531" />
      </SafeAreaView>
    );
  }

  const filteredTrips = getFilteredTrips();

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <Text style={styles.headerTitle}>Your Trips</Text>

      {/* ✅ Fixed: Filters now render properly without negative margin */}
      <View style={styles.filtersWrapper}>
        <FlatList
          data={FILTERS}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item}
          renderItem={({ item }) => renderFilter(item)}
          contentContainerStyle={styles.filtersContainer}
        />
      </View>

      {/* Trips List */}
      {filteredTrips.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="car-outline" size={48} color="#9CA3AF" />
          <Text style={styles.emptyTitle}>No trips found</Text>
          <Text style={styles.emptyText}>
            You don't have any {activeFilter.toLowerCase()} trips yet.
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredTrips}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <TripCard item={item} />}
          contentContainerStyle={styles.tripsListContainer}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FA',
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '600',
    marginVertical: 16,
    color: '#235594',
    textAlign: 'center',
  },
  // ✅ Fixed: Removed negative margin that was hiding filters
  filtersWrapper: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  filtersContainer: {
    paddingVertical: 4,
    gap: 12,
  },
  filterChip: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: '#235594',
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  filterChipActive: {
    backgroundColor: '#79B531',
    borderWidth: 0,
  },
  filterText: {
    fontWeight: '700',
    fontSize: 14,
    color: '#235594',
  },
  filterTextActive: {
    color: '#FFFFFF',
  },
  tripsListContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 134,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
});