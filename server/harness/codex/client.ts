// A thin JSON-RPC client over `codex app-server`'s stdio: one JSON object per line.
// Used both by the long-lived Codex adapter and by the catalog's short-lived probe.
import { spawn, type ChildProcess } from 'node:child_process';
import { LineSplitter } from '../../stream.ts';
import type { RpcNotification } from './protocol.ts';

export interface CodexClientOptions {
  bin: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onNotification?: (n: RpcNotification) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  onStderr?: (chunk: string) => void;
}

export class CodexClient {
  readonly child: ChildProcess;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private splitter = new LineSplitter();

  constructor(opts: CodexClientOptions) {
    this.child = spawn(opts.bin, ['app-server'], {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout!.setEncoding('utf8');
    this.child.stdout!.on('data', (d: string) => this.splitter.push(d).forEach((l) => this.onLine(l, opts.onNotification)));
    if (opts.onStderr) {
      this.child.stderr!.setEncoding('utf8');
      this.child.stderr!.on('data', (d: string) => opts.onStderr!(d));
    }
    this.child.stdin!.on('error', () => {});
    this.child.on('close', (code, signal) => {
      this.splitter.flush().forEach((l) => this.onLine(l, opts.onNotification));
      for (const p of this.pending.values()) p.reject(new Error('codex app-server exited'));
      this.pending.clear();
      opts.onExit?.(code, signal);
    });
  }

  private onLine(line: string, onNote?: (n: RpcNotification) => void) {
    let msg: { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: unknown };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof msg.id === 'number' && ('result' in msg || 'error' in msg)) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message ?? 'codex error'));
      else p.resolve(msg.result);
    } else if (typeof msg.method === 'string') {
      onNote?.({ method: msg.method, params: msg.params });
    }
  }

  request<T = any>(method: string, params?: unknown): Promise<T> {
    const id = ++this.seq;
    if (!this.write({ id, method, params })) return Promise.reject(new Error('codex stdin closed'));
    return new Promise<T>((resolve, reject) => this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject }));
  }

  notify(method: string, params?: unknown) {
    this.write({ method, params });
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

  close() {
    try {
      this.child.stdin?.end();
    } catch {
      /* already gone */
    }
  }

  kill(signal: NodeJS.Signals = 'SIGKILL') {
    try {
      this.child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}
