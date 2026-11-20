// Usage analytics: the events Omni may send to PostHog and the only properties each may carry. The server is the one
// place that sends (apps/server/analytics.ts), the Web UI's events go through it (POST /api/analytics/events), and
// everything passes `cleanEvent` first. Pure.
//
// Omni holds client work, so an event says what kind of thing happened, never what it was about: no message text,
// prompts, file contents, titles, paths, repo, channel, store or account names, ids, secrets or email. A property is
// a fixed token, a number or a boolean. Anything else is dropped, and an event this file does not list is never sent.

/** Settings > About > Usage analytics, kept by the server in kv (`analytics`), shared by every client and machine. */
export interface AnalyticsState {
  /** The switch: on unless turned off. */
  enabled: boolean;
  /** Whether this server has a PostHog project key (OMNI_POSTHOG_KEY or the global secret POSTHOG_KEY). Without one nothing is sent. */
  configured: boolean;
}

/** The global secret that holds the PostHog project API key. OMNI_POSTHOG_KEY wins over it. */
export const POSTHOG_KEY_SECRET = 'POSTHOG_KEY';

/** PostHog Cloud EU. OMNI_POSTHOG_HOST points somewhere else, a fake in tests. */
export const POSTHOG_EU_HOST = 'https://eu.i.posthog.com';

/** Which client a person used: the Web UI on a desktop browser, its phone layout, or the desktop app. */
export const SURFACES = ['web', 'phone', 'desktop'] as const;

/** The screens the Web UI reports, its route names (apps/web/src/router.ts). */
export const SCREENS = ['home', 'inbox', 'channels', 'channel', 'thread', 'search', 'automations', 'settings', 'artifacts', 'prs', 'new-channel', 'quick-prompt', 'notfound'] as const;

/** The settings a `settings_changed` names. Never a value other than a boolean. */
export const SETTING_NAMES = [
  'analytics',
  'display.technical',
  'display.shopify',
  'display.openItems',
  'model-visibility',
  'config.user',
  'config.workspace',
  'config.integrations',
  'config.runOn',
  'config.other',
  'push-preferences',
  'worktree-retention',
  'worktree-slim',
  'theme',
  'layout',
] as const;

/** The branch steps a thread can be asked to run (packages/shared/thread-glance.ts PRStep). */
const PR_STEPS = ['open', 'conflicts', 'checks'] as const;

/** The `settings_changed` name for a saved config section (data/omni.config.json): the section, never a field or value. */
export const configSetting = (section: string): (typeof SETTING_NAMES)[number] => {
  const name = `config.${section}`;
  return (SETTING_NAMES as readonly string[]).includes(name) ? (name as (typeof SETTING_NAMES)[number]) : 'config.other';
};

/** A short lowercase word: a harness id, a source, a route's tab or a settings section. Never a name someone chose. */
const TOKEN = /^[a-z][a-z0-9-]{0,31}$/;

type Prop = { kind: 'token' } | { kind: 'enum'; values: readonly string[] } | { kind: 'bool' } | { kind: 'count' };

const token: Prop = { kind: 'token' };
const bool: Prop = { kind: 'bool' };
const count: Prop = { kind: 'count' };
const oneOf = (values: readonly string[]): Prop => ({ kind: 'enum', values });
const surface = oneOf(SURFACES);

/** Every event, with the properties it may carry. */
export const ANALYTICS_EVENTS = {
  /** The server started: the desktop app opening, or a checkout's `npm start`. */
  server_started: { bundled: bool, sync: bool },
  /** A client loaded the Web UI. */
  app_opened: { surface, layout: oneOf(['rail', 'classic', 'phone']) },
  /** A client moved to another screen. `section`: the channel tab, thread view or settings section. */
  screen_viewed: { surface, screen: oneOf(SCREENS), section: token },
  /** Any new thread: from the composer, the Conductor, an automation, a team or a capture. */
  thread_created: { harness: token, source: token, delegated: bool, team: bool, quick: bool, workspace: token, remote: bool },
  /** A thread another thread started (the Conductor's delegate, a crew hand-off, a team's one thread). */
  thread_delegated: { harness: token, source: token, team: bool },
  /** A message sent to a thread, by the user or the Conductor. `step`: one of the branch steps' prompts (Open PR, Fix conflicts, Fix checks). */
  message_sent: { harness: token, mode: oneOf(['steer', 'queue', 'interrupt']), from: oneOf(['user', 'conductor']), attachments: count, step: oneOf(PR_STEPS) },
  /** Open PR, Fix conflicts or Fix checks asked of a thread's agent, from any client. Omni does not see the PR itself open. */
  pr_step_requested: { harness: token, step: oneOf(PR_STEPS) },
  /** A setting changed. `value` only for an on/off switch. */
  settings_changed: { setting: oneOf(SETTING_NAMES), value: bool },
} as const satisfies Record<string, Record<string, Prop>>;

export type AnalyticsEvent = keyof typeof ANALYTICS_EVENTS;

/** What a client may report itself (POST /api/analytics/events). The rest the server sees happen and reports. */
export const CLIENT_EVENTS: readonly AnalyticsEvent[] = ['app_opened', 'screen_viewed', 'settings_changed'];

/** The settings only a client keeps (localStorage), which only it can report changing. */
export const CLIENT_SETTINGS: readonly (typeof SETTING_NAMES)[number][] = ['theme', 'layout'];
export type AnalyticsProps = Record<string, string | number | boolean>;

export const isAnalyticsEvent = (v: unknown): v is AnalyticsEvent => typeof v === 'string' && Object.hasOwn(ANALYTICS_EVENTS, v);

function cleanValue(p: Prop, v: unknown): string | number | boolean | undefined {
  switch (p.kind) {
    case 'bool':
      return typeof v === 'boolean' ? v : undefined;
    case 'count':
      return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10_000 ? v : undefined;
    case 'enum':
      return typeof v === 'string' && p.values.includes(v) ? v : undefined;
    case 'token':
      return typeof v === 'string' && TOKEN.test(v) ? v : undefined;
  }
}

/** An event as it may be sent: a listed name and only its listed properties, each the right kind. null for any other name. */
export function cleanEvent(event: unknown, props: unknown): { event: AnalyticsEvent; props: AnalyticsProps } | null {
  if (!isAnalyticsEvent(event)) return null;
  const allowed: Record<string, Prop> = ANALYTICS_EVENTS[event];
  const raw = props && typeof props === 'object' ? (props as Record<string, unknown>) : {};
  const out: AnalyticsProps = {};
  for (const [k, p] of Object.entries(allowed)) {
    const v = cleanValue(p, raw[k]);
    if (v !== undefined) out[k] = v;
  }
  return { event, props: out };
}

/** A harness as an event names it: a built-in id as is, a custom harness (`custom:<slug>`, slug chosen by the user) as `custom`. */
export const harnessToken = (h: string | null | undefined): string => (!h ? 'unknown' : h.startsWith('custom:') ? 'custom' : TOKEN.test(h) ? h : 'other');

// ---------- exceptions ----------

/** One stack frame, without the folders: a file's name and the function, nothing a path could leak. */
export interface ExceptionFrame {
  function?: string;
  file: string;
  line?: number;
  col?: number;
}

/** An error as it may be sent: its class and where it was thrown. Its message stays here: it can quote anything. */
export interface CleanException {
  type: string;
  frames: ExceptionFrame[];
  handled: boolean;
  source: 'server' | 'web';
  /** The API route's pattern (`/api/threads/:id`) or the screen, never a filled-in path. */
  where?: string;
  surface?: (typeof SURFACES)[number];
}

const IDENT = /^[A-Za-z_$][\w$.<> ]{0,99}$/;
const FILE = /^[\w.@+-]{1,100}$/;
const ROUTE = /^\/[\w/:.*-]{0,120}$/;
const MAX_FRAMES = 30;

/** The last part of a path or URL, without a query: `index-abc123.js` from `http://127.0.0.1:4747/assets/index-abc123.js?v=1`. */
export function fileName(path: string): string {
  const noQuery = path.split(/[?#]/)[0] ?? '';
  return noQuery.split(/[\\/]/).filter(Boolean).at(-1) ?? '';
}

/**
 * The frames of a stack, innermost first, each reduced to a function name and a file name. V8 (Chromium, Node) writes
 * the message first and then `    at fn (file:line:col)` lines: only those are read, so no line of the message is.
 * WebKit and Gecko write `fn@url:line:col` lines and no message.
 */
export function stackFrames(stack: string | undefined): ExceptionFrame[] {
  if (!stack) return [];
  const lines = stack.split('\n');
  const v8 = lines.some((l) => /^\s+at /.test(l));
  const frames: ExceptionFrame[] = [];
  for (const line of lines) {
    const m = v8 ? /^\s+at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line) : /^(?:([^@\s]*)@)?([a-z-]+:\/\/\S+?|[^\s:]+):(\d+):(\d+)$/.exec(line.trim());
    if (!m) continue;
    const file = fileName(m[2]);
    if (!FILE.test(file)) continue;
    const fn = m[1]?.replace(/^async /, '');
    frames.push({ ...(fn && IDENT.test(fn) && { function: fn }), file, line: Number(m[3]), col: Number(m[4]) });
    if (frames.length >= MAX_FRAMES) break;
  }
  return frames;
}

/** An exception from a client or the server, checked the way `cleanEvent` checks an event. null when its type is not a plain name. */
export function cleanException(v: unknown): CleanException | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const type = typeof o.type === 'string' && IDENT.test(o.type) ? o.type : null;
  if (!type) return null;
  const frames = (Array.isArray(o.frames) ? o.frames : []).slice(0, MAX_FRAMES).flatMap((f): ExceptionFrame[] => {
    if (!f || typeof f !== 'object') return [];
    const r = f as Record<string, unknown>;
    if (typeof r.file !== 'string' || !FILE.test(r.file)) return [];
    const num = (n: unknown) => (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 10_000_000 ? n : undefined);
    const line = num(r.line);
    const col = num(r.col);
    return [{ ...(typeof r.function === 'string' && IDENT.test(r.function) && { function: r.function }), file: r.file, ...(line !== undefined && { line }), ...(col !== undefined && { col }) }];
  });
  const where = typeof o.where === 'string' && (ROUTE.test(o.where) || (SCREENS as readonly string[]).includes(o.where)) ? o.where : undefined;
  const surface = (SURFACES as readonly string[]).includes(o.surface as string) ? (o.surface as CleanException['surface']) : undefined;
  return { type, frames, handled: o.handled === true, source: o.source === 'server' ? 'server' : 'web', ...(where && { where }), ...(surface && { surface }) };
}

/** An Error as a client or the server reports it: its class name and its frames, never its message. */
export function exceptionOf(err: unknown, extra: Omit<CleanException, 'type' | 'frames'>): CleanException | null {
  const e = err instanceof Error ? err : null;
  const type = e ? (e.constructor?.name && e.constructor.name !== 'Object' ? e.constructor.name : e.name) || 'Error' : typeof err === 'string' ? 'StringThrown' : 'NonError';
  return cleanException({ ...extra, type, frames: stackFrames(e?.stack) });
}
