import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { WIRE_FIXTURES } from '@omni/test-fixtures';
import type { CrewPR } from '../crew-prs.ts';
import { startRunner } from './runner-boot.ts';

// GET /api/threads/:id/pr `crew`: a PR opened on a thread the Conductor delegated to, at any depth, shows on the
// Conductor's thread and on every thread between, once, in the state GitHub has it in now.

let H: Awaited<ReturnType<typeof startRunner>>;
let githubApi: (typeof import('../github-api.ts'))['githubApi'];
const T = { timeout: 20_000 };

type FakePR = { number: number; branch: string; state?: 'OPEN' | 'MERGED' | 'CLOSED'; title?: string };
let prsFile: string;
/** What the fake gh answers, per repo. */
const github = (byRepo: Record<string, FakePR[]>) => writeFileSync(prsFile, JSON.stringify(byRepo));
const url = (repo: string, n: number) => `https://github.com/${repo}/pull/${n}`;

beforeAll(async () => {
  H = await startRunner();
  ({ githubApi } = await import('../github-api.ts'));
  prsFile = join(H.tmp, 'gh-prs.json');
  github({});
  // `gh pr list --repo R [--head B]`, newest first, from the file above. The startRunner bin is first on PATH.
  const gh = `#!/usr/bin/env node
const a = process.argv.slice(2), arg = (n) => a[a.indexOf(n) + 1];
if (a[0] !== 'pr' || a[1] !== 'list') { console.error('fake gh: ' + a.join(' ')); process.exit(1); }
const all = JSON.parse(require('fs').readFileSync(${JSON.stringify(prsFile)}, 'utf8'))[arg('--repo')] ?? [];
const head = a.includes('--head') ? arg('--head') : null;
const out = all.filter((p) => !head || p.branch === head).map((p) => ({
  number: p.number, title: p.title ?? 'PR ' + p.number, author: null, headRefName: p.branch, baseRefName: 'main', state: p.state ?? 'OPEN',
  isDraft: false, updatedAt: '2026-11-01T00:00:00Z', reviewDecision: null, url: 'https://github.com/' + arg('--repo') + '/pull/' + p.number,
  additions: 1, deletions: 0, mergeable: 'MERGEABLE', statusCheckRollup: [],
}));
console.log(JSON.stringify(out));
`;
  writeFileSync(join(H.tmp, 'bin', 'gh'), gh, { mode: 0o755 });
  H.db.channels.create({ id: 'shop', name: 'shop', github_repo: 'acme/shop' });
  H.db.channels.create({ id: 'app', name: 'app', github_repo: 'acme/app' });
});

/** The repo-wide PR list is cached for 30s (github.ts threadPRMarks): step the clock past it, as a minute's refresh would. */
const realNow = Date.now.bind(Date);
let skipped = 0;
vi.spyOn(Date, 'now').mockImplementation(() => realNow() + skipped);
const later = () => (skipped += 60_000);

const prsOf = async (id: string) => {
  const res = await githubApi.request(`/threads/${id}/pr`);
  expect(res.status).toBe(200);
  return (await res.json()) as { pr: { url: string } | null; prs: { url: string }[]; crew: CrewPR[] };
};

/** A delegated thread, as the Conductor's delegate tool makes one, on a branch of its own. */
const delegate = async (parent: string, channel: string, branch: string | null) => {
  const t = await H.start('do the work', { channel, parent_id: parent, title: `work on ${branch}` });
  await H.untilResults(t.id, 1);
  if (branch) H.db.threads.update(t.id, { branch });
  return H.thread(t.id);
};

describe('crew PRs', () => {
  it('shows a PR from a delegated thread on the Conductor, and through every level of nested delegation', T, async () => {
    const conductor = await H.start('be the conductor');
    await H.untilResults(conductor.id, 1);
    const child = await delegate(conductor.id, 'shop', 'omni/child');
    const grandchild = await delegate(child.id, 'app', 'omni/grandchild');
    expect((await prsOf(conductor.id)).crew).toEqual([]);

    // Opened after the delegation existed, in two repos: both reach the Conductor on its next read.
    github({ 'acme/shop': [{ number: 4, branch: 'omni/child', title: 'Child work' }], 'acme/app': [{ number: 9, branch: 'omni/grandchild' }] });
    later();
    const top = await prsOf(conductor.id);
    expect(top.pr).toBeNull();
    expect(top.prs).toEqual([]);
    expect(top.crew).toEqual([
      { number: 4, title: 'Child work', state: 'OPEN', isDraft: false, url: url('acme/shop', 4), repo: 'acme/shop', thread_id: child.id, thread_title: child.title, channel_id: 'shop', task_id: child.task_id },
      expect.objectContaining({ number: 9, url: url('acme/app', 9), thread_id: grandchild.id, channel_id: 'app' }),
    ]);

    // The child lists its own PR as its own and its delegate's as crew, never both.
    const mid = await prsOf(child.id);
    expect(mid.prs.map((p) => p.url)).toEqual([url('acme/shop', 4)]);
    expect(mid.crew.map((p) => p.url)).toEqual([url('acme/app', 9)]);
    expect((await prsOf(grandchild.id)).crew).toEqual([]);
  });

  it("keeps a crew PR's state in step with GitHub: merged shows merged, closed unmerged drops out", T, async () => {
    const conductor = await H.start('be the conductor');
    await H.untilResults(conductor.id, 1);
    const a = await delegate(conductor.id, 'shop', 'omni/sync-a');
    await delegate(conductor.id, 'shop', 'omni/sync-b');
    github({ 'acme/shop': [{ number: 21, branch: 'omni/sync-a' }, { number: 22, branch: 'omni/sync-b' }] });
    later();
    expect((await prsOf(conductor.id)).crew.map((p) => [p.number, p.state])).toEqual([[21, 'OPEN'], [22, 'OPEN']]);

    github({ 'acme/shop': [{ number: 21, branch: 'omni/sync-a', state: 'MERGED' }, { number: 22, branch: 'omni/sync-b', state: 'CLOSED' }] });
    later();
    expect((await prsOf(conductor.id)).crew.map((p) => [p.number, p.state, p.thread_id])).toEqual([[21, 'MERGED', a.id]]);
  });

  it('lists a PR two delegated threads share once, and leaves out threads without a branch or a repo', T, async () => {
    const conductor = await H.start('be the conductor');
    await H.untilResults(conductor.id, 1);
    const first = await delegate(conductor.id, 'shop', 'omni/shared');
    await delegate(conductor.id, 'shop', 'omni/shared');
    await delegate(conductor.id, 'shop', null);
    await delegate(conductor.id, 'scratch', 'omni/no-repo');
    github({ 'acme/shop': [{ number: 31, branch: 'omni/shared' }] });
    later();
    expect((await prsOf(conductor.id)).crew.map((p) => [p.url, p.thread_id])).toEqual([[url('acme/shop', 31), first.id]]);
  });

  it("brings each delegate_team member's PR up to the lead and on to the Conductor", T, async () => {
    const conductor = await H.start('be the conductor');
    await H.untilResults(conductor.id, 1);
    const { lead, members } = await H.runner.createTeam({
      channel: 'shop',
      title: 'Checkout work',
      prompt: 'Fix checkout',
      parent_id: conductor.id,
      task_id: 'T-40',
      tasks: [
        { title: 'Cart', prompt: 'fix the cart' },
        { title: 'Pay', prompt: 'fix payment' },
      ],
    });
    await H.untilResults(lead.id, 1);
    members.forEach((m, i) => H.db.threads.update(m.id, { branch: `omni/team-${i}` }));
    github({ 'acme/shop': [{ number: 41, branch: 'omni/team-0' }, { number: 42, branch: 'omni/team-1' }] });
    later();
    const want = [
      [41, members[0].id, 'T-40.1'],
      [42, members[1].id, 'T-40.2'],
    ];
    expect((await prsOf(lead.id)).crew.map((p) => [p.number, p.thread_id, p.task_id])).toEqual(want);
    expect((await prsOf(conductor.id)).crew.map((p) => [p.number, p.thread_id, p.task_id])).toEqual(want);
  });

  it('sends the keys the crew-prs.json wire fixture has', T, async () => {
    const conductor = await H.start('be the conductor');
    await H.untilResults(conductor.id, 1);
    await delegate(conductor.id, 'shop', 'omni/wire-shape');
    github({ 'acme/shop': [{ number: 51, branch: 'omni/wire-shape' }] });
    later();
    const sent = await prsOf(conductor.id);
    const fixture = JSON.parse(readFileSync(join(WIRE_FIXTURES, 'crew-prs.json'), 'utf8'));
    const keys = (o: object) => Object.keys(o).sort();
    expect(keys(sent)).toEqual(keys(fixture));
    expect(keys(sent.crew[0])).toEqual(keys(fixture.crew[0]));
  });

  it("links a PR page to the thread on its head branch and the thread that delegated it, on the PR's repo only", T, async () => {
    const { prThread } = await import('../crew-prs.ts');
    const conductor = await H.start('be the conductor');
    await H.untilResults(conductor.id, 1);
    const child = await delegate(conductor.id, 'shop', 'omni/linked');
    expect(prThread('acme/shop', 'omni/linked')).toEqual({ id: child.id, title: child.title, channel_id: 'shop', parent: { id: conductor.id, title: H.thread(conductor.id).title } });
    // A PR page's `thread`, as the pr.json wire fixture has it.
    const fixture = JSON.parse(readFileSync(join(WIRE_FIXTURES, 'pr.json'), 'utf8')).thread;
    const keys = (o: object) => Object.keys(o).sort();
    expect(keys(prThread('acme/shop', 'omni/linked')!)).toEqual(keys(fixture));
    expect(keys(prThread('acme/shop', 'omni/linked')!.parent!)).toEqual(keys(fixture.parent));
    expect(prThread('acme/app', 'omni/linked')).toBeNull();
    expect(prThread('acme/shop', 'someone/else')).toBeNull();

    const solo = await H.start('own branch', { channel: 'shop' });
    await H.untilResults(solo.id, 1);
    H.db.threads.update(solo.id, { branch: 'omni/solo' });
    expect(prThread('acme/shop', 'omni/solo')?.parent).toBeNull();
  });

  it('still answers for a thread with no crew and no branch', async () => {
    const solo = await H.start('alone');
    await H.untilResults(solo.id, 1);
    expect(await prsOf(solo.id)).toEqual({ pr: null, prs: [], crew: [] });
  });
});
