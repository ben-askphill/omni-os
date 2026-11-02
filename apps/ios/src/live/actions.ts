import { anyRunning, withRun, type ActionRun, type ChannelAction, type ThreadActions } from '@omni/shared/channel-actions.ts';
import type { OmniApi } from '@omni/client-core';

import { createStore, type Store } from './store';

export const POLL_MS = 1000;

export interface ActionsView {
  /** Null before the first load. */
  data: ThreadActions | null;
  loading: boolean;
  /** The last failed load. The runs it held stay on screen. */
  error: string | null;
  /** Keyed by the action id for Run, and the run id for Stop and Retry, so each shows on its own row. */
  busy: ReadonlySet<string>;
  errors: Readonly<Record<string, string>>;
}

/** One open Actions screen: a thread's actions and runs, kept fresh while a run goes. Created by `LiveHub.openActions`. */
export interface ActionsLive {
  readonly view: Store<ActionsView>;
  reload(): Promise<void>;
  run(action: ChannelAction): Promise<ActionRun | undefined>;
  stop(run: ActionRun): Promise<ActionRun | undefined>;
  retry(run: ActionRun): Promise<ActionRun | undefined>;
  pause(): void;
  resume(): void;
  close(): void;
}

export interface ActionsLiveOptions {
  api: Pick<OmniApi, 'threadActions' | 'runAction' | 'stopActionRun' | 'retryActionRun'> | null;
  withAuth: <T>(run: () => Promise<T>) => Promise<T>;
  threadId: string;
}

/**
 * Runs have no feed events, so this polls while one runs, one request at a time, and loads once otherwise. The answer
 * to Run, Stop or Retry is merged into the list at once, so the row changes before the next poll.
 */
export function createActionsLive({ api, withAuth, threadId }: ActionsLiveOptions): ActionsLive {
  const view = createStore<ActionsView>({ data: null, loading: false, error: null, busy: new Set(), errors: {} });
  let closed = false;
  let paused = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let loading: Promise<void> | null = null;
  let answered = 0;

  const messageOf = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong');

  function schedule() {
    if (timer !== null || closed || paused || loading || !anyRunning(view.get().data ?? undefined)) return;
    timer = setTimeout(() => {
      timer = null;
      void reload();
    }, POLL_MS);
  }

  function reload(): Promise<void> {
    if (!api || closed) return Promise.resolve();
    if (loading) return loading;
    view.set((v) => ({ ...v, loading: true }));
    const startedAt = answered;
    let stale = false;
    loading = (async () => {
      try {
        const data = await withAuth(() => api.threadActions(threadId));
        stale = startedAt !== answered;
        if (!closed && !stale) view.set((v) => ({ ...v, data, error: null, loading: false }));
      } catch (e) {
        if (!closed) view.set((v) => ({ ...v, error: messageOf(e), loading: false }));
      }
    })().finally(() => {
      loading = null;
      if (stale && !closed) void reload();
      else schedule();
    });
    return loading;
  }

  async function send(key: string, call: () => Promise<ActionRun>): Promise<ActionRun | undefined> {
    if (!api || closed) return undefined;
    view.set((v) => ({ ...v, busy: new Set(v.busy).add(key), errors: omit(v.errors, key) }));
    try {
      const run = await withAuth(call);
      if (closed) return run;
      answered++;
      view.set((v) => ({ ...v, data: v.data ? withRun(v.data, run) : v.data }));
      return run;
    } catch (e) {
      if (!closed) view.set((v) => ({ ...v, errors: { ...v.errors, [key]: messageOf(e) } }));
      return undefined;
    } finally {
      if (!closed) {
        view.set((v) => {
          const busy = new Set(v.busy);
          busy.delete(key);
          return { ...v, busy };
        });
        schedule();
      }
    }
  }

  void reload();

  return {
    view,
    reload,
    run: (a) => send(a.id, () => api!.runAction(threadId, a.id)),
    stop: (r) => send(r.id, () => api!.stopActionRun(threadId, r.id)),
    // Again of the setup run is the setup run, as the server records it.
    retry: async (r) => {
      const next = await send(r.id, () => api!.retryActionRun(threadId, r.id));
      if (next) view.set((v) => (v.data?.setup_run?.id === r.id ? { ...v, data: { ...v.data, setup_run: next } } : v));
      return next;
    },
    pause() {
      paused = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
    resume() {
      if (!paused) return;
      paused = false;
      void reload();
    },
    close() {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

function omit(errors: Readonly<Record<string, string>>, key: string): Readonly<Record<string, string>> {
  const { [key]: _, ...rest } = errors;
  return rest;
}
