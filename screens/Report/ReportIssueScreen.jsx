import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { Alert } from '../../components/ui/alert';
import { Ionicons, MaterialIcons, FontAwesome5 } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { COLORS } from '../../components/ui/kit';

const PRIMARY = COLORS.primary;
const SECONDARY = COLORS.blue;
const DANGER = COLORS.red;
const WARNING = COLORS.amber;

const DRIVER_CATEGORIES = [
  {
    id: 'rider_behavior',
    label: 'Rider Issue',
    icon: 'person-outline',
    iconSet: 'Ionicons',
    color: SECONDARY,
    subCategories: [
      { id: 'rude_behavior', label: 'Rude Behavior', severity: 'medium' },
      { id: 'wrong_pickup', label: 'Wrong Pickup Location', severity: 'low' },
      { id: 'no_show', label: 'Rider No-Show', severity: 'low' },
      { id: 'damaged_vehicle', label: 'Damaged Vehicle', severity: 'high' },
      { id: 'too_many_passengers', label: 'Too Many Passengers', severity: 'medium' },
      { id: 'unaccompanied_minor', label: 'Unaccompanied Minor', severity: 'high' },
    ],
  },
  {
    id: 'payment_dispute',
    label: 'Payment Issue',
    icon: 'cash-outline',
    iconSet: 'Ionicons',
    color: PRIMARY,
    subCategories: [
      { id: 'fare_dispute', label: 'Fare Dispute', severity: 'medium' },
      { id: 'missing_earnings', label: 'Missing Earnings', severity: 'high' },
      { id: 'wrong_charge', label: 'Wrong Charge', severity: 'medium' },
      { id: 'payment_failed', label: 'Payment Failed', severity: 'medium' },
      { id: 'tip_issue', label: 'Tip Issue', severity: 'low' },
    ],
  },
  {
    id: 'app_bug',
    label: 'App / Technical',
    icon: 'bug-report',
    iconSet: 'MaterialIcons',
    color: COLORS.muted,
    subCategories: [
      { id: 'gps_bug', label: 'GPS / Navigation Wrong', severity: 'medium' },
      { id: 'app_crash', label: 'App Crashed', severity: 'medium' },
      { id: 'map_error', label: 'Map Not Loading', severity: 'low' },
      { id: 'notification_issue', label: 'Not Getting Notifications', severity: 'low' },
      { id: 'account_issue', label: 'Account / Login Issue', severity: 'medium' },
    ],
  },
  {
    id: 'safety',
    label: 'Safety',
    icon: 'shield-alert',
    iconSet: 'MaterialIcons',
    color: DANGER,
    subCategories: [
      { id: 'emergency', label: '🚨 EMERGENCY', severity: 'critical' },
      { id: 'accident', label: 'Accident', severity: 'critical' },
      { id: 'feeling_unsafe', label: 'Feeling Unsafe', severity: 'high' },
      { id: 'harassment', label: 'Harassment', severity: 'critical' },
      { id: 'theft', label: 'Theft / Robbery', severity: 'critical' },
    ],
  },
];

// Passengers report about their driver, not about a rider.
const DRIVER_ISSUE = {
  id: 'driver_behavior',
  label: 'Driver Issue',
  icon: 'person-outline',
  iconSet: 'Ionicons',
  color: SECONDARY,
  subCategories: [
    { id: 'rude_behavior', label: 'Rude Behaviour', severity: 'medium' },
    { id: 'unsafe_driving', label: 'Unsafe Driving', severity: 'high' },
    { id: 'wrong_route', label: 'Took a Long Route', severity: 'low' },
    { id: 'driver_no_show', label: 'Driver Did Not Arrive', severity: 'low' },
    { id: 'vehicle_mismatch', label: 'Car or Driver Did Not Match', severity: 'high' },
    { id: 'dont_match_again', label: "Don't Match Me With This Driver", severity: 'low' },
  ],
};

// Lost & Found sits inside support tickets so replies come back to My Reports.
const LOST_FOUND = {
  id: 'lost_found',
  label: 'Lost & Found',
  icon: 'briefcase-outline',
  iconSet: 'Ionicons',
  color: '#8B5CF6',
  subCategories: [
    { id: 'lost_item', label: 'I Left Something Behind', severity: 'medium' },
    { id: 'found_item', label: 'I Found an Item', severity: 'medium' },
  ],
};

export default function ReportIssueScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { trip, reporterType = 'driver' } = route.params || {};
  const CATEGORIES = reporterType === 'rider'
    ? [DRIVER_ISSUE, ...DRIVER_CATEGORIES.slice(1), LOST_FOUND]
    : [...DRIVER_CATEGORIES, LOST_FOUND];

  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedSubCategory, setSelectedSubCategory] = useState(null);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const auth = getAuth();
  const db = getFirestore();
  const user = auth.currentUser;

  const isEmergency = selectedSubCategory?.severity === 'critical';

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return DANGER;
      case 'high': return WARNING;
      case 'medium': return SECONDARY;
      default: return COLORS.muted;
    }
  };

  const handleSubmit = async () => {
    if (!selectedCategory || !selectedSubCategory) {
      Alert.alert('Missing Info', 'Please select a category and sub-category.');
      return;
    }

    if (!description.trim()) {
      Alert.alert('Missing Description', 'Please describe the issue.');
      return;
    }

    setSubmitting(true);

    try {
      const reportData = {
        reporterId: user?.uid || 'anonymous',
        reporterType: reporterType,
        reporterEmail: user?.email || '',

        // Ride info (if applicable)
        rideId: trip?.id || null,
        otherPartyId: reporterType === 'driver' ? trip?.riderId : trip?.driverId,

        // Report content
        category: selectedCategory.id,
        subCategory: selectedSubCategory.id,
        categoryLabel: selectedCategory.label,
        subCategoryLabel: selectedSubCategory.label,
        description: description.trim(),
        severity: selectedSubCategory.severity,

        // Status
        status: 'open',
        priority: isEmergency ? 'urgent' : 'normal',

        // Timestamps
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        resolvedAt: null,

        // Admin
        assignedTo: null,
        adminNotes: '',

        // Trip snapshot (for context)
        tripSnapshot: trip
          ? {
              pickup: trip.pickupLocation?.address || '',
              dropoff: trip.dropoffLocation?.address || '',
              fare: trip.fare?.total || 0,
              completedAt: trip.completedAt || null,
            }
          : null,
      };

      await addDoc(collection(db, 'reports'), reportData);
      setSubmitted(true);
    } catch (error) {
      console.error('Error submitting report:', error);
      Alert.alert('Error', 'Failed to submit report. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Opens the phone's dialler on 999. It must never claim to have called
  // anyone: the person has to press dial themselves, and if the handset
  // cannot place the call we say so rather than leaving them believing help
  // is on the way.
  const handleEmergencyCall = () => {
    Alert.alert(
      'Emergency',
      'Are you in immediate danger? This opens your phone on 999.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Call 999',
          style: 'destructive',
          onPress: () => {
            Linking.openURL('tel:999').catch(() =>
              Alert.alert(
                'Could not open the dialler',
                'Please dial 999 from your phone directly.'
              )
            );
          },
        },
      ]
    );
  };

  if (submitted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.successContainer}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={64} color={PRIMARY} />
          </View>
          <Text style={styles.successTitle}>Report Submitted</Text>
          <Text style={styles.successText}>
            Thank you for reporting this issue. Our team will review it and get back to you within 24 hours.
          </Text>
          {isEmergency && (
            <View style={styles.emergencyNote}>
              <Ionicons name="warning" size={20} color={DANGER} />
              <Text style={styles.emergencyNoteText}>
                This is marked as urgent. A support agent will contact you shortly.
              </Text>
            </View>
          )}
          {isEmergency && (
            <TouchableOpacity
              style={[styles.doneButton, { backgroundColor: DANGER, marginBottom: 12 }]}
              onPress={() => Linking.openURL('tel:999')}
            >
              <Text style={styles.doneButtonText}>Call 999 now</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.doneButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ marginTop: 14, padding: 8 }}
            onPress={() => navigation.navigate('MyReports', { role: reporterType })}
          >
            <Text style={{ color: SECONDARY, fontWeight: '700', fontSize: 15 }}>Track it in My reports</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={26} color={SECONDARY} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Report an Issue</Text>
        <View style={{ width: 26 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.content}>
          {/* Emergency Banner */}
          {isEmergency && (
            <TouchableOpacity
              style={styles.emergencyBanner}
              onPress={handleEmergencyCall}
            >
              <Ionicons name="call" size={20} color={COLORS.white} />
              <Text style={styles.emergencyBannerText}>
                EMERGENCY — Tap to Call 999
              </Text>
            </TouchableOpacity>
          )}

          {/* Trip Context */}
          {trip && (
            <View style={styles.tripContext}>
              <Ionicons name="car-outline" size={18} color={SECONDARY} />
              <Text style={styles.tripContextText}>
                Reporting for trip: {trip.pickupLocation?.address?.substring(0, 30)}...
              </Text>
            </View>
          )}

          {/* Step 1: Category */}
          <Text style={styles.sectionTitle}>1. Select Category</Text>
          <View style={styles.categoriesGrid}>
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.categoryCard,
                  selectedCategory?.id === cat.id && {
                    borderColor: cat.color,
                    borderWidth: 2,
                    backgroundColor: cat.color + '10',
                  },
                ]}
                onPress={() => {
                  setSelectedCategory(cat);
                  setSelectedSubCategory(null);
                }}
              >
                <View style={[styles.categoryIcon, { backgroundColor: cat.color + '15' }]}>
                  {cat.iconSet === 'Ionicons' ? (
                    <Ionicons name={cat.icon} size={22} color={cat.color} />
                  ) : (
                    <MaterialIcons name={cat.icon} size={22} color={cat.color} />
                  )}
                </View>
                <Text style={[styles.categoryLabel, { color: cat.color }]}>
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Step 2: Sub-Category */}
          {selectedCategory && (
            <>
              <Text style={styles.sectionTitle}>2. What happened?</Text>
              <View style={styles.subCategoriesList}>
                {selectedCategory.subCategories.map((sub) => (
                  <TouchableOpacity
                    key={sub.id}
                    style={[
                      styles.subCategoryCard,
                      selectedSubCategory?.id === sub.id && {
                        borderColor: getSeverityColor(sub.severity),
                        borderWidth: 2,
                        backgroundColor: getSeverityColor(sub.severity) + '08',
                      },
                      sub.severity === 'critical' && styles.criticalSubCategory,
                    ]}
                    onPress={() => setSelectedSubCategory(sub)}
                  >
                    <Text
                      style={[
                        styles.subCategoryLabel,
                        sub.severity === 'critical' && { color: DANGER, fontWeight: '800' },
                      ]}
                    >
                      {sub.label}
                    </Text>
                    <View
                      style={[
                        styles.severityBadge,
                        { backgroundColor: getSeverityColor(sub.severity) + '15' },
                      ]}
                    >
                      <Text
                        style={[
                          styles.severityText,
                          { color: getSeverityColor(sub.severity) },
                        ]}
                      >
                        {sub.severity}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {/* Step 3: Description */}
          {selectedSubCategory && (
            <>
              <Text style={styles.sectionTitle}>3. Describe the issue</Text>
              <TextInput
                style={styles.descriptionInput}
                multiline
                numberOfLines={5}
                placeholder="Please provide as much detail as possible..."
                placeholderTextColor={COLORS.faint}
                value={description}
                onChangeText={setDescription}
                textAlignVertical="top"
              />
              <Text style={styles.charCount}>{description.length}/500</Text>
            </>
          )}

          {/* Submit Button */}
          {selectedSubCategory && (
            <TouchableOpacity
              style={[
                styles.submitButton,
                isEmergency && { backgroundColor: DANGER },
                submitting && { opacity: 0.6 },
              ]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <>
                  <Ionicons
                    name={isEmergency ? 'warning' : 'send'}
                    size={18}
                    color={COLORS.white}
                  />
                  <Text style={styles.submitButtonText}>
                    {isEmergency ? 'Submit Urgent Report' : 'Submit Report'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: SECONDARY,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },

  // Emergency Banner
  emergencyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DANGER,
    paddingVertical: 14,
    borderRadius: 14,
    gap: 10,
    marginBottom: 16,
  },
  emergencyBannerText: {
    color: COLORS.white,
    fontWeight: '800',
    fontSize: 15,
  },

  // Trip Context
  tripContext: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 16,
    gap: 10,
  },
  tripContextText: {
    fontSize: 13,
    color: COLORS.muted,
    fontWeight: '500',
    flex: 1,
  },

  // Section Title
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.ink,
    marginBottom: 12,
    marginTop: 8,
  },

  // Categories
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 8,
  },
  categoryCard: {
    width: '47%',
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#E5E5EA',
  },
  categoryIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  categoryLabel: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },

  // Sub-Categories
  subCategoriesList: {
    gap: 8,
    marginBottom: 8,
  },
  subCategoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: '#E5E5EA',
  },
  criticalSubCategory: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  subCategoryLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.ink,
  },
  severityBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  severityText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },

  // Description
  descriptionInput: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    fontSize: 15,
    color: COLORS.ink,
    minHeight: 120,
    borderWidth: 1.5,
    borderColor: '#E5E5EA',
  },
  charCount: {
    fontSize: 12,
    color: COLORS.muted,
    textAlign: 'right',
    marginTop: 6,
    fontWeight: '500',
  },

  // Submit
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PRIMARY,
    paddingVertical: 16,
    borderRadius: 16,
    gap: 8,
    marginTop: 20,
  },
  submitButtonText: {
    color: COLORS.white,
    fontWeight: '800',
    fontSize: 16,
  },

  // Success Screen
  successContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  successIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: PRIMARY + '15',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.ink,
    marginBottom: 12,
  },
  successText: {
    fontSize: 15,
    color: COLORS.muted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  emergencyNote: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    padding: 16,
    borderRadius: 12,
    gap: 10,
    marginBottom: 24,
  },
  emergencyNoteText: {
    fontSize: 13,
    color: DANGER,
    fontWeight: '600',
    flex: 1,
    lineHeight: 18,
  },
  doneButton: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 16,
  },
  doneButtonText: {
    color: COLORS.white,
    fontWeight: '800',
    fontSize: 16,
  },
});