import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, openSSE, errorText, taskHost, type BackgroundTask, type ChannelWithRunning, type CrewRole, type FeedEvent, type HarnessUsage, type ModStatus, type NeedsYou, type Profile, type Status, type Thread, type ThreadStub } from './api.ts';
import { coalesced, withoutResult } from './needs-you.ts';
import { withPin, type PinnedThread } from './pins.ts';

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
  status: Omit<Status, 'usage'> | null;
  /** The name Omni calls the user by, null until the first status load. Empty when nobody set it yet. */
  profile: Profile | null;
  /** Save the name (PUT /api/profile) and show it at once. */
  saveProfile: (p: Profile) => Promise<Profile>;
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
  /** The thread currently open, so the sidebar can list and highlight it under its channel. */
  openThread: ThreadStub | null;
  setOpenThread: (t: ThreadStub | null) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [channels, setChannels] = useState<ChannelWithRunning[]>([]);
  const [channelsLoaded, setChannelsLoaded] = useState(false);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [pinned, setPinnedList] = useState<PinnedThread[]>([]);
  const [crew, setCrew] = useState<CrewRole[]>([]);
  const [usage, setUsage] = useState<HarnessUsage>({});
  const [status, setStatus] = useState<Omit<Status, 'usage'> | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [feedLive, setFeedLive] = useState(false);
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const [mods, setMods] = useState<ModStatus[]>([]);
  const [openThread, setOpenThread] = useState<ThreadStub | null>(null);
  const [needsYou, setNeedsYou] = useState<NeedsYou | null>(null);
  /** Bumps on each read, so an inbox fetched before it cannot put the read result back. */
  const needsYouEpoch = useRef(0);
  const listeners = useRef(new Set<(e: FeedEvent) => void>());
  const taskHosts = useRef('');

  const reloadPinned = useCallback(
    () =>
      api
        .get<PinnedThread[]>('/pinned')
        .then(setPinnedList)
        .catch(() => {}),
    [],
  );

  const reloadChannels = useCallback(async () => {
    // Pins name threads in any channel, so they change whenever the channels' threads do.
    const pins = reloadPinned();
    try {
      const list = await api.get<ChannelWithRunning[]>('/channels');
      setChannels(list);
      setChannelsError(null);
    } catch (e) {
      setChannelsError(errorText(e));
    } finally {
      setChannelsLoaded(true);
    }
    await pins;
  }, [reloadPinned]);

  const setPinned = useCallback(
    async (t: ThreadStub, on: boolean) => {
      setPinnedList((prev) => withPin(prev, t, on));
      try {
        return await api.patch<Thread>(`/threads/${encodeURIComponent(t.id)}`, { pinned: on });
      } finally {
        // Refused or not, the server's list is the truth.
        void reloadPinned();
      }
    },
    [reloadPinned],
  );

  const reloadStatus = useCallback(async () => {
    try {
      const s = await api.get<Status>('/status');
      setStatus({ running: s.running, queued: s.queued, maxConcurrent: s.maxConcurrent, maxUploadMb: s.maxUploadMb, slots: s.slots ?? {} });
      setProfile(s.profile ?? { name: '' });
      if (s.usage) setUsage((prev) => ({ ...prev, ...s.usage }));
    } catch {
      /* the channel list already surfaces connection errors */
    }
  }, []);

  const reloadNeedsYou = useCallback(() => {
    const epoch = needsYouEpoch.current;
    return api
      .get<NeedsYou>('/needs-you')
      .then((n) => void (epoch === needsYouEpoch.current && setNeedsYou(n)))
      .catch(() => {});
  }, []);
  /** On a `needs_you` event: a read or a result here, on another client or from the other Mac's sync, often in a burst. */
  const needsYouChanged = useMemo(() => coalesced(reloadNeedsYou), [reloadNeedsYou]);

  const readResult = useCallback(
    (uid: string) => {
      needsYouEpoch.current++;
      setNeedsYou((prev) => (prev ? withoutResult(prev, uid) : prev));
      // Whatever the answer, the server's inbox is the truth: a newer result may have come in meanwhile.
      api
        .post('/needs-you/read', { uid })
        .catch(() => {})
        .finally(reloadNeedsYou);
    },
    [reloadNeedsYou],
  );

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

  const saveProfile = useCallback(async (p: Profile) => {
    const saved = await api.put<Profile>('/profile', p);
    setProfile(saved);
    return saved;
  }, []);

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
      profile,
      saveProfile,
      feedLive,
      tasks,
      mods,
      subscribe,
      channel: (id: string) => channels.find((c) => c.id === id),
      needsYou,
      readResult,
      openThread,
      setOpenThread,
    }),
    [channels, channelsLoaded, channelsError, reloadChannels, pinned, setPinned, crew, usage, status, profile, saveProfile, feedLive, tasks, mods, subscribe, needsYou, readResult, openThread],
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
