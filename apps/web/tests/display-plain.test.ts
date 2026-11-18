import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Thread } from '../src/api.ts';
import { takeDisplay } from '../src/display.ts';
import { StatusDot, StatusPill, statusLabel } from '../src/components/ui/status.tsx';
import { ThreadQuickCard } from '../src/components/thread/ThreadQuickCard.tsx';
import { rowOf } from '../src/mobile/rows.ts';

// Show technical details off: the plain words a person reads, and the code detail left out outside a repo channel.

vi.mock('../src/store.tsx', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/store.tsx')>()),
  useFeed: () => {},
}));

beforeAll(() => takeDisplay({ technical: false, shopify: false }));
afterAll(() => takeDisplay({ technical: true, shopify: true }));

const thread = (over: Partial<Thread> = {}) =>
  ({
    id: 't1',
    channel_id: 'notes',
    title: 'Brief',
    status: 'done',
    harness: 'claude-code',
    session_id: 's1',
    task_id: 'T-BRIEF',
    cwd: '/home/u/Omni/notes',
    branch: 'omni/t1',
    source: 'manual',
    created_at: '2026-11-18T09:00:00.000Z',
    updated_at: '2026-11-18T09:00:00.000Z',
    ...over,
  }) as Thread;

describe('plain status words', () => {
  it('names a mark with one of five words and keeps its own name as the detail', () => {
    const html = renderToStaticMarkup(createElement(StatusDot, { mark: 'limited' }));
    expect(html).toContain('aria-label="Needs you: Usage limit"');
    expect(renderToStaticMarkup(createElement(StatusDot, { mark: 'working' }))).toContain('aria-label="Working"');
    expect(renderToStaticMarkup(createElement(StatusPill, { mark: 'crew_failed' }))).toContain('Failed');
    expect(statusLabel('queued')).toBe('Working');
  });

  it('says Working on a phone row that is running', () => {
    const row = rowOf({ ...thread({ status: 'queued' }) }, undefined, Date.parse('2026-11-18T09:01:00.000Z'));
    expect(row.meta).toBe('Working');
  });
});

describe('the quick card outside a repo', () => {
  const base = { init: null, warm: true, slotBusy: false, prs: undefined, step: null, artifactCount: 0, machineName: 'Laptop', cwd: '/w', onOpen: () => {}, onOpenPR: () => {} };

  it('leaves out the task id, working directory, branch, session and pull requests', () => {
    const html = renderToStaticMarkup(createElement(ThreadQuickCard, { ...base, thread: thread(), code: false }));
    expect(html).not.toContain('T-BRIEF');
    expect(html).not.toContain('omni/t1');
    expect(html).not.toContain('Cold start');
    expect(html).not.toContain('Live session');
    expect(html).not.toContain('aria-label="Pull requests"');
  });

  it('keeps them in a channel with a repo', () => {
    const html = renderToStaticMarkup(createElement(ThreadQuickCard, { ...base, thread: thread(), code: true }));
    expect(html).toContain('T-BRIEF');
    expect(html).toContain('omni/t1');
  });
});
