// Antigravity's plan usage: the 5-hour and weekly windows of each model group on the Google account agy runs as.
// agy reads them itself. Omni runs agy's own /usage command in print mode (`agy -p /usage --output-format json`) and
// takes the numbers from its answer, so Omni never reads, holds or sends agy's Google sign-in. That is what kept the
// earlier design (#982, T3 Code's reader of agy's stored refresh token) from being built. Proven on agy 1.5.16: the
// command runs no model, costs no tokens and opens no conversation.
// - It runs with the state check's environment (state.ts antigravityEnv: the harness guard, openers that only write a
//   link down, the CA bundle) in one fixed folder under Omni's data dir, since agy keeps a little state per folder and
//   a new folder on every read would add to it. agy's log goes to that folder (--log-file), not to agy's own, and is
//   deleted once read.
// - The answer lists each group ("Gemini Models", "Claude and GPT models") with its buckets (window "5h" or "weekly",
//   remaining_fraction, reset_time). Utilization is the part not remaining. The Gemini group comes first, as the
//   default model's (catalog.ts ANTIGRAVITY_DEFAULT), and its windows are the reading's top-level ones too.
// - agy's log says which account it read as. A reading for another account than the one the last state check found
//   is not filed: a check runs instead, and the read after it files under the account it found.
// - When: each time a state check finds agy ready (server start, Check again, a thread starting), every 15 minutes
//   while it is, and shortly after each Antigravity turn. One read at a time. A failed read keeps the last reading for
//   an hour, then the row says "no data", as Cursor's does. agy trying to open a sign-in link means it is signed out.
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { PlanPool, PlanWindow } from '@omni/shared/account-usage.ts';
import { paths } from './config.ts';
import { clean } from './harness/accounts-parse.ts';
import { antigravityBin } from './harness/antigravity/bin.ts';
import { antigravityEnv, antigravityState, emailFromLog, markSignedOut, onAntigravityChecked, refreshAntigravity, writeOpeners } from './harness/antigravity/state.ts';
import type { Usage } from './stream.ts';
import { clearUsage, recordUsage, usageFor } from './usage.ts';

/** How long one read may take. agy unpacks its runtime on every start; a read takes about 3 seconds. */
export const READ_MS = 30_000;
/** A reading older than this, with every read since failing, is dropped to "no data". */
const STALE_MS = 60 * 60 * 1000;
/** How often the allowances are read while agy is ready. */
const EVERY_MS = 15 * 60 * 1000;
/** After a turn ends: one read, once Google has counted it. Turns that end together fold into one read. */
const AFTER_TURN_MS = 5_000;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** One bucket as a window: used is what is not remaining, 0 to 1, and the reset in epoch seconds. */
function bucketWindow(b: Record<string, unknown>): PlanWindow | null {
  const remaining = num(b.remaining_fraction);
  const resets = typeof b.reset_time === 'string' ? Date.parse(b.reset_time) : NaN;
  if (remaining === undefined || !Number.isFinite(resets)) return null;
  return { utilization: Math.round(Math.max(0, Math.min(1, 1 - remaining)) * 10_000) / 10_000, resetsAt: Math.round(resets / 1000) };
}

/** Which window a bucket is: agy names it, and its id ends with it ("gemini-5h", "3p-weekly"). */
function bucketKind(b: Record<string, unknown>): 'five_hour' | 'seven_day' | null {
  const named = typeof b.window === 'string' ? b.window : typeof b.id === 'string' ? b.id.split('-').pop() : null;
  return named === '5h' ? 'five_hour' : named === 'weekly' ? 'seven_day' : null;
}

/** A group with Gemini models: the default model's, so it goes first. */
const isGemini = (name: string, ids: string[]) => /^gemini\b/i.test(name) || ids.some((id) => id.startsWith('gemini'));

/**
 * agy's /usage answer (`--output-format json`) as a reading, or null when it holds no window Omni can read. Only the
 * group names and the numbers are kept, and a name goes through the same cleaning as every account field.
 */
export function parseAgyUsage(stdout: string, now = new Date()): Usage | null {
  let answer: unknown;
  try {
    answer = JSON.parse(stdout.trim());
  } catch {
    return null;
  }
  const groups = obj(obj(obj(answer)?.command)?.data)?.groups;
  if (!Array.isArray(groups)) return null;
  const read: { pool: PlanPool; gemini: boolean }[] = [];
  for (const g of groups) {
    const group = obj(g);
    const name = clean(typeof group?.name === 'string' ? group.name.replace(/\s+models$/i, '') : null, 40);
    const buckets = Array.isArray(group?.buckets) ? group.buckets.flatMap((b: unknown): Record<string, unknown>[] => (obj(b) ? [obj(b)!] : [])) : [];
    if (!name) continue;
    const pool: PlanPool = { name };
    for (const b of buckets) {
      const kind = bucketKind(b);
      const w = kind && bucketWindow(b);
      if (kind && w && !pool[kind]) pool[kind] = w;
    }
    if (!pool.five_hour && !pool.seven_day) continue;
    read.push({ pool, gemini: isGemini(name, buckets.flatMap((b) => (typeof b.id === 'string' ? [b.id] : []))) });
  }
  if (!read.length) return null;
  const pools = [...read.filter((r) => r.gemini), ...read.filter((r) => !r.gemini)].map((r) => r.pool);
  const first = pools[0];
  return {
    ...(first.five_hour && { five_hour: first.five_hour }),
    ...(first.seven_day && { seven_day: first.seven_day }),
    pools,
    updated_at: now.toISOString(),
  };
}

export interface UsageRead {
  usage: Usage | null;
  /** The account agy's log says it read as. Null when it did not say. */
  email: string | null;
  /** agy tried to open a sign-in link: it is signed out. */
  signedOut: boolean;
}

export interface ReadOptions {
  /** The environment Omni runs with (process.env by default), before the harness guard. */
  env?: NodeJS.ProcessEnv;
  /** The agy to run. The binary the last state check ran by default. */
  bin?: string | null;
  /** The folder the read runs in. Under Omni's data dir by default. */
  dir?: string;
  ms?: number;
  now?: Date;
}

const readText = (p: string) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
};

/** Run agy's /usage once. Never rejects: no agy, a failed run or an answer Omni cannot read is no reading. */
export async function readAgyUsage(opts: ReadOptions = {}): Promise<UsageRead | null> {
  const base = opts.env ?? process.env;
  const bin = opts.bin ?? antigravityState()?.bin ?? antigravityBin(base);
  if (!bin) return null;
  const dir = opts.dir ?? join(paths.data, 'antigravity-usage');
  const cwd = join(dir, 'work');
  const logFile = join(dir, 'agy.log');
  const linkFile = join(dir, 'sign-in-link');
  try {
    mkdirSync(cwd, { recursive: true });
    rmSync(logFile, { force: true });
    rmSync(linkFile, { force: true });
    const openers = join(dir, 'bin');
    writeOpeners(openers, linkFile);
    const stdout = await new Promise<string | null>((resolve) => {
      execFile(
        bin,
        ['-p', '/usage', '--output-format', 'json', '--log-file', logFile],
        { cwd, env: antigravityEnv(openers, {}, {}, base), timeout: opts.ms ?? READ_MS, maxBuffer: 512 * 1024, killSignal: 'SIGKILL' },
        (err, out) => resolve(err ? null : out),
      );
    });
    const signedOut = !!readText(linkFile).trim();
    return { usage: !signedOut && stdout ? parseAgyUsage(stdout, opts.now) : null, email: emailFromLog(readText(logFile)), signedOut };
  } catch {
    return null;
  } finally {
    rmSync(logFile, { force: true });
    rmSync(linkFile, { force: true });
  }
}

const sameAccount = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

async function readAndFile(opts: ReadOptions): Promise<void> {
  const state = antigravityState();
  if (state?.state !== 'ready') return;
  const now = opts.now ?? new Date();
  const r = await readAgyUsage(opts);
  if (r?.signedOut) return markSignedOut();
  if (r?.usage) {
    // Read as another account than the last check found: check first, so it is filed under the right one.
    const known = antigravityState()?.email;
    if (r.email && known && !sameAccount(r.email, known)) return void refreshAntigravity({ env: opts.env }).catch(() => {});
    return recordUsage('antigravity', r.usage);
  }
  const last = usageFor('antigravity');
  if (last && (!last.updated_at || now.getTime() - Date.parse(last.updated_at) > STALE_MS)) clearUsage('antigravity');
}

let reading: Promise<void> | null = null;

/** Read the allowances now when agy is ready, and file them under its account. A call while a read runs joins it. */
export function refreshAntigravityUsage(opts: ReadOptions = {}): Promise<void> {
  reading ??= readAndFile(opts)
    .catch((err) => console.error('[antigravity] could not read the usage:', (err as Error).message))
    .finally(() => {
      reading = null;
    });
  return reading;
}

let afterTurn: ReturnType<typeof setTimeout> | null = null;

/** An Antigravity turn ended: read again shortly, so the Usage card catches up. Repeats fold into one read. */
export function afterAntigravityTurn(ms = AFTER_TURN_MS) {
  if (afterTurn) clearTimeout(afterTurn);
  afterTurn = setTimeout(() => {
    afterTurn = null;
    void refreshAntigravityUsage();
  }, ms);
  afterTurn.unref?.();
}

let timer: ReturnType<typeof setInterval> | null = null;
let stopListening: (() => void) | null = null;

/** Read after each check that finds agy ready, and every 15 minutes. The first check runs with the catalog's at start. */
export function startAntigravityUsage() {
  stopListening ??= onAntigravityChecked((s) => {
    if (s.state === 'ready') void refreshAntigravityUsage();
  });
  if (!timer) {
    timer = setInterval(() => void refreshAntigravityUsage(), EVERY_MS);
    timer.unref?.();
  }
}

/** For tests: stop the timer and the listener, and drop a pending after-turn read. */
export function stopAntigravityUsage() {
  stopListening?.();
  stopListening = null;
  if (timer) clearInterval(timer);
  timer = null;
  if (afterTurn) clearTimeout(afterTurn);
  afterTurn = null;
}
