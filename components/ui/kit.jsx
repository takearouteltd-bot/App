// components/ui/kit.jsx
// Shared building blocks for account screens (reports, documents, safety,
// personal details). One set of colours, sizes and spacing so new screens
// look like one product instead of each inventing its own.
import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export const COLORS = {
  green: '#79B531',       // brand action colour
  greenSoft: '#EEF6E4',
  navy: '#17375E',        // headings and primary text
  blue: '#235594',        // brand secondary, links and icons
  blueSoft: '#E9EFF8',
  ink: '#1F2937',
  muted: '#6B7280',
  line: '#E5E7EB',
  surface: '#F5F7FA',
  white: '#FFFFFF',
  amber: '#B45309',
  amberSoft: '#FEF3C7',
  red: '#B91C1C',
  redSoft: '#FEE2E2',
};

export const TYPE = {
  title: { fontSize: 24, fontWeight: '800', color: COLORS.navy, letterSpacing: -0.3 },
  heading: { fontSize: 17, fontWeight: '700', color: COLORS.navy },
  body: { fontSize: 15, lineHeight: 22, color: COLORS.ink },
  small: { fontSize: 13, lineHeight: 18, color: COLORS.muted },
};

/* Header with back arrow, a large title and an optional line under it. */
export function ScreenHeader({ title, subtitle, onBack, right }) {
  return (
    <View style={s.header}>
      <View style={s.headerRow}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} style={s.backBtn} accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={24} color={COLORS.navy} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
        <View style={{ flex: 1 }} />
        {right || null}
      </View>
      <Text style={TYPE.title}>{title}</Text>
      {subtitle ? <Text style={[TYPE.small, { marginTop: 4 }]}>{subtitle}</Text> : null}
    </View>
  );
}

export function Section({ title, action, children, style }) {
  return (
    <View style={[{ marginTop: 24 }, style]}>
      {title ? (
        <View style={s.sectionHead}>
          <Text style={TYPE.heading}>{title}</Text>
          {action || null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Card({ children, style, onPress, tone }) {
  const toneStyle =
    tone === 'warning' ? { backgroundColor: COLORS.amberSoft, borderColor: '#FCD34D' }
    : tone === 'danger' ? { backgroundColor: COLORS.redSoft, borderColor: '#FCA5A5' }
    : tone === 'success' ? { backgroundColor: COLORS.greenSoft, borderColor: '#C7E3A5' }
    : null;
  const body = <View style={[s.card, toneStyle, style]}>{children}</View>;
  if (!onPress) return body;
  return (
    <TouchableOpacity activeOpacity={0.8} onPress={onPress}>
      {body}
    </TouchableOpacity>
  );
}

/* A tappable row: icon, title, detail, chevron or custom right side. */
export function ListRow({ icon, iconColor = COLORS.blue, title, detail, right, onPress, last }) {
  const Wrap = onPress ? TouchableOpacity : View;
  return (
    <Wrap onPress={onPress} activeOpacity={0.7} style={[s.row, !last && s.rowLine]}>
      {icon ? (
        <View style={[s.rowIcon, { backgroundColor: iconColor + '14' }]}>
          <Ionicons name={icon} size={20} color={iconColor} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle}>{title}</Text>
        {detail ? <Text style={[TYPE.small, { marginTop: 2 }]}>{detail}</Text> : null}
      </View>
      {right !== undefined ? right : onPress ? (
        <Ionicons name="chevron-forward" size={18} color="#C0C4CC" />
      ) : null}
    </Wrap>
  );
}

const PILL = {
  open: { label: 'Received', bg: COLORS.blueSoft, fg: COLORS.blue },
  in_review: { label: 'Investigating', bg: COLORS.amberSoft, fg: COLORS.amber },
  resolved: { label: 'Closed', bg: COLORS.greenSoft, fg: '#3F6F12' },
  pending: { label: 'Waiting for approval', bg: COLORS.amberSoft, fg: COLORS.amber },
  approved: { label: 'Approved', bg: COLORS.greenSoft, fg: '#3F6F12' },
  rejected: { label: 'Not approved', bg: COLORS.redSoft, fg: COLORS.red },
  expired: { label: 'Expired', bg: COLORS.redSoft, fg: COLORS.red },
  expiring: { label: 'Expiring soon', bg: COLORS.amberSoft, fg: COLORS.amber },
  valid: { label: 'Valid', bg: COLORS.greenSoft, fg: '#3F6F12' },
  missing: { label: 'No date set', bg: COLORS.surface, fg: COLORS.muted },
};

export function StatusPill({ status, label }) {
  const p = PILL[status] || { label: label || status, bg: COLORS.surface, fg: COLORS.muted };
  return (
    <View style={[s.pill, { backgroundColor: p.bg }]}>
      <Text style={[s.pillText, { color: p.fg }]}>{label || p.label}</Text>
    </View>
  );
}

export function Button({ title, onPress, variant = 'primary', loading, disabled, icon, style }) {
  const v =
    variant === 'secondary' ? { bg: COLORS.white, fg: COLORS.navy, border: COLORS.line }
    : variant === 'danger' ? { bg: COLORS.red, fg: COLORS.white, border: COLORS.red }
    : variant === 'ghost' ? { bg: 'transparent', fg: COLORS.blue, border: 'transparent' }
    : { bg: COLORS.green, fg: COLORS.white, border: COLORS.green };
  const off = disabled || loading;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={off}
      activeOpacity={0.85}
      style={[s.btn, { backgroundColor: v.bg, borderColor: v.border, opacity: off ? 0.55 : 1 }, style]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={v.fg} style={{ marginRight: 8 }} /> : null}
          <Text style={[s.btnText, { color: v.fg }]}>{title}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

export function Field({ label, hint, error, style, ...inputProps }) {
  return (
    <View style={[{ marginBottom: 16 }, style]}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor="#9CA3AF"
        style={[s.input, error && { borderColor: COLORS.red }, inputProps.multiline && { minHeight: 96, textAlignVertical: 'top' }]}
        {...inputProps}
      />
      {error ? <Text style={[TYPE.small, { color: COLORS.red, marginTop: 4 }]}>{error}</Text>
        : hint ? <Text style={[TYPE.small, { marginTop: 4 }]}>{hint}</Text> : null}
    </View>
  );
}

export function EmptyState({ icon = 'albums-outline', title, body, action }) {
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}>
        <Ionicons name={icon} size={28} color={COLORS.blue} />
      </View>
      <Text style={[TYPE.heading, { textAlign: 'center' }]}>{title}</Text>
      {body ? <Text style={[TYPE.small, { textAlign: 'center', marginTop: 6, maxWidth: 280 }]}>{body}</Text> : null}
      {action ? <View style={{ marginTop: 18, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

export function Loading() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <ActivityIndicator color={COLORS.green} size="large" />
    </View>
  );
}

export function formatWhen(ts) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
  if (!d || isNaN(d)) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

const s = StyleSheet.create({
  header: { paddingTop: 8, paddingBottom: 4 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  backBtn: { width: 40, height: 40, marginLeft: -8, alignItems: 'center', justifyContent: 'center' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: 16,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 12 },
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.line },
  rowIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '600', color: COLORS.ink },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, alignSelf: 'flex-start' },
  pillText: { fontSize: 12, fontWeight: '700' },
  btn: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  btnText: { fontSize: 16, fontWeight: '700' },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: COLORS.navy, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.ink,
    backgroundColor: COLORS.white,
  },
  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 20, backgroundColor: COLORS.blueSoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
});
