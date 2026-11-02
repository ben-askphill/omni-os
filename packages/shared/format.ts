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
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))}m ago`;
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
