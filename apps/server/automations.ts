import { existsSync, readFileSync, mkdirSync, watch } from 'node:fs';
import { removeOwnFileOnDisk, yamlFiles } from './automation-store.ts';
import { Cron } from 'croner';
import YAML from 'yaml';
import { config, paths } from './config.ts';
import { automationRuns, channels, db } from './db.ts';
import { record } from './db/sync.ts';
import { publishFeed } from './bus.ts';
import { createThread } from './runner.ts';
import { runsHere } from './sync/owner.ts';
import { parseTrigger, type EventTrigger } from './automation-events.ts';
import { fillPlaceholders, NEEDS_CHECKOUT, omniCheckout, updateUserConfig, userConfig } from './user-config.ts';
import { parsePrecheck, runPrecheck, type Precheck } from './automation-precheck.ts';
import { commandsFolder } from './sandbox.ts';

export interface Automation {
  id: string;
  name: string;
  /** Empty for an event automation. */
  cron: string;
  /** Set for an event automation: it runs when this happens, not on a schedule. */
  on?: EventTrigger;
  timezone: string;
  channel: string;
  role?: string;
  harness?: string;
  model?: string;
  effort?: string;
  prompt: string;
  enabled: boolean;
  /** Run a slot that was missed because the Mac was asleep or Omni was not running, once Omni is back. */
  catchup?: boolean;
  /** `catchup_max_age`, in seconds: a missed slot older than this is recorded as skipped instead of run. */
  catchupMaxAge?: number;
  /** Run before a scheduled run (cron or catch-up) starts anything; a failure skips the run. */
  precheck?: Precheck;
  /** The synced machine that runs it, by name or sync id. Unset, the one picked in "Run automations on" (sync/owner.ts). */
  machine?: string;
  file: string;
  error?: string;
  next?: string | null;
}

export function parseAutomation(id: string, src: string, file = ''): Automation {
  let y: any = {};
  let yamlError: string | undefined;
  try {
    y = YAML.parse(src) ?? {};
  } catch (err) {
    yamlError = `bad yaml: ${(err as Error).message}`;
  }
  const rawPrompt = String(y.prompt ?? '').trim();
  const a: Automation = {
    id,
    name: y.name ?? id,
    cron: String(y.cron ?? ''),
    timezone: y.timezone ?? config.timezone,
    channel: y.channel ?? 'inbox',
    role: y.role,
    harness: y.harness,
    model: y.model,
    effort: y.effort,
    prompt: fillPlaceholders(rawPrompt),
    enabled: y.enabled === true,
    file,
    catchup: y.catchup === true,
    ...(typeof y.machine === 'string' && y.machine.trim() && { machine: y.machine.trim() }),
  };
  let rawPrecheck = '';
  if (!yamlError && y.on !== undefined) {
    const t = parseTrigger(y.on);
    if (typeof t === 'string') a.error = `invalid "on": ${t}`;
    else a.on = t;
  }
  if (!yamlError && !a.error && y.precheck !== undefined) {
    const p = parsePrecheck(y.precheck);
    if (typeof p === 'string') a.error = p;
    else (rawPrecheck = p.command), (a.precheck = { ...p, command: fillPlaceholders(p.command) });
  }
  if (!yamlError && !a.error && y.catchup_max_age !== undefined) {
    const age = parseAge(y.catchup_max_age);
    if (age === null) a.error = 'catchup_max_age must be seconds or a duration like 90m, 6h or 2d';
    else a.catchupMaxAge = age;
  }
  if (yamlError) (a.error = yamlError), (a.enabled = false);
  else if (a.error) return a;
  else if (a.on && a.cron) a.error = 'set either cron or on, not both';
  else if (!a.on && !a.cron) a.error = 'missing cron';
  else if (!a.prompt) a.error = 'missing prompt';
  else if ((NEEDS_CHECKOUT.test(rawPrompt) || NEEDS_CHECKOUT.test(rawPrecheck)) && !omniCheckout()) a.error = 'needs an Omni checkout: set OMNI_CHECKOUT in the data dir\'s .env';
  else if (a.on) a.next = null;
  else {
    try {
      a.next = new Cron(a.cron, { timezone: a.timezone, paused: true }).nextRun()?.toISOString() ?? null;
    } catch (err) {
      a.error = `invalid schedule (cron "${a.cron}", timezone "${a.timezone}"): ${(err as Error).message}`;
    }
  }
  return a;
}

const AGE_UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 };

/** Seconds from a number of seconds or a duration such as `45s`, `90m`, `6h` or `2d`; null when it is neither. */
export function parseAge(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
  const m = typeof raw === 'string' ? /^\s*(\d+(?:\.\d+)?)\s*([smhd])\s*$/i.exec(raw) : null;
  if (!m) return null;
  const n = Number(m[1]) * AGE_UNITS[m[2].toLowerCase()];
  return n > 0 ? n : null;
}

/** A duration in seconds as the YAML would write it: `6h`, `90m`, `45s`. */
function ageLabel(sec: number) {
  for (const [unit, n] of [['d', 86_400], ['h', 3600], ['m', 60]] as const) if (sec >= n && sec % n === 0) return `${sec / n}${unit}`;
  return `${sec}s`;
}

/**
 * The shared automations in automations/ (Omni ships none, tests point OMNI_AUTOMATIONS_DIR at their own) and the
 * user's own in data/automations/ (same id there wins). The user
 * config's per-automation overrides (`enabled`, `channel`) apply last, so turning one on never edits a repo file.
 * A shared one deleted on this machine (`deleted`) is left out; the user's own file of that id still loads.
 */
export function loadAutomations(): Automation[] {
  const overrides = userConfig().automations;
  const files = new Map<string, string>();
  for (const [id, file] of yamlFiles(paths.automations)) if (!overrides[id]?.deleted) files.set(id, file);
  for (const [id, file] of yamlFiles(paths.personalAutomations)) files.set(id, file);
  return [...files].map(([id, file]) => {
    const a = parseAutomation(id, readFileSync(file, 'utf8'), file);
    const o = overrides[id];
    if (o?.channel) a.channel = o.channel;
    if (o?.enabled !== undefined && !a.error) a.enabled = o.enabled;
    return a;
  });
}

const jobs = new Map<string, Cron>();

/**
 * `event` runs pass their own prompt (the automation's plus what happened) and title, and a delivery its thread's id
 * (automation-triggers.ts), fixed in advance so a restart never makes the thread twice.
 */
export async function runAutomation(a: Automation, trigger: 'cron' | 'manual' | 'catchup' | 'event', event?: { prompt: string; title: string; id?: string }) {
  const date = new Date().toLocaleDateString('en-GB', { timeZone: a.timezone, day: 'numeric', month: 'short' });
  const thread = await createThread({
    id: event?.id,
    channel: a.channel,
    role: a.role,
    harness: a.harness,
    model: a.model,
    effort: a.effort,
    prompt: event?.prompt ?? a.prompt,
    title: event?.title ?? `${a.name} · ${date}`,
    source: 'automation',
    automation: a.id,
  });
  automationRuns.add(a.id, thread.id, trigger);
  return thread;
}

/**
 * A skipped scheduled run: a history row with its reason and no thread. It also counts as the slot's run, so a
 * catch-up does not try the same slot again.
 */
function recordSkip(a: Automation, trigger: 'cron' | 'catchup', reason: string) {
  console.log(`[automations] ${a.id} skipped (${trigger}): ${reason}`);
  automationRuns.skip(a.id, trigger, reason);
  return null;
}

/** Where a precheck runs: the channel's folder (its repo, else its base dir, else the brain), as for its threads. */
function precheckDir(a: Automation) {
  const ch = channels.get(a.channel);
  return (ch && commandsFolder(ch)) || paths.data;
}

/** Automations whose scheduled run is starting: a precheck can take a while, and a catch-up must not start it twice. */
const starting = new Set<string>();

/**
 * A scheduled run (cron tick or catch-up): its precheck first, if it has one. A failed precheck records a skipped
 * run and returns null; no thread is made and no harness starts. Manual and event runs never run the precheck.
 */
async function runScheduled(a: Automation, trigger: 'cron' | 'catchup') {
  if (starting.has(a.id)) return null;
  starting.add(a.id);
  try {
    if (a.precheck) {
      const reason = await runPrecheck(a.precheck, precheckDir(a));
      if (reason) return recordSkip(a, trigger, reason);
    }
    return await runAutomation(a, trigger);
  } finally {
    starting.delete(a.id);
  }
}

/**
 * A cron tick. With sync on, only the machine that runs this automation runs it: its own `machine:`, else the one
 * that owns automations (apps/server/sync/owner.ts). Another machine skips it and returns null. Manual runs call
 * runAutomation directly and are never skipped.
 */
export async function fireScheduled(a: Automation) {
  if (!runsHere(a)) return null;
  return runScheduled(a, 'cron');
}

/** Slots younger than this belong to the cron job itself, which may still be starting the run. */
const CATCHUP_GRACE_MS = 2 * 60_000;

/**
 * Runs the most recent slot of a `catchup: true` automation when no run of any kind started at or after it,
 * because the Mac slept through it or Omni was not running. Older missed slots fold into this one run. Gated
 * like a cron tick. Returns the thread, or null when nothing was missed.
 */
export async function catchUp(a: Automation, now = new Date()) {
  if (!a.catchup || !a.enabled || a.error || a.on || starting.has(a.id)) return null;
  const slot = new Cron(a.cron, { timezone: a.timezone, paused: true }).previousRuns(1, now)[0];
  if (!slot || now.getTime() - slot.getTime() < CATCHUP_GRACE_MS) return null;
  const ran = db
    .prepare('SELECT 1 FROM automation_runs WHERE automation = ? AND created_at >= ? LIMIT 1')
    .get(a.id, slot.toISOString());
  if (ran || !runsHere(a)) return null;
  if (a.catchupMaxAge !== undefined && now.getTime() - slot.getTime() > a.catchupMaxAge * 1000)
    return recordSkip(a, 'catchup', `missed run at ${slot.toISOString()} is older than catchup_max_age (${ageLabel(a.catchupMaxAge)})`);
  console.log(`[automations] ${a.id} missed ${slot.toISOString()}, catching up`);
  return runScheduled(a, 'catchup');
}

function catchUpAll() {
  let all: Automation[];
  try {
    all = loadAutomations();
  } catch (err) {
    return console.error('[automations] could not load automations:', err);
  }
  for (const a of all) catchUp(a).catch((err) => console.error(`[automations] ${a.id} catch-up failed:`, err));
}

export function lastRuns(id: string, limit = 10) {
  return db
    .prepare(
      `SELECT r.id, r.automation, r.thread_id, r.trigger, r.created_at, CASE WHEN r.skip_reason IS NOT NULL THEN 'skipped' ELSE t.status END AS status,
       t.title, r.skip_reason FROM automation_runs r LEFT JOIN threads t ON t.id = r.thread_id
       WHERE r.automation = ? ORDER BY r.created_at DESC, r.id DESC LIMIT ?`,
    )
    .all(id, limit);
}

export function schedule() {
  try {
    scheduleAll();
  } catch (err) {
    console.error('[automations] could not load automations:', err);
  }
  publishFeed({ type: 'automations' });
}

function scheduleAll() {
  for (const j of jobs.values()) j.stop();
  jobs.clear();
  for (const a of loadAutomations()) {
    if (!a.enabled || a.error || a.on) continue; // event automations are started by apps/server/automation-watch.ts
    jobs.set(
      a.id,
      new Cron(a.cron, { timezone: a.timezone, protect: true }, () => {
        fireScheduled(a).catch((err) => console.error(`[automations] ${a.id} failed:`, err));
      }),
    );
  }
  console.log(`[automations] ${jobs.size} scheduled`);
  catchUpAll();
}

/**
 * Delete a listed automation on this machine. The user's own YAML in data/automations/ is removed. One shipped in
 * automations/ stays on disk, since the next update would bring it back, and is hidden here with `deleted` in
 * data/omni.config.json instead. Its schedule stops now; threads it already started stay. Only files listed under
 * its id are touched, so the id never becomes a path.
 */
export function deleteAutomation(a: Automation): 'file' | 'hidden' {
  const own = removeOwnFileOnDisk(a.id);
  // The other machines drop their copy too (sync/handlers/automation-file.ts). Hiding a shipped one stays on this machine.
  if (own) record('automation_file', a.id, 'delete');
  const shipped = yamlFiles(paths.automations).some(([id]) => id === a.id);
  updateUserConfig({ automations: { [a.id]: shipped ? { deleted: true } : null } });
  schedule();
  return own ? 'file' : 'hidden';
}

// Also how a catch-up notices the Mac woke up: timers sleep with it, so this fires soon after wake.
const CATCHUP_EVERY_MS = 5 * 60_000;

export function startScheduler() {
  schedule();
  setInterval(catchUpAll, CATCHUP_EVERY_MS).unref();
  let t: NodeJS.Timeout | undefined;
  mkdirSync(paths.personalAutomations, { recursive: true });
  // Omni ships no automations, so the shared folder is usually missing, and in the app it is read-only: never made here.
  for (const dir of [paths.automations, paths.personalAutomations].filter((d) => existsSync(d)))
    watch(dir, () => {
      clearTimeout(t);
      t = setTimeout(schedule, 300);
    });
}
