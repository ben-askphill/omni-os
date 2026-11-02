// The Omni server behind the window: attach to this install's server when one already holds the port, else start
// one on this app's own binary and stop it on quit. After the Web UI's Update it exits with RESTART_EXIT_CODE and
// starts again here, the job the Mac app's ServerSupervisor and the Linux launcher did.
import { readFileSync } from 'node:fs';
import type { DesktopServerInfo } from '@omni/shared/desktop-bridge.ts';
import {
  childEnv,
  decide,
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

export type BackendState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'ready'; startedHere: boolean }
  | { kind: 'restarting' }
  | { kind: 'failed'; message: string }
  | { kind: 'stopped' };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class Backend {
  private state: BackendState = { kind: 'idle' };
  private child: Spawned | null = null;
  private listeners = new Set<(state: BackendState) => void>();
  private stopping = false;
  private path: string | null = null;

  constructor(readonly config: BackendConfig) {}

  get current(): BackendState {
    return this.state;
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
    this.stopping = false;
    this.set({ kind: 'starting' });
    const probe = () => probePort(this.config.port, this.token());
    const decision = decide(await settleProbe(probe, sleep), this.config.port);
    if (decision.action === 'fail') return this.set({ kind: 'failed', message: decision.message });
    if (decision.action === 'attach') return this.set({ kind: 'ready', startedHere: false });
    return this.launch();
  }

  /** Stops the server this app started. One it attached to keeps running. */
  async stop(): Promise<void> {
    this.stopping = true;
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

  private async launch(): Promise<BackendState> {
    this.path ??= await this.serverPath();
    const { args, cwd } = serverCommand({ bundled: this.config.bundled, appRoot: this.config.appRoot });
    const env = childEnv(process.env, { path: this.path, port: this.config.port, dataDir: this.config.dataDir });
    const child = spawnServer({ command: this.config.binary, args, cwd, env, logFile: this.config.logFile });
    this.child = child;
    child.onExit((code) => this.exited(child, code));
    const ready = await waitForReady({
      probe: () => probePort(this.config.port, this.token()),
      exited: () => child.exited(),
      sleep,
      attempts: 120,
      port: this.config.port,
      logTail: () => readTail(this.config.logFile),
      cancelled: () => this.stopping || this.child !== child,
    });
    if (this.child !== child) return this.state;
    if (!ready.ok) {
      if (child.exited() === null) await stopGroup(child.pid);
      this.child = null;
      return this.set({ kind: 'failed', message: ready.message });
    }
    return this.set({ kind: 'ready', startedHere: true });
  }

  private exited(child: Spawned, code: number): void {
    if (this.child !== child || this.stopping) return;
    if (this.state.kind !== 'ready') return;
    this.child = null;
    if (shouldRestart(code, Date.now() - child.startedAt)) {
      this.set({ kind: 'restarting' });
      void this.launch();
      return;
    }
    const why = code === 0 ? 'The server stopped.' : `The server stopped with exit code ${code}.`;
    const tail = readTail(this.config.logFile);
    this.set({ kind: 'failed', message: tail ? `${why}\n${tail}` : why });
  }

  private async serverPath(): Promise<string> {
    const login = (await readLoginPath(process.env.SHELL || '/bin/zsh', process.env)) ?? fallbackPath(this.config.home);
    return this.config.shimDir ? `${login}:${this.config.shimDir}` : login;
  }

  private set(state: BackendState): BackendState {
    this.state = state;
    for (const listener of this.listeners) listener(state);
    return state;
  }
}
