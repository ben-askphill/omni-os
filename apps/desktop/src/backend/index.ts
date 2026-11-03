// The Omni server behind the window: attach to this install's server when one already holds the port, else start
// one on this app's own binary and stop it on quit. After the Web UI's Update it exits with RESTART_EXIT_CODE and
// starts again here, the job the Mac app's ServerSupervisor and the Linux launcher did. A server an earlier launch
// started and left running (Keep Server Running) is still this app's own: a note of its pid says so.
import { readFileSync, rmSync } from 'node:fs';
import type { DesktopServerInfo } from '@omni/shared/desktop-bridge.ts';
import {
  childEnv,
  decide,
  exitMessage,
  fallbackPath,
  probePort,
  serverCommand,
  settleProbe,
  shouldRestart,
  tokenFile,
  waitForReady,
} from './launch.ts';
import { writeJsonAtomic } from '../settings.ts';
import { readLoginPath, readTail, spawnServer, stopGroup, writeNodeShim, type Spawned } from './process.ts';

export interface BackendConfig {
  port: number;
  dataDir: string;
  logFile: string;
  /** Run the packaged bundle (true) or the checkout's TypeScript (false). */
  bundled: boolean;
  /** The bundle's copy of the repo layout, or the checkout. */
  appRoot: string;
  /** This app's binary. It runs the server as Node. */
  binary: string;
  /**
   * A folder for a `node` that runs this binary as Node, put last on the server's PATH. Written as the app starts a
   * server, so a launch that only attaches leaves the running server's shim on the binary it runs on.
   */
  shimDir: string | null;
  /** Where the app notes the server it started (pid, port, data dir), so a later launch knows it as its own. */
  recordFile: string | null;
  home: string;
}

/** What tests replace: the clock that times a run, the login shell's PATH, and how often a server is checked on. */
export interface BackendDeps {
  now: () => number;
  loginPath: () => Promise<string | null>;
  /** How often a server with no child process here to watch is probed while it is ready. */
  watchMs: number;
}

/** The note of a server this app started. */
export interface ServerRecord {
  pid: number;
  port: number;
  dataDir: string;
}

/**
 * The server this app answers for: the child it started on this launch, or one an earlier launch started and left
 * running. Quit stops or asks about it, and Restart Server restarts it. One that someone else started is not.
 */
type Owned = { pid: number; child: Spawned | null };

export type BackendState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'ready' }
  | { kind: 'restarting' }
  /** `logTail` is the last lines of the server's log, empty when it has none to show. */
  | { kind: 'failed'; message: string; logTail: string }
  | { kind: 'stopped' };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** A wait that does not hold the process open. */
const idle = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());

/** Probes in a row that find no server before a ready one counts as gone. */
const GONE_AFTER = 2;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function parseRecord(raw: unknown): ServerRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const { pid, port, dataDir } = raw as Partial<ServerRecord>;
  if (!Number.isInteger(pid) || (pid as number) <= 1 || !Number.isInteger(port) || typeof dataDir !== 'string') return null;
  return { pid: pid as number, port: port as number, dataDir };
}

/** True when the server on the port is the one the note is of: same port and data dir, and the pid it reports. */
export function isRecordedServer(record: ServerRecord | null, server: { port: number; dataDir: string; pid: unknown }): boolean {
  return !!record && record.port === server.port && record.dataDir === server.dataDir && record.pid === server.pid;
}

export class Backend {
  private state: BackendState = { kind: 'idle' };
  private owned: Owned | null = null;
  private listeners = new Set<(state: BackendState) => void>();
  private path: string | null = null;
  private wasReady = false;
  /** Bumped by each start and stop. A start that finds it moved on was overtaken and gives up. */
  private generation = 0;
  private readonly deps: BackendDeps;

  constructor(
    readonly config: BackendConfig,
    deps: Partial<BackendDeps> = {},
  ) {
    this.deps = {
      now: deps.now ?? Date.now,
      loginPath: deps.loginPath ?? (() => readLoginPath(process.env.SHELL || '/bin/zsh', process.env)),
      watchMs: deps.watchMs ?? 3000,
    };
  }

  get current(): BackendState {
    return this.state;
  }

  /** True once the server has answered as ready, so a later failure is a stop, not a first start that failed. */
  get hasBeenReady(): boolean {
    return this.wasReady;
  }

  onState(listener: (state: BackendState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  info(): DesktopServerInfo {
    return { port: this.config.port, dataDir: this.config.dataDir, logFile: this.config.logFile, startedHere: this.owned !== null };
  }

  origin(): string {
    return `http://127.0.0.1:${this.config.port}`;
  }

  token(): string | null {
    try {
      const text = readFileSync(tokenFile(this.config.dataDir), 'utf8').trim();
      return text.length >= 32 ? text : null;
    } catch {
      return null;
    }
  }

  /** A call to the server's API from this process, with the install's token. */
  async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = this.token();
    const headers = new Headers(init.headers);
    if (token) headers.set('authorization', `Bearer ${token}`);
    const res = await fetch(`${this.origin()}${path}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status}`);
    return (await res.json()) as T;
  }

  /** Turns running on the server: 0 when it is not up, null when it does not say within `timeoutMs`. */
  async runningTurns(timeoutMs = 3000): Promise<number | null> {
    if (this.state.kind !== 'ready') return 0;
    try {
      const status = await this.api<{ running?: unknown }>('/api/status', { signal: AbortSignal.timeout(timeoutMs) });
      return typeof status.running === 'number' ? status.running : null;
    } catch {
      // Busy, as a server with several turns running can be. Stopping it now could end turns nobody was asked about.
      return null;
    }
  }

  /**
   * Stops queued turns first, so none starts in between, then the running ones, and waits up to `settleMs` for the
   * server to record them. A server stopped before then marks them failed ("Omni shut down while this turn was
   * running") instead of stopped.
   */
  async interruptTurns(settleMs = 5000): Promise<void> {
    const ids: string[] = [];
    for (const status of ['queued', 'running']) {
      try {
        const threads = await this.api<{ id: string }[]>(`/api/threads?status=${status}&limit=200`);
        ids.push(...threads.map((thread) => thread.id));
      } catch {
        // The server is going away anyway; a list it cannot give is nothing to stop.
      }
    }
    await Promise.allSettled(ids.map((id) => this.api(`/api/threads/${encodeURIComponent(id)}/stop`, { method: 'POST' })));
    if (!ids.length) return;
    const until = this.deps.now() + settleMs;
    while (this.deps.now() < until && (await this.runningTurns(1000)) !== 0) await sleep(150);
  }

  /** Attaches or starts. Resolves once the server answers as this install, or with why it could not. */
  async start(): Promise<BackendState> {
    const generation = ++this.generation;
    this.set({ kind: 'starting' });
    const probe = () => probePort(this.config.port, this.token());
    const decision = decide(await settleProbe(probe, sleep), this.config.port);
    if (generation !== this.generation) return this.state;
    if (decision.action === 'fail') return this.set({ kind: 'failed', message: decision.message, logTail: '' });
    if (decision.action === 'start') return this.launch(generation);
    const adopted = await this.adopt();
    if (generation !== this.generation) return this.state;
    this.owned = adopted;
    this.set({ kind: 'ready' });
    void this.watch(generation);
    return this.state;
  }

  /**
   * A server this app noted starting, on this launch or an earlier one, still runs. True as well when this launch
   * has not adopted it (still starting, or the server was too busy to say who it is).
   */
  recordedServerUp(): boolean {
    const record = this.readRecord();
    return !!record && record.port === this.config.port && record.dataDir === this.config.dataDir && alive(record.pid);
  }

  /** Stops the server this app started, on this launch or an earlier one. One someone else started keeps running. */
  async stop(): Promise<void> {
    this.generation++;
    const owned = this.release();
    if (owned && (owned.child ? owned.child.exited() === null : alive(owned.pid))) await stopGroup(owned.pid);
    this.set({ kind: 'stopped' });
  }

  /** Stops the server this app started and starts it again. */
  async restart(): Promise<BackendState> {
    await this.stop();
    return this.start();
  }

  private async launch(generation: number): Promise<BackendState> {
    this.path ??= await this.serverPath();
    if (generation !== this.generation) return this.state;
    this.writeShim();
    const { args, cwd } = serverCommand({ bundled: this.config.bundled, appRoot: this.config.appRoot });
    const env = childEnv(process.env, { path: this.path, port: this.config.port, dataDir: this.config.dataDir });
    const child = spawnServer({ command: this.config.binary, args, cwd, env, logFile: this.config.logFile });
    const startedAt = this.deps.now();
    this.owned = { pid: child.pid, child };
    this.writeRecord(child.pid);
    const ours = () => this.owned?.child === child;
    child.onExit((code, signal) => this.exited(child, code, signal, startedAt));
    const ready = await waitForReady({
      probe: () => probePort(this.config.port, this.token()),
      exited: () => child.exited(),
      sleep,
      attempts: 120,
      port: this.config.port,
      logTail: () => readTail(this.config.logFile),
      cancelled: () => generation !== this.generation || !ours(),
    });
    if (generation !== this.generation || !ours()) {
      // Overtaken by a later start or stop. A child still recorded here is this start's own: nothing else stops it.
      if (ours()) {
        this.release();
        if (child.exited() === null) await stopGroup(child.pid);
      }
      return this.state;
    }
    if (!ready.ok) {
      if (child.exited() === null) await stopGroup(child.pid);
      this.release();
      return this.set({ kind: 'failed', message: ready.message, logTail: ready.logTail });
    }
    return this.set({ kind: 'ready' });
  }

  private exited(child: Spawned, code: number, signal: NodeJS.Signals | null, startedAt: number): void {
    if (this.owned?.child !== child) return;
    if (this.state.kind !== 'ready') return;
    this.release();
    if (shouldRestart(code, this.deps.now() - startedAt)) {
      this.set({ kind: 'restarting' });
      void this.launch(this.generation);
      return;
    }
    this.set({ kind: 'failed', message: exitMessage(code, signal), logTail: readTail(this.config.logFile) });
  }

  /** The attached server as this app's own, when it is the one an earlier launch noted, else null. */
  private async adopt(): Promise<Owned | null> {
    const record = this.readRecord();
    if (!record) return null;
    let pid: unknown = null;
    try {
      pid = (await this.api<{ server?: { pid?: unknown } }>('/api/status')).server?.pid;
    } catch {
      // Too busy to say: treated as someone else's for this launch, which leaves it running.
      return null;
    }
    if (isRecordedServer(record, { port: this.config.port, dataDir: this.config.dataDir, pid })) return { pid: record.pid, child: null };
    if (record.port === this.config.port && record.dataDir === this.config.dataDir) this.forgetRecord(record.pid);
    return null;
  }

  /**
   * Checks on a ready server with no child here to hear it exit (attached, or started by an earlier launch). One
   * that stops answering ends in failed, so the failure screen offers Try Again. A busy server still counts as up.
   */
  private async watch(generation: number): Promise<void> {
    let misses = 0;
    while (true) {
      await idle(this.deps.watchMs);
      if (generation !== this.generation || this.state.kind !== 'ready' || this.owned?.child) return;
      const probe = await probePort(this.config.port, this.token());
      if (generation !== this.generation || this.state.kind !== 'ready') return;
      misses = probe.kind === 'omni' || probe.kind === 'slow' ? 0 : misses + 1;
      if (misses < GONE_AFTER) continue;
      const owned = this.release();
      this.set({ kind: 'failed', message: `The server on port ${this.config.port} stopped answering.`, logTail: owned ? readTail(this.config.logFile) : '' });
      return;
    }
  }

  /** Lets go of the server this app answers for, and of its note. */
  private release(): Owned | null {
    const owned = this.owned;
    this.owned = null;
    if (owned) this.forgetRecord(owned.pid);
    return owned;
  }

  private readRecord(): ServerRecord | null {
    if (!this.config.recordFile) return null;
    try {
      return parseRecord(JSON.parse(readFileSync(this.config.recordFile, 'utf8')));
    } catch {
      return null;
    }
  }

  private writeRecord(pid: number): void {
    const file = this.config.recordFile;
    if (!file) return;
    try {
      const record: ServerRecord = { pid, port: this.config.port, dataDir: this.config.dataDir };
      writeJsonAtomic(file, record);
    } catch (err) {
      console.error('[omni] could not note the server it started:', err);
    }
  }

  /** Removes the note, if it is still of `pid`. */
  private forgetRecord(pid: number): void {
    const file = this.config.recordFile;
    if (!file || this.readRecord()?.pid !== pid) return;
    rmSync(file, { force: true });
  }

  private writeShim(): void {
    if (!this.config.shimDir) return;
    try {
      writeNodeShim(this.config.shimDir, this.config.binary);
    } catch (err) {
      console.error('[omni] could not write the node shim:', err);
    }
  }

  private async serverPath(): Promise<string> {
    const login = (await this.deps.loginPath()) ?? fallbackPath(this.config.home);
    return this.config.shimDir ? `${login}:${this.config.shimDir}` : login;
  }

  private set(state: BackendState): BackendState {
    this.state = state;
    if (state.kind === 'ready') this.wasReady = true;
    for (const listener of this.listeners) listener(state);
    return state;
  }
}
