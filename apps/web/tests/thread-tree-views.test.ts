// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@omni/server/db.ts', () => {
  throw new Error('db.ts must not be imported by thread tree tests');
});

// The store and the phone shell as these views read them.
const app = vi.hoisted(() => ({
  channels: [] as unknown[],
  needsYou: null as unknown,
  tasks: [] as unknown[],
  setDone: null as unknown as (id: string, on: boolean) => Promise<unknown>,
  readResult: () => {},
}));
vi.mock('../src/store.tsx', async (importActual) => ({
  ...(await importActual<typeof import('../src/store.tsx')>()),
  useApp: () => app,
}));
vi.mock('../src/mobile/shell.tsx', () => ({ useShell: () => ({ open: () => {}, toast: () => {} }) }));

import { treePrefKey } from '@omni/shared/thread-tree.ts';
import type { BackgroundTask, ChannelWithRunning, ThreadStub } from '../src/api.ts';
import { DoneConfirmProvider } from '../src/done-confirm.tsx';
import { ChannelThreadEntry } from '../src/components/sidebar/SidebarRows.tsx';
import { useJobTree, type JobTree } from '../src/thread-tree.ts';

// The thread tree in the views that show it: its open state across a job's runs (apps/web/src/thread-tree.ts), the
// phone card's Done question (apps/web/src/mobile/NeedsCard.tsx) and sub-agents in the classic sidebar
// (apps/web/src/components/sidebar/SidebarRows.tsx).

const s = (id: string, channel_id: string, status: string, over: Partial<ThreadStub> = {}): ThreadStub => ({
  id, channel_id, title: id, status: status as ThreadStub['status'], created_at: '2026-11-15T20:00:00.000Z', updated_at: '2026-11-15T20:00:00.000Z', ...over,
});
const channel = (id: string, over: Partial<ChannelWithRunning> = {}) => ({ id, name: id, running: 0, ...over }) as ChannelWithRunning;
const conductor = (job: ThreadStub, children: ThreadStub[]) => [channel('conductor', { handoffs: [{ parent: job, children }] }), channel('omni-os')];
const agent = (thread_id: string, description: string): BackgroundTask =>
  ({ thread_id, channel_id: 'omni-os', task_id: `task-${thread_id}`, description, subagent: true, background: false, started_at: '2026-11-15T20:00:00.000Z' }) as BackgroundTask;

let root: Root;
let host: HTMLDivElement;
const render = async (node: ReactNode) => act(async () => root.render(node));
beforeEach(() => {
  localStorage.clear();
  app.tasks = [];
  app.needsYou = { items: [], unread: 0, blocked: 0 };
  app.setDone = vi.fn(async (id: string) => ({ id }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('a tree Ben closed by hand', () => {
  let tree: JobTree | null = null;
  const Probe = ({ job }: { job: ThreadStub }) => {
    tree = useJobTree(job, 'inbox');
    return null;
  };
  const at = async (jobStatus: string, childStatus: string) => {
    const job = s('job', 'conductor', jobStatus, { delegating: childStatus === 'running' });
    app.channels = conductor(job, [s('child', 'omni-os', childStatus)]);
    await render(createElement(Probe, { job }));
  };

  it('opens by itself on the job\'s next run, as the choice ends with the run it was made in', async () => {
    await at('done', 'running');
    expect(tree!.open).toBe(true);
    await act(async () => tree!.toggle());
    expect(tree!.open).toBe(false);

    await at('done', 'done');
    expect(tree!.phase).toBe('finished');
    expect(tree!.open).toBe(false);
    // The run ended, and with it the choice: nothing stays saved for the next one.
    expect(localStorage.getItem(`omni.${treePrefKey('inbox', 'job')}`)).toBeNull();

    await at('done', 'running');
    expect(tree!.open).toBe(true);
  });
});

describe('a choice made in a view that is not on screen', () => {
  it('ends when the job moves between running and finished, seen from the app\'s lists', async () => {
    const at = async (childStatus: string) => {
      app.channels = conductor(s('job', 'conductor', 'done', { delegating: childStatus === 'running' }), [s('child', 'omni-os', childStatus)]);
      await render(createElement(DoneConfirmProvider, null, null));
    };
    await at('running');
    localStorage.setItem(`omni.${treePrefKey('sidebar', 'job')}`, JSON.stringify({ open: false, phase: 'running' }));
    await at('running');
    expect(localStorage.getItem(`omni.${treePrefKey('sidebar', 'job')}`)).not.toBeNull();
    await at('done');
    expect(localStorage.getItem(`omni.${treePrefKey('sidebar', 'job')}`)).toBeNull();
  });
});

describe('sub-agents in the classic sidebar', () => {
  const rows = () => [...host.querySelectorAll('a')].map((a) => a.textContent?.trim() ?? '');

  it('nest under the delegated thread that runs them, as in the Inbox', async () => {
    const job = s('job', 'conductor', 'done', { delegating: true, title: 'Ship the thread tree' });
    app.channels = conductor(job, [s('child', 'omni-os', 'running', { title: 'Mock the options' })]);
    app.tasks = [agent('child', 'Find sidebar rows'), agent('job', 'Plan the briefs')];
    // The row gets its own tasks, as the sidebar hands them out (by host); the tree reads the rest from the store.
    await render(createElement(ChannelThreadEntry, { t: job, active: false, tasks: [app.tasks[1] as BackgroundTask] }));
    const list = rows();
    const child = list.findIndex((r) => r.startsWith('Mock the options'));
    expect(child).toBeGreaterThanOrEqual(0);
    expect(list[child + 1]).toMatch(/^Find sidebar rows/);
    expect(list.some((r) => r.startsWith('Plan the briefs'))).toBe(true);
  });

  it('show only under a job at work, and never under one that stopped', async () => {
    // A failed turn left a sub-agent behind: it no longer counts, so no row shows it.
    const lone = s('lone', 'omni-os', 'failed', { title: 'Left a sub-agent behind' });
    app.channels = [channel('omni-os')];
    app.tasks = [agent('lone', 'Orphaned explore')];
    await render(createElement(ChannelThreadEntry, { t: lone, active: false, tasks: app.tasks as BackgroundTask[] }));
    expect(rows().some((r) => r.startsWith('Orphaned explore'))).toBe(false);

    // A finished job Ben opened by hand: its threads show, their leftover sub-agents do not.
    const job = s('job', 'conductor', 'done', { title: 'Finished job' });
    app.channels = conductor(job, [s('child', 'omni-os', 'stopped', { title: 'Stopped child' })]);
    app.tasks = [agent('child', 'Leftover task')];
    localStorage.setItem(`omni.${treePrefKey('sidebar', 'job')}`, JSON.stringify({ open: true, phase: 'finished' }));
    await render(createElement(ChannelThreadEntry, { key: 'job', t: job, active: false, tasks: [] }));
    expect(rows().some((r) => r.startsWith('Stopped child'))).toBe(true);
    expect(rows().some((r) => r.startsWith('Leftover task'))).toBe(false);
  });
});
