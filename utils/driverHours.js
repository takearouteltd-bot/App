// Driver hours, as kept by the enforceDriverHours function: workLog is a list
// of {start, end} spells in ms over the last 24 hours, extended every two
// minutes while the driver is online or on a trip. Keep in step with
// functions/index.js (workedInLastDay).

const DAY_MS = 24 * 60 * 60 * 1000;
const TICK_MS = 2 * 60 * 1000;

// Online time in the last 24 hours, counting the minutes since the server
// last logged them while the driver is still working.
export function workedInLastDay(driver, now = Date.now()) {
  const from = now - DAY_MS;
  const log = Array.isArray(driver?.workLog) ? driver.workLog : [];
  let worked = log.reduce(
    (sum, s) => sum + Math.max(0, Math.min(s.end, now) - Math.max(s.start, from)),
    0
  );
  const working = driver?.status === 'online' || driver?.status === 'on_ride';
  if (working) {
    const last = log[log.length - 1];
    if (last && now - last.end <= TICK_MS * 2) worked += now - last.end;
    else {
      const went = driver.shiftStartedAt?.toMillis?.();
      if (went && went < now) worked += now - Math.max(went, from);
    }
  }
  return worked;
}

// When a rest ends, in ms, or null when the driver isn't resting.
export function restEndsAt(driver, now = Date.now()) {
  const until = driver?.restUntil?.toMillis?.();
  return until && until > now ? until : null;
}

export function formatHours(ms) {
  const mins = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

// "6:40 pm", or "tomorrow 6:40 am" when the rest runs past midnight.
export function formatRestEnd(ms, now = Date.now()) {
  const end = new Date(ms);
  const time = end
    .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    .toLowerCase();
  return end.toDateString() === new Date(now).toDateString() ? time : `tomorrow ${time}`;
}
