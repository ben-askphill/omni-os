import type { OmniApi, PinnedThread, Thread } from '@omni/client-core';
import { latestOnly } from '@omni/shared/latest.ts';

import { serial } from './serial';
import { createStore, type Store } from './store';

/** How many threads the recent list holds, as phone web's Inbox asks for (apps/web/src/app/useInbox.ts). */
export const RECENT_LIMIT = 200;

export interface ActivityState {
  /** Newest activity first. Null until the first load. */
  recent: readonly Thread[] | null;
  pinned: readonly PinnedThread[];
  /** The largest file the server takes, from the status the load already read. Null until it says. */
  maxUploadMb: number | null;
  loading: boolean;
  /** The last failed load. What the earlier loads brought stays on screen. */
  error: string | null;
  loadedAt: number | null;
}

export interface ActivityLive {
  readonly state: Store<ActivityState>;
  /** Loads everything again: on open, on every feed reconnect and on return to the front. */
  refresh(): Promise<void>;
  /** A thread Ben just changed here (pin, rename): it goes in now, and a load already in flight cannot put the old copy back. */
  applyThread(thread: Thread): void;
  applyFeed(message: unknown): void;
}

export interface ActivityLiveOptions {
  api: Pick<OmniApi, 'recent' | 'pinned' | 'status'> | null;
  withAuth: <T>(run: () => Promise<T>) => Promise<T>;
  now: () => number;
}

/** Activity's data, kept live from the feed the way phone web's store keeps it. */
export function createActivityLive({ api, withAuth, now }: ActivityLiveOptions): ActivityLive {
  const state = createStore<ActivityState>({ recent: null, pinned: [], maxUploadMb: null, loading: false, error: null, loadedAt: null });
  const failed = (e: unknown) => state.set((s) => ({ ...s, error: messageOf(e) }));
  // A load that started before a local change or a feed update answers with the older lists (@omni/shared/latest.ts).
  const reads = latestOnly();

  const refresh = serial(async () => {
    if (!api) return;
    state.set((s) => ({ ...s, loading: true }));
    const token = reads.begin();
    const [recent, pinned, status] = await Promise.allSettled([
      withAuth(() => api.recent(RECENT_LIMIT)),
      withAuth(() => api.pinned()),
      withAuth(() => api.status()),
    ]);
    const failure = [recent, pinned, status].find((r) => r.status === 'rejected');
    const fresh = reads.holds(token);
    if (!fresh) void refreshPinned();
    state.set((s) => ({
      recent: fresh && recent.status === 'fulfilled' ? recent.value : s.recent,
      pinned: fresh && pinned.status === 'fulfilled' ? pinned.value : s.pinned,
      maxUploadMb: status.status === 'fulfilled' ? (status.value.maxUploadMb ?? null) : s.maxUploadMb,
      loading: false,
      error: failure ? messageOf(failure.reason) : null,
      loadedAt: failure ? s.loadedAt : now(),
    }));
  });

  const refreshPinned = serial(async () => {
    if (!api) return;
    try {
      const token = reads.begin();
      const pinned = await withAuth(() => api.pinned());
      if (reads.holds(token)) state.set((s) => ({ ...s, pinned }));
    } catch (e) {
      failed(e);
    }
  });

  function applyFeed(message: unknown) {
    if (!isRecord(message)) return;
    if (message.type !== 'thread' || !isRecord(message.thread) || typeof message.thread.id !== 'string') return;
    applyThread(message.thread as unknown as Thread);
  }

  function applyThread(thread: Thread) {
    reads.edit();
    patchRecent(thread);
    void refreshPinned();
  }

  /** The thread's new copy in its place by activity. An archived one leaves the list. */
  function patchRecent(thread: Thread) {
    state.set((s) => {
      if (!s.recent) return s;
      const list = s.recent.filter((t) => t.id !== thread.id);
      if (!thread.archived) list.push(thread);
      list.sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
      return { ...s, recent: list.slice(0, RECENT_LIMIT) };
    });
  }

  return { state, refresh, applyFeed, applyThread };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function messageOf(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return 'Something went wrong';
}
