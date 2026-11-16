// The real Io: Node's process, fetch, file system and child processes.
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, fstatSync, openSync, readFileSync, readSync, statfsSync, statSync } from 'node:fs';
import type { Fetch } from '@omni/client-core';
import type { Io, RunResult } from './io.ts';

/**
 * The environment the CLI and what it starts see. The shim the desktop app writes runs the CLI on the app's own
 * binary with ELECTRON_RUN_AS_NODE=1 (apps/desktop/src/cli-shim.ts). Left in, it would make the app that `omni open`
 * starts, or an Electron-based CLI that `doctor` runs, act as Node too.
 */
function childEnv(): Record<string, string | undefined> {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

export function nodeIo(): Io {
  const env = childEnv();
  return {
    env,
    cwd: process.cwd(),
    platform: process.platform,
    out: (text) => void process.stdout.write(text),
    err: (text) => void process.stderr.write(text),
    async stdin() {
      if (process.stdin.isTTY) return null;
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString('utf8');
    },
    fetch: globalThis.fetch as unknown as Fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    clock: () => performance.now(),
    uuid: () => randomUUID(),
    run(bin, args, timeoutMs) {
      return new Promise<RunResult>((resolve) => {
        execFile(bin, args, { env, timeout: timeoutMs, maxBuffer: 1024 * 1024, killSignal: 'SIGKILL' }, (err, stdout, stderr) => {
          const e = err as (NodeJS.ErrnoException & { code?: string | number; killed?: boolean }) | null;
          if (e && (e.code === 'ENOENT' || e.code === 'EACCES')) return resolve({ code: null, stdout: '', stderr: '', missing: true });
          const code = !e ? 0 : typeof e.code === 'number' ? e.code : e.killed ? null : 1;
          resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), missing: false });
        });
      });
    },
    launch(bin, args) {
      return new Promise((resolve) => {
        try {
          const child = spawn(bin, args, { env, detached: true, stdio: 'ignore' });
          child.once('error', () => resolve(false));
          child.once('spawn', () => {
            child.unref();
            resolve(true);
          });
        } catch {
          resolve(false);
        }
      });
    },
    readFile(path) {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    stat(path) {
      try {
        const s = statSync(path);
        return { mode: s.mode, size: s.size, mtimeMs: s.mtimeMs, dir: s.isDirectory() };
      } catch {
        return null;
      }
    },
    disk(path) {
      try {
        const s = statfsSync(path);
        return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
      } catch {
        return null;
      }
    },
    tail(path, bytes) {
      let fd: number | null = null;
      try {
        fd = openSync(path, 'r');
        const size = fstatSync(fd).size;
        const length = Math.min(size, bytes);
        const buf = Buffer.alloc(length);
        readSync(fd, buf, 0, length, size - length);
        return buf.toString('utf8');
      } catch {
        return null;
      } finally {
        if (fd !== null) closeSync(fd);
      }
    },
  };
}
