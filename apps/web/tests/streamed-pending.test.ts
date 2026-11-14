import { describe, expect, it } from 'vitest';
import { streamedPending } from '../src/streamed-pending.ts';

// The thread's pending list and opening arrive three ways: the stream's thread messages, which wait for the frame
// that lands the rows before them (useThreadHistory withRows), a reconnect's sync, and an action's answer, both
// applied at once. Whatever arrived last must be what the thread shows.

type P = { uuid: string };
const M = { uuid: 'm' };

/** A thread view with one frame: rows wait for it while the window is hidden, and the stream's copy waits with them. */
function view() {
  const shown: { pending: P[]; opening: string | null } = { pending: [], opening: null };
  const frame: (() => void)[] = [];
  let hidden = false;
  const s = streamedPending<P, string>((next) => {
    if (next.pending) shown.pending = next.pending;
    if (next.opening !== undefined) shown.opening = next.opening;
  });
  const withRows = (fn: () => void) => (hidden ? frame.push(fn) : fn());
  return {
    shown,
    hide: () => (hidden = true),
    show: () => {
      hidden = false;
      frame.splice(0).forEach((fn) => fn());
    },
    thread: (pending?: P[], opening?: string | null) => s.arrived({ pending, opening }, withRows),
    sync: (pending: P[], opening: string | null) => {
      s.replaced();
      shown.pending = pending;
      shown.opening = opening;
    },
    answer: (pending: P[]) => {
      s.replaced('pending');
      shown.pending = pending;
    },
  };
}

describe('the pending list a thread shows', () => {
  it('keeps the sync a reconnect brings over a stream copy from before the drop', () => {
    const v = view();
    // Ben steers, the window goes to the background: the stream's list naming the steer waits for a frame.
    v.hide();
    v.thread([M]);
    // The connection drops while the steer is read; the reconnect's sync says nothing is pending.
    v.sync([], null);
    expect(v.shown.pending).toEqual([]);
    // The window shows again and its frame lands: the steer must not come back as pending.
    v.show();
    expect(v.shown.pending).toEqual([]);
  });

  it('takes a stream copy that arrived after the sync, once its frame lands', () => {
    const v = view();
    v.hide();
    v.sync([], null);
    v.thread([M]);
    expect(v.shown.pending).toEqual([]);
    v.show();
    expect(v.shown.pending).toEqual([M]);
  });

  it('lands the newest of several stream copies, once', () => {
    const v = view();
    v.hide();
    v.thread([M], 'first');
    v.thread([]);
    v.show();
    expect(v.shown).toEqual({ pending: [], opening: 'first' });
  });

  it('keeps an action answer over an older stream copy, and the opening that copy brought', () => {
    const v = view();
    v.hide();
    v.thread([M], 'first');
    v.answer([]);
    v.show();
    expect(v.shown).toEqual({ pending: [], opening: 'first' });
  });

  it('applies a stream copy at once while no rows wait', () => {
    const v = view();
    v.thread([M], 'first');
    expect(v.shown).toEqual({ pending: [M], opening: 'first' });
    v.thread([], null);
    expect(v.shown).toEqual({ pending: [], opening: null });
  });
});
