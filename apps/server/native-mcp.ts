// The program a thread's ask, render and threads MCP servers run on: omni-mcp, the Rust build in crates/omni-mcp
// (docs/internals/rust-port.md). The desktop app carries it at bin/omni-mcp. A checkout builds it into
// target/debug with scripts/native.ts, which npm run dev, npm start, scripts/qa-stack.sh and the server's tests run.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BUNDLED, ROOT } from './config.ts';

/** The servers the binary has, by the name it takes as its one argument. */
export type NativeMcpServer = 'ask' | 'render' | 'threads';

/** Where the desktop app's build puts the binary (apps/desktop/scripts/native.ts), under the app root. */
export const NATIVE_MCP_PATH = join('bin', 'omni-mcp');

/** Where a checkout's own build goes, under the repo root. */
export const CHECKOUT_MCP_PATH = join('target', 'debug', 'omni-mcp');

/**
 * The binary this install uses, whether or not it is there: the path OMNI_NATIVE_MCP names (relative to the repo
 * root), else the desktop app's own, else the checkout's build.
 */
export function nativeMcpCandidate(env: NodeJS.ProcessEnv = process.env, bundled = BUNDLED, root = ROOT): string {
  const setting = env.OMNI_NATIVE_MCP?.trim();
  if (setting) return resolve(root, setting);
  return join(root, bundled ? NATIVE_MCP_PATH : CHECKOUT_MCP_PATH);
}

export type NativeMcpProbe = { ok: true; version: string } | { ok: false; reason: string };

/** Whether the binary starts on this machine: it must print its name and version and exit 0. */
export function probeNativeMcp(file: string): NativeMcpProbe {
  if (!existsSync(file)) return { ok: false, reason: 'no such file' };
  const result = spawnSync(file, ['--version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
  if (result.error) return { ok: false, reason: result.error.message };
  const version = /^omni-mcp (\S+)$/.exec(result.stdout.trim())?.[1];
  if (result.status !== 0 || !version) return { ok: false, reason: `--version exited with ${result.status ?? result.signal}` };
  return { ok: true, version };
}

let chosen: { candidate: string; file: string | null } | undefined;

/**
 * The binary to start the servers from, or null when it does not start. Probed once per path and logged, so the
 * server log says what every thread on this machine gets.
 */
export function nativeMcp(candidate: string = nativeMcpCandidate()): string | null {
  if (chosen?.candidate === candidate) return chosen.file;
  const probe = probeNativeMcp(candidate);
  let file: string | null = null;
  if (probe.ok) {
    file = candidate;
    console.log(`[mcp] ask, render and threads run on ${candidate} (${probe.version})`);
  } else {
    const fix = BUNDLED ? 'This build of the app was made without it' : 'Build it with npm run dev, or cargo build -p omni-mcp';
    console.warn(`[mcp] ${candidate} did not start (${probe.reason}). Threads get no ask_user_question, html_render or read_referenced_thread. ${fix}`);
  }
  chosen = { candidate, file };
  return file;
}

/** How to start one of the servers, or null when this install has no binary that starts: the thread goes without it. */
export function nativeMcpCommand(name: NativeMcpServer): { command: string; args: string[] } | null {
  const file = nativeMcp();
  return file ? { command: file, args: [name] } : null;
}
