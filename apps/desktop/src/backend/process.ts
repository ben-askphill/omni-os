// Process work the backend does: read the login shell's PATH, start the server into its log, stop its process group.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { extractPath } from './launch.ts';

function minimalEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const key of ['HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL']) {
    if (env[key]) out[key] = env[key];
  }
  return out;
}

/**
 * PATH from the user's login shell, or null when it does not answer in time. An app opened from the Dock or a
 * launcher gets a short PATH, and the harness CLIs (claude, codex) live on the user's own.
 */
export function readLoginPath(shell: string, env: NodeJS.ProcessEnv, timeoutMs = 5000): Promise<string | null> {
  const id = randomBytes(8).toString('hex');
  const command = `printf '%s%s\\n%s\\n%s%s' OMNI 'START${id}' "$PATH" OMNI 'END${id}'`;
  return new Promise((resolve) => {
    const child = spawn(shell, ['-ilc', command], { env: minimalEnv(env), stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(null);
    }, timeoutMs);
    child.stdout?.on('data', (buf: Buffer) => {
      out += buf.toString();
    });
    child.once('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.once('close', () => {
      clearTimeout(timer);
      resolve(extractPath(out, id));
    });
  });
}

/**
 * A `node` for scripts that start with `#!/usr/bin/env node`, for a Mac with no Node of its own: this app's binary
 * acting as Node. It goes last on PATH, so a Node the user installed still wins.
 */
export function writeNodeShim(dir: string, binary: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'node');
  const quoted = `'${binary.replaceAll("'", `'\\''`)}'`;
  writeFileSync(file, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${quoted} "$@"\n`, { mode: 0o755 });
  chmodSync(file, 0o755);
  return dir;
}

export interface Spawned {
  pid: number;
  /** The exit code once it exited, else null. */
  exited: () => number | null;
  onExit: (listener: (code: number) => void) => void;
}

export function spawnServer(input: { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; logFile: string }): Spawned {
  mkdirSync(dirname(input.logFile), { recursive: true, mode: 0o700 });
  const fd = openSync(input.logFile, 'a', 0o600);
  try {
    // Its own process group, so stopping it also stops what it started, and a crash of this app does not.
    const child = spawn(input.command, input.args, { cwd: input.cwd, env: input.env, detached: true, stdio: ['ignore', fd, fd] });
    let code: number | null = null;
    const listeners: ((code: number) => void)[] = [];
    const finish = (status: number) => {
      if (code !== null) return;
      code = status;
      for (const listener of listeners) listener(status);
    };
    child.once('exit', (status) => finish(status ?? 0));
    child.once('error', () => finish(1));
    child.unref();
    if (!child.pid) throw new Error('Could not start the server.');
    return {
      pid: child.pid,
      exited: () => code,
      onExit: (listener) => {
        if (code !== null) listener(code);
        else listeners.push(listener);
      },
    };
  } finally {
    closeSync(fd);
  }
}

export function readTail(file: string, lines = 20): string {
  try {
    const text = readFileSync(file);
    const slice = text.subarray(Math.max(0, text.length - 8000)).toString('utf8');
    return slice.split('\n').slice(-lines).join('\n').trim();
  } catch {
    return '';
  }
}

/** SIGTERM the process group we started, then SIGKILL if it is still there. */
export async function stopGroup(pid: number, waitMs = 8000): Promise<void> {
  const kill = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
    } catch {
      // Already gone.
    }
  };
  kill('SIGTERM');
  const start = Date.now();
  while (Date.now() - start < waitMs) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  kill('SIGKILL');
}
