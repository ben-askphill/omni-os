import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Which program a thread's ask, render and threads servers start from (native-mcp.ts): the Rust build when the
// install has one that runs, the TypeScript otherwise. The stand-ins here are shell scripts that answer --version.

vi.mock('../db.ts', () => {
  throw new Error('db.ts must not be imported by sandbox tests');
});

const DIR = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const dir = mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'omni-native-mcp-'));
  process.env.OMNI_DATA_DIR = require('node:path').join(dir, 'data');
  delete process.env.OMNI_CONFIG;
  delete process.env.OMNI_NATIVE_MCP;
  return dir;
});

import { nativeMcp, nativeMcpCandidate, nativeMcpCommand, probeNativeMcp } from '../native-mcp.ts';
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
const conductor: CrewRole = { id: 'r', name: 'R', description: '', mcp: ['omni'], delegateOnly: false, charter: 'x' };
const URL = 'http://127.0.0.1:4747';
const servers = (omniUrl = URL, role?: CrewRole) => buildMcpConfig({ threadId: 't', channel, role, browserBusy: false, omniUrl }).mcpServers;

const originalBrowser = config.browser;
config.browser = false;
afterEach(() => {
  delete process.env.OMNI_NATIVE_MCP;
  vi.restoreAllMocks();
});
afterAll(() => {
  config.browser = originalBrowser;
  rmSync(DIR, { recursive: true, force: true });
});

describe('where the Rust build is looked for', () => {
  it('is the app root in the desktop app, and nowhere in a checkout unless it is named', () => {
    expect(nativeMcpCandidate({}, true, '/app')).toBe('/app/bin/omni-mcp');
    expect(nativeMcpCandidate({}, false, '/repo')).toBeNull();
    expect(nativeMcpCandidate({ OMNI_NATIVE_MCP: 'target/release/omni-mcp' }, false, '/repo')).toBe('/repo/target/release/omni-mcp');
    expect(nativeMcpCandidate({ OMNI_NATIVE_MCP: '/opt/omni-mcp' }, true, '/app')).toBe('/opt/omni-mcp');
  });

  it('is turned off with OMNI_NATIVE_MCP=0, in the desktop app too', () => {
    expect(nativeMcpCandidate({ OMNI_NATIVE_MCP: '0' }, true, '/app')).toBeNull();
    expect(nativeMcpCandidate({ OMNI_NATIVE_MCP: ' 0 ' }, true, '/app')).toBeNull();
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
  it('starts ask, render and threads from the Rust build, with the same environment, and says so once', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.OMNI_NATIVE_MCP = GOOD;
    const typescript = (() => {
      delete process.env.OMNI_NATIVE_MCP;
      const got = servers();
      process.env.OMNI_NATIVE_MCP = GOOD;
      return got;
    })();
    const native = servers();
    expect(Object.keys(native)).toEqual(['omni-ask', 'omni-render', 'omni-threads']);
    for (const [name, arg] of [['omni-ask', 'ask'], ['omni-render', 'render'], ['omni-threads', 'threads']] as const) {
      expect(native[name]).toEqual({ command: GOOD, args: [arg], env: typescript[name].env });
      expect(typescript[name].command).toBe(paths.mcpRunner);
    }
    servers();
    expect(log.mock.calls.filter(([line]) => String(line).includes('Rust build'))).toEqual([[`[mcp] ask, render and threads run on the Rust build: ${GOOD} (9.9.9)`]]);
  });

  it('keeps the conductor on its TypeScript server, which has no Rust build', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.OMNI_NATIVE_MCP = GOOD;
    const got = servers(URL, conductor);
    expect(got['omni']).toMatchObject({ command: paths.mcpRunner, args: [paths.mcpOmni] });
    expect(got['omni-ask'].command).toBe(GOOD);
    expect(got['omni-threads']).toBeUndefined();
  });

  it('falls back to the TypeScript servers, with a warning, when the named binary does not start', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.OMNI_NATIVE_MCP = script('broken', 'exit 1');
    expect(servers()['omni-ask']).toMatchObject({ command: paths.mcpRunner, args: [paths.mcpAsk] });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('run on the TypeScript servers');
  });

  it('says nothing when a desktop build simply has no binary', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(nativeMcp(join(DIR, 'app', 'bin', 'omni-mcp'))).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('leaves an API that is not plain HTTP to the TypeScript servers', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.OMNI_NATIVE_MCP = GOOD;
    expect(nativeMcpCommand('ask', 'https://omni.example')).toBeNull();
    expect(nativeMcpCommand('ask', URL)).toEqual({ command: GOOD, args: ['ask'] });
    expect(servers('https://omni.example')['omni-ask'].command).toBe(paths.mcpRunner);
  });
});
