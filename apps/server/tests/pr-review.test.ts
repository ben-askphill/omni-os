import { beforeAll, describe, expect, it, vi } from 'vitest';
import { startRunner } from './runner-boot.ts';

const getPR = vi.hoisted(() => vi.fn());
vi.mock('../github.ts', async (original) => ({ ...await original<typeof import('../github.ts')>(), getPR }));
let H: Awaited<ReturnType<typeof startRunner>>;
let api: (typeof import('../github-api.ts'))['githubApi'];
beforeAll(async () => {
  H = await startRunner();
  api = (await import('../github-api.ts')).githubApi;
  H.db.channels.create({ id: 'shop', name: 'Shop', github_repo: 'acme/shop', use_worktree: 0, base_dir: `${H.tmp}/scratch` });
  H.db.channels.create({ id: 'shared', name: 'Shared', github_repo: 'acme/shop', use_worktree: 0, base_dir: `${H.tmp}/scratch` });
  H.db.channels.create({ id: 'other', name: 'Other', github_repo: 'acme/other', use_worktree: 0, base_dir: `${H.tmp}/scratch` });
});
const start = async (opts: Parameters<typeof H.start>[1] = {}) => {
  const t = await H.start('hello', { channel: 'shop', ...opts });
  await H.untilResults(t.id, 1);
  return t;
};
const review = async (branch: string, conflict = false, fork = false) => {
  getPR.mockResolvedValue({ number: 517, headRefName: branch, baseRefName: 'main', url: 'https://github.com/acme/shop/pull/517', mergeable: conflict ? 'CONFLICTING' : 'MERGEABLE', isCrossRepository: fork });
  const res = await api.request('/channels/shop/prs/517/review', { method: 'POST' });
  expect(res.status).toBe(200);
  const reply = await res.json() as { thread_id: string; destination_thread_id: string };
  await H.untilResults(reply.thread_id, 1);
  return { ...reply, child: H.thread(reply.thread_id), prompt: H.events(reply.thread_id).find((e) => e.kind === 'user')!.p.text as string };
};

describe('PR review delegation', () => {
  it('resolves conflicts under the Conductor through a team lead and reports there', async () => {
    const parent = await start({ role: 'conductor', channel: 'scratch' });
    const lead = await start({ parent_id: parent.id });
    const origin = await start({ channel: 'shared', parent_id: lead.id });
    H.db.threads.update(origin.id, { branch: 'omni/conflict', archived: 1 });
    const r = await review('omni/conflict', true);
    expect(r.destination_thread_id).toBe(parent.id);
    expect(r.child).toMatchObject({ parent_id: parent.id, source: 'conductor', role: 'builder', channel_id: 'shared' });
    expect(r.child.task_id).toBeTruthy();
    expect(r.prompt).toContain('Resolve them against the latest base branch');
    expect(r.prompt).toContain('push the resolution to the existing PR head branch');
    expect(r.prompt).toContain(origin.id);
    await H.until('review report on Conductor', () => H.events(parent.id).some((e) => e.kind === 'crew_report'));
  });

  it('delegates plain review to its builder when there is no Conductor ancestor', async () => {
    const nonConductor = await start();
    const origin = await start({ parent_id: nonConductor.id });
    H.db.threads.update(origin.id, { branch: 'feature/review' });
    const r = await review('feature/review');
    expect(r.destination_thread_id).toBe(origin.id);
    expect(r.child.parent_id).toBe(origin.id);
    expect(r.prompt).toContain('summarize the change, risks');
    expect(r.prompt).not.toContain('This PR has merge conflicts');
    expect(r.prompt).toContain('Do not open a replacement PR');
  });

  it('uses the generated branch owner when a second thread shares the branch', async () => {
    const origin = await start();
    const branch = `omni/${origin.id.slice(0, 8)}`;
    H.db.threads.update(origin.id, { branch });
    const other = await start();
    H.db.threads.update(other.id, { branch });
    expect((await review(branch)).child.parent_id).toBe(origin.id);
  });

  it('falls back for unknown origins, different repos, forks and ambiguous owners', async () => {
    const differentRepo = await start({ channel: 'other' });
    H.db.threads.update(differentRepo.id, { branch: 'feature/external' });
    const a = await start();
    const b = await start();
    H.db.threads.update(a.id, { branch: 'feature/shared' });
    H.db.threads.update(b.id, { branch: 'feature/shared' });
    const forkOwner = await start();
    H.db.threads.update(forkOwner.id, { branch: 'feature/fork' });
    for (const [branch, fork] of [['feature/unknown', false], ['feature/external', false], ['feature/shared', false], ['feature/fork', true]] as const) {
      const r = await review(branch, true, fork);
      expect(r.child.parent_id).toBeNull();
      expect(r.child.source).toBe('manual');
      expect(r.destination_thread_id).toBe(r.thread_id);
      expect(r.prompt).toContain('This PR has merge conflicts');
    }
  });

  it('does not create a fallback thread when GitHub fails', async () => {
    const before = H.db.threads.byChannel('shop').length;
    getPR.mockRejectedValue(new Error('GitHub unavailable'));
    const response = await api.request('/channels/shop/prs/517/review', { method: 'POST' });
    expect(response.status).toBe(500);
    expect(H.db.threads.byChannel('shop')).toHaveLength(before);
  });
});
