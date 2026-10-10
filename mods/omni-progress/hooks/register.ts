// omni-progress: a compact status line for the running turn, and a watchdog that warns when one tool call
// runs long or the same call keeps failing. It only observes: every hook passes the call through `next(e)`
// untouched, and its `.catch` passes through too, so a bug here can never block or change a tool call.
//
// Bash is not hooked unless `watchBash` is on: any tool.call hook matching Bash breaks subagents spawned
// with `isolation: "worktree"` (Claude Code bug #92533), so the default matcher names the other tools.
import type { EngineInterface, Register } from 'claude-code';

/** The tools observed by default. Glob and Grep are not built in on every build, so they go by pattern. */
const WATCHED = ['Read', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'LSP', 'Skill', /^(Glob|Grep|MultiEdit)$/, /^mcp__/] as const;

/** How often the watchdog looks at the running calls. */
const TICK_MS = 15_000;

type Running = { tool: string; label: string; startedAt: number; warned: boolean };
type Streak = { key: string; count: number };
type Ran = { deny?: string; isError?: boolean };

// Module state is per process: hot reload is off under -p, so it lives as long as the session does.
const limits = { slowMs: 5 * 60_000, repeatFailures: 3 };
const running = new Map<string, Running>();
const streaks = new Map<string, Streak>();
const turn: { startedAt: number | undefined; tools: number; failed: number } = { startedAt: undefined, tools: 0, failed: 0 };
let timer: { cancel: () => void } | undefined;

export const register: Register = (on, options) => {
  limits.slowMs = positive(options.slowCallMinutes, 5) * 60_000;
  limits.repeatFailures = Math.max(2, Math.round(positive(options.repeatFailures, 3)));

  on('session.start', ($, e, next) => {
    startWatchdog($);
    return next(e);
  }).catch(($, e, next) => next(e));

  on('turn.start', async ($, e, next) => {
    startWatchdog($);
    running.clear();
    streaks.clear();
    Object.assign(turn, { startedAt: await $.clock.now(), tools: 0, failed: 0 });
    $.ui.status(undefined);
    return next(e);
  }).catch(($, e, next) => next(e));

  on('turn.complete', async ($, e, next) => {
    const done = await next(e);
    // A subagent's run completes too; only the main loop's turn gets the summary.
    if (e.agentId === undefined) {
      running.clear();
      const end = e.isAborted ? 'Stopped' : e.reason === 'error' ? 'Failed' : 'Done';
      $.ui.status(summary(end, e.durationMs));
    }
    return done;
  }).catch(($, e, next) => next(e));

  on('tool.call', { tool: WATCHED }, ($, e, next) => observe($, e, () => next(e))).catch(($, e, next) => next(e));

  if (options.watchBash === true) {
    on('tool.call', { tool: 'Bash' }, ($, e, next) => observe($, e, () => next(e))).catch(($, e, next) => next(e));
  }
};

/** One interval per process, started by the first hook that runs. */
function startWatchdog($: EngineInterface) {
  if (timer) return;
  timer = $.clock.every(TICK_MS, () => void tick($).catch(() => {}));
}

/** Warns once per call that passed the slow threshold, and keeps the elapsed time in the status fresh. */
async function tick($: EngineInterface) {
  if (running.size === 0) return;
  const now = await $.clock.now();
  for (const call of running.values()) {
    if (call.warned || now - call.startedAt < limits.slowMs) continue;
    call.warned = true;
    warn($, `${describe(call)} has run ${duration(now - call.startedAt)}`);
  }
  $.ui.status(statusText(now));
}

/** Runs the call through untouched, counting it and keeping the status line on it while it runs. */
async function observe<R extends Ran>($: EngineInterface, e: { tool: string; tool_use_id: string }, run: () => Promise<R>): Promise<R> {
  startWatchdog($);
  const now = await $.clock.now();
  turn.startedAt ??= now;
  turn.tools++;
  const call: Running = { tool: e.tool, label: label(e), startedAt: now, warned: false };
  running.set(e.tool_use_id, call);
  $.ui.status(statusText(now));

  const ran = await run();
  try {
    running.delete(e.tool_use_id);
    const failed = ran.deny !== undefined || ran.isError === true;
    if (failed) turn.failed++;
    noteOutcome($, e, call, failed);
    $.ui.status(statusText(await $.clock.now()));
  } catch {
    // Observation only: the result goes back whatever happened here.
  }
  return ran;
}

/** Counts consecutive failures of one tool with one input; warns once when the streak reaches the limit. */
function noteOutcome($: EngineInterface, e: object, call: Running, failed: boolean) {
  if (!failed) {
    streaks.delete(call.tool);
    return;
  }
  const key = inputKey(e);
  const prev = streaks.get(call.tool);
  const streak = prev && prev.key === key ? { key, count: prev.count + 1 } : { key, count: 1 };
  streaks.set(call.tool, streak);
  if (streak.count === limits.repeatFailures) warn($, `${describe(call)} failed ${streak.count} times in a row with the same input`);
}

function warn($: EngineInterface, text: string) {
  $.ui.toast(`omni-progress: ${text}`);
  $.ui.log(`omni-progress: ${text}`);
}

/** The newest running call, the turn's tool count and its elapsed time: `Edit: src/foo.ts · 4 tools · 2m 10s`. */
function statusText(now: number) {
  const newest = [...running.values()].at(-1);
  return summary(newest ? describe(newest) : 'Working', now - (turn.startedAt ?? now));
}

function summary(head: string, ms: number) {
  const parts = [head, plural(turn.tools, 'tool')];
  if (turn.failed) parts.push(`${turn.failed} failed`);
  parts.push(duration(ms));
  return parts.join(' · ');
}

function positive(v: unknown, fallback: number) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}

function describe(call: Running) {
  return call.label ? `${call.tool}: ${call.label}` : call.tool;
}

/** A short handle for what the call is about: the file, the pattern, the URL, the command. */
function label(e: object) {
  const a = e as Record<string, unknown>;
  const path = str(a.file_path) ?? str(a.notebook_path);
  if (path) return shortPath(path);
  const text = str(a.command) ?? str(a.pattern) ?? str(a.url) ?? str(a.query) ?? str(a.skill);
  return text ? clip(text.replace(/\s+/g, ' ').trim(), 48) : '';
}

function str(v: unknown) {
  return typeof v === 'string' && v ? v : undefined;
}

/** The last two segments of a path: enough to tell files apart in a status line. */
function shortPath(p: string) {
  const parts = p.split('/').filter(Boolean);
  return parts.length <= 2 ? p : parts.slice(-2).join('/');
}

function clip(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** The call's arguments as a stable string, keys sorted, without the envelope fields that differ per call. */
function inputKey(e: object) {
  const { tool_use_id, agentId, requestMeta, ...args } = e as Record<string, unknown>;
  void [tool_use_id, agentId, requestMeta];
  return stable(args);
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** 45s, 2m 10s, 1h 3m. */
function duration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
