// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Thread } from '../src/api.ts';

// The rail's Inbox rows (the desktop default): a Conductor job on the Finished shelf whose three delegated threads all
// finished showed one line, and its hover card said "3 delegated" with no way to open them. The row now carries the
// same tally and chevron the Inbox card and the phone row have.

const at = (m: number) => `2026-11-26T20:${String(m).padStart(2, '0')}:00.000Z`;
const thread = (id: string, over: Partial<Thread> = {}) =>
  ({ id, channel_id: 'conductor', title: id, status: 'done', created_at: at(1), updated_at: at(30), ...over }) as Thread;
const job = thread('job', { title: 'Three-agent test thread with delegated tasks', delegating: false });
const plain = thread('plain', { title: 'Plain thread' });
const children = [
  thread('note', { channel_id: 'general', title: 'Write the release note', created_at: at(2), updated_at: at(10) }),
  thread('facts', { channel_id: 'general', title: 'Collect tulip facts', created_at: at(3), updated_at: at(11) }),
  thread('card', { channel_id: 'general', title: 'Critique the status card', created_at: at(4), updated_at: at(12) }),
];

const prefs = new Map<string, unknown>();
const app = {
  channels: [
    { id: 'conductor', name: 'Conductor', handoffs: [{ parent: job, children }], teams: [] },
    { id: 'general', name: 'General', handoffs: [], teams: [] },
  ],
  pinned: [] as Thread[],
  needsYou: { items: [], unread: 0, blocked: 0 },
  openThread: null,
  tasks: [],
  setPinned: async () => job,
  setDone: async () => {},
};
vi.mock('../src/store.tsx', async (orig) => ({
  ...(await orig<typeof import('../src/store.tsx')>()),
  useApp: () => app,
  useNeedOf: () => undefined,
  useUserName: () => undefined,
  readPref: <T,>(k: string, d: T) => (prefs.has(k) ? (prefs.get(k) as T) : d),
  writePref: (k: string, v: unknown) => void prefs.set(k, v),
  dropPref: (k: string) => void prefs.delete(k),
}));
vi.mock('../src/components/ThreadList.tsx', () => ({ useLiveThreads: () => ({ data: [job, plain, ...children], loading: false, error: null, reload: () => {} }) }));
vi.mock('../src/router.ts', async (orig) => ({ ...(await orig<typeof import('../src/router.ts')>()), useRoute: () => ({ name: 'inbox' }) }));

const { InboxView } = await import('../src/components/sidebar/InboxView.tsx');

let root: Root;
let host: HTMLElement;
const render = (collapsed = false) => act(() => root.render(createElement(InboxView, { variant: 'row', links: false, collapsed })));
const row = (id: string) => host.querySelector<HTMLElement>(`[data-inbox-thread="${id}"]`)!;
const treeTitles = (id: string) => [...row(id).querySelectorAll('[data-thread-tree] .tree-node a')].map((a) => a.textContent);

beforeEach(() => {
  prefs.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("a finished job's row in the rail's Inbox", () => {
  it('starts closed, with a toggle that names what sits under it', () => {
    render();
    const toggle = row('job').querySelector<HTMLButtonElement>('button[data-tree-toggle]')!;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('Open the threads under Three-agent test thread with delegated tasks: 3 done');
    expect(treeTitles('job')).toEqual([]);
  });

  it('opens to every delegated thread, newest first, and closes again', () => {
    render();
    const toggle = () => row('job').querySelector<HTMLButtonElement>('button[data-tree-toggle]')!;
    act(() => toggle().click());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(treeTitles('job')).toEqual(['Critique the status card', 'Collect tulip facts', 'Write the release note']);
    expect([...row('job').querySelectorAll('[data-tree-state]')].map((n) => n.getAttribute('data-tree-state'))).toEqual(['done', 'done', 'done']);
    act(() => toggle().click());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(treeTitles('job')).toEqual([]);
  });

  it('gives a thread with nothing delegated no toggle, and the Collapsed list none at all', () => {
    render();
    expect(row('plain').querySelector('[data-tree-toggle]')).toBeNull();
    // The delegated threads are counted on the job's row, not listed on their own.
    expect(row('note')).toBeNull();
    render(true);
    expect(row('job').querySelector('[data-tree-toggle]')).toBeNull();
  });
});
