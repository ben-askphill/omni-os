// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FIX_CONFLICTS_PROMPT, type PRStep } from '@omni/shared/thread-glance.ts';

// Fix conflicts turns to "Fixing conflicts…" at the click and must stay that way until the thread's stream shows the
// message. It used to drop back to "Fix conflicts" when the POST returned, before the stream caught up: a flicker.

let reply: { resolve: (v: unknown) => void; reject: (e: unknown) => void };
vi.mock('../src/api.ts', () => ({
  api: { post: () => new Promise((resolve, reject) => (reply = { resolve, reject })) },
  errorText: (e: unknown) => String(e),
}));
vi.mock('../src/store.tsx', () => ({ useApp: () => ({ reloadChannels: () => {}, setDone: () => {} }) }));

const { useThreadActions } = await import('../src/pages/useThreadActions.ts');

let root: Root;
let host: HTMLElement;
let actions: ReturnType<typeof useThreadActions>;
const errors: (string | null)[] = [];

function Probe({ underway }: { underway: PRStep | null }) {
  actions = useThreadActions({ id: 't1', thread: null, slotBusy: false, underway, applyThread: () => {}, setActionError: (e) => errors.push(e), pin: () => {} });
  return null;
}
const render = (underway: PRStep | null) => act(() => root.render(createElement(Probe, { underway })));

beforeEach(() => {
  host = document.createElement('div');
  root = createRoot(host);
  errors.length = 0;
});
afterEach(() => act(() => root.unmount()));

describe('useThreadActions sending', () => {
  it('holds the step from the click until the thread shows it underway', async () => {
    await render(null);
    let done!: Promise<void>;
    await act(async () => void (done = actions.ask(FIX_CONFLICTS_PROMPT)));
    expect(actions.sending).toBe(FIX_CONFLICTS_PROMPT);
    await act(async () => {
      reply.resolve({});
      await done;
    });
    expect(actions.sending).toBe(FIX_CONFLICTS_PROMPT);
    await render('conflicts');
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

  it('lets go after 15 s when the stream never shows it', async () => {
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
    } finally {
      vi.useRealTimers();
    }
  });
});
