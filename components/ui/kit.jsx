// components/ui/kit.jsx
// The TakeARoute design system. Every screen builds from these tokens and
// primitives, so the app reads as one product rather than forty screens that
// each invented their own colours and spacing.
//
// The rules this file encodes:
//
//   Midnight and lime. Midnight is the brand's weight: headings, the main
//   button, map routes. Lime is the spark, taken from the arrow in the logo:
//   the live dot, the pickup pin, what is selected, the words on the main
//   button. Lime is never text on white (it cannot be read there); use
//   limeInk for that. Amber asks for attention, red stops you. Anything that
//   is not carrying meaning is grey.
//
//   Soft cards. Cards are white on a pale grey page and lift with a faint
//   shadow rather than an outline. Sheets and map buttons float higher.
//
//   One scheme. The app is light whatever the phone is set to (app.json and
//   plugins/withLightOnly.js), so every colour here can be relied on.
//
//   One rhythm. Spacing is a 4pt scale, radius has four steps, type has nine.
//   If a value is not on the scale it is a mistake, not a decision.
//
//   Density over padding. A row is 56pt so it is comfortable to tap, not so
//   the screen looks airy. Real content beats whitespace.
import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  TextInput,
  Platform,
  SafeAreaView,
  ScrollView,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';

/* ======================================================================
   TOKENS
====================================================================== */

export const COLORS = {
  // Brand. Also the splash, notification colour (app.json) and the receipt
  // email header (functions). Change them here and those have to change too.
  midnight: '#0B0F1A',
  midnightSoft: '#171C2A',
  midnightLine: '#2A3142',
  lime: '#B8F03A',       // fills, and anything on midnight
  limeDeep: '#86C814',   // small lime marks that sit on white: dots, switches
  limeInk: '#3D6A00',    // lime as readable text on a light surface
  limeSoft: '#F2FADF',
  limeLine: '#D9F0A0',

  // What the main action is drawn in, and what goes on top of it.
  primary: '#0B0F1A',
  onPrimary: '#B8F03A',

  // Older names, kept so every screen picks up the new palette.
  navy: '#0B0F1A',
  navyDeep: '#05070D',
  navyLine: '#2A3142',
  blue: '#3A4256',
  blueSoft: '#EEF0F4',
  greenSoft: '#F2FADF',

  // Text, darkest to lightest.
  ink: '#111522',
  inkSoft: '#474E5E',
  muted: '#6B7180',
  faint: '#9AA0AC',

  // Surfaces and rules.
  white: '#FFFFFF',
  surface: '#F3F4F6',
  raised: '#FAFAFB',
  fill: '#EDEFF2',       // inputs, segmented controls, secondary buttons
  line: '#E6E8EC',
  lineStrong: '#D3D7DE',

  // States.
  amber: '#B45309',
  amberSoft: '#FEF3C7',
  red: '#C8102E',
  redSoft: '#FDE6E9',
  success: '#3D6A00',
  successSoft: '#F2FADF',

  // Ratings.
  star: '#F5B300',

  // Map and overlay.
  overlay: 'rgba(11, 15, 26, 0.5)',
  onDark: '#AEB5C4',
};

// 4pt scale. SPACE[4] is 16 and is the default gutter.
export const SPACE = {
  0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 28, 8: 32, 10: 40, 12: 48, 16: 64,
};

export const RADIUS = {
  sm: 12,   // chips, small controls
  md: 16,   // inputs, small buttons
  lg: 24,   // cards
  xl: 32,   // bottom sheets
  pill: 999,
};

// Cards lift a little; sheets and map buttons float.
export const SHADOW = {
  card: Platform.select({
    ios: {
      shadowColor: '#0B0F1A',
      shadowOpacity: 0.06,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 4 },
    },
    android: { elevation: 2 },
  }),
  sheet: Platform.select({
    ios: {
      shadowColor: '#0B1220',
      shadowOpacity: 0.12,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: -6 },
    },
    android: { elevation: 16 },
  }),
  float: Platform.select({
    ios: {
      shadowColor: '#0B1220',
      shadowOpacity: 0.16,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    },
    android: { elevation: 6 },
  }),
};

// Nine steps, tightening as they grow. Negative tracking on the large sizes is
// what stops big numbers looking like a spreadsheet.
export const TYPE = {
  display: { fontSize: 40, fontWeight: '800', color: COLORS.midnight, letterSpacing: -1.4 },
  title: { fontSize: 30, fontWeight: '800', color: COLORS.midnight, letterSpacing: -0.9 },
  heading: { fontSize: 20, fontWeight: '800', color: COLORS.midnight, letterSpacing: -0.4 },
  subhead: { fontSize: 16, fontWeight: '600', color: COLORS.ink, letterSpacing: -0.1 },
  body: { fontSize: 15, lineHeight: 22, color: COLORS.ink },
  callout: { fontSize: 15, fontWeight: '600', color: COLORS.ink },
  small: { fontSize: 13, lineHeight: 18, color: COLORS.muted },
  caption: { fontSize: 12, lineHeight: 16, color: COLORS.faint },
  // Section labels above a group of rows.
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.faint,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  // Tabular-ish figures for money and counts.
  figure: { fontSize: 24, fontWeight: '800', color: COLORS.midnight, letterSpacing: -0.7 },
};

/* ======================================================================
   LAYOUT
====================================================================== */

/* Standard screen frame: safe area, background, and a scrolling body with the
   right gutter already applied. `scroll={false}` for map screens that manage
   their own layout. */
export function Screen({ children, scroll = true, style, contentStyle, refreshControl, dark }) {
  const bg = dark ? COLORS.navyDeep : COLORS.surface;
  if (!scroll) {
    return <SafeAreaView style={[{ flex: 1, backgroundColor: bg }, style]}>{children}</SafeAreaView>;
  }
  return (
    <SafeAreaView style={[{ flex: 1, backgroundColor: bg }, style]}>
      <ScrollView
        contentContainerStyle={[{ padding: SPACE[5], paddingBottom: SPACE[12] }, contentStyle]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

/* Header with back arrow, a large title and an optional line under it. */
/* Where "back" goes from the current screen, or null when there is nowhere
   to go: a tab's home screen, or the first step of a flow.

   Several stacks are both a tab and somewhere you can be sent (Payments is
   the Wallet tab and also opens from Profile and Home), so a fixed back
   button would be wrong in one place or the other. This looks at where the
   screen actually is: not first in its own stack, or its whole stack was
   pushed onto another stack. */
export function useBackAction() {
  const navigation = useNavigation();
  const route = useRoute();
  const state = navigation.getState?.();
  if (!state) return null;

  const position = state.routes.findIndex((r) => r.key === route.key);
  if (position > 0) return () => navigation.goBack();

  const parentState = navigation.getParent?.()?.getState?.();
  if (parentState?.type === 'stack') {
    const holder = parentState.routes.findIndex((r) => r.state?.key === state.key);
    if (holder > 0) return () => navigation.goBack();
  }
  return null;
}

/* The standard page title. A back button appears by itself whenever the
   screen was opened from somewhere; pass `onBack` to override what it does,
   or `onBack={null}` to leave it out. */
export function ScreenHeader(props) {
  const autoBack = useBackAction();
  const onBack = props.onBack === undefined ? autoBack : props.onBack;
  return <ScreenHeaderView {...props} onBack={onBack} />;
}

function ScreenHeaderView({ title, subtitle, onBack, right, compact }) {
  if (compact) {
    return (
      <View style={s.compactHeader}>
        {onBack ? (
          <TouchableOpacity
            onPress={onBack}
            style={s.backBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={22} color={COLORS.midnight} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={TYPE.heading} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={TYPE.caption} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {right || <View style={{ width: 40 }} />}
      </View>
    );
  }
  return (
    <View style={s.header}>
      {(onBack || right) ? (
        <View style={s.headerRow}>
          {onBack ? (
            <TouchableOpacity
              onPress={onBack}
              style={s.backBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="chevron-back" size={22} color={COLORS.midnight} />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 40 }} />
          )}
          <View style={{ flex: 1 }} />
          {right || null}
        </View>
      ) : null}
      <Text style={TYPE.title}>{title}</Text>
      {subtitle ? <Text style={[TYPE.small, { marginTop: SPACE[1] }]}>{subtitle}</Text> : null}
    </View>
  );
}

export function Section({ title, action, children, style }) {
  return (
    <View style={[{ marginTop: SPACE[7] }, style]}>
      {title ? (
        <View style={s.sectionHead}>
          <Text style={TYPE.label}>{title}</Text>
          {action || null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Divider({ style }) {
  return <View style={[s.divider, style]} />;
}

/* ======================================================================
   SURFACES
====================================================================== */

export function Card({ children, style, onPress, tone, flush }) {
  const toneStyle =
    tone === 'warning' ? { backgroundColor: COLORS.amberSoft, borderColor: '#FCD34D' }
    : tone === 'danger' ? { backgroundColor: COLORS.redSoft, borderColor: '#FCA5A5' }
    : tone === 'success' ? { backgroundColor: COLORS.limeSoft, borderColor: COLORS.limeLine }
    : tone === 'dark' ? { backgroundColor: COLORS.midnight, borderColor: COLORS.midnight }
    : tone === 'accent' ? { backgroundColor: COLORS.lime, borderColor: COLORS.lime }
    : null;
  const body = (
    <View style={[s.card, !toneStyle && SHADOW.card, toneStyle && s.cardToned, flush && { paddingVertical: 0 }, toneStyle, style]}>{children}</View>
  );
  if (!onPress) return body;
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress}>
      {body}
    </TouchableOpacity>
  );
}

/* A group of rows in one card, with the hairlines handled for you.
   <RowGroup items={[{ icon, title, detail, onPress }, ...]} /> */
export function RowGroup({ items, style }) {
  const rows = (items || []).filter(Boolean);
  if (!rows.length) return null;
  return (
    <Card flush style={style}>
      {rows.map((item, i) => (
        <ListRow key={item.key || item.title || i} {...item} last={i === rows.length - 1} />
      ))}
    </Card>
  );
}

/* The panel that sits over a map. Rounded at the top, shadowed because it
   genuinely floats, and never scrolled behind the home indicator. */
export function Sheet({ children, style, grabber = true }) {
  return (
    <View style={[s.sheet, SHADOW.sheet, style]}>
      {grabber ? <View style={s.grabber} /> : null}
      {children}
    </View>
  );
}

/* The bar that stays at the bottom of the screen with the main action in it.
   White, a hairline above, and clear of the home indicator. */
export function Footer({ children, note, style }) {
  return (
    <SafeAreaView style={{ backgroundColor: COLORS.white }}>
      <View style={[s.footer, style]}>
        {note ? <Text style={[TYPE.caption, { textAlign: 'center', marginBottom: SPACE[2] }]}>{note}</Text> : null}
        {children}
      </View>
    </SafeAreaView>
  );
}

/* ======================================================================
   ROWS AND DATA
====================================================================== */

/* A tappable row: icon, title, detail, chevron or custom right side. */
export function ListRow({ icon, iconColor = COLORS.blue, title, detail, right, onPress, last, danger }) {
  const Wrap = onPress ? TouchableOpacity : View;
  const titleColor = danger ? COLORS.red : COLORS.ink;
  return (
    <Wrap
      onPress={onPress}
      activeOpacity={0.6}
      accessibilityRole={onPress ? 'button' : undefined}
      style={[s.row, !last && s.rowLine]}
    >
      {icon ? (
        <View style={[s.rowIcon, { backgroundColor: (danger ? COLORS.red : iconColor) + '14' }]}>
          <Ionicons name={icon} size={20} color={danger ? COLORS.red : iconColor} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={[s.rowTitle, { color: titleColor }]}>{title}</Text>
        {detail ? <Text style={[TYPE.small, { marginTop: 2 }]}>{detail}</Text> : null}
      </View>
      {right !== undefined ? right : onPress ? (
        <Ionicons name="chevron-forward" size={18} color={COLORS.lineStrong} />
      ) : null}
    </Wrap>
  );
}

/* One number with its label. Use two or three, never a wall of them. */
export function Stat({ value, label, tone }) {
  return (
    <View style={s.stat}>
      <Text style={[TYPE.figure, tone === 'onDark' && { color: COLORS.white }]}>{value}</Text>
      <Text style={[TYPE.small, tone === 'onDark' && { color: COLORS.onDark }]}>{label}</Text>
    </View>
  );
}

/* Stats side by side with hairlines between them. */
export function StatRow({ items, tone, style }) {
  const stats = (items || []).filter(Boolean);
  return (
    <View style={[s.statRow, style]}>
      {stats.map((item, i) => (
        <React.Fragment key={item.label}>
          {i > 0 ? (
            <View style={[s.statRule, tone === 'onDark' && { backgroundColor: COLORS.navyLine }]} />
          ) : null}
          <Stat {...item} tone={tone} />
        </React.Fragment>
      ))}
    </View>
  );
}

/* Photo if we have one, initial on navy if we do not. `badge` sits bottom-right
   and is used for the driver's online dot. */
export function Avatar({ uri, name, size = 48, badge, style }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const box = { width: size, height: size, borderRadius: size / 3 };
  return (
    <View style={[box, style]}>
      {uri ? (
        <Image source={{ uri }} style={box} />
      ) : (
        <View style={[box, { backgroundColor: COLORS.navy, alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={{ fontSize: size * 0.4, fontWeight: '800', color: COLORS.white }}>
            {initial}
          </Text>
        </View>
      )}
      {badge ? <View style={s.avatarBadge}>{badge}</View> : null}
    </View>
  );
}

/* The green/grey dot used as an Avatar badge. */
export function PresenceDot({ online, size = 14 }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 3,
        borderColor: COLORS.surface,
        backgroundColor: online ? COLORS.limeDeep : COLORS.faint,
      }}
    />
  );
}

/* ======================================================================
   STATUS
====================================================================== */

const PILL = {
  open: { label: 'Received', bg: COLORS.blueSoft, fg: COLORS.blue },
  in_review: { label: 'Investigating', bg: COLORS.amberSoft, fg: COLORS.amber },
  resolved: { label: 'Closed', bg: COLORS.limeSoft, fg: COLORS.success },
  pending: { label: 'Waiting for approval', bg: COLORS.amberSoft, fg: COLORS.amber },
  approved: { label: 'Approved', bg: COLORS.limeSoft, fg: COLORS.success },
  rejected: { label: 'Not approved', bg: COLORS.redSoft, fg: COLORS.red },
  expired: { label: 'Expired', bg: COLORS.redSoft, fg: COLORS.red },
  expiring: { label: 'Expiring soon', bg: COLORS.amberSoft, fg: COLORS.amber },
  valid: { label: 'Valid', bg: COLORS.limeSoft, fg: COLORS.success },
  missing: { label: 'No date set', bg: COLORS.fill, fg: COLORS.muted },
  online: { label: 'Online', bg: COLORS.midnight, fg: COLORS.lime },
  offline: { label: 'Offline', bg: COLORS.fill, fg: COLORS.muted },
};

export function StatusPill({ status, label, dot }) {
  const p = PILL[status] || { label: label || status, bg: COLORS.fill, fg: COLORS.muted };
  return (
    <View style={[s.pill, { backgroundColor: p.bg }]}>
      {dot ? <View style={[s.pillDot, { backgroundColor: p.fg }]} /> : null}
      <Text style={[s.pillText, { color: p.fg }]}>{label || p.label}</Text>
    </View>
  );
}

/* A full-width message that needs reading before carrying on. */
export function Banner({ tone = 'info', title, body, action, icon }) {
  const t =
    tone === 'warning' ? { bg: COLORS.amberSoft, border: '#FCD34D', fg: COLORS.amber, icon: 'alert-circle' }
    : tone === 'danger' ? { bg: COLORS.redSoft, border: '#FCA5A5', fg: COLORS.red, icon: 'warning' }
    : tone === 'success' ? { bg: COLORS.limeSoft, border: COLORS.limeLine, fg: COLORS.success, icon: 'checkmark-circle' }
    : { bg: COLORS.blueSoft, border: COLORS.line, fg: COLORS.midnight, icon: 'information-circle' };
  return (
    <View style={[s.banner, { backgroundColor: t.bg, borderColor: t.border }]}>
      <Ionicons name={icon || t.icon} size={20} color={t.fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        {title ? <Text style={[TYPE.callout, { color: t.fg }]}>{title}</Text> : null}
        {body ? <Text style={[TYPE.small, { color: COLORS.inkSoft, marginTop: 2 }]}>{body}</Text> : null}
        {action ? <View style={{ marginTop: SPACE[3] }}>{action}</View> : null}
      </View>
    </View>
  );
}

/* ======================================================================
   CONTROLS
====================================================================== */

export function Button({ title, onPress, variant = 'primary', loading, disabled, icon, style, size }) {
  const v =
    variant === 'secondary' ? { bg: COLORS.fill, fg: COLORS.midnight, border: COLORS.fill }
    : variant === 'danger' ? { bg: COLORS.red, fg: COLORS.white, border: COLORS.red }
    : variant === 'ghost' ? { bg: 'transparent', fg: COLORS.midnight, border: 'transparent' }
    : variant === 'dark' ? { bg: COLORS.midnight, fg: COLORS.white, border: COLORS.midnight }
    : variant === 'accent' ? { bg: COLORS.lime, fg: COLORS.midnight, border: COLORS.lime }
    : { bg: COLORS.primary, fg: COLORS.onPrimary, border: COLORS.primary };
  const off = disabled || loading;
  const small = size === 'small';
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={off}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={[
        s.btn,
        small && { minHeight: 42, paddingHorizontal: SPACE[4] },
        { backgroundColor: v.bg, borderColor: v.border, opacity: off ? 0.5 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={v.fg} style={{ marginRight: SPACE[2] }} /> : null}
          <Text style={[s.btnText, small && { fontSize: 14 }, { color: v.fg }]}>{title}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

/* A round icon button, for map controls and sheet headers. */
export function IconButton({ icon, onPress, tone, size = 44, accessibilityLabel }) {
  const dark = tone === 'dark';
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        s.iconBtn,
        SHADOW.float,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: dark ? COLORS.midnight : COLORS.white,
        },
      ]}
    >
      <Ionicons name={icon} size={20} color={dark ? COLORS.lime : COLORS.midnight} />
    </TouchableOpacity>
  );
}

/* Two or three mutually exclusive options. */
export function Segmented({ options, value, onChange, style }) {
  return (
    <View style={[s.segmented, style]}>
      {(options || []).map((opt) => {
        const active = opt.value === value;
        return (
          <TouchableOpacity
            key={opt.value}
            onPress={() => onChange && onChange(opt.value)}
            activeOpacity={0.8}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[s.segment, active && s.segmentActive]}
          >
            <Text style={[s.segmentText, active && s.segmentTextActive]}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function Chip({ label, icon, active, onPress, style }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      disabled={!onPress}
      style={[s.chip, active && { backgroundColor: COLORS.midnight, borderColor: COLORS.midnight }, style]}
    >
      {icon ? (
        <Ionicons name={icon} size={15} color={active ? COLORS.lime : COLORS.inkSoft} />
      ) : null}
      <Text style={[s.chipText, active && { color: COLORS.white }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function Field({ label, hint, error, style, left, right, ...inputProps }) {
  const [focused, setFocused] = React.useState(false);
  return (
    <View style={[{ marginBottom: SPACE[4] }, style]}>
      {label ? <Text style={s.fieldLabel}>{label}</Text> : null}
      <View
        style={[
          s.inputWrap,
          focused && { borderColor: COLORS.midnight, backgroundColor: COLORS.white },
          error && { borderColor: COLORS.red },
        ]}
      >
        {left ? (
          <Ionicons name={left} size={20} color={COLORS.muted} style={{ marginLeft: SPACE[4], marginRight: -SPACE[1] }} />
        ) : null}
        <TextInput
          placeholderTextColor={COLORS.faint}
          selectionColor={COLORS.midnight}
          style={[s.input, inputProps.multiline && { minHeight: 104, textAlignVertical: 'top' }]}
          {...inputProps}
          onFocus={(e) => { setFocused(true); inputProps.onFocus && inputProps.onFocus(e); }}
          onBlur={(e) => { setFocused(false); inputProps.onBlur && inputProps.onBlur(e); }}
        />
        {right ? <View style={{ paddingRight: SPACE[3] }}>{right}</View> : null}
      </View>
      {error ? (
        <Text style={[TYPE.small, { color: COLORS.red, marginTop: SPACE[1] }]}>{error}</Text>
      ) : hint ? (
        <Text style={[TYPE.small, { marginTop: SPACE[1] }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

/* ======================================================================
   JOURNEY
   Pickup and dropoff shown as one connected route, the shape people
   recognise from every travel app.
====================================================================== */

export function RouteLine({ pickup, dropoff, compact }) {
  return (
    <View style={{ gap: compact ? SPACE[2] : SPACE[3] }}>
      <View style={s.routeRow}>
        <View style={s.routeGutter}>
          <View style={[s.routeDot, { backgroundColor: COLORS.lime }]} />
          <View style={s.routeStem} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={TYPE.label}>Pickup</Text>
          <Text style={[TYPE.callout, { marginTop: 2 }]} numberOfLines={2}>
            {pickup || 'Pickup location'}
          </Text>
        </View>
      </View>
      <View style={s.routeRow}>
        <View style={s.routeGutter}>
          <View style={[s.routeSquare, { backgroundColor: COLORS.midnight }]} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={TYPE.label}>Dropoff</Text>
          <Text style={[TYPE.callout, { marginTop: 2 }]} numberOfLines={2}>
            {dropoff || 'Dropoff location'}
          </Text>
        </View>
      </View>
    </View>
  );
}

/* ======================================================================
   STATES
====================================================================== */

export function EmptyState({ icon = 'albums-outline', title, body, action }) {
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}>
        <Ionicons name={icon} size={28} color={COLORS.midnight} />
      </View>
      <Text style={[TYPE.heading, { textAlign: 'center' }]}>{title}</Text>
      {body ? (
        <Text style={[TYPE.small, { textAlign: 'center', marginTop: SPACE[2], maxWidth: 300 }]}>
          {body}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: SPACE[5], alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

export function Loading({ label }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACE[10] }}>
      <ActivityIndicator color={COLORS.midnight} size="large" />
      {label ? <Text style={[TYPE.small, { marginTop: SPACE[4] }]}>{label}</Text> : null}
    </View>
  );
}

/* Grey blocks while real content loads. Calmer than a spinner on a list. */
export function Skeleton({ lines = 3 }) {
  return (
    <Card>
      {Array.from({ length: lines }).map((_, i) => (
        <View
          key={i}
          style={{
            height: 12,
            borderRadius: 6,
            backgroundColor: COLORS.fill,
            marginTop: i === 0 ? 0 : SPACE[3],
            width: i === lines - 1 ? '55%' : '100%',
          }}
        />
      ))}
    </Card>
  );
}

/* ======================================================================
   TAB BAR
   Shared by the rider and driver tabs. The active tab sits in a lime pill;
   the rest are quiet grey outlines.
====================================================================== */

export const TAB_BAR_OPTIONS = {
  headerShown: false,
  tabBarActiveTintColor: COLORS.midnight,
  tabBarInactiveTintColor: COLORS.faint,
  tabBarLabelStyle: { fontSize: 11, fontWeight: '700', marginTop: 2 },
  tabBarStyle: {
    backgroundColor: COLORS.white,
    borderTopWidth: 0,
    ...Platform.select({
      ios: {
        shadowColor: '#0B0F1A',
        shadowOpacity: 0.08,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: -4 },
      },
      android: { elevation: 12 },
    }),
  },
};

/* `name` is the outline icon; the filled version shows when active. */
export function TabIcon({ name, focused, color }) {
  const icon = focused ? name.replace(/-outline$/, '') : name;
  return (
    <View style={[s.tabIcon, focused && { backgroundColor: COLORS.lime }]}>
      <Ionicons name={icon} size={20} color={focused ? COLORS.midnight : color} />
    </View>
  );
}

/* ======================================================================
   HELPERS
====================================================================== */

/* ---------------- coordinates ----------------
   A MapView handed a region with a missing latitude silently renders at
   0°, 0° — a spot in the Gulf of Guinea off west Africa. Every map in the app
   goes through these so a trip with incomplete coordinates shows nothing
   rather than the wrong continent. */

export function isCoord(point) {
  return (
    !!point &&
    typeof point.latitude === 'number' &&
    typeof point.longitude === 'number' &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    // 0,0 is valid on paper and never right in practice for a UK trip.
    !(point.latitude === 0 && point.longitude === 0)
  );
}

// Keeps only the points a map can actually use.
export function validCoords(...points) {
  return points.filter(isCoord);
}

// A region around the first usable point, or null when there is none.
export function regionFrom(point, delta = 0.01) {
  if (!isCoord(point)) return null;
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    latitudeDelta: delta,
    longitudeDelta: delta,
  };
}

// A region covering every usable point, or null.
export function regionCovering(points, delta = 0.05) {
  const good = (points || []).filter(isCoord);
  if (!good.length) return null;
  if (good.length === 1) return regionFrom(good[0], delta);
  const lats = good.map((p) => p.latitude);
  const lngs = good.map((p) => p.longitude);
  const latSpan = Math.max(...lats) - Math.min(...lats);
  const lngSpan = Math.max(...lngs) - Math.min(...lngs);
  return {
    latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
    longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    latitudeDelta: Math.max(latSpan, 0.01) * 1.6,
    longitudeDelta: Math.max(lngSpan, 0.01) * 1.6,
  };
}

/* Shown in place of a map when there are no usable coordinates. */
export function MapUnavailable({ note }) {
  return (
    <View style={s.mapOff}>
      <Ionicons name="map-outline" size={26} color={COLORS.faint} />
      <Text style={[TYPE.small, { marginTop: SPACE[2], textAlign: 'center' }]}>
        {note || 'No map for this trip'}
      </Text>
    </View>
  );
}

export function formatWhen(ts) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
  if (!d || isNaN(d)) return '';
  return (
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ', ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  );
}

/* ======================================================================
   STYLES
====================================================================== */

const s = StyleSheet.create({
  header: { paddingTop: SPACE[2], paddingBottom: SPACE[1] },
  compactHeader: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[2],
    paddingHorizontal: SPACE[4], paddingVertical: SPACE[2], minHeight: 56,
  },
  footer: {
    paddingHorizontal: SPACE[5], paddingTop: SPACE[3], paddingBottom: SPACE[3],
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line,
    backgroundColor: COLORS.white,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACE[3] },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.white,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.line,
    alignItems: 'center', justifyContent: 'center',
  },
  sectionHead: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: SPACE[3],
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.line },

  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACE[5],
  },
  cardToned: { borderWidth: 1 },

  sheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SPACE[5],
    paddingTop: SPACE[3],
    paddingBottom: SPACE[8],
  },
  grabber: {
    width: 44, height: 5, borderRadius: 3, backgroundColor: COLORS.lineStrong,
    alignSelf: 'center', marginBottom: SPACE[4],
  },

  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingVertical: SPACE[3], gap: SPACE[3] },
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.line },
  rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 16, fontWeight: '600', color: COLORS.ink, letterSpacing: -0.2 },

  avatarBadge: { position: 'absolute', right: -2, bottom: -2 },

  stat: { alignItems: 'center', paddingHorizontal: SPACE[6], minWidth: 88 },
  statRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  statRule: { width: StyleSheet.hairlineWidth, height: 36, backgroundColor: COLORS.line },

  pill: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[1],
    paddingHorizontal: SPACE[3], paddingVertical: 5,
    borderRadius: RADIUS.pill, alignSelf: 'flex-start',
  },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.1 },

  banner: {
    flexDirection: 'row', gap: SPACE[3],
    borderRadius: RADIUS.lg, borderWidth: 1,
    padding: SPACE[4],
  },

  btn: {
    minHeight: 56,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACE[5],
  },
  btnText: { fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },

  iconBtn: { alignItems: 'center', justifyContent: 'center' },

  segmented: {
    flexDirection: 'row',
    backgroundColor: COLORS.fill,
    borderRadius: RADIUS.pill,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1, minHeight: 40, borderRadius: RADIUS.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  segmentActive: { backgroundColor: COLORS.midnight },
  segmentText: { fontSize: 14, fontWeight: '600', color: COLORS.muted },
  segmentTextActive: { color: COLORS.lime },

  chip: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[2],
    paddingHorizontal: SPACE[4], height: 40,
    borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: COLORS.line,
    backgroundColor: COLORS.white,
  },
  chipText: { fontSize: 14, fontWeight: '600', color: COLORS.inkSoft },

  fieldLabel: { fontSize: 13, fontWeight: '700', color: COLORS.inkSoft, marginBottom: SPACE[2] },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: COLORS.fill,
    borderRadius: RADIUS.md, backgroundColor: COLORS.fill,
  },
  input: {
    flex: 1,
    paddingHorizontal: SPACE[4], paddingVertical: SPACE[3],
    minHeight: 54, fontSize: 16, color: COLORS.ink,
  },

  routeRow: { flexDirection: 'row', gap: SPACE[3] },
  routeGutter: { width: 12, alignItems: 'center', paddingTop: 5 },
  routeDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2.5, borderColor: COLORS.midnight },
  routeSquare: { width: 12, height: 12, borderRadius: 3 },
  routeStem: { flex: 1, width: StyleSheet.hairlineWidth * 3, backgroundColor: COLORS.line, marginTop: 4, minHeight: 18 },

  mapOff: {
    flex: 1, minHeight: 160,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.surface,
    padding: SPACE[5],
  },

  tabIcon: {
    width: 52, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },

  empty: { alignItems: 'center', paddingVertical: SPACE[12], paddingHorizontal: SPACE[6] },
  emptyIcon: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: COLORS.lime,
    alignItems: 'center', justifyContent: 'center', marginBottom: SPACE[4],
  },
});
