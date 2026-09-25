// components/onboarding/kit.jsx
// The frame and controls every driver sign-up step is built from, so the five
// steps read as one journey: the same header, the same progress, the same
// place for the button that moves you on.
//
// Built from the app's design system (components/ui/kit). Navy frames the
// step, green is only ever the way forward.
import React from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Button, COLORS, RADIUS, SPACE, TYPE } from '../ui/kit';
import { isPdfUpload } from '../../helpers/uploadPicker';
import { confirmLeaveSignup } from '../../utils/leaveSignup';

/* The journey, in order. `route` is the screen name in DriverOnboardingStack. */
export const DRIVER_STEPS = [
  { route: 'PersonalInformation', label: 'About you', icon: 'person' },
  { route: 'IdentityVerification', label: 'Identity', icon: 'id-card' },
  { route: 'VehicleDetails', label: 'Vehicle', icon: 'car-sport' },
  { route: 'PayoutDetails', label: 'Payouts', icon: 'wallet' },
  { route: 'FinalReview', label: 'Review', icon: 'checkmark-done' },
];

/* ------------------------------------------------------------ frame */

/**
 * One step of driver sign-up.
 *
 * step      1-based position in DRIVER_STEPS; drives the header and progress
 * title     the question this step asks
 * subtitle  one line on why we need it
 * action    { title, onPress, loading, disabled } for the button at the bottom
 */
export function OnboardingFrame({ step, title, subtitle, action, children, footerNote }) {
  const navigation = useNavigation();
  const current = DRIVER_STEPS[step - 1];

  // Back goes to the previous step; from the first step it offers to leave
  // sign-up, since there is nothing behind it.
  const onBack = () => (navigation.canGoBack() ? navigation.goBack() : confirmLeaveSignup());

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.navyDeep} />
      <SafeAreaView style={styles.headerSafe}>
        <View style={styles.header}>
          {/* The step's icon, large and faint, gives each page its own face. */}
          <Ionicons name={current.icon} size={150} color={COLORS.white} style={styles.watermark} />

          <View style={styles.topRow}>
            <TouchableOpacity
              onPress={onBack}
              style={styles.back}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={step === 1 ? 'Leave sign-up' : 'Previous step'}
            >
              <Ionicons name="chevron-back" size={22} color={COLORS.white} />
            </TouchableOpacity>
            <View style={styles.stepPill}>
              <Text style={styles.stepPillText}>
                Step {step} of {DRIVER_STEPS.length}
              </Text>
            </View>
            <View style={{ width: 40 }} />
          </View>

          <Progress step={step} />

          <Text style={styles.eyebrow}>{current.label.toUpperCase()}</Text>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>

        {action ? (
          <SafeAreaView style={styles.footerSafe}>
            <View style={styles.footer}>
              {footerNote ? <Text style={styles.footerNote}>{footerNote}</Text> : null}
              <Button
                title={action.title}
                onPress={action.onPress}
                loading={action.loading}
                disabled={action.disabled}
                icon={action.icon}
              />
            </View>
          </SafeAreaView>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

/* Five segments: done ones solid green, this one green, the rest faint. */
function Progress({ step }) {
  return (
    <View style={styles.progress} accessibilityLabel={`Step ${step} of ${DRIVER_STEPS.length}`}>
      {DRIVER_STEPS.map((s, i) => (
        <View
          key={s.route}
          style={[
            styles.segment,
            i < step - 1 && styles.segmentDone,
            i === step - 1 && styles.segmentCurrent,
          ]}
        />
      ))}
    </View>
  );
}

/* ---------------------------------------------------------- sections */

export function StepSection({ title, hint, children, style }) {
  return (
    <View style={[styles.section, style]}>
      {title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

/* ------------------------------------------------------------ upload */

/**
 * A document to upload. Shows a thumbnail once there is one, a spinner while
 * it goes up, and tapping it again replaces it.
 */
export function UploadTile({ title, subtitle, icon, url, uploading, onPress, optional }) {
  const done = !!url;
  const isPdf = done && isPdfUpload(url);

  return (
    <TouchableOpacity
      style={[styles.tile, done && styles.tileDone]}
      onPress={onPress}
      disabled={uploading}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`${title}${done ? ', uploaded. Tap to replace' : ', not uploaded yet'}`}
    >
      <View style={[styles.tileThumb, done && styles.tileThumbDone]}>
        {uploading ? (
          <ActivityIndicator color={COLORS.green} />
        ) : done && !isPdf ? (
          <Image source={{ uri: url }} style={styles.tileImage} />
        ) : (
          <MaterialCommunityIcons
            name={isPdf ? 'file-pdf-box' : icon}
            size={26}
            color={done ? COLORS.success : COLORS.navy}
          />
        )}
      </View>

      <View style={{ flex: 1 }}>
        <View style={styles.tileTitleRow}>
          <Text style={styles.tileTitle}>{title}</Text>
          {optional ? <Text style={styles.optional}>Optional</Text> : null}
        </View>
        <Text style={[styles.tileSub, done && { color: COLORS.success }]}>
          {uploading ? 'Uploading…' : done ? 'Uploaded · tap to replace' : subtitle}
        </Text>
      </View>

      <Ionicons
        name={done ? 'checkmark-circle' : 'cloud-upload-outline'}
        size={24}
        color={done ? COLORS.green : COLORS.faint}
      />
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------ choice */

export function ChoiceCard({ title, detail, meta, icon, selected, onPress, style }) {
  return (
    <TouchableOpacity
      style={[styles.choice, selected && styles.choiceSelected, style]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="radio"
      accessibilityState={{ selected: !!selected }}
    >
      {icon ? (
        <View style={[styles.choiceIcon, selected && styles.choiceIconSelected]}>
          <MaterialCommunityIcons name={icon} size={22} color={selected ? COLORS.white : COLORS.navy} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={styles.choiceTitle}>{title}</Text>
        {detail ? <Text style={styles.choiceDetail}>{detail}</Text> : null}
      </View>
      {meta ? <Text style={styles.choiceMeta}>{meta}</Text> : null}
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={22}
        color={selected ? COLORS.green : COLORS.lineStrong}
      />
    </TouchableOpacity>
  );
}

/* ----------------------------------------------------------- consent */

/**
 * A tick box with its sentence. `link` makes part of the sentence open a
 * document without toggling the box.
 */
export function ConsentRow({ checked, onToggle, text, link }) {
  return (
    <TouchableOpacity
      style={styles.consent}
      onPress={onToggle}
      activeOpacity={0.8}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: !!checked }}
    >
      <View style={[styles.box, checked && styles.boxOn]}>
        {checked ? <Ionicons name="checkmark" size={16} color={COLORS.white} /> : null}
      </View>
      <Text style={styles.consentText}>
        {text}
        {link ? (
          <Text style={styles.consentLink} onPress={link.onPress} suppressHighlighting>
            {link.label}
          </Text>
        ) : null}
      </Text>
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------ styles */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },

  headerSafe: { backgroundColor: COLORS.navyDeep },
  header: {
    backgroundColor: COLORS.navyDeep,
    paddingHorizontal: SPACE[5],
    paddingTop: SPACE[3],
    paddingBottom: SPACE[6],
    overflow: 'hidden',
  },
  watermark: { position: 'absolute', right: -24, bottom: -30, opacity: 0.06 },

  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  stepPill: {
    paddingHorizontal: SPACE[3], height: 28, borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
  },
  stepPillText: { fontSize: 12, fontWeight: '700', color: COLORS.white, letterSpacing: 0.3 },

  progress: { flexDirection: 'row', gap: 6, marginTop: SPACE[5] },
  segment: { flex: 1, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.16)' },
  segmentDone: { backgroundColor: COLORS.greenDeep },
  segmentCurrent: { backgroundColor: COLORS.green },

  eyebrow: { ...TYPE.label, color: COLORS.green, marginTop: SPACE[5] },
  title: { ...TYPE.title, color: COLORS.white, marginTop: SPACE[1] },
  subtitle: { ...TYPE.body, color: COLORS.onDark, marginTop: SPACE[2] },

  body: { flex: 1 },
  bodyContent: { padding: SPACE[5], paddingBottom: SPACE[8] },

  footerSafe: { backgroundColor: COLORS.white },
  footer: {
    paddingHorizontal: SPACE[5],
    paddingTop: SPACE[3],
    paddingBottom: SPACE[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.line,
    backgroundColor: COLORS.white,
  },
  footerNote: { ...TYPE.caption, textAlign: 'center', marginBottom: SPACE[2] },

  section: { marginBottom: SPACE[6] },
  sectionTitle: { ...TYPE.subhead, color: COLORS.navy, marginBottom: SPACE[1] },
  sectionHint: { ...TYPE.small, marginBottom: SPACE[3] },

  tile: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[3],
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    borderWidth: 1.5, borderColor: COLORS.line, borderStyle: 'dashed',
    padding: SPACE[3],
    marginBottom: SPACE[3],
  },
  tileDone: { borderStyle: 'solid', borderColor: '#C7E3A5' },
  tileThumb: {
    width: 54, height: 54, borderRadius: RADIUS.md,
    backgroundColor: COLORS.blueSoft,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  tileThumbDone: { backgroundColor: COLORS.greenSoft },
  tileImage: { width: 54, height: 54 },
  tileTitleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE[2] },
  tileTitle: { ...TYPE.callout, color: COLORS.navy },
  tileSub: { ...TYPE.small, marginTop: 2 },
  optional: {
    fontSize: 11, fontWeight: '700', color: COLORS.muted,
    backgroundColor: COLORS.surface, paddingHorizontal: 6, paddingVertical: 1,
    borderRadius: RADIUS.pill, overflow: 'hidden',
  },

  choice: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[3],
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    borderWidth: 1.5, borderColor: COLORS.line,
    padding: SPACE[3],
    marginBottom: SPACE[3],
  },
  choiceSelected: { borderColor: COLORS.green, backgroundColor: COLORS.greenSoft },
  choiceIcon: {
    width: 44, height: 44, borderRadius: RADIUS.md,
    backgroundColor: COLORS.blueSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  choiceIconSelected: { backgroundColor: COLORS.green },
  choiceTitle: { ...TYPE.callout, color: COLORS.navy },
  choiceDetail: { ...TYPE.small, marginTop: 2 },
  choiceMeta: { ...TYPE.caption, color: COLORS.muted, fontWeight: '600' },

  consent: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE[3], paddingVertical: SPACE[2] },
  box: {
    width: 24, height: 24, borderRadius: 7,
    borderWidth: 2, borderColor: COLORS.lineStrong,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 1,
  },
  boxOn: { backgroundColor: COLORS.green, borderColor: COLORS.green },
  consentText: { ...TYPE.body, flex: 1, color: COLORS.inkSoft },
  consentLink: { color: COLORS.blue, fontWeight: '700', textDecorationLine: 'underline' },
});
