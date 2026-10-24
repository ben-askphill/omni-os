import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFakeCursorApi, type FakeCursorApi } from '@omni/test-fixtures/fake-cursor-api.mjs';
import { startRunner } from './runner-boot.ts';

// A stand-in for `security`: the global CURSOR_API_KEY is a test double, every other secret is missing.
const SECURITY = `#!/bin/sh
if [ "$1" = "find-generic-password" ]; then
  case "$*" in *" -a global/CURSOR_API_KEY "*) printf '%s\\n' 'test-cursor-key'; exit 0 ;; esac
  exit 44
fi
exit 0
`;

let fake: FakeCursorApi;
let bin: string;
let H: Awaited<ReturnType<typeof startRunner>>;
const savedPath = process.env.PATH;

beforeAll(async () => {
  fake = await startFakeCursorApi();
  bin = mkdtempSync(join(tmpdir(), 'omni-security-'));
  writeFileSync(join(bin, 'security'), SECURITY, { mode: 0o755 });
  H = await startRunner({
    OMNI_CURSOR_API_URL: fake.url,
    OMNI_CURSOR_CLOUD_POLL_MS: '5',
    PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
  });
  const repo = join(H.tmp, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', repo]);
  H.db.channels.create({ id: 'acme', name: 'Acme', kind: 'client', use_worktree: 1, repo_path: repo, github_repo: 'acme/widgets' });
  H.db.channels.create({ id: 'notes', name: 'Notes', kind: 'internal', use_worktree: 0 });
  const svc = await import('../harness/catalog-service.ts');
  await svc.loadCatalog();
});

afterAll(() => {
  process.env.PATH = savedPath;
  if (bin) rmSync(bin, { recursive: true, force: true });
  return fake?.close();
});

describe('Cursor Cloud through the runner', () => {
  it('lists Cursor Cloud from the models probe, and per channel', async () => {
    const { getCatalog, channelCatalog } = await import('../harness/catalog-service.ts');
    const h = getCatalog().harnesses.find((x) => x.id === 'cursor-cloud')!;
    expect(h.available).toBe(true);
    expect(h.models.map((m) => m.id)).toEqual(['default', 'composer-2', 'claude-4.5-sonnet']);
    expect(channelCatalog(getCatalog(), 'notes').harnesses.find((x) => x.id === 'cursor-cloud')).toMatchObject({ available: false });
    expect(H.runner.slotsByHarness()['cursor-cloud'].cap).toBe(4);
  });

  it('runs a Conductor delegate as a cloud agent with no worktree, and reports back with the PR', async () => {
    const parent = await H.start('plan the work');
    await H.untilResults(parent.id, 1);
    const t = await H.runner.createThread({
      channel: 'acme',
      prompt: 'Move the toolbar buttons',
      harness: 'cursor-cloud',
      source: 'conductor',
      parent_id: parent.id,
      task_id: 'T-7',
    });
    expect(t).toMatchObject({ harness: 'cursor-cloud', branch: null, setup: null });
    expect(t.cwd).toBe(join(H.paths.threads, t.id));
    expect(existsSync(join(H.paths.worktrees, t.id))).toBe(false);

    await H.untilResults(t.id, 1);
    expect(H.thread(t.id)).toMatchObject({ status: 'done', session_id: `bc-${t.id}` });
    const create = fake.calls.find((c) => c.method === 'POST' && c.path === '/v1/agents')!;
    const prompt = (create.body as { prompt: { text: string } }).prompt.text;
    expect(prompt).toContain('You are a Cursor cloud agent');
    expect(prompt).toContain('cannot build or run macOS apps');
    expect(prompt).toContain('acme/widgets');
    expect(prompt).not.toContain(H.paths.threads);
    expect(H.texts(t.id, 'user')).toEqual(['Move the toolbar buttons']);
    const cloud = H.byKind(t.id, 'cloud_agent').map((e) => e.p.status);
    expect(cloud.at(-1)).toBe('FINISHED');

    await H.until('crew report on the parent', () => H.byKind(parent.id, 'crew_report').length === 1);
    const report = H.byKind(parent.id, 'crew_report')[0].p;
    expect(report).toMatchObject({ thread_id: t.id, task_id: 'T-7', status: 'done' });
    expect(report.text).toContain('https://github.com/acme/widgets/pull/');
    expect(report.text).toContain(`https://cursor.com/agents/bc-${t.id}`);
  });

  it('Stop cancels the run, keeps the agent, and marks the thread stopped', async () => {
    const t = await H.runner.createThread({ channel: 'acme', prompt: 'CLOUD:HOLD wait for me', harness: 'cursor-cloud' });
    await H.until('the run is going', () => H.byKind(t.id, 'cloud_agent').some((e) => e.p.status === 'RUNNING'));
    H.runner.stopThread(t.id);
    await H.untilStatus(t.id, 'stopped');
    expect(H.byKind(t.id, 'cloud_agent').at(-1)?.p.status).toBe('CANCELLED');
    expect(H.byKind(t.id, 'result').at(-1)?.p).toMatchObject({ ok: false, subtype: 'cancelled', stopped: true });
    expect(fake.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/cancel'))).toHaveLength(1);

    // The agent is still there: the next message is a follow-up run on it.
    H.runner.sendMessage(t.id, 'carry on');
    await H.untilResults(t.id, 2);
    expect(H.thread(t.id).status).toBe('done');
    expect(fake.calls.filter((c) => c.method === 'POST' && c.path === `/v1/agents/bc-${t.id}/runs`)).toHaveLength(1);
  });

  it('refuses a cloud thread in a channel with no GitHub repo', async () => {
    await expect(H.runner.createThread({ channel: 'notes', prompt: 'go', harness: 'cursor-cloud' })).rejects.toThrow(/GitHub repo/);
  });
});
