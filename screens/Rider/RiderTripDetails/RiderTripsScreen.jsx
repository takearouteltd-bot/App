import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  FlatList,
} from 'react-native';
import RiderTripCard from '../../../components/Rider/RiderTripCard';




const FILTERS = ['Today', 'This Week', 'This Month'];

const tripsData = [
  {
    id: '1',
    dateLabel: 'TODAY',
    time: '09:15 AM',
    status: 'COMPLETED',
    pickup: 'Baker Street, London',
    destination: 'Oxford Circus, London',
    fare: 12.5,
  },
  {
    id: '2',
    dateLabel: 'TODAY',
    time: '11:40 AM',
    status: 'CANCELLED',
    pickup: 'Canary Wharf',
    destination: 'London Bridge',
    fare: 0,
  },
];

export default function RiderTripsScreen() {
  const [activeFilter, setActiveFilter] = useState('Today');

  const renderFilter = (item) => {
    const isActive = activeFilter === item;

    return (
      <TouchableOpacity
        style={[
          styles.filterChip,
          {
            backgroundColor: isActive ? '#79B531' : '#FFFFFF',
            borderWidth: isActive ? 0 : 1.5,
            borderColor: '#235594',
          },
        ]}
        onPress={() => setActiveFilter(item)}
      >
        <Text
          style={[
            styles.filterText,
            { color: isActive ? '#FFFFFF' : '#235594' },
          ]}
        >
          {item}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <Text style={styles.headerTitle}>Your Trips</Text>

      {/* Filters */}
      <FlatList
        data={FILTERS}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item}
        renderItem={({ item }) => renderFilter(item)}
        contentContainerStyle={styles.filtersContainer}
      />

      {/* Trips List */}
      <FlatList
        data={tripsData}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <RiderTripCard item={item} />}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 134 }}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FA',
    paddingHorizontal: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '600',
    marginVertical: 16,
    color: '#235594',
    textAlign: 'center',
  },
  filtersContainer: {
    marginBottom: -120,
    justifyContent: 'space-between',
    width: '100%',
    alignItems: 'center',
    height: 50,
    padding: 10
  },
  filterChip: {
    paddingHorizontal: 28,
    paddingVertical: 10,
    borderRadius: 22,
    height: 38,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    marginLeft: 10
  },
  filterText: {
    fontWeight: '700',
    fontSize: 14,
  },
});
