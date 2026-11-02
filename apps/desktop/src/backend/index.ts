// The Omni server behind the window: attach to this install's server when one already holds the port, else start
// one on this app's own binary and stop it on quit. After the Web UI's Update it exits with RESTART_EXIT_CODE and
// starts again here, the job the Mac app's ServerSupervisor and the Linux launcher did.
import { readFileSync } from 'node:fs';
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
import { readLoginPath, readTail, spawnServer, stopGroup, type Spawned } from './process.ts';

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
  /** A folder holding a `node` that runs this binary as Node, put last on the server's PATH. */
  shimDir: string | null;
  home: string;
}

/** What tests replace: the clock that times a run, and the login shell's PATH. */
export interface BackendDeps {
  now: () => number;
  loginPath: () => Promise<string | null>;
}

export type BackendState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'ready'; startedHere: boolean }
  | { kind: 'restarting' }
  /** `logTail` is the last lines of the server's log, empty when it has none to show. */
  | { kind: 'failed'; message: string; logTail: string }
  | { kind: 'stopped' };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class Backend {
  private state: BackendState = { kind: 'idle' };
  private child: Spawned | null = null;
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
    return { port: this.config.port, dataDir: this.config.dataDir, logFile: this.config.logFile, startedHere: this.child !== null };
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

  /** Attaches or starts. Resolves once the server answers as this install, or with why it could not. */
  async start(): Promise<BackendState> {
    const generation = ++this.generation;
    this.set({ kind: 'starting' });
    const probe = () => probePort(this.config.port, this.token());
    const decision = decide(await settleProbe(probe, sleep), this.config.port);
    if (generation !== this.generation) return this.state;
    if (decision.action === 'fail') return this.set({ kind: 'failed', message: decision.message, logTail: '' });
    if (decision.action === 'attach') return this.set({ kind: 'ready', startedHere: false });
    return this.launch(generation);
  }

  /** Stops the server this app started. One it attached to keeps running. */
  async stop(): Promise<void> {
    this.generation++;
    const child = this.child;
    this.child = null;
    if (child && child.exited() === null) await stopGroup(child.pid);
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
    const { args, cwd } = serverCommand({ bundled: this.config.bundled, appRoot: this.config.appRoot });
    const env = childEnv(process.env, { path: this.path, port: this.config.port, dataDir: this.config.dataDir });
    const child = spawnServer({ command: this.config.binary, args, cwd, env, logFile: this.config.logFile });
    const startedAt = this.deps.now();
    this.child = child;
    child.onExit((code) => this.exited(child, code, startedAt));
    const ready = await waitForReady({
      probe: () => probePort(this.config.port, this.token()),
      exited: () => child.exited(),
      sleep,
      attempts: 120,
      port: this.config.port,
      logTail: () => readTail(this.config.logFile),
      cancelled: () => generation !== this.generation || this.child !== child,
    });
    if (generation !== this.generation || this.child !== child) {
      // Overtaken by a later start or stop. A child still recorded here is this start's own: nothing else stops it.
      if (this.child === child) {
        this.child = null;
        if (child.exited() === null) await stopGroup(child.pid);
      }
      return this.state;
    }
    if (!ready.ok) {
      if (child.exited() === null) await stopGroup(child.pid);
      this.child = null;
      return this.set({ kind: 'failed', message: ready.message, logTail: ready.logTail });
    }
    return this.set({ kind: 'ready', startedHere: true });
  }

  private exited(child: Spawned, code: number, startedAt: number): void {
    if (this.child !== child) return;
    if (this.state.kind !== 'ready') return;
    this.child = null;
    if (shouldRestart(code, this.deps.now() - startedAt)) {
      this.set({ kind: 'restarting' });
      void this.launch(this.generation);
      return;
    }
    this.set({ kind: 'failed', message: exitMessage(code), logTail: readTail(this.config.logFile) });
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
