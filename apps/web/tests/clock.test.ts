import { describe, expect, it, vi } from 'vitest';
import { createClock } from '../src/clock.ts';

// One interval for every ticking run time on screen, however many rows show one (apps/web/src/clock.ts).

describe('createClock', () => {
  it('runs one interval while anything listens, and none once nothing does', () => {
    const set = vi.fn((fn: () => void, ms: number) => setInterval(fn, ms));
    const clear = vi.fn((t: ReturnType<typeof setInterval>) => clearInterval(t));
    const clock = createClock(1000, Date.now, { set, clear });
    expect(clock.timers()).toBe(0);
    const offs = Array.from({ length: 25 }, () => clock.subscribe(() => {}));
    expect(clock.timers()).toBe(1);
    expect(set).toHaveBeenCalledTimes(1);
    for (const off of offs) off();
    expect(clock.timers()).toBe(0);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('calls the timer functions unbound, as a browser needs', () => {
    // A browser's setInterval throws Illegal invocation when called with another object as `this`.
    const self = globalThis;
    const set = vi.fn(function (this: unknown, fn: () => void, ms: number) {
      if (this !== undefined && this !== self) throw new TypeError('Illegal invocation');
      return setInterval(fn, ms);
    });
    const clock = createClock(1000, Date.now, { set, clear: (t) => clearInterval(t) });
    clock.subscribe(() => {})();
    expect(set).toHaveBeenCalledTimes(1);
  });

  it('tells every listener the new time on each tick', () => {
    vi.useFakeTimers();
    try {
      let t = 1000;
      const clock = createClock(1000, () => t);
      const seen: number[] = [];
      const off1 = clock.subscribe(() => seen.push(clock.now()));
      const off2 = clock.subscribe(() => seen.push(clock.now()));
      t = 2000;
      vi.advanceTimersByTime(1000);
      expect(seen).toEqual([2000, 2000]);
      off1();
      off2();
    } finally {
      vi.useRealTimers();
    }
  });
});
