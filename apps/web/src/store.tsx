import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, openSSE, taskHost, type BackgroundTask, type ChannelWithRunning, type CrewRole, type FeedEvent, type HarnessUsage, type ModStatus, type NeedsYou, type Profile, type Status, type Thread, type ThreadStub } from './api.ts';
import { type PinnedThread } from './pins.ts';
import { pageTitle, type Route } from './router.ts';
import { windowTitle } from './device.ts';
import { useChannels } from './app/useChannels.ts';
import { useNeedsYou } from './app/useNeedsYou.ts';
import { useStatusAndProfile } from './app/useStatusAndProfile.ts';
import { createSyncNudge } from './sync-nudge.ts';
import { secretStoreLabel, type SecretStoreKind } from '@omni/shared/secret-store.ts';

interface AppState {
  channels: ChannelWithRunning[];
  channelsLoaded: boolean;
  channelsError: string | null;
  reloadChannels: () => Promise<void>;
  /** The sidebar's Pinned section (GET /api/pinned), the latest pin first. Reloads with the channel list. */
  pinned: PinnedThread[];
  /** Pin a thread or unpin it: the sidebar shows it at once, the server keeps it. The thread as it is now, or the server's error. */
  setPinned: (t: ThreadStub, on: boolean) => Promise<Thread>;
  /** Change the channel list in place, ahead of the server: folder edits show at once (apps/web/src/folders.tsx). */
  updateChannels: (fn: (list: ChannelWithRunning[]) => ChannelWithRunning[]) => void;
  crew: CrewRole[];
  usage: HarnessUsage;
  status: (Omit<Status, 'usage' | 'server'> & { secretStore: SecretStoreKind }) | null;
  /** Re-read GET /api/status, as after a secret that changes what it reports. */
  reloadStatus: () => Promise<void>;
  /** The name Omni calls the user by, null until the first status load. Empty when nobody set it yet. */
  profile: Profile | null;
  /** Save profile fields (PUT /api/profile) and show them at once. */
  saveProfile: (p: Partial<Profile>) => Promise<Profile>;
  /** Re-read the profile after onboarding or Settings wrote the user config. */
  reloadProfile: () => Promise<void>;
  /** The onboarding wizard: open on first run, or again from Settings. */
  setupOpen: boolean;
  openSetup: () => void;
  closeSetup: () => void;
  feedLive: boolean;
  /** Every sub-agent running right now, across all threads. */
  tasks: BackgroundTask[];
  /** Every mod status line pinned right now, across all threads. */
  mods: ModStatus[];
  subscribe: (fn: (e: FeedEvent) => void) => () => void;
  channel: (id: string) => ChannelWithRunning | undefined;
  /** Unread results and blockers across every thread (GET /api/needs-you), null until the first load. */
  needsYou: NeedsYou | null;
  /** Ben saw this result: it leaves Needs you at once, and the server keeps it read. */
  readResult: (uid: string) => void;
  /** Mark a thread done (out of Needs you at once) or not done again. The thread as it is now, or the server's error. */
  setDone: (threadId: string, on: boolean) => Promise<Thread>;
  /** The thread currently open, so the sidebar can list and highlight it under its channel. */
  openThread: ThreadStub | null;
  setOpenThread: (t: ThreadStub | null) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [crew, setCrew] = useState<CrewRole[]>([]);
  const [feedLive, setFeedLive] = useState(false);
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const [mods, setMods] = useState<ModStatus[]>([]);
  const [openThread, setOpenThread] = useState<ThreadStub | null>(null);
  const { channels, setChannels, channelsLoaded, channelsError, pinned, reloadChannels, setPinned } = useChannels();
  const { usage, setUsage, status, profile, setupOpen, openSetup, closeSetup, reloadStatus, saveProfile, reloadProfile } = useStatusAndProfile();
  const { needsYou, reloadNeedsYou, needsYouChanged, readResult, setDone } = useNeedsYou(reloadChannels);
  const listeners = useRef(new Set<(e: FeedEvent) => void>());
  const taskHosts = useRef('');

  const reloadCrew = useCallback(() => {
    api
      .get<CrewRole[]>('/crew')
      .then(setCrew)
      .catch(() => {});
  }, []);

  // Sub-agents and mod status lines both live only as long as a thread's process: reload them together.
  const reloadTasks = useCallback(() => {
    api
      .get<BackgroundTask[]>('/tasks')
      .then(setTasks)
      .catch(() => {});
    api
      .get<ModStatus[]>('/mods')
      .then(setMods)
      .catch(() => {});
  }, []);

  useEffect(() => {
    void reloadChannels();
    void reloadStatus();
    reloadCrew();
    reloadTasks();
    reloadNeedsYou();
  }, [reloadChannels, reloadStatus, reloadCrew, reloadTasks, reloadNeedsYou]);

  // Thread events arrive in bursts; refresh running counts at most every ~0.5s.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = undefined;
      void reloadChannels();
      void reloadStatus();
      reloadNeedsYou();
    }, 500);
  }, [reloadChannels, reloadStatus, reloadNeedsYou]);

  useEffect(() => {
    const emit = (e: FeedEvent) => listeners.current.forEach((fn) => fn(e));
    const h = openSSE(
      () => '/api/feed',
      (d) => {
        const e = d as FeedEvent;
        if (e.type === 'usage') {
          setUsage((prev) => ({ ...prev, [e.harness ?? 'claude-code']: e.usage }));
        } else if (e.type === 'thread' || e.type === 'channel') {
          scheduleRefresh();
        } else if (e.type === 'tasks') {
          setTasks(e.tasks);
          // A thread stays listed while its agents run past its turn: the list changes when the set of hosts does.
          const hosts = [...new Set(e.tasks.map(taskHost))].sort().join();
          if (hosts !== taskHosts.current) {
            taskHosts.current = hosts;
            scheduleRefresh();
          }
        } else if (e.type === 'mods') {
          setMods(e.mods);
        } else if (e.type === 'needs_you') {
          needsYouChanged();
        }
        emit(e);
      },
      {
        onOpen: (again) => {
          setFeedLive(true);
          if (again) {
            // Missed events while disconnected: let every view refetch.
            scheduleRefresh();
            reloadCrew();
            reloadTasks();
            emit({ type: 'reconnect' });
          }
        },
        onDown: () => setFeedLive(false),
      },
    );
    return () => h.close();
  }, [scheduleRefresh, reloadCrew, reloadTasks, needsYouChanged]);

  const subscribe = useCallback((fn: (e: FeedEvent) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  const value = useMemo<AppState>(
    () => ({
      channels,
      channelsLoaded,
      channelsError,
      reloadChannels,
      pinned,
      setPinned,
      updateChannels: setChannels,
      crew,
      usage,
      status,
      reloadStatus,
      profile,
      saveProfile,
      reloadProfile,
      setupOpen,
      openSetup,
      closeSetup,
      feedLive,
      tasks,
      mods,
      subscribe,
      channel: (id: string) => channels.find((c) => c.id === id),
      needsYou,
      readResult,
      setDone,
      openThread,
      setOpenThread,
    }),
    [channels, channelsLoaded, channelsError, reloadChannels, pinned, setPinned, crew, usage, status, reloadStatus, profile, saveProfile, reloadProfile, setupOpen, openSetup, closeSetup, feedLive, tasks, mods, subscribe, needsYou, readResult, setDone, openThread],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

/** Subscribe to /feed events for the lifetime of the component. */
export function useFeed(fn: (e: FeedEvent) => void) {
  const { subscribe } = useApp();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => subscribe((e) => ref.current(e)), [subscribe]);
}

// ---------- tiny UI prefs (localStorage, conveniences only) ----------

export function readPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`omni.${key}`);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown) {
  try {
    localStorage.setItem(`omni.${key}`, JSON.stringify(value));
  } catch {
    /* private mode or blocked storage: ignore */
  }
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(q).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

export const useIsMobile = () => !useMediaQuery('(min-width: 768px)');

/** Re-render every `ms` so relative times stay fresh. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** The window title: the page's name, or the one given, then Omni, led by the Mac's name when it is not this one. */
export function usePageTitle(route: Route, name?: string) {
  const { channel, status } = useApp();
  const device = status?.device;
  useEffect(() => {
    document.title = windowTitle(name ?? pageTitle(route, (id) => channel(id)?.name), device);
  }, [route, channel, name, device]);
}

/** Back on the tab: ask the server to sync, so the other Mac's work shows up now rather than on its timer. */
export function useSyncOnReturn() {
  useEffect(() => {
    const sync = createSyncNudge({ post: () => api.post('/sync/now') });
    const onFocus = () => sync.nudge();
    const onVisible = () => document.visibilityState === 'visible' && sync.nudge();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      sync.cancel();
    };
  }, []);
}

/** True while the tab is on screen. */
export function usePageVisible() {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

/** Where the server keeps secret values, as a sentence names it: "the server Mac's Keychain". */
export function useSecretStoreLabel(): string {
  return secretStoreLabel(useApp().status?.secretStore ?? 'keychain');
}
