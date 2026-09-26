import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { Alert } from '../../components/ui/alert';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import {
  COLORS, TYPE, SPACE, RADIUS, SHADOW,
  ScreenHeader, Card, Field, Button, Footer,
} from '../../components/ui/kit';

const DANGER = COLORS.red;
const WARNING = COLORS.amber;

const DRIVER_CATEGORIES = [
  {
    id: 'rider_behavior',
    label: 'Rider Issue',
    icon: 'person-outline',
    iconSet: 'Ionicons',
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
    danger: true,
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

  // Only the two severities that need attention get a colour; the rest are grey.
  const severityTone = (severity) => {
    switch (severity) {
      case 'critical': return { fg: DANGER, bg: COLORS.redSoft };
      case 'high': return { fg: WARNING, bg: COLORS.amberSoft };
      default: return { fg: COLORS.muted, bg: COLORS.fill };
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
            <Ionicons name="checkmark" size={44} color={COLORS.midnight} />
          </View>
          <Text style={[TYPE.title, { textAlign: 'center' }]}>Report Submitted</Text>
          <Text style={styles.successText}>
            Thank you for reporting this issue. Our team will review it and get back to you within 24 hours.
          </Text>
          {isEmergency && (
            <Card tone="danger" style={styles.emergencyNote}>
              <Ionicons name="warning" size={20} color={DANGER} />
              <Text style={styles.emergencyNoteText}>
                This is marked as urgent. A support agent will contact you shortly.
              </Text>
            </Card>
          )}
          {isEmergency && (
            <Button
              title="Call 999 now"
              variant="danger"
              icon="call"
              style={styles.successButton}
              onPress={() => Linking.openURL('tel:999')}
            />
          )}
          <Button title="Done" style={styles.successButton} onPress={() => navigation.goBack()} />
          <Button
            title="Track it in My reports"
            variant="ghost"
            style={{ marginTop: SPACE[2] }}
            onPress={() => navigation.navigate('MyReports', { role: reporterType })}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* Header */}
          <ScreenHeader
            title="Report an Issue"
            subtitle="Tell us what happened and support will get back to you."
            onBack={() => navigation.goBack()}
          />

          {/* Emergency Banner */}
          {isEmergency && (
            <TouchableOpacity
              style={styles.emergencyBanner}
              onPress={handleEmergencyCall}
              activeOpacity={0.85}
              accessibilityRole="button"
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
              <View style={styles.tripIcon}>
                <Ionicons name="car-outline" size={18} color={COLORS.midnight} />
              </View>
              <Text style={styles.tripContextText} numberOfLines={1}>
                Reporting for trip: {trip.pickupLocation?.address?.substring(0, 30)}...
              </Text>
            </View>
          )}

          {/* Step 1: Category */}
          <Text style={styles.sectionTitle}>1. Select Category</Text>
          <View style={styles.categoriesGrid}>
            {CATEGORIES.map((cat) => {
              const on = selectedCategory?.id === cat.id;
              const iconColor = cat.danger ? DANGER : COLORS.midnight;
              return (
                <TouchableOpacity
                  key={cat.id}
                  style={[
                    styles.categoryCard,
                    on && styles.categoryCardOn,
                    on && cat.danger && styles.categoryCardDanger,
                  ]}
                  onPress={() => {
                    setSelectedCategory(cat);
                    setSelectedSubCategory(null);
                  }}
                  activeOpacity={0.85}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                >
                  <View style={[styles.categoryIcon, on && styles.categoryIconOn, cat.danger && styles.categoryIconDanger]}>
                    {cat.iconSet === 'Ionicons' ? (
                      <Ionicons name={cat.icon} size={22} color={on && !cat.danger ? COLORS.lime : iconColor} />
                    ) : (
                      <MaterialIcons name={cat.icon} size={22} color={on && !cat.danger ? COLORS.lime : iconColor} />
                    )}
                  </View>
                  <Text style={[styles.categoryLabel, cat.danger && { color: DANGER }]}>
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Step 2: Sub-Category */}
          {selectedCategory && (
            <>
              <Text style={styles.sectionTitle}>2. What happened?</Text>
              <View style={styles.subCategoriesList}>
                {selectedCategory.subCategories.map((sub) => {
                  const on = selectedSubCategory?.id === sub.id;
                  const critical = sub.severity === 'critical';
                  const tone = severityTone(sub.severity);
                  return (
                    <TouchableOpacity
                      key={sub.id}
                      style={[
                        styles.subCategoryCard,
                        critical && styles.criticalSubCategory,
                        on && styles.subCategoryCardOn,
                        on && critical && styles.subCategoryCardCritical,
                      ]}
                      onPress={() => setSelectedSubCategory(sub)}
                      activeOpacity={0.85}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                    >
                      <Text
                        style={[
                          styles.subCategoryLabel,
                          critical && { color: DANGER, fontWeight: '800' },
                        ]}
                      >
                        {sub.label}
                      </Text>
                      <View style={[styles.severityBadge, { backgroundColor: tone.bg }]}>
                        <Text style={[styles.severityText, { color: tone.fg }]}>
                          {sub.severity}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          {/* Step 3: Description */}
          {selectedSubCategory && (
            <>
              <Text style={styles.sectionTitle}>3. Describe the issue</Text>
              <Field
                multiline
                numberOfLines={5}
                placeholder="Please provide as much detail as possible..."
                value={description}
                onChangeText={setDescription}
                maxLength={500}
                hint={`${description.length}/500`}
                style={{ marginBottom: 0 }}
              />
            </>
          )}
        </ScrollView>

        {/* Submit Button */}
        {selectedSubCategory && (
          <Footer>
            <Button
              title={isEmergency ? 'Submit Urgent Report' : 'Submit Report'}
              icon={isEmergency ? 'warning' : 'send'}
              variant={isEmergency ? 'danger' : 'primary'}
              loading={submitting}
              onPress={handleSubmit}
            />
          </Footer>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.surface,
  },
  content: {
    padding: SPACE[5],
    paddingBottom: SPACE[10],
  },

  // Emergency Banner
  emergencyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DANGER,
    paddingVertical: SPACE[4],
    borderRadius: RADIUS.pill,
    gap: SPACE[3],
    marginTop: SPACE[4],
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
    backgroundColor: COLORS.white,
    paddingHorizontal: SPACE[3],
    paddingVertical: SPACE[3],
    borderRadius: RADIUS.lg,
    marginTop: SPACE[4],
    gap: SPACE[3],
    ...SHADOW.card,
  },
  tripIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripContextText: {
    ...TYPE.small,
    color: COLORS.inkSoft,
    fontWeight: '600',
    flex: 1,
  },

  // Section Title
  sectionTitle: {
    ...TYPE.heading,
    marginBottom: SPACE[3],
    marginTop: SPACE[6],
  },

  // Categories
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACE[3],
  },
  categoryCard: {
    width: '47%',
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACE[4],
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.white,
    ...SHADOW.card,
  },
  categoryCardOn: {
    borderColor: COLORS.midnight,
    backgroundColor: COLORS.limeSoft,
  },
  categoryCardDanger: {
    borderColor: DANGER,
    backgroundColor: COLORS.redSoft,
  },
  categoryIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.fill,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACE[3],
  },
  categoryIconOn: {
    backgroundColor: COLORS.midnight,
  },
  categoryIconDanger: {
    backgroundColor: COLORS.redSoft,
  },
  categoryLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.midnight,
    textAlign: 'center',
  },

  // Sub-Categories
  subCategoriesList: {
    gap: SPACE[2],
  },
  subCategoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE[3],
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACE[4],
    paddingVertical: SPACE[4],
    borderWidth: 2,
    borderColor: COLORS.white,
    ...SHADOW.card,
  },
  subCategoryCardOn: {
    borderColor: COLORS.midnight,
    backgroundColor: COLORS.limeSoft,
  },
  criticalSubCategory: {
    backgroundColor: COLORS.redSoft,
    borderColor: COLORS.redSoft,
  },
  subCategoryCardCritical: {
    borderColor: DANGER,
    backgroundColor: COLORS.redSoft,
  },
  subCategoryLabel: {
    ...TYPE.callout,
    flex: 1,
  },
  severityBadge: {
    paddingHorizontal: SPACE[3],
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
  },
  severityText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },

  // Success Screen
  successContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACE[8],
  },
  successIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: COLORS.lime,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACE[6],
  },
  successText: {
    ...TYPE.body,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: SPACE[3],
    marginBottom: SPACE[6],
  },
  successButton: {
    alignSelf: 'stretch',
    marginTop: SPACE[3],
  },
  emergencyNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE[3],
    alignSelf: 'stretch',
    marginBottom: SPACE[3],
  },
  emergencyNoteText: {
    ...TYPE.small,
    color: DANGER,
    fontWeight: '600',
    flex: 1,
  },
});
