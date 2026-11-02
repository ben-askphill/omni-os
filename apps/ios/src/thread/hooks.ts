import type { HarnessInfo, OmniApi } from '@omni/client-core';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import type { LiveHub } from '../live/hub';
import { useLiveHub } from '../live/react';
import { runThreadAction, type ActionOutcome, type ThreadAction, type ThreadActionApi } from './actions';
import { IDLE, switchReducer, switchThreadRun, type SwitchPick, type SwitchState } from './switch-state';
import { targetOfThread, type ThreadTarget } from './target';
import type { RunThread } from './run-model';

/** The calls the menu and the switch make, each sent through the hub so a 401 refreshes the session and tries once more. */
function hubApi(hub: LiveHub): ThreadActionApi & Pick<OmniApi, 'switchRun'> {
  return {
    setPinned: (id, pinned) => hub.request((api) => api.setPinned(id, pinned)),
    setDone: (id, done) => hub.request((api) => api.setDone(id, done)),
    rename: (id, title) => hub.request((api) => api.rename(id, title)),
    setArchived: (id, archived) => hub.request((api) => api.setArchived(id, archived)),
    moveToFolder: (id, folderId) => hub.request((api) => api.moveToFolder(id, folderId)),
    switchRun: (id, run) => hub.request((api) => api.switchRun(id, run)),
  };
}

/**
 * Runs an Organize action on a thread. A change goes into the open thread's view and refetches the lists, so the rows
 * the user left behind show it too. Resolves with what happened, for the caller to show.
 */
export function useThreadActions() {
  const hub = useLiveHub();
  return useCallback(
    async (target: ThreadTarget, action: ThreadAction): Promise<ActionOutcome> => {
      const outcome = await runThreadAction(hubApi(hub), target, action, targetOfThread);
      if (outcome.kind === 'changed') hub.applyThread(outcome.thread);
      return outcome;
    },
    [hub],
  );
}

export interface HarnessCatalog {
  harnesses: HarnessInfo[] | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** `/harnesses` as the channel sees it: Cursor Cloud needs the channel's GitHub repo. Loads when asked and keeps the last answer. */
export function useHarnessCatalog(channelId: string | undefined, enabled: boolean): HarnessCatalog {
  const hub = useLiveHub();
  const [state, setState] = useState<{ harnesses: HarnessInfo[] | null; error: string | null; loading: boolean }>({
    harnesses: null,
    error: null,
    loading: false,
  });
  const [round, reload] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!enabled || !channelId) return;
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    hub
      .request((api) => api.harnesses(channelId))
      .then((harnesses) => live && setState({ harnesses, error: null, loading: false }))
      .catch((e: unknown) => live && setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : 'Something went wrong' })));
    return () => {
      live = false;
    };
  }, [hub, channelId, enabled, round]);

  return { ...state, reload };
}

/**
 * Switches a thread's run from the sheet. Between turns the switch applies at once; during a turn the server queues it,
 * and the thread comes back with the queued run, which the Next turn chip shows.
 */
export function useRunSwitch(threadId: string, thread: RunThread | null, harnesses: HarnessInfo[] | null) {
  const hub = useLiveHub();
  const [state, dispatch] = useReducer(switchReducer, IDLE as SwitchState);
  const busy = useRef(false);

  const pick = useCallback(
    async (choice: SwitchPick) => {
      if (!thread || !harnesses || busy.current) return;
      busy.current = true;
      dispatch({ type: 'start' });
      const outcome = await switchThreadRun(hubApi(hub), threadId, thread, harnesses, choice);
      busy.current = false;
      if (outcome.kind === 'switched') {
        hub.applyThread(outcome.thread);
        dispatch({ type: 'done' });
      } else if (outcome.kind === 'failed') dispatch({ type: 'fail', error: outcome.error });
      else dispatch({ type: 'done' });
    },
    [hub, threadId, thread, harnesses],
  );

  const dismiss = useCallback(() => dispatch({ type: 'dismiss' }), []);
  return { state, pick, dismiss };
}
