import type { HarnessInfo, OmniApi } from '@omni/client-core';
import { continueReducer, defaultRun, initContinue, type ContinueSource } from '@omni/shared/continue-flow.ts';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { useLiveHub } from '../live/react';
import { closeSourceTerminal, loadPreview, loadSource, startContinue, type ContinueApi, type SourceState } from './flow';

/** Each call goes through the hub, so a 401 refreshes the session (and forgets a revoked server) and is tried once more. */
function hubContinueApi(hub: ReturnType<typeof useLiveHub>): ContinueApi {
  const call = <T,>(run: (api: OmniApi) => Promise<T>) => hub.request(run);
  return {
    thread: (id) => call((api) => api.thread(id)),
    continuePreview: (id, body) => call((api) => api.continuePreview(id, body)),
    continueThread: (id, body) => call((api) => api.continueThread(id, body)),
    closeTerminal: (id) => call((api) => api.closeTerminal(id)),
  };
}

/** The thread to continue, read once when the screen opens. */
export function useContinueSource(threadId: string): { state: SourceState; reload: () => void } {
  const hub = useLiveHub();
  const [state, setState] = useState<SourceState>({ status: 'loading' });
  const [round, reload] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    void loadSource(hubContinueApi(hub), threadId).then((next) => alive && setState(next));
    return () => {
      alive = false;
    };
  }, [hub, threadId, round]);
  return { state, reload };
}

/**
 * One Continue screen's state: the picked run's preview, asked again whenever the run or the attachments change or the
 * user checks again (a later ask makes an earlier one's answer stale), Start, and closing the source's terminal. The
 * calls are in `./flow`. Mount it once the harness catalog is in: the first run is chosen from `offered`.
 */
export function useContinue(source: ContinueSource, offered: HarnessInfo[]) {
  const hub = useLiveHub();
  const api = useMemo(() => hubContinueApi(hub), [hub]);
  const [s, dispatch] = useReducer(continueReducer, offered, (o) => initContinue(defaultRun(o, source.harness)));
  const { run, picked, asked } = s;

  useEffect(() => {
    if (!run) return;
    let alive = true;
    void loadPreview(api, source.id, run, picked, dispatch, () => alive);
    return () => {
      alive = false;
    };
  }, [api, source.id, run, picked, asked]);

  const out = useRef(false);
  const start = useCallback(async () => {
    if (out.current) return null;
    out.current = true;
    try {
      return await startContinue(api, source.id, s, dispatch);
    } finally {
      out.current = false;
    }
  }, [api, source.id, s]);

  const [closing, setClosing] = useState(false);
  const closeTerminal = useCallback(async () => {
    setClosing(true);
    await closeSourceTerminal(api, source.id, dispatch);
    setClosing(false);
  }, [api, source.id]);

  const recheck = useCallback(() => dispatch({ type: 'recheck' }), []);
  return { s, dispatch, start, recheck, closeTerminal, closing };
}
