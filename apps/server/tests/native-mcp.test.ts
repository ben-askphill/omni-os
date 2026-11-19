import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Which program a thread's ask, render, steps and threads servers start from (native-mcp.ts): omni-mcp, when the install
// has one that runs, and none of the four when it does not. The stand-ins here are shell scripts that answer --version.

vi.mock('../db.ts', () => {
  throw new Error('db.ts must not be imported by sandbox tests');
});

const DIR = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const dir = mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'omni-native-mcp-'));
  process.env.OMNI_DATA_DIR = require('node:path').join(dir, 'data');
  delete process.env.OMNI_CONFIG;
  return dir;
});

import { nativeMcp, nativeMcpCandidate, nativeMcpCommand, probeNativeMcp } from '../native-mcp.ts';
import { buildCheckoutMcp } from '../scripts/native.ts';
import { prepareMcp } from './global-native.ts';
import { buildMcpConfig } from '../sandbox.ts';
import { config, paths } from '../config.ts';
import type { Channel } from '../db.ts';
import type { CrewRole } from '../crew.ts';

const script = (name: string, body: string, mode = 0o755) => {
  const file = join(DIR, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, mode);
  return file;
};
const GOOD = script('good', 'echo "omni-mcp 9.9.9"');
const channel = { id: 'c', name: 'C', browser_headless: 1 } as Channel;
const conductor: CrewRole = { id: 'r', name: 'R', description: '', mcp: ['omni'], tools: 'full', delegateOnly: false, delegatable: true, review: false, kind: 'own', hidden: false, charter: 'x' };
const URL = 'http://127.0.0.1:4747';
const servers = (role?: CrewRole) => buildMcpConfig({ threadId: 't', channel, role, browserBusy: false, omniUrl: URL }).mcpServers;

const originalBrowser = config.browser;
config.browser = false;
// The run's own setting (global-native.ts), put back after each test that names another binary.
const runs = process.env.OMNI_NATIVE_MCP;
afterEach(() => {
  if (runs === undefined) delete process.env.OMNI_NATIVE_MCP;
  else process.env.OMNI_NATIVE_MCP = runs;
  vi.restoreAllMocks();
});
afterAll(() => {
  config.browser = originalBrowser;
  rmSync(DIR, { recursive: true, force: true });
});

describe('where the binary is looked for', () => {
  it('is the app root in the desktop app, target/debug in a checkout, or the path OMNI_NATIVE_MCP names', () => {
    expect(nativeMcpCandidate({}, true, '/app')).toBe('/app/bin/omni-mcp');
    expect(nativeMcpCandidate({}, false, '/repo')).toBe('/repo/target/debug/omni-mcp');
    expect(nativeMcpCandidate({ OMNI_NATIVE_MCP: 'target/release/omni-mcp' }, false, '/repo')).toBe('/repo/target/release/omni-mcp');
    expect(nativeMcpCandidate({ OMNI_NATIVE_MCP: '/opt/omni-mcp' }, true, '/app')).toBe('/opt/omni-mcp');
    expect(nativeMcpCandidate({ OMNI_NATIVE_MCP: '  ' }, true, '/app')).toBe('/app/bin/omni-mcp');
  });
});

describe('whether a binary starts', () => {
  it('takes one that prints its name and version', () => {
    expect(probeNativeMcp(GOOD)).toEqual({ ok: true, version: '9.9.9' });
  });

  it('refuses a missing file, one that fails, one that says something else and one that cannot run', () => {
    expect(probeNativeMcp(join(DIR, 'absent'))).toEqual({ ok: false, reason: 'no such file' });
    expect(probeNativeMcp(script('fails', 'echo "omni-mcp 1.0.0"; exit 3'))).toEqual({ ok: false, reason: '--version exited with 3' });
    expect(probeNativeMcp(script('other', 'echo "v24.0.0"'))).toMatchObject({ ok: false });
    expect(probeNativeMcp(script('locked', 'echo "omni-mcp 1.0.0"', 0o644))).toMatchObject({ ok: false, reason: expect.stringContaining('EACCES') });
  });
});

describe('what a thread gets', () => {
  it('starts ask, render, steps and threads from the binary, with the API environment, and says so once', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.OMNI_NATIVE_MCP = GOOD;
    const got = servers();
    expect(Object.keys(got)).toEqual(['omni-ask', 'omni-render', 'omni-steps', 'omni-threads']);
    for (const [name, arg] of [['omni-ask', 'ask'], ['omni-render', 'render'], ['omni-steps', 'steps'], ['omni-threads', 'threads']] as const) {
      expect(got[name]).toMatchObject({ command: GOOD, args: [arg], env: { OMNI_URL: URL, OMNI_THREAD_ID: 't', OMNI_TOKEN_FILE: expect.any(String) } });
    }
    servers();
    expect(log.mock.calls.filter(([line]) => String(line).startsWith('[mcp]'))).toEqual([[`[mcp] ask, render, steps and threads run on ${GOOD} (9.9.9)`]]);
  });

  it('keeps the conductor on its TypeScript server, which has no Rust build yet', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.OMNI_NATIVE_MCP = GOOD;
    const got = servers(conductor);
    expect(got['omni']).toMatchObject({ command: paths.mcpRunner, args: [paths.mcpOmni] });
    expect(got['omni-ask'].command).toBe(GOOD);
    expect(got['omni-threads']).toBeUndefined();
  });

  it('leaves the four out, with one warning that says how to build it, when the binary does not start', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.OMNI_NATIVE_MCP = script('broken', 'exit 1');
    expect(servers()).toEqual({});
    expect(servers(conductor)).toEqual({ omni: expect.objectContaining({ args: [paths.mcpOmni] }) });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('Threads get no ask_user_question, html_render, set_steps or read_referenced_thread. Build it with npm run dev');
    expect(nativeMcpCommand('ask')).toBeNull();
  });

  it('warns about a missing binary too, which a checkout that never built it has', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(nativeMcp(join(DIR, 'app', 'target', 'debug', 'omni-mcp'))).toBeNull();
    expect(String(warn.mock.calls[0][0])).toContain('did not start (no such file)');
  });
});

describe("a checkout's build", () => {
  /** Runs `fn` with only a fake `cargo` on PATH, which answers --version and the build as told. */
  const withCargo = <T>(version: string, build: string, fn: () => T): T => {
    const bin = join(DIR, `cargo-${version}-${build}`.replace(/\W+/g, '-'));
    require('node:fs').mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'cargo'), `#!/bin/sh\nif [ "$1" = --version ]; then ${version}; fi\n${build}\n`);
    chmodSync(join(bin, 'cargo'), 0o755);
    const path = process.env.PATH;
    process.env.PATH = `${bin}:/usr/bin:/bin`;
    try {
      return fn();
    } finally {
      process.env.PATH = path;
    }
  };

  it('says cargo is missing when there is none, or when it does not run, as a version manager shim with no Rust set', () => {
    const path = process.env.PATH;
    process.env.PATH = join(DIR, 'no-bin');
    try {
      expect(buildCheckoutMcp(DIR)).toEqual({ ok: false, missing: true, reason: 'cargo does not run (ENOENT). Install Rust from https://rustup.rs' });
    } finally {
      process.env.PATH = path;
    }
    const shim = withCargo('echo "No version is set for shim: cargo" >&2; exit 1', 'exit 0', () => buildCheckoutMcp(DIR));
    expect(shim).toEqual({ ok: false, missing: true, reason: 'cargo does not run (No version is set for shim: cargo). Install Rust from https://rustup.rs' });
  });

  it('tells a build that fails apart from a missing cargo', () => {
    expect(withCargo('echo "cargo 1.100.0"; exit 0', 'exit 101', () => buildCheckoutMcp(DIR))).toEqual({ ok: false, missing: false, reason: 'cargo build -p omni-mcp exited with 101' });
    expect(withCargo('echo "cargo 1.100.0"; exit 0', 'exit 0', () => buildCheckoutMcp(DIR))).toEqual({ ok: true });
  });

  it("fails the test run on a build that fails, and skips only without cargo", () => {
    const saved = { build: process.env.OMNI_TEST_MCP_BUILD, mcp: process.env.OMNI_NATIVE_MCP };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() => prepareMcp({ ok: false, missing: false, reason: 'cargo build -p omni-mcp exited with 101' })).toThrow('omni-mcp did not build: cargo build -p omni-mcp exited with 101');
      prepareMcp({ ok: false, missing: true, reason: 'cargo does not run (ENOENT)' });
      expect(process.env.OMNI_TEST_MCP_BUILD).toBe('0');
      expect(probeNativeMcp(process.env.OMNI_NATIVE_MCP!)).toEqual({ ok: true, version: '0.0.0-stub' });
    } finally {
      if (saved.build === undefined) delete process.env.OMNI_TEST_MCP_BUILD;
      else process.env.OMNI_TEST_MCP_BUILD = saved.build;
      if (saved.mcp === undefined) delete process.env.OMNI_NATIVE_MCP;
      else process.env.OMNI_NATIVE_MCP = saved.mcp;
    }
  });
});
