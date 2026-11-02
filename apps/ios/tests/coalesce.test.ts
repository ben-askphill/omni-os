import { describe, expect, it } from 'vitest';

import { coalesced } from '../src/live/coalesce';

const gate = () => {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
};

describe('coalesced', () => {
  it('runs a lone call once', async () => {
    let runs = 0;
    const load = coalesced(async () => void runs++);
    await load();
    expect(runs).toBe(1);
  });

  it('turns a burst during a run into one more pass', async () => {
    let runs = 0;
    const gates = [gate(), gate()];
    const load = coalesced(async () => {
      await gates[runs++]?.promise;
    });
    const first = load();
    load();
    load();
    load();
    expect(runs).toBe(1);
    gates[0]?.open();
    await Promise.resolve();
    await Promise.resolve();
    gates[1]?.open();
    await first;
    expect(runs).toBe(2);
  });

  it.each(Array.from({ length: 9 }, (_, tick) => tick))('never drops a call made %i ticks after the first', async (tick) => {
    let started = 0;
    const load = coalesced(async () => void started++);
    const first = load();
    for (let i = 0; i < tick; i++) await Promise.resolve();
    const startedAtCall = started;
    await load();
    await first;
    expect(started).toBeGreaterThan(startedAtCall);
  });

  it('starts fresh after it settles', async () => {
    let runs = 0;
    const load = coalesced(async () => void runs++);
    await load();
    await load();
    expect(runs).toBe(2);
  });
});
