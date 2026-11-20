import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Thread } from '../src/api.ts';
import { takeDisplay } from '../src/display.ts';
import { StatusDot, StatusPill, statusLabel } from '../src/components/ui/status.tsx';
import { ThreadQuickCard } from '../src/components/thread/ThreadQuickCard.tsx';
import { rowOf } from '../src/mobile/rows.ts';
import { prsShown } from '../src/display.ts';
import { paletteItems } from '../src/components/command-palette/items.tsx';
import type { ChannelWithRunning } from '../src/api.ts';

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

describe('the quick card with Show technical details off', () => {
  const base = { init: { model: 'claude-opus-5-5' }, warm: true, slotBusy: false, prs: undefined, step: null, artifactCount: 2, machineName: 'Laptop', cwd: '/home/u/Omni/notes', onOpen: () => {}, onOpenPR: () => {}, onOpenThread: () => {} };

  it('still opens, with the machine, owner, agent, AI app, run, files and the door to all details', () => {
    const html = renderToStaticMarkup(createElement(ThreadQuickCard, { ...base, thread: thread({ role: 'conductor' }), code: false }));
    expect(html).toContain('aria-label="Thread quick actions"');
    expect(html).toContain('Laptop');
    expect(html).toContain('>Owner<');
    expect(html).toContain('>Agent<');
    expect(html).toContain('Claude Code');
    expect(html).toContain('2 files');
    expect(html).toContain('All details');
  });

  it('leaves out the task id, working directory, model id, session and branch, and PRs while there are none', () => {
    const html = renderToStaticMarkup(createElement(ThreadQuickCard, { ...base, thread: thread(), code: false, prs: { pr: null, prs: [], crew: [] } }));
    expect(html).not.toContain('T-BRIEF');
    expect(html).not.toContain('Omni/notes');
    expect(html).not.toContain('Copy the working directory path');
    expect(html).not.toContain('claude-opus-5-5');
    expect(html).not.toContain('default model');
    expect(html).not.toContain('omni/t1');
    expect(html).not.toContain('Cold start');
    expect(html).not.toContain('Live session');
    expect(html).not.toContain('aria-label="Pull requests"');
  });

  it('lists the PRs its crew opened, though the channel has no repo', () => {
    const crew = { number: 41, title: 'Crew work', state: 'OPEN' as const, isDraft: false, url: 'https://github.com/u/r/pull/41', repo: 'u/r', thread_id: 'c1', thread_title: 'Builder', channel_id: 'shop', task_id: null };
    const html = renderToStaticMarkup(createElement(ThreadQuickCard, { ...base, thread: thread({ branch: null }), code: false, prs: { pr: null, prs: [], crew: [crew] } }));
    expect(html).toContain('aria-label="Pull requests"');
    expect(html).toContain('#41');
  });

  it('shows the lineage, as it does with the switch on', () => {
    const child = thread({ id: 'c1', title: 'Builder: fix the cart', status: 'running', run_started_at: new Date(Date.now() - 4000).toISOString() });
    const html = renderToStaticMarkup(createElement(ThreadQuickCard, { ...base, thread: thread(), code: false, delegated: [child] }));
    expect(html).toContain('aria-label="Lineage"');
    expect(html).toContain('Builder: fix the cart');
    expect(html).toMatch(/· 1 running/);
  });

  it('keeps the branch and the Pull requests section in a channel with a repo, but not the raw path or task id', () => {
    const html = renderToStaticMarkup(createElement(ThreadQuickCard, { ...base, thread: thread(), code: true }));
    expect(html).toContain('omni/t1');
    expect(html).toContain('aria-label="Pull requests"');
    expect(html).not.toContain('T-BRIEF');
    expect(html).not.toContain('Omni/notes');
  });
});

describe('Pull requests outside a code project', () => {
  const plain = [{ id: 'notes', name: 'Notes', repo_path: null }] as unknown as ChannelWithRunning[];
  const code = [...plain, { id: 'shop', name: 'Shop', repo_path: '/code/shop' }] as unknown as ChannelWithRunning[];
  const prs = (channels: ChannelWithRunning[]) => paletteItems('pull', channels, [], { name: 'home' }, null).some((i) => i.id === 'p:prs');

  it('has no way in until a channel has a repo or the switch is on', () => {
    expect(prsShown({ technical: false, shopify: false }, plain)).toBe(false);
    expect(prsShown({ technical: false, shopify: false }, code)).toBe(true);
    expect(prsShown({ technical: true, shopify: false }, plain)).toBe(true);
    expect(prs(plain)).toBe(false);
    expect(prs(code)).toBe(true);
  });
});
