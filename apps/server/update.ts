import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { about } from './about.ts';
import { publishFeed } from './bus.ts';
import { BUNDLED, nodeChildEnv, ROOT } from './config.ts';
import { runningCount } from './runner.ts';

// Update: is this server behind main, and the one Update button that brings it level.
//
// The check fetches origin's main every 15 minutes and compares it with the commit this server booted from. Update
// waits until no turn runs, runs scripts/sync-main.sh (the main checkout fast-forwards; a worktree stays), rebuilds
// the Web UI and exits with RESTART_EXIT_CODE. Only a supervisor starts it again: the desktop app run with --dev, or a
// service manager such as systemd with OMNI_SUPERVISOR set by hand (docs/user/install.md). Without one, Update is not offered. The packaged desktop app runs the server as a bundle
// with no checkout and updates itself (apps/desktop/src/updates.ts), so there Update is neither checked nor offered.

const run = promisify(execFile);

/** The exit code that asks the app that started the server to start it again. EX_TEMPFAIL. */
export const RESTART_EXIT_CODE = 75;

const CHECK_EVERY_MS = 15 * 60_000;
const FIRST_CHECK_MS = 20_000;
const IDLE_POLL_MS = 2_000;
const MAX_COMMITS = 10;

export type UpdatePhase = 'idle' | 'waiting' | 'updating' | 'restarting' | 'failed';

export interface UpdateCommit {
  sha: string;
  subject: string;
}

export interface UpdateView {
  /** The commit this server runs. */
  current: string | null;
  /** main's newest commit: origin/main when it contains the local main, else the local main. */
  target: string | null;
  /** Commits on main this server does not have. */
  behind: number;
  /** The newest of them, newest first, at most 10. */
  commits: UpdateCommit[];
  checkedAt: string | null;
  phase: UpdatePhase;
  /** Turns Update waits for, while `phase` is waiting. */
  waitingFor: number;
  error: string | null;
  /** An app started this server and starts it again: Update can run. */
  canApply: boolean;
}

interface Git {
  (args: string[], timeoutMs?: number): Promise<string | null>;
}

function gitIn(root: string): Git {
  return async (args, timeoutMs = 10_000) => {
    try {
      const { stdout } = await run('git', ['-C', root, ...args], { timeout: timeoutMs, encoding: 'utf8' });
      return stdout.trim();
    } catch {
      return null;
    }
  };
}

/** main's newest commit known here: origin/main when it contains the local main (or there is no local main). */
export async function mainHead(git: Git): Promise<string | null> {
  const local = await git(['rev-parse', '--verify', '--quiet', 'refs/heads/main^{commit}']);
  const remote = await git(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main^{commit}']);
  if (!remote) return local || null;
  if (!local) return remote;
  const contains = (await git(['merge-base', '--is-ancestor', local, remote])) !== null;
  return contains ? remote : local;
}

/** How far `current` is behind `target`, and the newest commits it lacks. */
export async function behindBy(git: Git, current: string | null, target: string | null): Promise<{ behind: number; commits: UpdateCommit[] }> {
  if (!current || !target || current === target) return { behind: 0, commits: [] };
  const count = Number(await git(['rev-list', '--count', `${current}..${target}`]));
  if (!Number.isFinite(count) || count <= 0) return { behind: 0, commits: [] };
  const log = (await git(['log', `-${MAX_COMMITS}`, '--format=%H%x09%s', `${current}..${target}`])) ?? '';
  const commits = log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      return { sha: line.slice(0, tab), subject: line.slice(tab + 1) };
    });
  return { behind: count, commits };
}

/** Checks for new commits on main. `fetch` asks origin first; without it the check reads the refs it has. */
export async function checkRepo(root: string, current: string | null, fetch: boolean): Promise<{ target: string | null; behind: number; commits: UpdateCommit[] }> {
  const git = gitIn(root);
  if (fetch) await git(['fetch', '--quiet', 'origin', 'main'], 30_000);
  const target = await mainHead(git);
  return { target, ...(await behindBy(git, current, target)) };
}

/** What Update runs, and how it learns about turns. Tests swap these. */
export interface UpdateDeps {
  root: string;
  current: () => string | null;
  supervised: () => boolean;
  /** The desktop app's bundle: no checkout to update, and the app replaces the server with itself. */
  bundled: boolean;
  enabled: () => boolean;
  runningTurns: () => number;
  /** Fast-forwards main and rebuilds the Web UI. Returns an error message, null on success. */
  install: (root: string) => Promise<string | null>;
  restart: () => void;
  sleep: (ms: number) => Promise<void>;
  changed: () => void;
}

async function runStep(cmd: string, args: string[], cwd: string, timeoutMs: number, env?: Record<string, string>): Promise<string | null> {
  try {
    await run(cmd, args, { cwd, timeout: timeoutMs, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: env && { ...process.env, ...env } });
    return null;
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message: string };
    const lines = `${e.stderr ?? ''}\n${e.stdout ?? ''}`.split('\n').map((l) => l.trim()).filter(Boolean);
    return lines.findLast((l) => l.startsWith('sync-main:')) ?? lines.at(-1) ?? e.message;
  }
}

async function installFromMain(root: string): Promise<string | null> {
  const sync = join(root, 'scripts/sync-main.sh');
  if (existsSync(sync)) {
    const error = await runStep('/bin/bash', [sync], root, 10 * 60_000);
    if (error) return `Updating to main failed. ${error.replace(/^sync-main: /, '')}`;
  }
  const vite = join(root, 'node_modules/vite/bin/vite.js');
  if (!existsSync(vite)) return 'The Web UI could not be built. Run npm install in the repo first.';
  const error = await runStep(process.execPath, [vite, 'build'], join(root, 'apps/web'), 5 * 60_000, nodeChildEnv);
  return error ? `The Web UI build failed. ${error}` : null;
}

let restartHandler: () => void = () => process.exit(RESTART_EXIT_CODE);

/** index.ts sets this to its shutdown, so sessions close before the exit. */
export function onRestart(handler: () => void): void {
  restartHandler = handler;
}

export function defaultDeps(): UpdateDeps {
  return {
    root: ROOT,
    current: () => about.gitHead,
    supervised: () => Boolean(process.env.OMNI_SUPERVISOR),
    // The desktop app's bundle has no checkout to bring level: it updates itself (apps/desktop/src/updates.ts).
    bundled: BUNDLED,
    enabled: () => !BUNDLED && process.env.OMNI_UPDATE_CHECK !== '0',
    runningTurns: runningCount,
    install: installFromMain,
    restart: () => restartHandler(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    changed: () => publishFeed({ type: 'update' }),
  };
}

export class Updater {
  private target: string | null = null;
  private behind = 0;
  private commits: UpdateCommit[] = [];
  private checkedAt: string | null = null;
  private phase: UpdatePhase = 'idle';
  private waitingFor = 0;
  private error: string | null = null;
  private applying: Promise<void> | null = null;
  private cancelled = false;

  constructor(private deps: UpdateDeps) {}

  view(): UpdateView {
    return {
      current: this.deps.current(),
      target: this.target,
      behind: this.behind,
      commits: this.commits,
      checkedAt: this.checkedAt,
      phase: this.phase,
      waitingFor: this.waitingFor,
      error: this.error,
      canApply: !this.deps.bundled && this.deps.supervised(),
    };
  }

  async check(fetch = true): Promise<UpdateView> {
    if (!this.deps.enabled()) return this.view();
    const found = await checkRepo(this.deps.root, this.deps.current(), fetch);
    const moved = found.target !== this.target || found.behind !== this.behind;
    Object.assign(this, found);
    this.checkedAt = new Date().toISOString();
    if (moved) this.deps.changed();
    return this.view();
  }

  /** Starts Update. Refused in the desktop app's bundle, and without an app to start the server again. A second call joins the first. */
  apply(): { ok: true } | { ok: false; error: string } {
    if (this.deps.bundled) {
      return { ok: false, error: 'This server is part of the Omni desktop app, which updates itself: relaunch when it says an update is ready.' };
    }
    if (!this.deps.supervised()) {
      return { ok: false, error: 'This server was not started by the Omni app, so it can not restart itself. Restart it by hand.' };
    }
    if (!this.applying) {
      this.cancelled = false;
      this.applying = this.sequence().finally(() => (this.applying = null));
    }
    return { ok: true };
  }

  /** Ends the wait for running turns. Does nothing once the install started. */
  cancel(): boolean {
    if (this.phase !== 'waiting') return false;
    this.cancelled = true;
    return true;
  }

  dismiss(): void {
    if (this.phase === 'failed') this.set('idle', null);
  }

  private set(phase: UpdatePhase, error: string | null = null, waitingFor = 0) {
    this.phase = phase;
    this.error = error;
    this.waitingFor = waitingFor;
    this.deps.changed();
  }

  private async waitForIdle(): Promise<boolean> {
    for (;;) {
      if (this.cancelled) return false;
      const n = this.deps.runningTurns();
      if (n === 0) return true;
      if (this.phase !== 'waiting' || this.waitingFor !== n) this.set('waiting', null, n);
      await this.deps.sleep(IDLE_POLL_MS);
    }
  }

  private async sequence(): Promise<void> {
    for (;;) {
      if (!(await this.waitForIdle())) return this.set('idle');
      this.set('updating');
      const error = await this.deps.install(this.deps.root);
      if (error) return this.set('failed', error);
      // The install takes a while: a turn may have started. It finishes before the restart.
      if (this.deps.runningTurns() === 0) break;
    }
    this.set('restarting');
    this.deps.restart();
  }
}

export const updater = new Updater(defaultDeps());

/** Checks shortly after boot, then every 15 minutes. Off with OMNI_UPDATE_CHECK=0 (the QA stack and tests). */
export function startUpdateCheck(): void {
  if (process.env.OMNI_UPDATE_CHECK === '0') return;
  const tick = () => void updater.check().catch((err) => console.error('[update] check failed:', (err as Error).message));
  setTimeout(tick, FIRST_CHECK_MS).unref();
  setInterval(tick, CHECK_EVERY_MS).unref();
}
