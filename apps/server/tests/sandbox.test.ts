import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// sandbox.ts only type-imports db.ts; make sure that stays true.
vi.mock('../db.ts', () => {
  throw new Error('db.ts must not be imported by sandbox tests');
});

import { buildMcpConfig, needsWorktree, playwrightMcpBin, plannedWorktree, prepareWorkdir, writeCursorDenyConfig } from '../sandbox.ts';
import { config, paths, browserOutDir, threadDir } from '../config.ts';
import type { Channel } from '../db.ts';
import type { CrewRole } from '../crew.ts';

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
  default_harness: null,
  default_model: null,
  default_effort: null,
  design_system: null,
  design_system_name: null,
  browser_headless: 1,
  notes: null,
  archived: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  ...patch,
});

const role = (mcp: string[], delegateOnly = false): CrewRole => ({ id: 'r', name: 'R', description: '', mcp, delegateOnly, charter: 'x' });

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
  it('gives a delegate-only role the omni tools but no browser', () => {
    const cfg = buildMcpConfig({ threadId: THREAD, channel: channel(), role: role(['omni'], true), browserBusy: false, omniUrl: OMNI_URL });
    expect(cfg.mcpServers['omni-browser']).toBeUndefined();
    expect(cfg.mcpServers['omni']).toBeDefined();
  });

  it('adds a headless playwright server with a persistent per-channel profile', () => {
    const cfg = buildMcpConfig({ threadId: THREAD, channel: channel(), browserBusy: false, omniUrl: OMNI_URL });
    const b = cfg.mcpServers['omni-browser'];
    // The pinned install by absolute path, run by node: never npx and a registry tag.
    expect(b.command).toBe(process.execPath);
    expect(b.args[0]).toBe(playwrightMcpBin());
    expect(b.args.join(' ')).not.toMatch(/npx|@latest/);
    expect(b.args).toContain('--headless');
    expect(b.args).not.toContain('--isolated');
    const out = b.args.indexOf('--output-dir');
    expect(b.args[out + 1]).toBe(browserOutDir(THREAD));
    const udd = b.args.indexOf('--user-data-dir');
    expect(udd).toBeGreaterThan(-1);
    expect(b.args[udd + 1]).toBe(join(paths.browsers, 'volero'));
  });

  it('runs @playwright/mcp from an exact version pinned in the server package', () => {
    const { dependencies } = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'));
    expect(dependencies['@playwright/mcp']).toMatch(/^\d+\.\d+\.\d+$/);
    const bin = playwrightMcpBin();
    expect(existsSync(bin)).toBe(true);
    const installed = JSON.parse(readFileSync(join(bin, '..', 'package.json'), 'utf8'));
    expect(installed.version).toBe(dependencies['@playwright/mcp']);
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
    expect(Object.keys(cfg.mcpServers)).toEqual(['omni-ask', 'omni-threads']);
  });
});

describe('buildMcpConfig: omni-ask', () => {
  it('gives every thread ask_user_question, whatever its role, with the token file and never the token', () => {
    for (const r of [undefined, role([]), role(['github']), role(['omni'])]) {
      const cfg = buildMcpConfig({ threadId: THREAD, channel: channel(), role: r, browserBusy: false, omniUrl: OMNI_URL });
      expect(cfg.mcpServers['omni-ask']).toEqual({
        command: paths.tsx,
        args: [paths.mcpAsk],
        env: { OMNI_URL, OMNI_TOKEN_FILE: join(paths.data, 'api-token'), OMNI_THREAD_ID: THREAD, OMNI_USER: 'the user' },
      });
    }
    expect(existsSync(paths.mcpAsk)).toBe(true);
  });
});

describe('buildMcpConfig: omni-threads', () => {
  it('gives every thread without the conductor server read_referenced_thread, which the conductor server has itself', () => {
    for (const r of [undefined, role([]), role(['github'])]) {
      const cfg = buildMcpConfig({ threadId: THREAD, channel: channel(), role: r, browserBusy: false, omniUrl: OMNI_URL });
      expect(cfg.mcpServers['omni-threads']).toEqual({
        command: paths.tsx,
        args: [paths.mcpThreads],
        env: { OMNI_URL, OMNI_TOKEN_FILE: join(paths.data, 'api-token'), OMNI_THREAD_ID: THREAD, OMNI_USER: 'the user' },
      });
    }
    expect(buildMcpConfig({ threadId: THREAD, channel: channel(), role: role(['omni']), browserBusy: false, omniUrl: OMNI_URL }).mcpServers['omni-threads']).toBeUndefined();
    expect(existsSync(paths.mcpThreads)).toBe(true);
  });
});

describe('buildMcpConfig: omni conductor server', () => {
  it('is added only when the role asks for omni', () => {
    const cfg = buildMcpConfig({ threadId: THREAD, channel: channel(), role: role(['omni']), browserBusy: false, omniUrl: OMNI_URL });
    expect(cfg.mcpServers['omni']).toEqual({
      command: paths.tsx,
      args: [paths.mcpOmni],
      // The token file's path, never the token: mcp.json and Cursor's plugin folder hold no secret value.
      env: { OMNI_URL, OMNI_TOKEN_FILE: join(paths.data, 'api-token'), OMNI_THREAD_ID: THREAD, OMNI_USER: 'the user' },
    });
    expect(Object.keys(cfg.mcpServers).sort()).toEqual(['omni', 'omni-ask', 'omni-browser']);
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
    expect(Object.keys(cfg.mcpServers).sort()).toEqual(['omni', 'omni-ask']);
  });
});

describe('prepareWorkdir', () => {
  it('names a worktree thread its planned folder and branch, and makes nothing in the repo', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'omni-plan-repo-'));
    const id = 'planned-wd-123456';
    try {
      const ch = channel({ repo_path: repo, use_worktree: 1 });
      expect(needsWorktree(ch)).toBe(true);
      expect(await prepareWorkdir(ch, id)).toEqual(plannedWorktree(id));
      expect(plannedWorktree(id)).toEqual({ cwd: join(paths.worktrees, id), branch: 'omni/planned-' });
      expect(existsSync(join(paths.worktrees, id))).toBe(false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(threadDir(id), { recursive: true, force: true });
    }
  });

  it('needs no worktree with worktrees off, without a repo, or for a remote harness', () => {
    expect(needsWorktree(channel({ repo_path: '/r', use_worktree: 0 }))).toBe(false);
    expect(needsWorktree(channel({ repo_path: null, use_worktree: 1 }))).toBe(false);
    expect(needsWorktree(channel({ repo_path: '/r', use_worktree: 1 }), { remote: true })).toBe(false);
  });
});

describe('writeCursorDenyConfig', () => {
  it('writes the deny rules alone when the user has no Cursor config yet, and again each spawn without failing', () => {
    const user = mkdtempSync(join(tmpdir(), 'omni-cursor-none-'));
    const dir = join(mkdtempSync(join(tmpdir(), 'omni-cursor-thread-')), 'cursor-config');
    expect(writeCursorDenyConfig(dir, user)).toBe(dir);
    expect(JSON.parse(readFileSync(join(dir, 'cli-config.json'), 'utf8'))).toEqual({ version: 1, permissions: { allow: [], deny: ['Shell(*)', 'Write(**)'] } });
    // A folder Cursor made since the last spawn is linked on the next; the ones already linked stay.
    mkdirSync(join(user, 'chats'));
    expect(writeCursorDenyConfig(dir, user)).toBe(dir);
    expect(lstatSync(join(dir, 'chats')).isSymbolicLink()).toBe(true);
    expect(writeCursorDenyConfig(dir, user)).toBe(dir);
  });

  it('never repeats a deny rule the user already has', () => {
    const user = mkdtempSync(join(tmpdir(), 'omni-cursor-dup-'));
    writeFileSync(join(user, 'cli-config.json'), JSON.stringify({ permissions: { deny: ['Shell(*)'] } }));
    const cfg = JSON.parse(readFileSync(join(writeCursorDenyConfig(join(mkdtempSync(join(tmpdir(), 'omni-cursor-thread-')), 'cursor-config'), user), 'cli-config.json'), 'utf8'));
    expect(cfg.permissions.deny).toEqual(['Shell(*)', 'Write(**)']);
  });
});
