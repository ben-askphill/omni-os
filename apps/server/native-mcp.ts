// Which program runs a thread's ask, render and threads MCP servers: the Rust build (crates/omni-mcp) when this
// install carries one that starts, else the TypeScript ones on a Node runtime. The Rust build is held to a record of
// the TypeScript servers (docs/internals/rust-port.md), so a thread cannot tell which it got.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BUNDLED, ROOT } from './config.ts';

/** The servers the binary has, by the name it takes as its one argument. */
export type NativeMcpServer = 'ask' | 'render' | 'threads';

/** Where the desktop app's build puts the binary (apps/desktop/scripts/native.ts), under the app root. */
export const NATIVE_MCP_PATH = join('bin', 'omni-mcp');

/**
 * The binary this install would use, whether or not it is there. OMNI_NATIVE_MCP decides: `0` means never, a path
 * names one, and unset means the desktop app's own. A checkout has none unless it is named: a `target/` build can be
 * older than the TypeScript beside it.
 */
export function nativeMcpCandidate(env: NodeJS.ProcessEnv = process.env, bundled = BUNDLED, root = ROOT): string | null {
  const setting = env.OMNI_NATIVE_MCP?.trim();
  if (setting === '0') return null;
  if (setting) return resolve(root, setting);
  return bundled ? join(root, NATIVE_MCP_PATH) : null;
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

let chosen: { candidate: string | null; file: string | null } | undefined;

/**
 * The binary to start the servers from, or null for the TypeScript ones. Probed once per path and logged, so the
 * server log says which implementation every thread on this machine gets.
 */
export function nativeMcp(candidate: string | null = nativeMcpCandidate()): string | null {
  if (chosen?.candidate === candidate) return chosen.file;
  let file: string | null = null;
  if (candidate) {
    const probe = probeNativeMcp(candidate);
    if (probe.ok) {
      file = candidate;
      console.log(`[mcp] ask, render and threads run on the Rust build: ${candidate} (${probe.version})`);
    } else {
      // A desktop build made without cargo carries no binary. That is a supported build, not a fault.
      const missing = probe.reason === 'no such file' && !process.env.OMNI_NATIVE_MCP;
      if (!missing) console.warn(`[mcp] ${candidate} did not start (${probe.reason}). ask, render and threads run on the TypeScript servers`);
    }
  }
  chosen = { candidate, file };
  return file;
}

/**
 * How to start one of the servers the Rust build has, or null to start the TypeScript one. The binary speaks plain
 * HTTP only, which is all a thread's server is ever given: the local API on 127.0.0.1.
 */
export function nativeMcpCommand(name: NativeMcpServer, omniUrl: string): { command: string; args: string[] } | null {
  if (!omniUrl.startsWith('http://')) return null;
  const file = nativeMcp();
  return file ? { command: file, args: [name] } : null;
}
