import type { ArtifactWithThread, OmniApi } from '@omni/client-core';

import { serial } from './serial';
import { createStore, type Store } from './store';

/** Agents often rewrite a file several times in a row. A burst of feed messages refetches once, this long after the first. */
export const LIBRARY_DEBOUNCE_MS = 1500;

export interface LibraryState {
  /** Newest first, screenshots left out. Null until the first load. */
  artifacts: readonly ArtifactWithThread[] | null;
  loading: boolean;
  /** The last failed load. The files an earlier load brought stay on screen. */
  error: string | null;
  loadedAt: number | null;
}

export interface LibraryLive {
  readonly state: Store<LibraryState>;
  /** Loads the list again: on open, on every feed reconnect and on return to the front. */
  refresh(): Promise<void>;
  applyFeed(message: unknown): void;
  close(): void;
}

export interface LibraryLiveOptions {
  api: Pick<OmniApi, 'artifacts'> | null;
  withAuth: <T>(run: () => Promise<T>) => Promise<T>;
  now: () => number;
  debounceMs?: number;
}

/** The Library's list, kept live from the feed the way phone web keeps it. */
export function createLibraryLive({ api, withAuth, now, debounceMs = LIBRARY_DEBOUNCE_MS }: LibraryLiveOptions): LibraryLive {
  const state = createStore<LibraryState>({ artifacts: null, loading: false, error: null, loadedAt: null });
  let timer: ReturnType<typeof setTimeout> | null = null;

  const refresh = serial(async () => {
    if (!api) return;
    state.set((s) => ({ ...s, loading: true }));
    try {
      const artifacts = await withAuth(() => api.artifacts());
      state.set({ artifacts, loading: false, error: null, loadedAt: now() });
    } catch (e) {
      state.set((s) => ({ ...s, loading: false, error: e instanceof Error && e.message ? e.message : 'Something went wrong' }));
    }
  });

  function applyFeed(message: unknown) {
    if (!isArtifactChange(message) || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void refresh();
    }, debounceMs);
  }

  function close() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  return { state, refresh, applyFeed, close };
}

/** A screenshot is a thread's own capture, not a file in the Library. */
function isArtifactChange(message: unknown): boolean {
  if (!message || typeof message !== 'object') return false;
  const m = message as { type?: unknown; artifact?: { kind?: unknown } };
  return m.type === 'artifact' && m.artifact?.kind !== 'screenshot';
}
