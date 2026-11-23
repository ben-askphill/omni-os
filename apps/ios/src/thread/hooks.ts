import type { CommandList, CommandsFor, HarnessInfo, OmniApi } from '@omni/client-core';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Alert } from 'react-native';

import type { LiveHub } from '../live/hub';
import { useLiveHub } from '../live/react';
import { doneQuestion, type DoneQuestion } from '../live/thread-tree';
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

/** Asks the Done question as an alert: Cancel, or Mark as done. */
function confirmDone(q: DoneQuestion): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(q.title, q.message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Mark as done', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) }),
  );
}

/**
 * Runs an Organize action on a thread. A change goes into the open thread's view and refetches the lists, so the rows
 * the user left behind show it too. Resolves with what happened, for the caller to show.
 *
 * Marking a job done while a thread under it still runs, failed or waits on Ben asks first, as on the web
 * (apps/web/src/done-confirm.tsx): done takes the job out of Activity with that work unfinished. The lists are read
 * when Ben asks, so the question never goes by a stale tree.
 */
export function useThreadActions() {
  const hub = useLiveHub();
  return useCallback(
    async (target: ThreadTarget, action: ThreadAction): Promise<ActionOutcome> => {
      if (action.kind === 'done' && !target.done) {
        const question = doneQuestion(target, hub.channels.get().channels, hub.needsYou.get().data);
        if (question && !(await confirmDone(question))) return { kind: 'cancelled' };
      }
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

/**
 * The command list for a composer's `/` menu (GET /commands), kept as phone web's use-commands.ts keeps it: `load` sets
 * the cached list at once, then the fresh one when a refresh was running. The server probes at most every 30 seconds, so
 * calling it often is cheap. Null until a load for `of` answers.
 */
export function useCommands(of: CommandsFor): { list: CommandList | null; load: () => void } {
  const hub = useLiveHub();
  const key = 'thread' in of ? `thread:${of.thread}` : `new:${of.harness}:${of.channel}`;
  // The list with the menu it answers, so another thread's never shows.
  const [got, setGot] = useState<{ key: string; list: CommandList } | null>(null);
  const current = useRef(key);
  const target = useRef(of);
  useEffect(() => {
    current.current = key;
    target.current = of;
  });
  const load = useCallback(() => {
    const ask = target.current;
    const mine = (prev: typeof got) => (prev?.key === key ? prev.list : null);
    // Never swap a list for an older one when two loads overlap.
    const take = (next: CommandList) =>
      current.current === key &&
      setGot((prev) => {
        const had = mine(prev);
        return had?.fetchedAt && (next.fetchedAt ?? 0) < had.fetchedAt ? prev : { key, list: next };
      });
    void (async () => {
      try {
        take(await hub.request((api) => api.commands(ask)));
        take(await hub.request((api) => api.commands(ask, true)));
      } catch {
        if (current.current === key) setGot((prev) => (mine(prev) ? prev : { key, list: { status: 'unavailable', commands: [], fetchedAt: null } }));
      }
    })();
  }, [hub, key]);
  return { list: got?.key === key ? got.list : null, load };
}
