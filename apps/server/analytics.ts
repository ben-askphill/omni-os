// Usage analytics to PostHog (packages/shared/analytics.ts lists the events and what each may carry). This is the only
// code that sends: the server's own events, and the Web UI's through POST /api/analytics/events (analytics-api.ts).
//
// Nothing goes out without a project key (OMNI_POSTHOG_KEY, else the global secret POSTHOG_KEY) and with Settings >
// About > Usage analytics on. The switch is checked when an event is captured and again when the batch is sent, so
// turning it off drops what is waiting. Events carry an anonymous install id, the app version and the OS, and ask
// PostHog for no person profile and no GeoIP lookup.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { join } from 'node:path';
import {
  cleanEvent,
  exceptionOf,
  cleanException,
  POSTHOG_EU_HOST,
  POSTHOG_KEY_SECRET,
  type AnalyticsEvent,
  type AnalyticsState,
  type CleanException,
} from '@omni/shared/analytics.ts';
import { about } from './about.ts';
import { paths } from './config.ts';
import { kv } from './db.ts';
import { globalSecret, onSecretChange } from './secrets.ts';

/** The kv row: the switch and the install id. Synced, so the switch and the id are the same on every machine. */
export const ANALYTICS_KV = 'analytics';
interface Saved {
  enabled: boolean;
  id?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function saved(): Saved {
  const v = kv.get<Partial<Saved>>(ANALYTICS_KV);
  return { enabled: typeof v?.enabled === 'boolean' ? v.enabled : true, ...(typeof v?.id === 'string' && UUID.test(v.id) && { id: v.id }) };
}

/** The anonymous id every event goes out under, made the first time one is sent. Not the user's name or email. */
function installId(): string {
  const s = saved();
  if (s.id) return s.id;
  const id = randomUUID();
  kv.set(ANALYTICS_KV, { ...s, id });
  return id;
}

// ---------- the key ----------

let secretKey: Promise<string | null> | null = null;
onSecretChange((scope, name) => {
  if (scope === 'global' && name === POSTHOG_KEY_SECRET) secretKey = null;
});

/** The PostHog project API key, or null: then nothing is ever sent. */
async function projectKey(): Promise<string | null> {
  const env = process.env.OMNI_POSTHOG_KEY?.trim();
  if (env) return env;
  secretKey ??= globalSecret(POSTHOG_KEY_SECRET)
    .then((v) => v?.trim() || null)
    .catch(() => null);
  return secretKey;
}

const host = () => (process.env.OMNI_POSTHOG_HOST?.trim() || POSTHOG_EU_HOST).replace(/\/+$/, '');

export async function analyticsState(): Promise<AnalyticsState> {
  return { enabled: saved().enabled, configured: !!(await projectKey()) };
}

/** Turn capture on or off for every machine. Off drops anything still waiting to go. */
export async function setAnalyticsEnabled(enabled: boolean): Promise<AnalyticsState> {
  kv.set(ANALYTICS_KV, { ...saved(), enabled });
  if (!enabled) queue.length = 0;
  else capture('settings_changed', { setting: 'analytics', value: true });
  return analyticsState();
}

// ---------- the queue ----------

interface Queued {
  event: string;
  uuid: string;
  timestamp: string;
  properties: Record<string, unknown>;
}

const queue: Queued[] = [];
const MAX_QUEUE = 500;
const BATCH_AT = 50;
const flushMs = () => Number(process.env.OMNI_POSTHOG_FLUSH_MS ?? 5000);
let timer: ReturnType<typeof setTimeout> | null = null;

function enqueue(event: string, properties: Record<string, unknown>) {
  if (!saved().enabled) return;
  queue.push({ event, uuid: randomUUID(), timestamp: new Date().toISOString(), properties });
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  if (queue.length >= BATCH_AT) void flushAnalytics();
  else if (!timer) {
    timer = setTimeout(() => void flushAnalytics(), flushMs());
    timer.unref?.();
  }
}

/**
 * Note that something happened. Only a listed event with its listed properties is kept (cleanEvent); the rest is
 * dropped here, so a caller cannot send more than packages/shared/analytics.ts allows.
 */
export function capture(event: AnalyticsEvent, props: Record<string, unknown> = {}) {
  const clean = cleanEvent(event, props);
  if (clean) enqueue(clean.event, clean.props);
}

/** The last status PostHog answered, for the log line: each new one is logged once. */
let lastStatus: number | string | null = null;

/** Send what is waiting, now. Resolves with how many went and PostHog's status, or 0 when nothing could go. */
export async function flushAnalytics(): Promise<{ sent: number; status?: number }> {
  if (timer) clearTimeout(timer);
  timer = null;
  const batch = queue.splice(0);
  if (!batch.length || !saved().enabled) return { sent: 0 };
  const apiKey = await projectKey();
  if (!apiKey) return { sent: 0 };
  const distinct_id = installId();
  const common = {
    $lib: 'omni-server',
    $lib_version: about.version,
    app_version: about.version,
    os: platform(),
    os_arch: arch(),
    $process_person_profile: false,
    $geoip_disable: true,
  };
  const body = JSON.stringify({ api_key: apiKey, batch: batch.map((e) => ({ ...e, distinct_id, properties: { ...common, ...e.properties } })) });
  try {
    const res = await fetch(`${host()}/batch/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(10_000) });
    if (res.status !== lastStatus) console.log(`[analytics] PostHog answered ${res.status} for ${batch.length} event${batch.length === 1 ? '' : 's'}`);
    lastStatus = res.status;
    return { sent: res.ok ? batch.length : 0, status: res.status };
  } catch (err) {
    const why = (err as Error).name;
    if (why !== lastStatus) console.log(`[analytics] could not reach PostHog (${why})`);
    lastStatus = why;
    return { sent: 0 };
  }
}

// ---------- exceptions ----------

/** The same error from the same place goes once a minute at most. */
const lastSent = new Map<string, number>();
const REPEAT_MS = 60_000;

/** An exception as PostHog's Error tracking reads it: its class and frames, outermost first, and no message. */
function exceptionProps(e: CleanException): Record<string, unknown> {
  const platform = e.source === 'server' ? 'node:javascript' : 'web:javascript';
  return {
    $exception_list: [
      {
        type: e.type,
        value: e.type,
        mechanism: { handled: e.handled, synthetic: false, type: 'generic' },
        stacktrace: {
          type: 'raw',
          frames: e.frames
            .map((f) => ({ platform, filename: f.file, function: f.function ?? '?', lineno: f.line, colno: f.col, in_app: true }))
            .reverse(),
        },
      },
    ],
    $exception_level: 'error',
    exception_source: e.source,
    ...(e.where && { where: e.where }),
    ...(e.surface && { surface: e.surface }),
  };
}

/** Report a cleaned exception (cleanException), from the server or a client. */
export function captureCleanException(e: CleanException | null) {
  if (!e) return;
  const key = `${e.source}:${e.type}:${e.frames[0]?.file}:${e.frames[0]?.line}`;
  const now = Date.now();
  if (now - (lastSent.get(key) ?? 0) < REPEAT_MS) return;
  lastSent.set(key, now);
  enqueue('$exception', exceptionProps(e));
}

/** Report an error the server caught: a route's 500 (`where` its pattern) or a failed background job. */
export function captureException(err: unknown, opts: { where?: string; handled?: boolean } = {}) {
  captureCleanException(exceptionOf(err, { source: 'server', handled: opts.handled ?? true, ...(opts.where && { where: opts.where }) }));
}

// ---------- a crash ----------

/**
 * The server is about to die of an uncaught error, so nothing async runs again: the cleaned error goes to a file in the
 * data folder, and the next start sends it (sendSavedCrash).
 */
const crashFile = () => join(paths.data, 'analytics-crash.json');

export function saveCrash(err: unknown) {
  if (!saved().enabled) return;
  const e = exceptionOf(err, { source: 'server', handled: false });
  if (!e) return;
  try {
    writeFileSync(crashFile(), JSON.stringify(e));
  } catch {
    // Dying anyway: a crash we cannot write down goes unreported.
  }
}

export function sendSavedCrash() {
  const file = crashFile();
  if (!existsSync(file)) return;
  try {
    captureCleanException(cleanException(JSON.parse(readFileSync(file, 'utf8'))));
  } catch {
    // A torn file from the crash: nothing to send.
  }
  rmSync(file, { force: true });
}

/** For tests: forget what is waiting and what was sent. */
export function resetAnalyticsForTests() {
  queue.length = 0;
  lastSent.clear();
  secretKey = null;
  lastStatus = null;
  if (timer) clearTimeout(timer);
  timer = null;
}
