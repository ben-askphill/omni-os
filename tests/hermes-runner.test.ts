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
  const svc = await import('../server/harness/catalog-service.ts');
  await svc.loadCatalog();
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
    const { getCatalog } = await import('../server/harness/catalog-service.ts');
    const h = getCatalog().harnesses.find((x) => x.id === 'hermes');
    expect(h?.available).toBe(true);
    expect(h?.models.map((m) => m.id)).toEqual(['hermes']);
    expect(h?.models[0].efforts).toEqual([]);
    expect(H.runner.slotsByHarness().hermes.cap).toBe(4);
  });

  it('accepts a conductor delegate, skips the worktree, and continues the remote session', async () => {
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
    expect(t.branch).toBeNull();
    expect(t.source).toBe('conductor');
    expect(t.cwd).toBe(join(H.paths.threads, t.id));
    expect(existsSync(join(H.paths.worktrees, t.id))).toBe(false);
    expect(existsSync(join(H.paths.browsers, 'repo'))).toBe(false);

    await H.untilResults(t.id, 1);
    expect(H.thread(t.id).session_id).toBe(`omni-${t.id}`);
    expect(H.thread(t.id).status).toBe('done');
    const first = creates(`omni-${t.id}`);
    expect(first).toHaveLength(1);
    const instructions = (first[0].body as { instructions: string }).instructions;
    expect(instructions).toContain('OMNI_ARTIFACTS_DIR does not exist');
    expect(instructions).toContain('acme/widgets');
    expect(instructions).toContain('own clone');
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

  it('rejects an effort Hermes does not have', async () => {
    await expect(H.runner.createThread({ channel: 'scratch', prompt: 'x', harness: 'hermes', model: 'hermes', effort: 'high' })).rejects.toThrow(/effort/);
  });
});
