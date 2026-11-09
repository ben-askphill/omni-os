import { isClaudeArtifactsFeedEvent, type ClaudeArtifact, type ClaudeArtifactsSchedule, type ClaudeArtifactsState, type OmniApi } from '@omni/client-core';

import { serial } from './serial';
import { createStore, type Store } from './store';

// Ben's claude.ai Artifacts (the Library's claude.ai switch), kept live from the feed the way phone web keeps them. The
// server lists them through Claude Code (apps/server/claude-artifacts.ts); the phone only reads that cache and asks for
// a refresh. Nothing loads until the switch is first shown: most visits to the Library never need it.

export interface ClaudeArtifactsLiveState {
  /** In the server's order. Null until the first load. */
  items: readonly ClaudeArtifact[] | null;
  /** The server's refresh state: when it last listed, whether a listing runs now, why the last one failed. */
  server: ClaudeArtifactsState | null;
  loading: boolean;
  /** The last failed request to Omni itself (not a failed listing, which is `server.error`). */
  error: string | null;
}

export interface ClaudeArtifactsLive {
  readonly state: Store<ClaudeArtifactsLiveState>;
  /** The switch was shown: load the list, and ask the server to list again unless it did in the last ten minutes. */
  open(): Promise<void>;
  /** Pull to refresh: always lists again, then the list reloads when the feed says the run ended. */
  refresh(): Promise<void>;
  /** Loads the cached list again, as on a feed reconnect. Does nothing before the switch was first shown. */
  reload(): Promise<void>;
  setSchedule(schedule: ClaudeArtifactsSchedule): Promise<void>;
  applyFeed(message: unknown): void;
}

export interface ClaudeArtifactsLiveOptions {
  api: Pick<OmniApi, 'claudeArtifacts' | 'refreshClaudeArtifacts' | 'setClaudeArtifactsSchedule'> | null;
  withAuth: <T>(run: () => Promise<T>) => Promise<T>;
}

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong');

export function createClaudeArtifactsLive({ api, withAuth }: ClaudeArtifactsLiveOptions): ClaudeArtifactsLive {
  const state = createStore<ClaudeArtifactsLiveState>({ items: null, server: null, loading: false, error: null });
  let opened = false;

  const load = serial(async () => {
    if (!api) return;
    state.set((s) => ({ ...s, loading: true }));
    try {
      const res = await withAuth(() => api.claudeArtifacts());
      state.set({ items: res.items, server: res.state, loading: false, error: null });
    } catch (e) {
      state.set((s) => ({ ...s, loading: false, error: message(e) }));
    }
  });

  async function ask(force: boolean) {
    if (!api) return;
    try {
      const res = await withAuth(() => api.refreshClaudeArtifacts({ force }));
      state.set((s) => ({ ...s, server: res.state, error: null }));
    } catch (e) {
      state.set((s) => ({ ...s, error: message(e) }));
    }
  }

  return {
    state,
    async open() {
      opened = true;
      await load();
      await ask(false);
    },
    async refresh() {
      opened = true;
      await ask(true);
    },
    async reload() {
      if (opened) await load();
    },
    async setSchedule(schedule) {
      if (!api) return;
      try {
        const res = await withAuth(() => api.setClaudeArtifactsSchedule(schedule));
        state.set((s) => ({ ...s, server: res.state, error: null }));
      } catch (e) {
        state.set((s) => ({ ...s, error: message(e) }));
      }
    },
    applyFeed(m) {
      if (!isClaudeArtifactsFeedEvent(m)) return;
      state.set((s) => ({ ...s, server: m.state }));
      // A run ended (or the schedule changed): its list is in the cache now.
      if (!m.state.refreshing && opened) void load();
    },
  };
}
