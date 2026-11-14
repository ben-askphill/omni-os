// One clock for every live elapsed time on screen (the Inbox rows' run timers): a single interval while anything
// shows one, none otherwise, however many rows tick. useTick re-renders only the component that reads it.
import { useSyncExternalStore } from 'react';

/** Often enough for a seconds count under a minute; past that the text changes once a minute anyway. */
export const TICK_MS = 1000;

export interface Clock {
  subscribe: (fn: () => void) => () => void;
  now: () => number;
  /** How many intervals run: 1 while anything listens, else 0. */
  timers: () => number;
}

// Wrapped, not passed bare: a browser's setInterval called as a method of another object throws Illegal invocation.
const browserTimers = {
  set: (fn: () => void, ms: number) => setInterval(fn, ms),
  clear: (t: ReturnType<typeof setInterval>) => clearInterval(t),
};

export function createClock(tickMs = TICK_MS, read = () => Date.now(), timers = browserTimers): Clock {
  const { set, clear } = timers;
  const listeners = new Set<() => void>();
  let now = read();
  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    subscribe(fn) {
      listeners.add(fn);
      if (!timer) {
        now = read();
        timer = set(() => {
          now = read();
          for (const l of listeners) l();
        }, tickMs);
      }
      return () => {
        listeners.delete(fn);
        if (!listeners.size && timer) {
          clear(timer);
          timer = null;
        }
      };
    },
    now: () => now,
    timers: () => (timer ? 1 : 0),
  };
}

const clock = createClock();

/** The shared clock's time, re-rendering the caller once a tick. */
export const useTick = () => useSyncExternalStore(clock.subscribe, clock.now);
