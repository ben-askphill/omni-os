// Dates from SQLite are ISO strings in UTC. Display uses the browser's locale timezone,
// except automations, which use their own timezone (Europe/Amsterdam by default).

import { formatCents } from '@omni/shared/context-meter.ts';
import type { ArtifactTrigger, MonthlyUsage, WebhookTrigger } from './api.ts';

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

/** How full a usage window is, 0 to 1, whether the harness reports a fraction or a percent. Null without one. */
export const windowPct = (w?: { utilization: number }) => {
  if (!w) return null;
  const raw = w.utilization > 1.5 ? w.utilization / 100 : w.utilization;
  return Math.max(0, Math.min(1, raw));
};

/** A channel kind as people read it. */
export const CHANNEL_KIND: Record<string, string> = { client: 'Client', internal: 'Internal', personal: 'Personal', system: 'System' };

export function untilLabel(unixSecs: number, now = Date.now()) {
  const ms = unixSecs * 1000 - now;
  const d = new Date(unixSecs * 1000);
  if (ms <= 0) return 'now';
  if (ms < 3_600_000) return `in ${Math.max(1, Math.round(ms / 60_000))}m`;
  if (ms < DAY) return `in ${Math.floor(ms / 3_600_000)}h ${Math.round((ms % 3_600_000) / 60_000)}m`;
  return d.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

/** "Cursor month: 43% of included usage (Auto 39%, API 82%). $564.36 spent, $70.00 included. Resets 24 Oct (in 3d)." */
export function monthlyTitle(name: string, m: MonthlyUsage, now = Date.now()): string {
  const pct = (f: number) => `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`;
  const buckets = [m.auto !== undefined && `Auto ${pct(m.auto)}`, m.api !== undefined && `API ${pct(m.api)}`].filter(Boolean).join(', ');
  const money = [m.spendCents !== undefined && `${formatCents(m.spendCents)} spent`, m.includedCents !== undefined && `${formatCents(m.includedCents)} included`]
    .filter(Boolean)
    .join(', ');
  const days = Math.round((m.resetsAt * 1000 - now) / DAY);
  const date = new Date(m.resetsAt * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${name} month: ${pct(m.utilization)} of included usage${buckets ? ` (${buckets})` : ''}.${money ? ` ${money}.` : ''} Resets ${date} (${days >= 1 ? `in ${days}d` : untilLabel(m.resetsAt, now)}).`;
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

const EVENT_LABELS: Record<string, string> = {
  pr_opened: 'When a PR opens',
  pr_checks_failed: 'When PR checks fail',
  pr_conflict: 'When a PR has conflicts',
  pr_review: 'When a PR gets review comments',
  artifact_published: 'When a page is published',
  github_webhook: 'When GitHub sends a webhook',
};

/** An event automation's trigger in words (server/automation-events.ts EVENT_LABELS). */
export function describeEvent(event: string): string {
  return EVENT_LABELS[event] ?? event;
}

/** The channels an artifact automation listens to, as `#name`s, or null for any channel. */
export function artifactChannels(on: ArtifactTrigger, name: (id: string) => string): string | null {
  return on.channels ? on.channels.map((id) => `#${name(id)}`).join(', ') : null;
}

/** Which publishes an artifact automation takes, for its filter chip: `#acme, #ops · updates too`. */
export function describeArtifactSource(on: ArtifactTrigger, name: (id: string) => string): string {
  return `${artifactChannels(on, name) ?? 'any channel'}${on.updates ? ' · updates too' : ''}`;
}

/** Which webhooks an automation takes, for its filter chip: `acme/shop · workflow_run, pull_request_review · anyone`. */
export function describeWebhookSource(on: WebhookTrigger): string {
  return [on.repo, on.events.join(', '), on.trust === 'any' && 'anyone'].filter(Boolean).join(' · ');
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

const graphemes = new Intl.Segmenter();
/** The last character of what was typed, whole even when it is a multi-part emoji. Typing over a channel icon replaces it. */
export function lastGrapheme(s: string) {
  const all = [...graphemes.segment(s.trim())];
  return all.length ? all[all.length - 1].segment : '';
}

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

/** An event's JSON payload; a payload that does not parse reads as empty. */
export function parsePayload<T = Record<string, unknown>>(e: { payload: string }): T {
  try {
    return JSON.parse(e.payload) as T;
  } catch {
    return {} as T;
  }
}
