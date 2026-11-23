// Dates and sizes as the clients write them. SQLite stores ISO strings in UTC; these format them in the device's locale timezone.

export const DAY = 86_400_000;

export const toDate = (iso: string) => new Date(iso);

export function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function relTime(iso: string, now = Date.now()) {
  const t = toDate(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = now - t;
  if (diff < 45_000) return 'just now';
  // Round to whole minutes before picking the unit, so 59m 50s reads "1h ago", not "60m ago".
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const d = toDate(iso);
  const today = startOfDay(new Date(now)).getTime();
  if (t >= today) return `${Math.round(diff / 3_600_000)}h ago`;
  if (t >= today - DAY) return `Yesterday ${clock(d)}`;
  if (t >= today - 6 * DAY) return d.toLocaleDateString('en-GB', { weekday: 'short' }) + ` ${clock(d)}`;
  return shortDate(d);
}

export const clock = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export function shortDate(d: Date) {
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** How long something took: "12s", "3m 4s", "1h 5m". Empty when no time was given. */
export function duration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
