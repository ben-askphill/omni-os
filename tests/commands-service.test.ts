import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';

// The command list service, against the fake Claude Code. Probes are counted through the
// fake's invocation log: a probe is an invocation with the commands entrypoint.

const r = await startRunner({ ANTHROPIC_API_KEY: 'sk-stale-from-zshrc' });
const { listCommands } = await import('../server/commands.ts');

const probes = (cwd?: string) => r.invocations().filter((i) => i.entrypoint === 'omni-os-commands' && (!cwd || i.cwd === cwd));
const names = (l: { commands: { name: string }[] }) => l.commands.map((c) => c.name);

/** A folder with project commands, like a channel's repo. */
function repo(commands: Record<string, string> = {}) {
  // The real path, as the CLI sees its cwd (macOS temp dirs sit behind a symlink).
  const dir = realpathSync(mkdtempSync(join(r.tmp, 'repo-')));
  addCommands(dir, commands);
  return dir;
}
function addCommands(dir: string, commands: Record<string, string>) {
  mkdirSync(join(dir, '.claude', 'commands'), { recursive: true });
  for (const [name, description] of Object.entries(commands)) {
    writeFileSync(join(dir, '.claude', 'commands', `${name}.md`), `---\ndescription: ${description}\n---\nDo it.\n`);
  }
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
});
afterAll(() => {
  vi.useRealTimers();
});
const later = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));

describe('listCommands on Claude Code', () => {
  it('reads the list from the folder the thread runs in, waiting on the first call', async () => {
    const dir = repo({ 'deploy-preview': 'Push this branch to a preview theme' });
    const list = await listCommands('claude-code', dir, { wait: true });

    expect(list.status).toBe('ready');
    expect(list.commands).toContainEqual({ name: 'deploy-preview', description: 'Push this branch to a preview theme', source: 'project', mentionable: true });
    expect(list.commands).toContainEqual(expect.objectContaining({ name: 'document-skills:pdf', source: 'plugin', aliases: ['pdf'] }));
    expect(list.fetchedAt).toEqual(expect.any(Number));
  });

  it('never creates a session or runs hooks, and strips a stale API key', async () => {
    const dir = repo();
    await listCommands('claude-code', dir, { wait: true });
    const [probe] = probes(dir);
    expect(probe.args).toEqual(expect.arrayContaining(['--no-session-persistence', '--strict-mcp-config']));
    expect(probe.args[probe.args.indexOf('--settings') + 1]).toBe('{"disableAllHooks":true}');
    expect(probe.api_auth).toEqual([]);
  });

  it('leaves out terminal-only commands and the built-ins Omni commands replace', async () => {
    const list = await listCommands('claude-code', repo(), { wait: true });
    expect(names(list)).toContain('compact');
    for (const hidden of ['clear', 'model', 'config']) expect(names(list)).not.toContain(hidden);
  });

  it('shares one probe between concurrent calls and serves the cache for 30 seconds', async () => {
    const dir = repo();
    const [a, b] = await Promise.all([listCommands('claude-code', dir, { wait: true }), listCommands('claude-code', dir, { wait: true })]);
    expect(names(a)).toEqual(names(b));
    later(20_000);
    const c = await listCommands('claude-code', dir, { wait: true });
    expect(c.fetchedAt).toBe(a.fetchedAt);
    expect(probes(dir)).toHaveLength(1);
  });

  it('says it is loading when nothing is cached and the caller does not wait', async () => {
    const dir = repo();
    expect(await listCommands('claude-code', dir)).toEqual({ status: 'loading', commands: [], fetchedAt: null });
    await r.until('the background probe', () => probes(dir).length === 1);
  });

  it('serves a stale list at once and refreshes it in the background', async () => {
    const dir = repo({ 'ship-check': 'Run the pre-ship checklist' });
    const first = await listCommands('claude-code', dir, { wait: true });
    addCommands(dir, { 'release-notes': 'Draft the release notes' });
    later(31_000);

    const stale = await listCommands('claude-code', dir);
    expect(stale.fetchedAt).toBe(first.fetchedAt);
    expect(names(stale)).not.toContain('release-notes');

    const fresh = await listCommands('claude-code', dir, { wait: true });
    expect(names(fresh)).toContain('release-notes');
    expect(probes(dir)).toHaveLength(2);
  });

  it('keeps the last good list when a refresh fails', async () => {
    const dir = repo({ 'ship-check': 'Run the pre-ship checklist' });
    const good = await listCommands('claude-code', dir, { wait: true });
    process.env.FAKE_CLAUDE_INIT_FAIL = '1';
    try {
      later(31_000);
      const after = await listCommands('claude-code', dir, { wait: true });
      expect(probes(dir)).toHaveLength(2);
      expect(after).toEqual(good);
    } finally {
      delete process.env.FAKE_CLAUDE_INIT_FAIL;
    }
  });

  it('reports the fix when Claude Code cannot list its commands', async () => {
    process.env.FAKE_CLAUDE_INIT_FAIL = '1';
    try {
      const list = await listCommands('claude-code', repo(), { wait: true });
      expect(list).toEqual({ status: 'unavailable', fix: 'claude doctor', commands: [], fetchedAt: null });
    } finally {
      delete process.env.FAKE_CLAUDE_INIT_FAIL;
    }
  });
});
