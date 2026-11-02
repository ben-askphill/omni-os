import type { Automation } from '@omni/client-core';
import { describeCron } from '@omni/shared/cron.ts';

const EVENT_LABELS: Record<string, string> = {
  pr_opened: 'When a PR opens',
  pr_checks_failed: 'When PR checks fail',
  pr_conflict: 'When a PR has conflicts',
  pr_review: 'When a PR gets review comments',
  artifact_published: 'When a page is published',
  github_webhook: 'When GitHub sends a webhook',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

export interface AutomationRow {
  id: string;
  name: string;
  enabled: boolean;
  invalid: boolean;
  detail: string;
  switchLabel: string;
}

export function triggerLabel(a: Pick<Automation, 'cron' | 'on'>): string {
  if (a.on) return EVENT_LABELS[a.on.event] ?? a.on.event;
  return describeCron(a.cron);
}

interface Clock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function clockIn(ms: number, timeZone: string): Clock {
  const read = (zone: string) => {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(ms);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute') };
  };
  try {
    return read(timeZone);
  } catch {
    return read('UTC');
  }
}

function dayNumber(c: Clock): number {
  return Date.UTC(c.year, c.month - 1, c.day) / DAY_MS;
}

/** "Today 09:00", "Tomorrow 09:00" or "Mon 3 Nov, 09:00", on the clock of the automation's own timezone. Empty for a time that does not parse. */
export function nextRunLabel(iso: string, timeZone: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const at = clockIn(t, timeZone);
  const time = `${String(at.hour).padStart(2, '0')}:${String(at.minute).padStart(2, '0')}`;
  const days = dayNumber(at) - dayNumber(clockIn(now, timeZone));
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  const weekday = WEEKDAYS[new Date(Date.UTC(at.year, at.month - 1, at.day)).getUTCDay()];
  return `${weekday} ${at.day} ${MONTHS[at.month - 1]}, ${time}`;
}

function statusLine(a: Automation, now: number): string {
  if (a.error) return `Invalid: ${a.error}`;
  if (!a.enabled) return 'Paused';
  const next = a.next ? nextRunLabel(a.next, a.timezone, now) : '';
  return next ? `Next ${next}` : '';
}

export function automationRows(list: readonly Automation[], now: number): AutomationRow[] {
  return list.map((a) => {
    const detail = [`${triggerLabel(a)} · #${a.channel}`, statusLine(a, now)].filter(Boolean).join('\n');
    return {
      id: a.id,
      name: a.name,
      enabled: a.enabled,
      invalid: !!a.error,
      detail,
      switchLabel: `${a.enabled ? 'Pause' : 'Enable'} ${a.name}`,
    };
  });
}

export function withEnabled(list: readonly Automation[], id: string, enabled: boolean): Automation[] {
  return list.map((a) => (a.id === id ? { ...a, enabled } : a));
}
