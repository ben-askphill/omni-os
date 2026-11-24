// A small Agent Client Protocol client: JSON-RPC 2.0 over a CLI's stdio, one JSON object per line, written the way
// the Codex client is (codex/client.ts). Antigravity's state reader uses it now; its thread sessions will too.
// - A request the agent sends that the caller does not handle is answered -32601, as the Cursor command probe does.
// - A stdout line that is not JSON goes to `onText`: agy prints its sign-in link that way.
import { spawn, type ChildProcess } from 'node:child_process';
import { LineSplitter } from '../../stream.ts';

/** An error answer, with the JSON-RPC code kept so callers can tell "signed out" (-32000) from the rest. */
export class AcpError extends Error {
  constructor(
    readonly method: string,
    readonly code: number | null,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

/** The agent did not answer in time. */
export class AcpTimeout extends Error {
  constructor(
    readonly method: string,
    readonly ms: number,
  ) {
    super(`did not answer ${method} within ${ms / 1000} s`);
  }
}

/** The agent's process ended before it answered. */
export class AcpExited extends Error {
  constructor(readonly method: string) {
    super(`exited before it answered ${method}`);
  }
}

/** A request from the agent. Return a result, or undefined to answer -32601. A throw answers -32603. */
export type AcpRequestHandler = (method: string, params: unknown) => unknown | Promise<unknown>;

export interface AcpClientOptions {
  bin: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onNotification?: (method: string, params: unknown) => void;
  onRequest?: AcpRequestHandler;
  /** A stdout line that is not JSON. */
  onText?: (line: string) => void;
  onStderr?: (chunk: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  /** Default deadline for a request. */
  requestTimeoutMs?: number;
}

interface Pending {
  method: string;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export class AcpClient {
  readonly child: ChildProcess;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private splitter = new LineSplitter({ onOverflow: (chars) => console.error(`[acp] dropped a message of at least ${chars} characters`) });
  private readonly timeoutMs: number;
  private exited = false;

  constructor(private readonly opts: AcpClientOptions) {
    this.timeoutMs = opts.requestTimeoutMs ?? 60_000;
    this.child = spawn(opts.bin, opts.args, { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout!.setEncoding('utf8');
    this.child.stdout!.on('data', (d: string) => this.splitter.push(d).forEach((l) => this.onLine(l)));
    this.child.stderr!.setEncoding('utf8');
    this.child.stderr!.on('data', (d: string) => opts.onStderr?.(d));
    this.child.stdin!.on('error', () => {});
    // A binary that cannot start is an error event, and `close` follows it.
    this.child.on('error', () => {});
    this.child.on('close', (code, signal) => {
      this.splitter.flush().forEach((l) => this.onLine(l));
      this.exited = true;
      for (const p of [...this.pending.values()]) p.reject(new AcpExited(p.method));
      this.pending.clear();
      opts.onExit?.(code, signal);
    });
  }

  private onLine(line: string) {
    if (!line.trim()) return;
    let msg: { id?: number | string; result?: unknown; error?: { code?: unknown; message?: unknown; data?: unknown }; method?: unknown; params?: unknown };
    try {
      msg = JSON.parse(line);
    } catch {
      this.opts.onText?.(line);
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (typeof msg.method === 'string') {
      if (msg.id === undefined || msg.id === null) this.opts.onNotification?.(msg.method, msg.params);
      else void this.answer(msg.id, msg.method, msg.params);
      return;
    }
    if (typeof msg.id !== 'number') return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.error) {
      const code = typeof msg.error.code === 'number' ? msg.error.code : null;
      const message = typeof msg.error.message === 'string' ? msg.error.message : 'error';
      p.reject(new AcpError(p.method, code, message, msg.error.data));
    } else p.resolve(msg.result);
  }

  private async answer(id: number | string, method: string, params: unknown) {
    try {
      const result = await this.opts.onRequest?.(method, params);
      if (result === undefined) this.write({ jsonrpc: '2.0', id, error: { code: -32601, message: `${method} is not supported` } });
      else this.write({ jsonrpc: '2.0', id, result });
    } catch (e) {
      this.write({ jsonrpc: '2.0', id, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } });
    }
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = this.timeoutMs): Promise<T> {
    if (this.exited) return Promise.reject(new AcpExited(method));
    const id = ++this.seq;
    if (!this.write({ jsonrpc: '2.0', id, method, params })) return Promise.reject(new AcpExited(method));
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AcpTimeout(method, timeoutMs));
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, {
        method,
        resolve: (v) => (clearTimeout(timer), resolve(v as T)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
    });
  }

  notify(method: string, params: unknown) {
    this.write({ jsonrpc: '2.0', method, params });
  }

  private write(obj: unknown): boolean {
    const stdin = this.child.stdin;
    if (!stdin || stdin.destroyed || stdin.writableEnded) return false;
    try {
      stdin.write(JSON.stringify(obj) + '\n');
      return true;
    } catch {
      return false;
    }
  }

  /** Whether the process has ended. */
  get closed() {
    return this.exited;
  }

  /** End the process: SIGTERM, then SIGKILL if it is still up after `graceMs`. Resolves once it is gone. */
  stop(graceMs = 2000): Promise<void> {
    if (this.exited || this.child.exitCode !== null || this.child.signalCode !== null || this.child.pid === undefined) return Promise.resolve();
    return new Promise((resolve) => {
      const kill = setTimeout(() => this.signal('SIGKILL'), graceMs);
      kill.unref();
      this.child.once('close', () => {
        clearTimeout(kill);
        resolve();
      });
      this.signal('SIGTERM');
    });
  }

  private signal(s: NodeJS.Signals) {
    try {
      this.child.kill(s);
    } catch {
      /* already gone */
    }
  }
}
