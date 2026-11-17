import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createYieldGate, HOLD_MAX_MS } from '../yield-gate.ts';

/** A read the test answers by hand, recording each start and whether its signal was aborted. */
function reads() {
  const started: { name: string; signal: AbortSignal; answer(value: string): void }[] = [];
  const read = (name: string) => (signal: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      started.push({ name, signal, answer: resolve });
      signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
    });
  return { started, read };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('yield gate', () => {
  it('runs a background read at once while no thread is loading', async () => {
    const gate = createYieldGate();
    const { started, read } = reads();
    const answer = gate.run(read('channels'));
    await vi.advanceTimersByTimeAsync(0);
    expect(started.map((s) => s.name)).toEqual(['channels']);
    started[0]?.answer('list');
    expect(await answer).toBe('list');
  });

  it('holds a background read while a thread loads and runs it once the load ends', async () => {
    const gate = createYieldGate();
    const { started, read } = reads();
    const release = gate.hold();
    const answer = gate.run(read('channels'));
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual([]);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(started.map((s) => s.name)).toEqual(['channels']);
    started[0]?.answer('list');
    expect(await answer).toBe('list');
  });

  it('cuts off a read already running when a thread starts loading, and runs it again after', async () => {
    const gate = createYieldGate();
    const { started, read } = reads();
    const answer = gate.run(read('channels'));
    await vi.advanceTimersByTimeAsync(0);
    const release = gate.hold();
    await vi.advanceTimersByTimeAsync(0);
    expect(started.map((s) => [s.name, s.signal.aborted])).toEqual([['channels', true]]);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(started.map((s) => [s.name, s.signal.aborted])).toEqual([
      ['channels', true],
      ['channels', false],
    ]);
    started[1]?.answer('second');
    expect(await answer).toBe('second');
  });

  it('waits for every thread that is loading, and a second release of one hold counts once', async () => {
    const gate = createYieldGate();
    const { started, read } = reads();
    const first = gate.hold();
    const second = gate.hold();
    void gate.run(read('needs-you'));
    first();
    first();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual([]);
    second();
    await vi.advanceTimersByTimeAsync(0);
    expect(started.map((s) => s.name)).toEqual(['needs-you']);
  });

  it('gives up a hold on its own after HOLD_MAX_MS, so a load that never answers cannot stall the lists', async () => {
    const gate = createYieldGate();
    const { started, read } = reads();
    gate.hold();
    void gate.run(read('channels'));
    await vi.advanceTimersByTimeAsync(HOLD_MAX_MS - 1);
    expect(started).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(started.map((s) => s.name)).toEqual(['channels']);
  });

  it('rejects when the caller cancels, and does not run again', async () => {
    const gate = createYieldGate();
    const { started, read } = reads();
    const caller = new AbortController();
    const answer = gate.run(read('channels'), caller.signal);
    await vi.advanceTimersByTimeAsync(0);
    caller.abort();
    await expect(answer).rejects.toMatchObject({ name: 'AbortError' });
    gate.hold()();
    await vi.advanceTimersByTimeAsync(0);
    expect(started.length).toBe(1);
  });

  it('passes on a failure that is not a cut-off', async () => {
    const gate = createYieldGate();
    const answer = gate.run(async () => {
      throw new Error('offline');
    });
    await expect(answer).rejects.toThrow('offline');
  });
});
