import type { OmniApi } from '@omni/client-core';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useLiveHub } from './react';

export interface Remote<T> {
  data: T | null;
  /** Why the last load failed. The previous data stays in `data`. */
  error: string | null;
  loading: boolean;
  reload(): Promise<void>;
  setData(next: T): void;
}

/**
 * Loads one thing from the active server when the screen opens, and again on `reload`. For lists the live feed does not
 * carry, such as devices and automations. `load` must be stable (wrap it in useCallback) or the screen loads in a loop.
 */
export function useRemote<T>(load: (api: OmniApi) => Promise<T>): Remote<T> {
  const hub = useLiveHub();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const run = ++latest.current;
    setLoading(true);
    try {
      const next = await hub.request(load);
      if (alive.current && run === latest.current) {
        setData(next);
        setError(null);
      }
    } catch (e) {
      if (alive.current && run === latest.current) setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      if (alive.current && run === latest.current) setLoading(false);
    }
  }, [hub, load]);

  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);

  return { data, error, loading, reload, setData };
}
