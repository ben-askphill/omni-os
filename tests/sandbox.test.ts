import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// sandbox.ts only type-imports db.ts; make sure that stays true.
vi.mock('../server/db.ts', () => {
  throw new Error('db.ts must not be imported by sandbox tests');
});

import { buildMcpConfig, prepareWorkdir } from '../server/sandbox.ts';
import { config, paths, browserOutDir, threadDir } from '../server/config.ts';
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
  icon: null,
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

  it("attaches to the channel browser Omni runs, instead of launching one", () => {
    const cfg = buildMcpConfig({ threadId: THREAD, channel: channel(), browserBusy: false, cdpEndpoint: 'http://127.0.0.1:9333', omniUrl: OMNI_URL });
    const args = cfg.mcpServers['omni-browser'].args;
    expect(args[args.indexOf('--cdp-endpoint') + 1]).toBe('http://127.0.0.1:9333');
    expect(args).not.toContain('--user-data-dir');
    expect(args).not.toContain('--headless');
    expect(args).not.toContain('--isolated');
  });

  it('keeps a thread that does not hold the profile isolated, even with the channel browser up', () => {
    const cfg = buildMcpConfig({ threadId: THREAD, channel: channel(), browserBusy: true, cdpEndpoint: 'http://127.0.0.1:9333', omniUrl: OMNI_URL });
    const args = cfg.mcpServers['omni-browser'].args;
    expect(args).toContain('--isolated');
    expect(args).not.toContain('--cdp-endpoint');
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

  it('does not create a git worktree for a remote harness', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'omni-hermes-repo-'));
    const id = 'hermes-remote-wd';
    try {
      execFileSync('git', ['init', repo]);
      execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@example.com']);
      execFileSync('git', ['-C', repo, 'config', 'user.name', 'Test']);
      writeFileSync(join(repo, 'README'), 'hi\n');
      execFileSync('git', ['-C', repo, 'add', 'README']);
      execFileSync('git', ['-C', repo, 'commit', '-m', 'init'], {
        env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' },
      });
      const wd = await prepareWorkdir(channel({ repo_path: repo, use_worktree: 1, github_repo: 'acme/widgets' }), id, { remote: true });
      expect(wd.branch).toBeNull();
      expect(wd.cwd).toBe(threadDir(id));
      expect(existsSync(join(paths.worktrees, id))).toBe(false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(threadDir(id), { recursive: true, force: true });
    }
  });

  it('still works with the browser off', () => {
    config.browser = false;
    const cfg = buildMcpConfig({ threadId: THREAD, channel: channel(), role: role(['omni']), browserBusy: true, omniUrl: OMNI_URL });
    expect(Object.keys(cfg.mcpServers)).toEqual(['omni']);
  });
});
