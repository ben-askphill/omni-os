import type { OmniApi } from '@omni/client-core';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { useLiveHub } from '../live/react';
import { describeFailure, type Fetched } from './failure';

export interface Fetch<T> extends Fetched<T> {
  /** A request is out. `data` still holds the last answer, so the screen keeps what it shows while it refreshes. */
  loading: boolean;
  reload: () => void;
}

/**
 * One GET through the hub (a 401 refreshes the session and tries once more). `key` names what is asked for: a new key drops
 * the old answer, a reload keeps it. A null `load` asks for nothing.
 */
export function useFetched<T>(key: string, load: ((api: OmniApi) => Promise<T>) | null): Fetch<T> {
  const hub = useLiveHub();
  const [state, setState] = useState<{ key: string; data: T | null; failure: Fetched<T>['failure']; loading: boolean }>({ key, data: null, failure: null, loading: load !== null });
  const [round, reload] = useReducer((n: number) => n + 1, 0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const asks = load !== null;

  useEffect(() => {
    const call = loadRef.current;
    if (!asks || !call) return;
    let live = true;
    setState((s) => (s.key === key ? { ...s, loading: true } : { key, data: null, failure: null, loading: true }));
    hub.request(call).then(
      (data) => live && setState({ key, data, failure: null, loading: false }),
      (e: unknown) => live && setState((s) => ({ key, data: s.key === key ? s.data : null, failure: describeFailure(e), loading: false })),
    );
    return () => {
      live = false;
    };
  }, [hub, key, asks, round]);

  const fresh = state.key === key;
  return { data: fresh ? state.data : null, failure: fresh ? state.failure : null, loading: asks && (!fresh || state.loading), reload: useCallback(() => reload(), []) };
}

/** Calls `fn` when `value` changes after the first render. */
export function useOnChange<T>(value: T, fn: () => void): void {
  const last = useRef(value);
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    if (!Object.is(last.current, value)) latest.current();
    last.current = value;
  }, [value]);
}

export function useEvery(ms: number, on: boolean, fn: () => void): void {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => latest.current(), ms);
    return () => clearInterval(timer);
  }, [ms, on]);
}
