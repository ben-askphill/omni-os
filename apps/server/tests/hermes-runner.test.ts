import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { startFakeHermes, type FakeHermes } from './fake-hermes.ts';

// A stand-in for `security`. It prints a test double, never a real token.
const SECURITY = `#!/bin/sh
if [ "$1" = "find-generic-password" ]; then
  printf '%s\\n' 'test-key'
  exit 0
fi
exit 0
`;

let fake: FakeHermes;
let bin: string;
let H: Awaited<ReturnType<typeof startRunner>>;
const savedPath = process.env.PATH;
const savedUrl = process.env.OMNI_HERMES_URL;

beforeAll(async () => {
  fake = await startFakeHermes();
  bin = mkdtempSync(join(tmpdir(), 'omni-security-'));
  writeFileSync(join(bin, 'security'), SECURITY, { mode: 0o755 });
  H = await startRunner({
    OMNI_HERMES_URL: fake.url,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
  });
  const repo = join(H.tmp, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Test']);
  writeFileSync(join(repo, 'README'), 'hi\n');
  execFileSync('git', ['-C', repo, 'add', 'README']);
  execFileSync('git', ['-C', repo, 'commit', '-m', 'init'], {
    env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' },
  });
  H.db.channels.create({ id: 'repo', name: 'Repo', kind: 'client', use_worktree: 1, repo_path: repo, github_repo: 'acme/widgets', notes: 'ship it' });
  const svc = await import('../harness/catalog-service.ts');
  await svc.loadCatalog();
  // As boot does: Hermes becomes the remote agent `hermes` (ADR 0020).
  (await import('../remote-agents.ts')).convertRemoteAgents();
});

afterAll(() => {
  process.env.PATH = savedPath;
  if (savedUrl === undefined) delete process.env.OMNI_HERMES_URL;
  else process.env.OMNI_HERMES_URL = savedUrl;
  if (bin) rmSync(bin, { recursive: true, force: true });
  return fake?.close();
});

const creates = (sessionId: string) => fake.calls.filter((c) => c.method === 'POST' && c.path === '/v1/runs' && (c.body as { session_id?: string })?.session_id === sessionId);

describe('Hermes through the runner', () => {
  it('lists Hermes from the capabilities probe', async () => {
    const { getCatalog } = await import('../harness/catalog-service.ts');
    const h = getCatalog().harnesses.find((x) => x.id === 'hermes');
    expect(h?.available).toBe(true);
    expect(h?.models.map((m) => m.id)).toEqual(['hermes']);
    expect(h?.models[0].efforts).toEqual([]);
    expect(H.runner.slotsByHarness().hermes.cap).toBe(12);
  });

  it('accepts a conductor delegate led by Hermes, makes its worktree at the start, and continues the remote session', async () => {
    const t = await H.runner.createThread({
      channel: 'repo',
      prompt: 'say hi',
      harness: 'hermes',
      model: 'hermes',
      source: 'conductor',
      task_id: 'T-9',
    });
    expect(t.harness).toBe('hermes');
    expect(t.model).toBe('hermes');
    expect(t.role).toBe('hermes');
    expect(t.source).toBe('conductor');
    // A remote-led thread gets its worktree at the start, for the local agents seated in it (Q31). Hermes reads none of it.
    expect(t.branch).toBe(`omni/${t.id.slice(0, 8)}`);
    expect(t.cwd).toBe(join(H.paths.worktrees, t.id));
    expect(existsSync(join(H.paths.browsers, 'repo'))).toBe(false);

    await H.untilResults(t.id, 1);
    expect(existsSync(join(H.paths.worktrees, t.id, 'README'))).toBe(true);
    expect(H.thread(t.id).session_id).toBe(`omni-${t.id}`);
    expect(H.thread(t.id).status).toBe('done');
    const first = creates(`omni-${t.id}`);
    expect(first).toHaveLength(1);
    const instructions = (first[0].body as { instructions: string }).instructions;
    expect(instructions).toContain('OMNI_ARTIFACTS_DIR does not exist');
    expect(instructions).toContain('acme/widgets');
    expect(instructions).toContain('You talk only in this thread');
    expect(instructions).toContain('ship it');
    expect(H.texts(t.id, 'user').join('\n')).toBe('say hi');
    expect(H.texts(t.id, 'user').join('\n')).not.toContain('OMNI_ARTIFACTS_DIR');
    expect(H.texts(t.id, 'assistant_text').join(' ')).toContain('printed');

    H.runner.sendMessage(t.id, 'and this');
    await H.untilResults(t.id, 2);
    const both = creates(`omni-${t.id}`);
    expect(both).toHaveLength(2);
    expect((both[1].body as { instructions?: string }).instructions).toBeUndefined();
    expect(both[1].body).toMatchObject({ input: 'and this', session_id: `omni-${t.id}` });
    expect(H.texts(t.id, 'user')).toEqual(['say hi', 'and this']);
  });

  it('delivers two messages sent while the thread starts, both of them, and ends the turn (F5)', async () => {
    // In a channel with no worktree: a worktree thread takes no message while its worktree is prepared.
    const t = await H.runner.createThread({ channel: 'scratch', prompt: 'first of two', harness: 'hermes', model: 'hermes', source: 'conductor', task_id: 'T-10' });
    // Before the process is up: the message joins the first one in flight, and both go in as the session starts.
    H.runner.sendMessage(t.id, 'second of two');
    await H.untilResults(t.id, 2, 15000);
    expect(H.texts(t.id, 'user')).toEqual(['first of two', 'second of two']);
    expect(creates(`omni-${t.id}`).map((c) => (c.body as { input: string }).input)).toEqual(['first of two', 'second of two']);
    await H.untilStatus(t.id, 'done');
  });

  it('fails a run Hermes refuses at its concurrent run cap as an error, not a usage limit stop', async () => {
    fake.failPosts = 99;
    try {
      const t = await H.runner.createThread({ channel: 'repo', prompt: 'busy now', harness: 'hermes', model: 'hermes' });
      await H.untilStatus(t.id, 'failed', 12_000);
      expect(H.texts(t.id, 'error').join('\n')).toContain('concurrent run cap');
      expect(H.thread(t.id)).toMatchObject({ limit_state: null, limit_resets_at: null });
      const item = H.db.needsYou(undefined, t.id).items[0];
      expect(item?.blockers ?? []).toEqual([]);
    } finally {
      fake.failPosts = 0;
    }
  });

  it('refuses a local agent on Hermes, the Conductor included, before it makes a thread', async () => {
    const before = H.db.threads.list({}).length;
    // A local agent never runs on a remote agent's server (ADR 0020): it is seated beside Hermes instead.
    for (const role of ['conductor', 'researcher'])
      await expect(H.runner.createThread({ channel: 'scratch', prompt: 'fix the cart', role, harness: 'hermes', model: 'hermes' })).rejects.toThrow(/is a local agent, and a local agent no longer runs on a remote agent's server/);
    expect(H.db.threads.list({}).length).toBe(before);
  });

  it("runs on Hermes's own run, whatever model or effort was asked", async () => {
    // A remote agent's run is its server's (ADR 0020): the pickers never offer one, so an effort sent anyway is dropped.
    const t = await H.runner.createThread({ channel: 'scratch', prompt: 'x', harness: 'hermes', model: 'hermes', effort: 'high' });
    expect(H.db.threads.get(t.id)).toMatchObject({ role: 'hermes', harness: 'hermes', model: 'hermes', effort: '' });
  });
});
