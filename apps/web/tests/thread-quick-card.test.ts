import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CrewPR, PRSummary, Thread } from '../src/api.ts';
import { cardPRs, ThreadQuickCard } from '../src/components/thread/ThreadQuickCard.tsx';

vi.mock('../src/store.tsx', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/store.tsx')>()),
  useFeed: () => {},
}));

const thread = (over: Partial<Thread> = {}) =>
  ({
    id: 't1',
    channel_id: 'omni',
    title: 'Lead',
    status: 'running',
    harness: 'cursor',
    session_id: 's1',
    cwd: '/home/ben/omni-os/data/worktrees/t1',
    branch: 'omni/t1',
    source: 'manual',
    created_at: '2026-10-28T09:00:00.000Z',
    updated_at: '2026-10-28T09:00:00.000Z',
    ...over,
  }) as Thread;

const own = (over: Partial<PRSummary> = {}) =>
  ({
    number: 12,
    title: 'Fix the cart',
    author: null,
    headRefName: 'omni/t1',
    baseRefName: 'main',
    state: 'OPEN',
    isDraft: false,
    updatedAt: '2026-10-28T09:00:00.000Z',
    reviewDecision: null,
    url: 'https://github.com/ben/omni/pull/12',
    additions: 1,
    deletions: 0,
    mergeable: 'MERGEABLE',
    checks: { passed: 1, failed: 0, pending: 0 },
    ...over,
  }) as PRSummary;

const crew = (n: number, over: Partial<CrewPR> = {}): CrewPR => ({
  number: n,
  title: `Crew work ${n}`,
  state: 'OPEN',
  isDraft: false,
  url: `https://github.com/ben/omni/pull/${n}`,
  repo: 'ben/omni',
  thread_id: `c${n}`,
  thread_title: `Builder ${n}`,
  channel_id: 'omni',
  task_id: null,
  ...over,
});

describe('the thread quick card', () => {
  const base = {
    init: null,
    warm: true,
    slotBusy: true,
    prs: undefined,
    step: null,
    artifactCount: 0,
    machineName: 'BenBook',
    cwd: '/w',
    onOpen: () => {},
    onOpenPR: () => {},
  };

  it('gives who the thread is for and who does it separate rows: You until someone is named, and the crew role', () => {
    const mine = renderToStaticMarkup(createElement(ThreadQuickCard, { ...base, thread: thread({ owner: null, role: 'builder', harness: 'claude-code' }) }));
    expect(mine).toContain('>Owner<');
    expect(mine).toMatch(/data-owner="">.*?>You</);
    expect(mine).toMatch(/>Agent<\/span><span class="min-w-0 truncate ">Builder</);
    const theirs = renderToStaticMarkup(createElement(ThreadQuickCard, { ...base, thread: thread({ owner: 'Maya Jansen', role: null }) }));
    expect(theirs).toMatch(/data-owner="Maya Jansen">.*?>Maya Jansen</);
    expect(theirs).toMatch(/>Agent<\/span><span class="min-w-0 truncate text-fg-3">No crew role</);
  });

  it('lists machine, checkout, harness, branch and a door into the inspector', () => {
    const html = renderToStaticMarkup(
      createElement(ThreadQuickCard, { ...base, thread: thread(), init: { model: 'composer' }, artifactCount: 2, cwd: '/home/ben/omni-os/data/worktrees/t1' }),
    );
    expect(html).toContain('Thread quick actions');
    expect(html).toContain('BenBook');
    expect(html).toContain('omni/t1');
    expect(html).toContain('All details');
    expect(html).toContain('2 artifacts');
  });

  it('mutes the branch row on a thread with no branch', () => {
    const html = renderToStaticMarkup(createElement(ThreadQuickCard, { ...base, thread: thread({ branch: null }), warm: undefined, slotBusy: false, machineName: undefined }));
    expect(html).toContain('No branch');
  });

  it('leaves Actions, Changes and the thread lineage out', () => {
    const html = renderToStaticMarkup(createElement(ThreadQuickCard, { ...base, thread: thread() }));
    expect(html).not.toContain('Channel actions');
    expect(html).not.toContain('aria-label="Changes"');
    expect(html).not.toContain('Lineage');
  });

  it('says it is checking PRs until the first answer, then that there are none', () => {
    expect(renderToStaticMarkup(createElement(ThreadQuickCard, { ...base, thread: thread() }))).toContain('Checking PRs…');
    const none = renderToStaticMarkup(createElement(ThreadQuickCard, { ...base, thread: thread({ branch: null }), prs: { pr: null, prs: [], crew: [] } }));
    expect(none).toContain('aria-label="Pull requests"');
    expect(none).toContain('No PRs yet');
  });

  it('lists a Conductor’s PRs from its crew, though it has no branch, each with number, title, state and a GitHub link', () => {
    const html = renderToStaticMarkup(
      createElement(ThreadQuickCard, { ...base, thread: thread({ branch: null, title: 'Conductor' }), prs: { pr: null, prs: [], crew: [crew(40, { state: 'MERGED' }), crew(41)] } }),
    );
    expect(html).toContain('No branch');
    expect(html).toContain('#41');
    expect(html).toContain('Crew work 41');
    expect(html).toContain('>open<');
    expect(html).toContain('>merged<');
    expect(html).toContain('href="https://github.com/ben/omni/pull/41"');
    expect(html).toContain('data-external="true"');
    expect(html.indexOf('#41')).toBeLessThan(html.indexOf('#40'));
  });

  it('calls a PR with failing checks blocked', () => {
    const html = renderToStaticMarkup(createElement(ThreadQuickCard, { ...base, thread: thread(), prs: { pr: own({ checks: { passed: 0, failed: 1, pending: 0 } }), prs: [own({ checks: { passed: 0, failed: 1, pending: 0 } })], crew: [] } }));
    expect(html).toContain('#12');
    expect(html).toContain('>blocked<');
  });

  it('says it is opening the PR while the agent does', () => {
    const html = renderToStaticMarkup(createElement(ThreadQuickCard, { ...base, thread: thread(), step: 'open', prs: { pr: null, prs: [], crew: [] } }));
    expect(html).not.toContain('No PRs yet');
  });

  it('says the turn waits on Ben while a question is open, not that it runs', () => {
    const html = renderToStaticMarkup(createElement(ThreadQuickCard, { ...base, thread: thread(), asking: true }));
    expect(html).toContain('Waiting on you');
    expect(html).not.toContain('Turn running');
  });

  it('puts Copy on the working directory row, beside its button rather than inside it', () => {
    const html = renderToStaticMarkup(createElement(ThreadQuickCard, { ...base, thread: thread() }));
    const row = html.indexOf('Show working directory in details');
    const copy = html.indexOf('Copy the working directory path');
    expect(copy).toBeGreaterThan(html.indexOf('</button>', row));
    expect(copy).toBeLessThan(html.indexOf('Turn running'));
  });
});

describe('cardPRs', () => {
  it('puts open PRs first, newest crew first, and lists a PR the thread and its crew share once', () => {
    const list = cardPRs(thread(), { pr: own({ state: 'MERGED' }), prs: [own({ state: 'MERGED' })], crew: [crew(12, { url: 'https://github.com/ben/omni/pull/12' }), crew(20), crew(21)] });
    expect(list.map((p) => p.number)).toEqual([21, 20, 12]);
    expect(list.find((p) => p.number === 12)?.state.label).toBe('merged');
  });
});
