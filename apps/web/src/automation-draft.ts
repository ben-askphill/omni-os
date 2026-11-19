import type { AutomationFields } from './api.ts';

// The Automations editor's form state and how it maps to what PUT /api/automations/:id takes. Pure, so it is tested
// on its own (tests/automation-draft.test.ts). The server checks the result again (apps/server/automation-files.ts).

export const PR_EVENTS = ['pr_opened', 'pr_checks_failed', 'pr_conflict', 'pr_review'] as const;
export const EVENTS = [...PR_EVENTS, 'artifact_published', 'github_webhook'] as const;
export type EventName = (typeof EVENTS)[number];
export const WEBHOOK_EVENTS = ['workflow_run', 'pull_request_review'] as const;
export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];

export const isPrEvent = (e: string) => (PR_EVENTS as readonly string[]).includes(e);

/** Schedules to start from. The cron field takes any five-field cron. */
export const CRON_PRESETS = [
  { label: 'Weekdays 08:00', cron: '0 8 * * 1-5' },
  { label: 'Daily 09:00', cron: '0 9 * * *' },
  { label: 'Mondays 09:00', cron: '0 9 * * 1' },
  { label: 'Every hour', cron: '0 * * * *' },
] as const;

export interface Draft {
  name: string;
  enabled: boolean;
  trigger: 'schedule' | 'event';
  cron: string;
  timezone: string;
  catchup: boolean;
  event: EventName;
  repo: string;
  drafts: boolean;
  trustAny: boolean;
  /** Empty: any channel's publishes. */
  channels: string[];
  updates: boolean;
  webhookEvents: WebhookEventName[];
  maxAge: string;
  concurrency: string;
  channel: string;
  /** '' follows "Run automations on"; `here` or a sync machine id. */
  machine: string;
  role: string;
  harness: string;
  model: string;
  effort: string;
  /** Post nothing when there is nothing to report. */
  quiet: boolean;
  /** Ask on a card before acting outside Omni. */
  approve: boolean;
  /** How long a draft waiting for approval lasts, like 8h. Empty: until answered. */
  expires: string;
  prompt: string;
}

export const blankDraft = (channel = 'inbox'): Draft => ({
  name: '',
  enabled: true,
  trigger: 'schedule',
  cron: CRON_PRESETS[0].cron,
  timezone: '',
  catchup: false,
  event: 'pr_checks_failed',
  repo: '',
  drafts: false,
  trustAny: false,
  channels: [],
  updates: false,
  webhookEvents: [...WEBHOOK_EVENTS],
  maxAge: '',
  concurrency: '',
  channel,
  machine: '',
  role: '',
  harness: '',
  model: '',
  effort: '',
  quiet: false,
  approve: false,
  expires: '',
  prompt: '',
});

const text = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/** The form for a definition's fields. `machineId` is where its `machine:` resolves; `self` is this machine's sync id. */
export function draftOf(f: AutomationFields, machineId: string | null, self: string | null): Draft {
  const d = blankDraft(f.channel);
  const raw = typeof f.on === 'string' ? { event: f.on } : f.on && typeof f.on === 'object' ? (f.on as Record<string, unknown>) : null;
  const event = (EVENTS as readonly string[]).includes(text(raw?.event)) ? (text(raw?.event) as EventName) : d.event;
  const list = (v: unknown) => (Array.isArray(v) ? v.map(text).filter(Boolean) : typeof v === 'string' && v ? [v] : []);
  const hooks = list(raw?.events).filter((e): e is WebhookEventName => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  return {
    ...d,
    name: f.name,
    enabled: f.enabled,
    trigger: raw ? 'event' : 'schedule',
    cron: f.cron || (raw ? d.cron : ''),
    timezone: f.timezone ?? '',
    catchup: !!f.catchup,
    event,
    repo: text(raw?.repo),
    drafts: raw?.drafts === true,
    trustAny: raw?.trust === 'any',
    channels: list(raw?.channels),
    updates: raw?.updates === true,
    webhookEvents: hooks.length ? hooks : [...WEBHOOK_EVENTS],
    maxAge: text(raw?.max_age),
    concurrency: text(raw?.concurrency),
    // A machine the file names that no synced machine is: kept as written, so saving does not drop it.
    machine: !f.machine ? '' : machineId && machineId === self ? 'here' : (machineId ?? f.machine),
    role: f.role ?? '',
    harness: f.harness ?? '',
    model: f.model ?? '',
    effort: f.effort ?? '',
    quiet: !!f.quiet,
    approve: !!f.approve,
    expires: f.expires ?? '',
    prompt: f.prompt,
  };
}

/** The `on:` block for an event draft, with only what applies to its event. */
export function triggerOf(d: Draft): Record<string, unknown> {
  const on: Record<string, unknown> = { event: d.event };
  const repo = d.repo.trim();
  if (isPrEvent(d.event)) {
    if (repo) on.repo = repo;
    if (d.drafts) on.drafts = true;
    if (d.trustAny) on.trust = 'any';
    return on;
  }
  if (d.event === 'github_webhook') {
    on.repo = repo;
    on.events = d.webhookEvents;
    if (d.trustAny) on.trust = 'any';
  } else {
    if (d.channels.length) on.channels = d.channels;
    if (d.updates) on.updates = true;
  }
  if (d.maxAge.trim()) on.max_age = d.maxAge.trim();
  if (d.concurrency.trim()) on.concurrency = Number(d.concurrency);
  return on;
}

/** What the server takes for a draft. */
export function fieldsOf(d: Draft): AutomationFields {
  const schedule = d.trigger === 'schedule';
  return {
    name: d.name.trim(),
    enabled: d.enabled,
    cron: schedule ? d.cron.trim() : '',
    ...(!schedule && { on: triggerOf(d) }),
    timezone: schedule ? d.timezone.trim() : '',
    catchup: schedule && d.catchup,
    channel: d.channel,
    machine: d.machine,
    role: d.role,
    harness: d.harness,
    model: d.harness ? d.model : '',
    effort: d.harness && d.model ? d.effort : '',
    quiet: d.quiet,
    approve: d.approve,
    expires: d.approve ? d.expires.trim() : '',
    prompt: d.prompt,
  };
}

/** Why the draft cannot be saved yet, or null. The server has the last word. */
export function draftProblem(d: Draft): string | null {
  if (!d.name.trim()) return 'Give it a name.';
  if (!d.prompt.trim()) return 'Write the prompt it runs.';
  if (d.trigger === 'schedule' && d.cron.trim().split(/\s+/).length !== 5) return 'A schedule takes five cron fields, like 0 8 * * 1-5.';
  if (d.trigger === 'event' && d.event === 'github_webhook' && !/^[\w.-]+\/[\w.-]+$/.test(d.repo.trim())) return 'A GitHub webhook needs its repo as owner/name.';
  if (d.trigger === 'event' && d.event === 'github_webhook' && !d.webhookEvents.length) return 'Pick at least one GitHub event.';
  if (d.approve && d.expires.trim() && !/^\d+(\.\d+)?\s*[smhd]?$/i.test(d.expires.trim())) return 'An expiry takes a duration like 90m, 8h or 2d.';
  return null;
}
