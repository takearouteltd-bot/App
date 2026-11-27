// utils/bookLater.js
// Booking a ride for later: the dashboard's settings, the pickup times a
// passenger may pick, and those times in UK time (wherever the phone thinks
// it is). The server checks every booking again (functions/bookLater.js);
// keep the limits in step with loadAppConfig there.
//
// UK time is worked out here, not with Intl's time zones, so it is the same
// on every phone: British Summer Time runs from 01:00 UTC on the last Sunday
// of March to 01:00 UTC on the last Sunday of October.

const DAY_MS = 24 * 3600 * 1000;
const STEP_MS = 5 * 60 * 1000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(n)));

/** The dashboard's settings, with the server's limits. */
export function bookLaterSettings(config) {
  const b = config?.bookLater || {};
  return {
    enabled: num(b.enabled, 0) === 1,
    minMinutes: clamp(num(b.minMinutes, 30), 15, 240),
    maxDays: clamp(num(b.maxDays, 7), 1, 14),
    leadMinutes: clamp(num(b.leadMinutes, 20), 5, 120),
    maxOpen: clamp(num(b.maxOpen, 3), 1, 10),
  };
}

function lastSundayAt1Utc(year, month) {
  const last = new Date(Date.UTC(year, month + 1, 0));
  return Date.UTC(year, month, last.getUTCDate() - last.getUTCDay(), 1, 0);
}

/** UK clock's offset from UTC at this moment: 0 or one hour. */
export function ukOffsetMs(ms) {
  const year = new Date(ms).getUTCFullYear();
  return ms >= lastSundayAt1Utc(year, 2) && ms < lastSundayAt1Utc(year, 9) ? 3600000 : 0;
}

/** The UK date and time of a moment. */
export function ukParts(ms) {
  const d = new Date(ms + ukOffsetMs(ms));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (p) => `${p.year}-${pad(p.month + 1)}-${pad(p.day)}`;

/** "14:30" in UK time. */
export function ukClock(ms) {
  const p = ukParts(ms);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** "Today", "Tomorrow" or "Tue 2 Dec", for the UK day of a moment. */
export function ukDayLabel(ms, now = Date.now()) {
  const p = ukParts(ms);
  if (dayKey(p) === dayKey(ukParts(now))) return 'Today';
  if (dayKey(p) === dayKey(ukParts(now + DAY_MS))) return 'Tomorrow';
  return `${WEEKDAYS[p.weekday]} ${p.day} ${MONTHS[p.month]}`;
}

/** "Today, 14:30" / "Tue 2 Dec, 14:30" in UK time. */
export function ukWhen(ms, now = Date.now()) {
  if (!ms) return '';
  return `${ukDayLabel(ms, now)}, ${ukClock(ms)}`;
}

/** The first and last pickup time a passenger may pick now. */
export function pickupWindow(settings, now = Date.now()) {
  const first = Math.ceil((now + settings.minMinutes * 60000) / STEP_MS) * STEP_MS;
  const last = Math.floor((now + settings.maxDays * DAY_MS) / STEP_MS) * STEP_MS;
  return { first, last };
}

/** Whether a picked time is still bookable (it may have been picked a while ago). */
export function pickupStillOk(ms, settings, now = Date.now()) {
  if (!Number.isFinite(ms)) return false;
  // A couple of minutes' grace: the server allows five.
  return ms >= now + (settings.minMinutes - 2) * 60000 && ms <= now + settings.maxDays * DAY_MS;
}

/**
 * Every pickup time on offer, in 5-minute steps, grouped by UK day:
 * [{ key, label, slots: [ms, ...] }]. Stepping through real time means the
 * hour the clocks skip in spring is never offered.
 */
export function pickupDays(settings, now = Date.now()) {
  const { first, last } = pickupWindow(settings, now);
  const days = [];
  for (let t = first; t <= last; t += STEP_MS) {
    const key = dayKey(ukParts(t));
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      day = { key, label: ukDayLabel(t, now), slots: [] };
      days.push(day);
    }
    day.slots.push(t);
  }
  return days;
}

function millis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  const n = Number(ts);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The booked pickup time of an app ride booked for later, or 0. Only a
 * booking the server checked (bookedAhead) counts, as on the server.
 */
export function bookedPickupMs(ride) {
  if (!ride || !ride.bookedAhead || ride.source === 'phone') return 0;
  return millis(ride.pickupAt);
}

/** When a booking's search for a driver starts (the server sets it). */
export function searchStartsMs(ride) {
  return millis(ride?.dispatchAt);
}
