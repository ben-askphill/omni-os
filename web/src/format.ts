// Dates from SQLite are ISO strings in UTC. Display uses the browser's locale timezone,
// except automations, which use their own timezone (Europe/Amsterdam by default).

const DAY = 86_400_000;

export const toDate = (iso: string) => new Date(iso);

function startOfDay(d: Date) {
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

export function fullDate(iso: string) {
  const d = toDate(iso);
  return d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function dayLabel(iso: string, now = Date.now()) {
  const d = toDate(iso);
  const today = startOfDay(new Date(now)).getTime();
  const t = d.getTime();
  if (t >= today) return 'Today';
  if (t >= today - DAY) return 'Yesterday';
  if (t >= today - 6 * DAY) return d.toLocaleDateString('en-GB', { weekday: 'long' });
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** Groups items (already sorted desc) by calendar day, keeping order. */
export function groupByDay<T>(items: T[], getIso: (t: T) => string) {
  const groups: { label: string; items: T[] }[] = [];
  for (const it of items) {
    const label = dayLabel(getIso(it));
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(it);
    else groups.push({ label, items: [it] });
  }
  return groups;
}

export function duration(ms: number | undefined) {
  if (!ms && ms !== 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function untilLabel(unixSecs: number, now = Date.now()) {
  const ms = unixSecs * 1000 - now;
  const d = new Date(unixSecs * 1000);
  if (ms <= 0) return 'now';
  if (ms < 3_600_000) return `in ${Math.max(1, Math.round(ms / 60_000))}m`;
  if (ms < DAY) return `in ${Math.floor(ms / 3_600_000)}h ${Math.round((ms % 3_600_000) / 60_000)}m`;
  return d.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

export function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------- cron ----------

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function pad(n: string) {
  return n.padStart(2, '0');
}

/** Best effort human text for common 5-field crons; falls back to the raw expression. */
export function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts;
  const num = /^\d+$/;

  if (min.startsWith('*/') && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return `Every ${min.slice(2)} minutes`;
  }
  if (num.test(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return min === '0' ? 'Every hour' : `Every hour at :${pad(min)}`;
  }
  if (num.test(min) && hour.startsWith('*/') && dom === '*' && mon === '*' && dow === '*') {
    return `Every ${hour.slice(2)} hours`;
  }
  if (!num.test(min)) return cron;
  const hours = hour.split(',');
  if (!hours.every((h) => num.test(h))) return cron;
  const at = hours.map((h) => `${pad(h)}:${pad(min)}`).join(', ');

  if (mon !== '*') return cron;
  if (dom === '*' && dow === '*') return `Every day at ${at}`;
  if (dom === '*') {
    if (dow === '1-5' || dow === 'MON-FRI') return `Weekdays at ${at}`;
    if (dow === '0,6' || dow === '6,0' || dow === 'SAT,SUN') return `Weekends at ${at}`;
    const days = dow.split(',');
    if (days.every((x) => num.test(x) && Number(x) <= 7)) {
      return `${days.map((x) => DOW[Number(x) % 7] + 's').join(', ')} at ${at}`;
    }
    return cron;
  }
  if (num.test(dom) && dow === '*') return `Day ${dom} of every month at ${at}`;
  return cron;
}

export function nextRunLabel(iso: string, timeZone: string) {
  const d = new Date(iso);
  const fmt = (o: Intl.DateTimeFormatOptions) => d.toLocaleString('en-GB', { timeZone, ...o });
  const dayKey = (x: Date) => x.toLocaleDateString('en-GB', { timeZone });
  const now = new Date();
  const tomorrow = new Date(now.getTime() + DAY);
  const time = fmt({ hour: '2-digit', minute: '2-digit' });
  if (dayKey(d) === dayKey(now)) return `Today ${time}`;
  if (dayKey(d) === dayKey(tomorrow)) return `Tomorrow ${time}`;
  return `${fmt({ weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}

// ---------- misc ----------

export function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Escape everything, then restore only the <mark> tags the search API adds. */
export function safeSnippet(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/&lt;mark&gt;/g, '<mark>')
    .replace(/&lt;\/mark&gt;/g, '</mark>');
}

export function shortPath(p: string, cwd?: string | null) {
  if (!p) return '';
  if (cwd && p.startsWith(cwd + '/')) return p.slice(cwd.length + 1);
  const home = p.match(/^\/Users\/[^/]+\//);
  const rel = home ? '~/' + p.slice(home[0].length) : p;
  const parts = rel.split('/');
  return parts.length > 4 ? '.../' + parts.slice(-3).join('/') : rel;
}
