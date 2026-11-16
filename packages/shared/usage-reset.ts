// When a plan limit resets, as the Usage card and the dashboard show it: "in 2h 10m" by the bar, the local time
// ("Thu 20 Nov, 09:00") on hover or tap. A window carries its reset as epoch seconds (account-usage.ts PlanWindow).

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** The reset as epoch ms, or null when the source sent none or nothing usable (0, negative, not a number). */
export function resetMs(resetsAt: unknown): number | null {
  return typeof resetsAt === 'number' && Number.isFinite(resetsAt) && resetsAt > 0 ? resetsAt * 1000 : null;
}

/**
 * How long until the window resets: "45m", "2h 10m", "3d 4h", or whole days from a week out ("12d"). Rounded up, so
 * it never says a reset is sooner than it is. Null without a reset time, or once it has passed: the reading is from
 * the window before, and the next one will carry the new time.
 */
export function resetIn(resetsAt: unknown, now = Date.now()): string | null {
  const at = resetMs(resetsAt);
  if (at === null || at <= now) return null;
  const mins = Math.ceil((at - now) / MIN);
  if (mins < 60) return `${mins}m`;
  if (mins < 24 * 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(mins / (24 * 60));
  const h = Math.floor((mins % (24 * 60)) / 60);
  return d >= 7 || !h ? `${d}d` : `${d}d ${h}h`;
}

/** The reset in local time: "today 14:20", "tomorrow 09:00", or "Thu 20 Nov, 09:00". Null without a reset time. */
export function resetAt(resetsAt: unknown, now = Date.now()): string | null {
  const at = resetMs(resetsAt);
  if (at === null) return null;
  const d = new Date(at);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const day = (ms: number) => new Date(ms).toDateString();
  if (day(at) === day(now)) return `today ${time}`;
  if (day(at) === day(now + DAY)) return `tomorrow ${time}`;
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}

/** The reset in local time, short enough for the Usage card's narrow columns: "at 14:20", "Fri 09:00", "28 Nov". */
export function resetAtShort(resetsAt: unknown, now = Date.now()): string | null {
  const at = resetMs(resetsAt);
  if (at === null) return null;
  const d = new Date(at);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date(now).toDateString()) return `at ${time}`;
  if (at - now < 6 * DAY) return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${time}`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * The full sentence for a tooltip or a screen reader: "Resets in 2h 10m, today 14:20." Past resets say when the
 * window reset and that the numbers are from before it. Null without a reset time.
 */
export function resetSentence(resetsAt: unknown, now = Date.now()): string | null {
  const when = resetAt(resetsAt, now);
  if (!when) return null;
  const left = resetIn(resetsAt, now);
  return left ? `Resets in ${left}, ${when}.` : `Reset ${when}; these numbers are from before it.`;
}
