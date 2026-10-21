import { readdirSync, readFileSync, existsSync, mkdirSync, watch } from 'node:fs';
import { join } from 'node:path';
import { Cron } from 'croner';
import YAML from 'yaml';
import { config, paths } from './config.ts';
import { automationRuns, db } from './db.ts';
import { createThread } from './runner.ts';
import { runsAutomationsHere } from './sync/owner.ts';
import { fillPlaceholders, updateUserConfig, userConfig } from './user-config.ts';

export interface Automation {
  id: string;
  name: string;
  cron: string;
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
    prompt: fillPlaceholders(String(y.prompt ?? '').trim()),
    enabled: y.enabled === true,
    file,
    catchup: y.catchup === true,
  };
  if (yamlError) (a.error = yamlError), (a.enabled = false);
  else if (!a.cron) a.error = 'missing cron';
  else if (!a.prompt) a.error = 'missing prompt';
  else {
    try {
      a.next = new Cron(a.cron, { timezone: a.timezone, paused: true }).nextRun()?.toISOString() ?? null;
    } catch (err) {
      a.error = `invalid schedule (cron "${a.cron}", timezone "${a.timezone}"): ${(err as Error).message}`;
    }
  }
  return a;
}

/**
 * The shared automations in automations/ and the user's own in data/automations/ (same id there wins). The user
 * config's per-automation overrides (`enabled`, `channel`) apply last, so turning one on never edits a repo file.
 */
export function loadAutomations(): Automation[] {
  const files = new Map<string, string>();
  for (const dir of [paths.automations, paths.personalAutomations]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) if (/\.ya?ml$/.test(f)) files.set(f.replace(/\.ya?ml$/, ''), join(dir, f));
  }
  const overrides = userConfig().automations;
  return [...files].map(([id, file]) => {
    const a = parseAutomation(id, readFileSync(file, 'utf8'), file);
    const o = overrides[id];
    if (o?.channel) a.channel = o.channel;
    if (o?.enabled !== undefined && !a.error) a.enabled = o.enabled;
    return a;
  });
}

const jobs = new Map<string, Cron>();

export async function runAutomation(a: Automation, trigger: 'cron' | 'manual' | 'catchup') {
  const date = new Date().toLocaleDateString('en-GB', { timeZone: a.timezone, day: 'numeric', month: 'short' });
  const thread = await createThread({
    channel: a.channel,
    role: a.role,
    harness: a.harness,
    model: a.model,
    effort: a.effort,
    prompt: a.prompt,
    title: `${a.name} · ${date}`,
    source: 'automation',
    automation: a.id,
  });
  automationRuns.add(a.id, thread.id, trigger);
  return thread;
}

/**
 * A cron tick. With sync on, only the Mac that owns scheduled automations runs it (apps/server/sync/owner.ts); the
 * other Mac skips it and returns null. Manual runs call runAutomation directly and are never skipped.
 */
export async function fireScheduled(a: Automation) {
  if (!runsAutomationsHere()) return null;
  return runAutomation(a, 'cron');
}

/** Slots younger than this belong to the cron job itself, which may still be starting the run. */
const CATCHUP_GRACE_MS = 2 * 60_000;
const catchingUp = new Set<string>();

/**
 * Runs the most recent slot of a `catchup: true` automation when no run of any kind started at or after it,
 * because the Mac slept through it or Omni was not running. Older missed slots fold into this one run. Gated
 * like a cron tick. Returns the thread, or null when nothing was missed.
 */
export async function catchUp(a: Automation, now = new Date()) {
  if (!a.catchup || !a.enabled || a.error || catchingUp.has(a.id)) return null;
  const slot = new Cron(a.cron, { timezone: a.timezone, paused: true }).previousRuns(1, now)[0];
  if (!slot || now.getTime() - slot.getTime() < CATCHUP_GRACE_MS) return null;
  const ran = db
    .prepare('SELECT 1 FROM automation_runs WHERE automation = ? AND created_at >= ? LIMIT 1')
    .get(a.id, slot.toISOString());
  if (ran || !runsAutomationsHere()) return null;
  catchingUp.add(a.id);
  console.log(`[automations] ${a.id} missed ${slot.toISOString()}, catching up`);
  try {
    return await runAutomation(a, 'catchup');
  } finally {
    catchingUp.delete(a.id);
  }
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
      `SELECT r.id, r.automation, r.thread_id, r.trigger, r.created_at, t.status, t.title FROM automation_runs r LEFT JOIN threads t ON t.id = r.thread_id
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
}

function scheduleAll() {
  for (const j of jobs.values()) j.stop();
  jobs.clear();
  for (const a of loadAutomations()) {
    if (!a.enabled || a.error) continue;
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

/** Turn one on or off for this user: an override in data/omni.config.json, never an edit to the YAML. */
export function setEnabled(id: string, enabled: boolean) {
  const a = loadAutomations().find((x) => x.id === id);
  if (!a) throw new Error('automation not found');
  updateUserConfig({ automations: { [id]: { enabled } } });
  schedule();
}

// Also how a catch-up notices the Mac woke up: timers sleep with it, so this fires soon after wake.
const CATCHUP_EVERY_MS = 5 * 60_000;

export function startScheduler() {
  schedule();
  setInterval(catchUpAll, CATCHUP_EVERY_MS).unref();
  let t: NodeJS.Timeout | undefined;
  mkdirSync(paths.personalAutomations, { recursive: true });
  for (const dir of [paths.automations, paths.personalAutomations])
    watch(dir, () => {
      clearTimeout(t);
      t = setTimeout(schedule, 300);
    });
}
