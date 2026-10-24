// A channel's named actions (Theme preview, Theme check, Tests) run in one thread's checkout. Each run is a process
// group started by Ben's login shell with the terminal's environment (terminal-env.ts), plus only the secrets the
// action names and the port it was given. The run is recorded with its state and the tail of its output, so either
// client can show it, stop it or run it again. Nothing here starts a run except startRun: listing never does.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { StringDecoder } from 'node:string_decoder';
import { OUTPUT_LIMIT, type ActionRun, type ChannelAction, type ThreadActions } from '@omni/shared/channel-actions.ts';
import { actionRuns, channelActions, channels, threadSetupRuns, threads, type Thread } from './db.ts';
import { artifactsDir } from './config.ts';
import { isRemoteHarness } from './harness/types.ts';
import { worktreeProblem } from './sandbox.ts';
import { namedSecrets } from './secrets.ts';
import { STRIPPED, terminalEnv } from './terminal-env.ts';

/** Where Omni picks a port for an action whose port is 0. */
export const PREVIEW_PORTS = { from: 9300, to: 9399 };
/** How long a stopped run has to exit after SIGTERM before its process group is killed. */
export const STOP_GRACE_MS = 5000;
/** How often a running run's output tail is written to the database for clients to read. */
const FLUSH_MS = 500;

const refusal = (message: string, status: number) => Object.assign(new Error(message), { status });

/** A secret no action may name: the harness billing keys, Omni's sync credentials and the Grok Bot webhook. */
export const forbiddenSecret = (name: string) => STRIPPED.includes(name);

interface Live {
  run: ActionRun;
  child: ChildProcess;
  tail: string;
  bytes: number;
  flush: NodeJS.Timeout | null;
  /** Set by stopRun, so the exit is recorded as stopped and not failed. */
  stopping: string | null;
  finished: Promise<ActionRun>;
}

/** Runs whose process is alive in this server, by run id. */
const live = new Map<string, Live>();
/** Ports held by a live run, or being checked for one. Claimed before the check awaits, so two runs never get one port. */
const claimed = new Set<number>();

// Colour and cursor codes: the clients show plain text.
const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;
const plain = (s: string) => s.replace(ANSI, '').replace(/\r(?!\n)/g, '\n');

/** Why no action can run in this thread right now, or null. A worktree still being prepared is #211's to run in. */
export function blockedReason(t: Thread): string | null {
  if (isRemoteHarness(t.harness)) return 'This thread runs off this Mac, so its actions have no checkout here to run in.';
  if (t.setup === 'preparing') return "The thread's worktree is still being prepared.";
  if (t.setup === 'failed') return `The thread's worktree could not be prepared: ${t.setup_error ?? 'unknown error'}`;
  return null;
}

/** The thread's checkout, checked: a worktree thread's must be its own worktree on its own branch, never the repo itself. */
async function verifiedCwd(t: Thread): Promise<string> {
  if (isRemoteHarness(t.harness)) throw refusal(blockedReason(t)!, 409);
  const repo = channels.get(t.channel_id)?.repo_path;
  if (t.branch && repo) {
    const problem = await worktreeProblem(repo, t.cwd, t.branch);
    if (problem) throw refusal(`The thread's checkout is not ready: ${problem}`, 409);
  } else if (!existsSync(t.cwd)) {
    throw refusal(`The thread's working directory is not on this Mac: ${t.cwd}`, 409);
  }
  return t.cwd;
}

/** True when nothing on this Mac listens on the port, on the loopback or on every interface. */
function portFree(port: number): Promise<boolean> {
  const bind = (host?: string) =>
    new Promise<boolean>((resolve) => {
      const srv = createServer();
      srv.once('error', () => resolve(false));
      srv.listen({ port, host, exclusive: true }, () => srv.close(() => resolve(true)));
    });
  return bind('127.0.0.1').then((ok) => ok && bind());
}

const holderOf = (port: number) => [...live.values()].find((l) => l.run.port === port)?.run;

/** The port a run gets: none, the action's fixed one if it is free, or the first free one in PREVIEW_PORTS. */
async function claimPort(want: number | null): Promise<number | null> {
  if (want === null) return null;
  if (want > 0) {
    if (claimed.has(want)) {
      const holder = holderOf(want);
      const where = holder ? `"${holder.name}" in the thread "${threads.get(holder.thread_id)?.title ?? holder.thread_id}"` : 'another action run';
      throw refusal(`Port ${want} is taken by ${where}. Stop that run first, or set this action's port to 0 so each run gets its own.`, 409);
    }
    claimed.add(want);
    if (await portFree(want)) return want;
    claimed.delete(want);
    throw refusal(`Port ${want} is already in use on this Mac by a program outside Omni. Stop it, or set this action's port to 0.`, 409);
  }
  for (let p = PREVIEW_PORTS.from; p <= PREVIEW_PORTS.to; p++) {
    if (claimed.has(p)) continue;
    claimed.add(p);
    if (await portFree(p)) return p;
    claimed.delete(p);
  }
  throw refusal(`No preview port is free between ${PREVIEW_PORTS.from} and ${PREVIEW_PORTS.to}. Stop a running action first.`, 409);
}

/** The run's environment: the terminal's, the secrets the action names, and where and as what it runs. */
async function runEnv(t: Thread, action: ChannelAction, port: number | null): Promise<Record<string, string>> {
  const named = action.secrets.filter((n) => !forbiddenSecret(n));
  const { env: secrets, missing } = await namedSecrets(t.channel_id, named);
  if (missing.length) throw refusal(`${action.name} needs ${missing.join(', ')}, which ${missing.length > 1 ? 'are' : 'is'} not set. Add ${missing.length > 1 ? 'them' : 'it'} under Secrets.`, 409);
  const env = { ...terminalEnv(), ...secrets };
  // Omni's own port is in its environment as OMNI_PORT: a run without a port of its own must not take it for one.
  delete env.OMNI_PORT;
  delete env.PORT;
  Object.assign(env, {
    HOME: env.HOME || homedir(),
    OMNI_THREAD_ID: t.id,
    OMNI_ARTIFACTS_DIR: artifactsDir(t.id),
    ...(t.branch ? { OMNI_BRANCH: t.branch } : {}),
  });
  if (port !== null) Object.assign(env, { OMNI_PORT: String(port), PORT: String(port) });
  return env;
}

/** Write a live run's output tail now. */
function flush(l: Live) {
  if (l.flush) clearTimeout(l.flush);
  l.flush = null;
  actionRuns.output(l.run.id, l.tail, l.bytes);
}

/**
 * Run an action in a thread's checkout. Resolves once the process has started, with its record and a promise that
 * settles with the final record when it exits. Refuses (409) a second run of the same action in the same thread, a
 * checkout that fails verification, a port that is taken and a secret that is not set. The thread's setup state is
 * the caller's to check (blockedReason): worktree preparation runs its setup action before the thread is ready.
 */
export async function startRun(t: Thread, action: ChannelAction): Promise<{ run: ActionRun; finished: Promise<ActionRun> }> {
  for (const l of live.values()) {
    if (l.run.thread_id === t.id && l.run.action_id === action.id) throw refusal(`${action.name} is already running in this thread.`, 409);
  }
  const cwd = await verifiedCwd(t);
  const port = await claimPort(action.port);
  let env: Record<string, string>;
  try {
    env = await runEnv(t, action, port);
  } catch (err) {
    if (port !== null) claimed.delete(port);
    throw err;
  }
  const run = actionRuns.create({ thread_id: t.id, action_id: action.id, name: action.name, command: action.command, cwd, port });
  // Its own process group, so Stop ends what the command started too (a dev server's watchers), not only the shell.
  const child = spawn(process.env.SHELL || '/bin/zsh', ['-lc', action.command], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let settle!: (r: ActionRun) => void;
  const l: Live = { run, child, tail: '', bytes: 0, flush: null, stopping: null, finished: new Promise((r) => (settle = r)) };
  live.set(run.id, l);

  const decoder = new StringDecoder('utf8');
  const take = (chunk: Buffer) => {
    l.bytes += chunk.length;
    l.tail = (l.tail + plain(decoder.write(chunk))).slice(-OUTPUT_LIMIT);
    l.flush ??= setTimeout(() => flush(l), FLUSH_MS);
  };
  child.stdout!.on('data', take);
  child.stderr!.on('data', take);

  let ended = false;
  const end = (code: number | null, signal: string | null, spawnError?: Error) => {
    if (ended) return;
    ended = true;
    l.tail = (l.tail + plain(decoder.end())).slice(-OUTPUT_LIMIT);
    flush(l);
    live.delete(run.id);
    if (port !== null) claimed.delete(port);
    const final = spawnError
      ? actionRuns.finish(run.id, { state: 'failed', error: `It could not start: ${spawnError.message}` })
      : l.stopping
        ? actionRuns.finish(run.id, { state: 'stopped', exit_code: code, error: l.stopping })
        : code === 0
          ? actionRuns.finish(run.id, { state: 'succeeded', exit_code: 0 })
          : actionRuns.finish(run.id, { state: 'failed', exit_code: code, error: signal ? `It was ended by ${signal}.` : null });
    settle(final);
  };
  child.once('error', (err) => end(null, null, err));
  // Output can trail the exit, so the run ends on close. A process the command left running in the background can
  // hold the pipes open past the shell's exit: then it ends shortly after the exit anyway.
  let drain: NodeJS.Timeout | undefined;
  child.once('exit', (code, signal) => {
    drain = setTimeout(() => {
      child.stdout!.destroy();
      child.stderr!.destroy();
      end(code, signal);
    }, 2000);
  });
  child.once('close', (code, signal) => {
    clearTimeout(drain);
    end(code, signal);
  });
  return { run, finished: l.finished };
}

/** Signal a run's whole process group. */
function signalGroup(child: ChildProcess, signal: NodeJS.Signals) {
  try {
    if (child.pid) process.kill(-child.pid, signal);
  } catch {
    // already gone
  }
}

/**
 * Stop a run: SIGTERM to its process group, then SIGKILL after STOP_GRACE_MS. Resolves with the record once it has
 * exited. Stopping a run that already ended returns it as it is.
 */
export async function stopRun(runId: string, why = 'Stopped by Ben.'): Promise<ActionRun | undefined> {
  const l = live.get(runId);
  if (!l) return settleOrphan(runId);
  l.stopping ??= why;
  signalGroup(l.child, 'SIGTERM');
  const kill = setTimeout(() => signalGroup(l.child, 'SIGKILL'), STOP_GRACE_MS);
  const final = await l.finished;
  clearTimeout(kill);
  return final;
}

/** A run recorded as running with no process in this server: it was running when Omni last stopped. */
function settleOrphan(runId: string): ActionRun | undefined {
  const run = actionRuns.get(runId);
  if (run?.state === 'running' && !live.has(runId)) return actionRuns.finish(runId, { state: 'stopped', error: 'Omni stopped while it was running.' });
  return run;
}

/** The thread's latest runs, any left over from before a restart settled as stopped. */
export function runsFor(threadId: string): ActionRun[] {
  return actionRuns.byThread(threadId).map((r) => (r.state === 'running' && !live.has(r.id) ? settleOrphan(r.id)! : r));
}

/** GET /api/threads/:id/actions. Reads only: a client that reconnects never starts anything. */
export function threadActions(t: Thread): ThreadActions {
  const setupRun = threadSetupRuns.get(t.id);
  return {
    actions: channelActions.list(t.channel_id),
    runs: runsFor(t.id),
    blocked: blockedReason(t),
    setup_run: (setupRun && settleOrphan(setupRun)) || null,
  };
}

/** Run the action a run ran, again, with the action's current command. Again of the setup run is the setup run. */
export async function retryRun(t: Thread, runId: string) {
  const run = actionRuns.get(runId);
  if (!run || run.thread_id !== t.id) throw refusal('run not found', 404);
  if (run.state === 'running' && live.has(runId)) throw refusal(`${run.name} is still running. Stop it first.`, 409);
  const action = run.action_id ? channelActions.get(run.action_id) : undefined;
  if (!action || action.channel_id !== t.channel_id) throw refusal(`"${run.name}" is no longer one of the channel's actions.`, 404);
  const started = await startRun(t, action);
  if (threadSetupRuns.get(t.id) === runId) threadSetupRuns.set(t.id, started.run.id);
  return started;
}

/** On server stop: every run's process group gets SIGTERM and its record says why it ended. */
export function stopAllRuns() {
  for (const l of [...live.values()]) {
    l.stopping ??= 'Omni stopped while it was running.';
    signalGroup(l.child, 'SIGTERM');
    flush(l);
    actionRuns.finish(l.run.id, { state: 'stopped', error: l.stopping });
  }
}
