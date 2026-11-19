// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A thread's first page renders as a transition (useThreadSession), so a tap made while it renders goes first. The
// lists the app reloads by itself (api.ts listGate) wait until that page has committed: their answers landing mid
// render would start it over.

const detail = {
  thread: { id: 't1', channel_id: 'inbox', title: 'T', status: 'done', updated_at: '2026-11-19T10:00:00.000Z' },
  events: [{ id: 1, thread_id: 't1', kind: 'user', payload: JSON.stringify({ text: 'hi' }), created_at: '2026-11-19T10:00:00.000Z' }],
  artifacts: [],
  children: [],
  parent: null,
};
let answer: (v: unknown) => void = () => {};
const releases: { done: boolean }[] = [];
vi.mock('../src/api.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/api.ts')>();
  actual.api.get = vi.fn((path: string) => (path.startsWith('/threads/t1?') ? new Promise((r) => (answer = r)) : new Promise(() => {}))) as typeof actual.api.get;
  const hold = actual.listGate.hold.bind(actual.listGate);
  actual.listGate.hold = () => {
    const r = { done: false };
    releases.push(r);
    const release = hold();
    return () => {
      r.done = true;
      release();
    };
  };
  return { ...actual, useThreadStream: () => true };
});
vi.mock('../src/store.tsx', async (original) => ({ ...(await original<object>()), useFeed: () => {} }));
vi.mock('../src/components/Toaster.tsx', () => ({ useToast: () => () => {} }));

const { useThreadSession } = await import('../src/pages/useThreadSession.ts');

/** Whether the gate was still shut in the commit that first showed the page. */
let shutAtCommit: boolean | null = null;
function Probe() {
  const s = useThreadSession('t1', undefined);
  useLayoutEffect(() => {
    if (s.ready && shutAtCommit === null) shutAtCommit = releases.some((r) => !r.done);
  });
  return null;
}

let root: Root;
beforeEach(() => {
  releases.length = 0;
  shutAtCommit = null;
  root = createRoot(document.createElement('div'));
});
afterEach(() => act(() => root.unmount()));

describe('a thread opening holds the list reloads', () => {
  it('until its first page has committed, then lets them go', async () => {
    await act(async () => root.render(createElement(Probe)));
    expect(releases.map((r) => r.done)).toEqual([false]);
    await act(async () => answer(detail));
    expect(shutAtCommit).toBe(true);
    expect(releases.map((r) => r.done)).toEqual([true]);
  });

  it('lets them go when the thread closes before its page lands', async () => {
    await act(async () => root.render(createElement(Probe)));
    act(() => root.unmount());
    await act(async () => answer(detail));
    expect(releases.every((r) => r.done)).toBe(true);
    root = createRoot(document.createElement('div'));
  });
});
