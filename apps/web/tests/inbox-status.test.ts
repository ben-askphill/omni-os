// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { BackgroundTask, NeedsYouItem, Thread } from '../src/api.ts';

// The Inbox a stopped thread sits in, on the desktop sidebar and the phone's Activity tab alike (both read useInbox),
// against what Home says about it. Ben stopped a turn whose process kept a background shell running: Home said
// Stopped, the Inbox card said Running.

const thread = (id: string, over: Partial<Thread> = {}) =>
  ({ id, channel_id: 'omni-os', title: id, status: 'done', created_at: '2026-11-12T08:00:00.000Z', updated_at: '2026-11-12T08:20:00.000Z', ...over }) as Thread;
const stopped = thread('stopped', { status: 'stopped' });
const running = thread('running', { status: 'running' });
const item: NeedsYouItem = { thread: stopped, result: { uid: 'r1', status: 'stopped', event_uid: null, at: '2026-11-12T08:27:00.000Z' }, blockers: [], at: '2026-11-12T08:27:00.000Z' };
// The turn is over, the process is not: a background shell it started still runs.
const shell: BackgroundTask = { thread_id: 'stopped', channel_id: 'omni-os', task_id: 'bg1', description: 'npm run dev', subagent: false, background: true, started_at: '2026-11-12T08:10:00.000Z' };

const app = { channels: [], pinned: [], needsYou: { items: [item], unread: 1, blocked: 0 }, openThread: null, tasks: [shell] };
vi.mock('../src/store.tsx', () => ({ useApp: () => app, readPref: <T,>(_k: string, d: T) => d, writePref: () => {} }));
vi.mock('../src/components/ThreadList.tsx', () => ({ useLiveThreads: () => ({ data: [stopped, running], loading: false, error: null, reload: () => {} }) }));
vi.mock('../src/router.ts', () => ({ useRoute: () => ({ name: 'home' }) }));

const { useInbox } = await import('../src/app/useInbox.ts');
const { reasonOf } = await import('../src/needs-you.ts');

let root: Root;
let host: HTMLElement;
let seen: ReturnType<typeof useInbox> | null = null;
function Probe() {
  seen = useInbox();
  return null;
}

beforeEach(() => {
  host = document.createElement('div');
  root = createRoot(host);
  act(() => root.render(createElement(Probe)));
});
afterEach(() => {
  act(() => root.unmount());
  seen = null;
});

describe('Inbox status of a stopped thread', () => {
  it('says Stopped, as Home does, while a background task its turn started still runs', () => {
    const inbox = seen!;
    const card = inbox.inbox.find((t) => t.id === 'stopped')!;
    expect(card).toBeDefined();
    expect(inbox.status(card)).toEqual({ glyph: 'settled', label: 'Stopped' });
    // Home's Needs you card for the same thread.
    expect(reasonOf(item)).toMatchObject({ glyph: 'settled', label: 'Stopped' });
  });

  it('keeps a thread whose turn runs on the Working shelf, reading Running', () => {
    const inbox = seen!;
    expect(inbox.working.count).toBe(1);
    expect(inbox.status(running)).toEqual({ glyph: 'running', label: 'Running' });
  });
});
