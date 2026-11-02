// Dates from SQLite are ISO strings in UTC. Display uses the browser's locale timezone,
// except automations, which use their own timezone (Europe/Amsterdam by default).

import { isDeliveryAhead, type DeliveryView, type TriggerSource } from '@omni/shared/automation-triggers.ts';
import { formatCents } from '@omni/shared/context-meter.ts';
import { DAY, relTime, startOfDay, toDate } from '@omni/shared/format.ts';
import type { ArtifactTrigger, MonthlyUsage, WebhookTrigger } from './api.ts';

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

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------- cron ----------

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

const SOURCE_LABELS: Record<TriggerSource, string> = { artifact_published: 'Published page', github_webhook: 'GitHub webhook' };

/** Where a delivery came from, for its detail. */
export const describeDeliverySource = (source: TriggerSource) => SOURCE_LABELS[source];

/** How far off a time is, for what has not happened yet: `in 12m`, `in 3h`, `in 2d`. `now` once it has passed. */
export function inTime(iso: string, now = Date.now()) {
  const ms = toDate(iso).getTime() - now;
  if (Number.isNaN(ms)) return '';
  if (ms <= 0) return 'now';
  const m = Math.ceil(ms / 60_000);
  if (m < 60) return `in ${m}m`;
  const h = Math.round(m / 60);
  return h < 24 ? `in ${h}h` : `in ${Math.round(h / 24)}d`;
}

/** When an event ages out, as a fact: `Expires in 3h`, or `Expired Thu 00:18` once it has. */
export function expiryFact(iso: string, now = Date.now()) {
  return toDate(iso).getTime() > now ? { label: 'Expires', value: inTime(iso, now) } : { label: 'Expired', value: relTime(iso, now) };
}

/** How long ago an event arrived, for one that came today. Earlier ones are told apart by the date alone. */
export function receivedAgo(iso: string, now = Date.now()) {
  return toDate(iso).getTime() >= startOfDay(new Date(now)).getTime() ? relTime(iso, now) : null;
}

/** The value when it is one http(s) link, else null. A delivery's context is text from outside, and only a web link becomes a link. */
export function httpUrl(value: string): string | null {
  if (/\s/.test(value)) return null;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Deliveries from a reload, a page of history or an answer to a retry or skip, folded into the ones already shown,
 * newest first. A row in both takes the incoming copy unless the shown one is further along, so a late copy never
 * takes a state back, and loaded history stays when the latest few move on.
 */
export function mergeDeliveries(incoming: DeliveryView[], current: DeliveryView[]): DeliveryView[] {
  const byId = new Map(current.map((d) => [d.id, d]));
  for (const d of incoming) {
    const shown = byId.get(d.id);
    if (!shown || !isDeliveryAhead(shown, d)) byId.set(d.id, d);
  }
  return [...byId.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
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
