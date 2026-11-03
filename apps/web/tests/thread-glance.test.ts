import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PRSummary, Thread } from '../src/api.ts';
import { AgentsSection } from '../src/components/thread/panel/AgentsSection.tsx';
import { DetailsTab } from '../src/components/thread/panel/DetailsTab.tsx';
import { FIX_CHECKS_PROMPT, FIX_CONFLICTS_PROMPT, OPEN_PR_PROMPT, prLine, prNext, stepUnderway } from '@omni/shared/thread-glance.ts';

// The thread panel's Details tab: the branch card on top (thread-glance.ts, GlanceCard.tsx), the agents card and the
// session rows with MCP folded to one line.

const pr = (over: Partial<PRSummary> = {}): PRSummary => ({
  number: 481,
  title: 'Panel',
  author: null,
  headRefName: 't3/x',
  baseRefName: 'main',
  state: 'OPEN',
  isDraft: false,
  updatedAt: '2026-11-01T18:00:00.000Z',
  reviewDecision: null,
  url: 'https://github.com/o/r/pull/481',
  additions: 4,
  deletions: 1,
  mergeable: 'MERGEABLE',
  checks: { passed: 3, failed: 0, pending: 0 },
  ...over,
});

const thread = (over: Partial<Thread> = {}) =>
  ({ id: 't1', channel_id: 'omni', title: 'Lead', status: 'done', harness: 'claude-code', session_id: 's1', cwd: '/w', source: 'manual', created_at: '2026-10-28T09:00:00.000Z', updated_at: '2026-10-28T09:00:00.000Z', ...over }) as Thread;

describe('the step a branch PR calls for', () => {
  it('opens a PR only when the branch has changes', () => {
    expect(prNext(null, true)).toEqual({ kind: 'open', label: 'Open PR', prompt: OPEN_PR_PROMPT });
    expect(prNext(null, false)).toBeNull();
  });

  it('fixes conflicts before checks, and checks before merging', () => {
    expect(prNext(pr({ mergeable: 'CONFLICTING', checks: { passed: 0, failed: 2, pending: 0 } }), true)).toMatchObject({ kind: 'conflicts', prompt: FIX_CONFLICTS_PROMPT });
    expect(prNext(pr({ checks: { passed: 1, failed: 2, pending: 0 } }), true)).toMatchObject({ kind: 'checks', prompt: FIX_CHECKS_PROMPT });
    expect(prNext(pr(), true)).toEqual({ kind: 'merge', label: 'Merge' });
  });

  it('waits on running checks and drafts, and has nothing for a merged or closed PR', () => {
    expect(prNext(pr({ checks: { passed: 1, failed: 0, pending: 1 } }), true)).toBeNull();
    expect(prNext(pr({ isDraft: true }), true)).toBeNull();
    expect(prNext(pr({ state: 'MERGED' }), true)).toBeNull();
    expect(prNext(pr({ state: 'CLOSED' }), true)).toBeNull();
  });

  it('knows the step the agent is on from the newest message, until its turn ends', () => {
    const said = (text: string) => ({ kind: 'user', payload: JSON.stringify({ text, source: 'ben' }) });
    const reply = { kind: 'assistant_text', payload: JSON.stringify({ text: 'Pushing' }) };
    expect(stepUnderway([said(OPEN_PR_PROMPT), reply], [], true)).toBe('open');
    expect(stepUnderway([said(OPEN_PR_PROMPT), reply], [], false)).toBeNull();
    expect(stepUnderway([said(OPEN_PR_PROMPT), said('Also fix the typo')], [], true)).toBeNull();
    expect(stepUnderway([said('Build it')], [{ kind: 'user', text: FIX_CHECKS_PROMPT }], true)).toBe('checks');
    expect(stepUnderway([], [{ kind: 'user', text: FIX_CONFLICTS_PROMPT }], false)).toBe('conflicts');
  });

  it('says what decides whether it can merge', () => {
    expect(prLine(pr())).toEqual({ text: '3 checks passed', tone: 'live' });
    expect(prLine(pr({ reviewDecision: 'APPROVED' })).text).toBe('3 checks passed · approved');
    expect(prLine(pr({ mergeable: 'CONFLICTING' }))).toEqual({ text: 'Conflicts with the base branch', tone: 'needs' });
    expect(prLine(pr({ checks: { passed: 1, failed: 1, pending: 1 } }))).toEqual({ text: '1 of 3 checks failing', tone: 'needs' });
    expect(prLine(pr({ checks: { passed: 2, failed: 0, pending: 1 } }))).toEqual({ text: '1 of 3 checks running', tone: 'live' });
    expect(prLine(pr({ state: 'MERGED' }))).toEqual({ text: 'Merged', tone: 'done' });
  });
});

describe('the agents card', () => {
  it('shows where the thread came from and folds finished delegations under Previous agents', () => {
    const html = renderToStaticMarkup(
      createElement(AgentsSection, {
        parent: thread({ id: 'p1', title: 'Bundled Server', status: 'done' }),
        links: { from: null, into: [] },
        children: [thread({ id: 'c1', title: 'Web UI Update banner', status: 'done' }), thread({ id: 'c2', title: 'Desktop app button', status: 'running' })],
        agents: [],
        onJump: () => {},
      }),
    );
    expect(html).toContain('Lineage');
    expect(html).toContain('Bundled Server');
    // The running delegation sits under Running, before the fold.
    expect(html.indexOf('Desktop app button')).toBeLessThan(html.indexOf('Previous agents'));
    expect(html.indexOf('Web UI Update banner')).toBeGreaterThan(html.indexOf('Previous agents'));
    expect(html).toContain('aria-expanded="true"');
  });
});

describe('the Details tab', () => {
  const details = { channel: undefined, parent: null, children: [], lastResult: null, warm: undefined, links: { from: null, into: [] }, agents: [], onJump: () => {} };

  it('keeps MCP to one line until opened', () => {
    const mcp = Array.from({ length: 6 }, (_, i) => `server${i}:${i % 2 ? 'failed' : 'connected'}`);
    const html = renderToStaticMarkup(createElement(DetailsTab, { ...details, thread: thread(), init: { mcp } }));
    expect(html).toContain('3 connected');
    expect(html).toContain('3 not connected');
    expect(html).not.toContain('server1');
    expect(html).toContain('aria-expanded="false"');
  });

  it('leads with the branch card: branch, PR and the step it calls for', () => {
    const html = renderToStaticMarkup(
      createElement(DetailsTab, {
        ...details,
        thread: thread({ branch: 't3/x' }),
        init: null,
        prs: { pr: pr({ mergeable: 'CONFLICTING' }), prs: [pr({ mergeable: 'CONFLICTING' })], crew: [] },
        changes: { files: [{}, {}], add: 4, del: 1 },
        next: prNext(pr({ mergeable: 'CONFLICTING' }), true),
      }),
    );
    const card = html.indexOf('Branch at a glance');
    expect(card).toBeGreaterThan(-1);
    expect(card).toBeLessThan(html.indexOf('Harness'));
    expect(html).toContain('#481');
    expect(html).toContain('Conflicts with the base branch');
    expect(html).toContain('2 files changed');
    expect(html).toContain('Fix conflicts');
  });

  it('shows the step the agent is on, spinning, until the PR opens', () => {
    const html = renderToStaticMarkup(
      createElement(DetailsTab, {
        ...details,
        thread: thread({ branch: 't3/x' }),
        init: null,
        prs: { pr: null, prs: [], crew: [] },
        changes: { files: [{}], add: 1, del: 0 },
        next: prNext(null, true),
        step: 'open',
      }),
    );
    expect(html).toContain('Opening PR…');
    expect(html).not.toContain('No PR yet');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Opening PR…<\/button>/);
  });

  it('has no branch card for a thread in the channel folder', () => {
    const html = renderToStaticMarkup(createElement(DetailsTab, { ...details, thread: thread(), init: null }));
    expect(html).not.toContain('Branch at a glance');
  });
});
