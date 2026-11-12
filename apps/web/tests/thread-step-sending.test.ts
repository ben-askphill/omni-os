// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FIX_CONFLICTS_PROMPT, type PRStep } from '@omni/shared/thread-glance.ts';

// Fix conflicts turns to "Fixing conflicts…" at the click and must stay that way until the turn it started ends. It
// used to drop back to "Fix conflicts" when the POST returned, before the stream caught up, and again for the frame
// where the stream has dropped the pending row but not yet sent the recorded message: a flicker.

let reply: { resolve: (v: unknown) => void; reject: (e: unknown) => void };
const posts: { path: string; body: unknown }[] = [];
vi.mock('../src/api.ts', () => ({
  api: {
    post: (path: string, body: unknown) => {
      posts.push({ path, body });
      return new Promise((resolve, reject) => (reply = { resolve, reject }));
    },
  },
  errorText: (e: unknown) => String(e),
}));
vi.mock('../src/store.tsx', () => ({ useApp: () => ({ reloadChannels: () => {}, setDone: () => {} }) }));

const { useThreadActions } = await import('../src/pages/useThreadActions.ts');

let root: Root;
let host: HTMLElement;
let actions: ReturnType<typeof useThreadActions>;
const errors: (string | null)[] = [];
const queuedSets: unknown[] = [];
type Parked = { step: PRStep; uuid: string } | null;

function Probe({ underway, busy, parked }: { underway: PRStep | null; busy: boolean; parked: Parked }) {
  actions = useThreadActions({
    id: 't1',
    thread: null,
    slotBusy: busy,
    underway,
    parked,
    applyThread: () => {},
    setQueued: (p) => queuedSets.push(p),
    setActionError: (e) => errors.push(e),
    pin: () => {},
  });
  return null;
}
const render = (underway: PRStep | null, busy = false, parked: Parked = null) => act(() => root.render(createElement(Probe, { underway, busy, parked })));

beforeEach(() => {
  host = document.createElement('div');
  root = createRoot(host);
  errors.length = 0;
  posts.length = 0;
  queuedSets.length = 0;
});
afterEach(() => act(() => root.unmount()));

describe('useThreadActions sending', () => {
  it('holds the step from the click until the turn it started ends', async () => {
    await render(null);
    let done!: Promise<void>;
    await act(async () => void (done = actions.ask(FIX_CONFLICTS_PROMPT)));
    expect(actions.sending).toBe(FIX_CONFLICTS_PROMPT);
    await act(async () => {
      reply.resolve({});
      await done;
    });
    expect(actions.sending).toBe(FIX_CONFLICTS_PROMPT);
    // What the thread showed on a QA stack: running with the message, then a frame without it, then with it again.
    await render('conflicts', true);
    await render(null, true);
    expect(actions.sending).toBe(FIX_CONFLICTS_PROMPT);
    await render('conflicts', true);
    await render(null, false);
    expect(actions.sending).toBeNull();
  });

  it('lets go when the send fails', async () => {
    await render(null);
    let done!: Promise<void>;
    await act(async () => void (done = actions.ask(FIX_CONFLICTS_PROMPT)));
    await act(async () => {
      reply.reject(new Error('offline'));
      await done;
    });
    expect(actions.sending).toBeNull();
    expect(errors.at(-1)).toContain('offline');
  });

  it('lets go after 15 s when the thread never shows it, and not while the turn it showed runs', async () => {
    vi.useFakeTimers();
    try {
      await render(null);
      let done!: Promise<void>;
      await act(async () => void (done = actions.ask(FIX_CONFLICTS_PROMPT)));
      await act(async () => {
        reply.resolve({});
        await done;
      });
      await act(async () => void vi.advanceTimersByTime(15_000));
      expect(actions.sending).toBeNull();

      await act(async () => void (done = actions.ask(FIX_CONFLICTS_PROMPT)));
      await act(async () => {
        reply.resolve({});
        await done;
      });
      await render('conflicts', true);
      await act(async () => void vi.advanceTimersByTime(15_000));
      expect(actions.sending).toBe(FIX_CONFLICTS_PROMPT);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resumes the parked copy of the same step instead of sending it again', async () => {
    await render(null, false, { step: 'conflicts', uuid: 'r1' });
    let done!: Promise<void>;
    await act(async () => void (done = actions.ask(FIX_CONFLICTS_PROMPT)));
    expect(posts.at(-1)).toEqual({ path: '/threads/t1/requests/resume', body: { ids: ['r1'] } });
    await act(async () => {
      reply.resolve({ thread: {}, pending: [{ uuid: 'r1', state: 'sent' }] });
      await done;
    });
    expect(queuedSets.at(-1)).toEqual([{ uuid: 'r1', state: 'sent' }]);
    expect(actions.sending).toBe(FIX_CONFLICTS_PROMPT);
  });

  it('sends a new message when a different step is parked', async () => {
    await render(null, false, { step: 'checks', uuid: 'r1' });
    await act(async () => void actions.ask(FIX_CONFLICTS_PROMPT));
    expect(posts.at(-1)?.path).toBe('/threads/t1/messages');
  });
});
