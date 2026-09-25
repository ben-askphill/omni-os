import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { join } from 'node:path';

// sandbox.ts only type-imports db.ts; make sure that stays true.
vi.mock('../server/db.ts', () => {
  throw new Error('db.ts must not be imported by sandbox tests');
});

import { buildMcpConfig } from '../server/sandbox.ts';
import { config, paths, browserOutDir } from '../server/config.ts';
import type { Channel } from '../server/db.ts';
import type { CrewRole } from '../server/crew.ts';

const channel = (patch: Partial<Channel> = {}): Channel => ({
  id: 'volero',
  name: 'Volero',
  kind: 'client',
  repo_path: null,
  github_repo: null,
  use_worktree: 1,
  base_dir: null,
  store_domain: null,
  portal_slug: null,
  browser_headless: 1,
  notes: null,
  archived: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  ...patch,
});

const role = (mcp: string[]): CrewRole => ({ id: 'r', name: 'R', description: '', mcp, charter: 'x' });

const THREAD = 'thread-123';
const OMNI_URL = 'http://127.0.0.1:4747';
const originalBrowser = config.browser;

beforeEach(() => {
  config.browser = true;
});
afterAll(() => {
  config.browser = originalBrowser;
});

describe('buildMcpConfig: browser', () => {
  it('adds a headless playwright server with a persistent per-channel profile', () => {
    const cfg = buildMcpConfig({ threadId: THREAD, channel: channel(), browserBusy: false, omniUrl: OMNI_URL });
    const b = cfg.mcpServers['omni-browser'];
    expect(b.command).toBe('npx');
    expect(b.args.slice(0, 2)).toEqual(['-y', '@playwright/mcp@latest']);
    expect(b.args).toContain('--headless');
    expect(b.args).not.toContain('--isolated');
    const out = b.args.indexOf('--output-dir');
    expect(b.args[out + 1]).toBe(browserOutDir(THREAD));
    const udd = b.args.indexOf('--user-data-dir');
    expect(udd).toBeGreaterThan(-1);
    expect(b.args[udd + 1]).toBe(join(paths.browsers, 'volero'));
  });

  it('omits --headless when the channel wants a visible browser', () => {
    const cfg = buildMcpConfig({ threadId: THREAD, channel: channel({ browser_headless: 0 }), browserBusy: false, omniUrl: OMNI_URL });
    expect(cfg.mcpServers['omni-browser'].args).not.toContain('--headless');
  });

  it('uses --isolated instead of the shared profile when another thread holds it', () => {
    const cfg = buildMcpConfig({ threadId: THREAD, channel: channel(), browserBusy: true, omniUrl: OMNI_URL });
    const args = cfg.mcpServers['omni-browser'].args;
    expect(args).toContain('--isolated');
    expect(args).not.toContain('--user-data-dir');
    expect(args).toContain('--headless');
  });

  it('adds no browser when OMNI_BROWSER is off', () => {
    config.browser = false;
    const cfg = buildMcpConfig({ threadId: THREAD, channel: channel(), browserBusy: false, omniUrl: OMNI_URL });
    expect(cfg.mcpServers).toEqual({});
  });
});

describe('buildMcpConfig: omni conductor server', () => {
  it('is added only when the role asks for omni', () => {
    const cfg = buildMcpConfig({ threadId: THREAD, channel: channel(), role: role(['omni']), browserBusy: false, omniUrl: OMNI_URL });
    expect(cfg.mcpServers['omni']).toEqual({
      command: paths.tsx,
      args: [paths.mcpOmni],
      env: { OMNI_URL, OMNI_THREAD_ID: THREAD },
    });
    expect(Object.keys(cfg.mcpServers).sort()).toEqual(['omni', 'omni-browser']);
  });

  it('is absent without a role or when the role lists other servers', () => {
    expect(buildMcpConfig({ threadId: THREAD, channel: channel(), browserBusy: false, omniUrl: OMNI_URL }).mcpServers['omni']).toBeUndefined();
    expect(
      buildMcpConfig({ threadId: THREAD, channel: channel(), role: role(['github']), browserBusy: false, omniUrl: OMNI_URL }).mcpServers['omni'],
    ).toBeUndefined();
    expect(
      buildMcpConfig({ threadId: THREAD, channel: channel(), role: role([]), browserBusy: false, omniUrl: OMNI_URL }).mcpServers['omni'],
    ).toBeUndefined();
  });

  it('still works with the browser off', () => {
    config.browser = false;
    const cfg = buildMcpConfig({ threadId: THREAD, channel: channel(), role: role(['omni']), browserBusy: true, omniUrl: OMNI_URL });
    expect(Object.keys(cfg.mcpServers)).toEqual(['omni']);
  });
});
