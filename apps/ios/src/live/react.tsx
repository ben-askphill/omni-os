import { eventSourceTransport, xhrUploadTransport, type NeedsYou } from '@omni/client-core';
import { useIsFocused } from '@react-navigation/native';
import { addNetworkStateListener } from 'expo-network';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';
import EventSource from 'react-native-sse';

import { clearArtifactCache } from '../artifacts/files';
import { shownResult } from '../needs/inbox';
import type { ActionsLive, ActionsView } from './actions';
import { afterFirstPage, afterNextPage, type ChannelPages } from './channel-pages';
import { createHandoffPrefs, type HandoffPrefs } from './handoff-prefs';
import { createLiveHub, type LiveHub, type ThreadLive, type ThreadView } from './hub';
import type { Link } from './connection';
import type { OmniSession } from './session';
import { createStore, type Store } from './store';

const HubContext = createContext<LiveHub | null>(null);

/**
 * Owns the live hub for one session. A new session makes a new hub, so re-pairing starts clean. The hub lives in an
 * effect rather than a memo, so a remount (or React's dev double-mount) closes it and opens a fresh one.
 */
export function LiveProvider({ session, children }: { session: OmniSession; children: ReactNode }) {
  const [hub, setHub] = useState<LiveHub | null>(null);

  useEffect(() => {
    clearArtifactCache();
    const next = createLiveHub({ session, transport: eventSourceTransport(EventSource), upload: xhrUploadTransport() });
    setHub(next);
    const appState = AppState.addEventListener('change', (state) => next.setForeground(state === 'active'));
    const network = addNetworkStateListener((state) => {
      if (state.isInternetReachable) next.kick();
    });
    return () => {
      appState.remove();
      network.remove();
      next.close();
      setHub(null);
    };
  }, [session]);

  return <HubContext.Provider value={hub}>{hub ? children : null}</HubContext.Provider>;
}

export function useLiveHub(): LiveHub {
  const hub = useContext(HubContext);
  if (!hub) throw new Error('useLiveHub needs a LiveProvider above it');
  return hub;
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export function useChannels() {
  return useStore(useLiveHub().channels);
}

/** What waits on Ben: unread results and blockers across the server's threads. Null until the first load. */
export function useNeedsYou(): NeedsYou | null {
  return useStore(useLiveHub().needsYou).data;
}

function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

/**
 * Like the desktop thread page, a thread's newest result counts as read while the thread is on screen: this screen is
 * the one in front and the app is in the foreground. Once read, the thread leaves Needs you.
 */
export function useMarkResultRead(threadId: string, status: string | undefined) {
  const hub = useLiveHub();
  const focused = useIsFocused();
  const active = useAppActive();
  const uid = shownResult(useNeedsYou(), threadId, status);
  useEffect(() => {
    if (uid && focused && active) void hub.markResultRead(uid);
  }, [hub, uid, focused, active]);
}

export function useActivity() {
  return useStore(useLiveHub().activity);
}

/** What the Activity tab's badge counts. A number, so the tab bar re-renders only when it changes. */
export function useNeedsYouCount(): number {
  const { needsYou } = useLiveHub();
  const count = () => needsYou.get().data?.items.length ?? 0;
  return useSyncExternalStore(needsYou.subscribe, count, count);
}

/** A pull-to-refresh that shows its spinner only for a pull. A refresh the app starts itself, as on returning to the front, stays quiet. */
export function usePullRefresh(load: (hub: LiveHub) => Promise<unknown> = (hub) => Promise.all([hub.refreshChannels(), hub.refreshActivity(), hub.refreshNeedsYou()])) {
  const hub = useLiveHub();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = () => {
    setRefreshing(true);
    void load(hub).finally(() => setRefreshing(false));
  };
  return { refreshing, onRefresh };
}

/**
 * A channel's own thread list, page by page (U3). The first page loads on open and again each time the channel list
 * refetches after a feed change; `loadMore` adds the next older page. Null until the first page arrives.
 */
export function useChannelThreadPages(channelId: string) {
  const hub = useLiveHub();
  const { loadedAt } = useChannels();
  const [pages, setPages] = useState<ChannelPages | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const latest = useRef(pages);
  latest.current = pages;

  useEffect(() => {
    let live = true;
    hub
      .request((api) => api.channelThreadsPage(channelId))
      .then((page) => live && setPages((prev) => afterFirstPage(prev, channelId, page)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [hub, channelId, loadedAt]);

  const loadMore = useCallback(async () => {
    const cursor = latest.current?.channelId === channelId ? latest.current.next : null;
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await hub.request((api) => api.channelThreadsPage(channelId, cursor));
      setPages((prev) => afterNextPage(prev, channelId, cursor, page));
    } catch {
      // The list stays as it is; scrolling to the end asks again.
    } finally {
      setLoadingMore(false);
    }
  }, [hub, channelId, loadingMore]);

  const mine = pages?.channelId === channelId ? pages : null;
  return { threads: mine?.threads ?? null, more: !!mine?.next, loadingMore, loadMore };
}

export function useLibrary() {
  return useStore(useLiveHub().library);
}

export function useLink(): Link {
  return useStore(useLiveHub().link);
}

/** Opens a thread for as long as the calling screen is mounted. */
export function useThreadLive(threadId: string): ThreadLive | null {
  const hub = useLiveHub();
  const [live, setLive] = useState<ThreadLive | null>(null);
  useEffect(() => {
    const thread = hub.openThread(threadId);
    setLive(thread);
    return () => {
      thread.close();
      setLive(null);
    };
  }, [hub, threadId]);
  return live;
}

const HANDOFF_PREF_KEY = 'omni.pref.handoffs.closed';
let handoffPrefs: HandoffPrefs | null = null;

/** One per app: whether a parent shows its delegated threads is a choice of this device, not of the server it is paired with. */
function sharedHandoffPrefs(): HandoffPrefs {
  handoffPrefs ??= createHandoffPrefs({
    read: () => SecureStore.getItemAsync(HANDOFF_PREF_KEY),
    write: (value) => SecureStore.setItemAsync(HANDOFF_PREF_KEY, value),
  });
  return handoffPrefs;
}

/** Whether the Conductor parent shows the threads it delegated (open unless closed), and a toggle that remembers it. */
export function useHandoffOpen(parentId: string): [open: boolean, toggle: () => void] {
  const prefs = sharedHandoffPrefs();
  const closed = useStore(prefs.closed);
  return [!closed.has(parentId), () => prefs.toggle(parentId)];
}

export type InboxShelf = 'working' | 'done';

const SHELF_PREF_KEY = 'omni.pref.inbox.open';
let shelfPrefs: HandoffPrefs | null = null;

/**
 * Whether an Activity shelf is open, and a toggle that remembers it on this device. Every shelf starts folded, as on
 * phone web; the same toggled-set store as the handoffs keeps the shelves Ben opened.
 */
export function useShelfOpen(shelf: InboxShelf): [open: boolean, toggle: () => void] {
  shelfPrefs ??= createHandoffPrefs({
    read: () => SecureStore.getItemAsync(SHELF_PREF_KEY),
    write: (value) => SecureStore.setItemAsync(SHELF_PREF_KEY, value),
  });
  const prefs = shelfPrefs;
  const opened = useStore(prefs.closed);
  return [opened.has(shelf), () => prefs.toggle(shelf)];
}

const idle = createStore<null>(null);

/** The thread's view, or null until its screen has opened it. */
export function useThreadView(live: ThreadLive | null): ThreadView | null {
  return useSyncExternalStore(
    (listener) => (live ? live.view.subscribe(listener) : idle.subscribe(listener)),
    () => (live ? live.view.get() : null),
  );
}

export function useActionsLive(threadId: string): ActionsLive | null {
  const hub = useLiveHub();
  const [live, setLive] = useState<ActionsLive | null>(null);
  useEffect(() => {
    const actions = hub.openActions(threadId);
    setLive(actions);
    return () => {
      actions.close();
      setLive(null);
    };
  }, [hub, threadId]);
  return live;
}

const idleActions = createStore<null>(null);

export function useActionsView(live: ActionsLive | null): ActionsView | null {
  return useSyncExternalStore(
    (listener) => (live ? live.view.subscribe(listener) : idleActions.subscribe(listener)),
    () => (live ? live.view.get() : null),
  );
}

/** Ben's claude.ai Artifacts and the server's refresh state, for the Library's claude.ai switch. */
export function useClaudeArtifacts() {
  return useStore(useLiveHub().claudeArtifacts);
}
