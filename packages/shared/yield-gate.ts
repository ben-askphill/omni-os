// Lets the reads a client sends by itself (the channel list, Needs you, the status, Activity, Library, tasks) give way
// to the thread Ben is opening. On a phone the link to the server is narrow and a few connections wide (iOS gives a
// host four, the feed keeps one), and the channel list alone can be close to a megabyte, so a thread's first page used
// to queue behind the refetches that coming back to the app or any thread change starts. While a thread's first page
// loads, a background read waits; one already running is cut off and run again once the page is in.

/** A hold ends by itself after this long, so a thread load that never answers cannot keep the lists from loading. */
export const HOLD_MAX_MS = 5_000;

export interface YieldGate {
  /**
   * Runs a background read. While a hold is on it waits. One running when a hold begins has its signal aborted and runs
   * again after, so the caller gets the second answer. Only a read that is safe to send twice belongs here. The caller's
   * own `signal` cancels it for good.
   */
  run<T>(read: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T>;
  /** A thread's first page is on its way. Call the returned function when it has landed or failed. */
  hold(): () => void;
}

export function createYieldGate(): YieldGate {
  let holds = 0;
  let opened = Promise.resolve();
  let open = () => {};
  const running = new Set<AbortController>();

  return {
    hold() {
      if (holds++ === 0) {
        ({ promise: opened, resolve: open } = Promise.withResolvers<void>());
        for (const read of running) read.abort();
      }
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        clearTimeout(timer);
        if (--holds === 0) open();
      };
      const timer = setTimeout(release, HOLD_MAX_MS);
      return release;
    },

    async run(read, signal) {
      for (;;) {
        while (holds > 0) await opened;
        const own = new AbortController();
        const cancel = () => own.abort();
        if (signal?.aborted) own.abort();
        else signal?.addEventListener('abort', cancel);
        running.add(own);
        try {
          return await read(own.signal);
        } catch (e) {
          // Cut off for a thread, not by the caller: wait for it, then read again.
          if (own.signal.aborted && !signal?.aborted) continue;
          throw e;
        } finally {
          running.delete(own);
          signal?.removeEventListener('abort', cancel);
        }
      }
    },
  };
}
