import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, openSSE, errorText, type ChannelWithRunning, type CrewRole, type FeedEvent, type Status, type Usage } from './api.ts';

interface AppState {
  channels: ChannelWithRunning[];
  channelsLoaded: boolean;
  channelsError: string | null;
  reloadChannels: () => Promise<void>;
  crew: CrewRole[];
  usage: Usage | null;
  status: Omit<Status, 'usage'> | null;
  feedLive: boolean;
  subscribe: (fn: (e: FeedEvent) => void) => () => void;
  channel: (id: string) => ChannelWithRunning | undefined;
  /** Channel of the thread currently open, so the sidebar can highlight it. */
  threadChannel: string | null;
  setThreadChannel: (id: string | null) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [channels, setChannels] = useState<ChannelWithRunning[]>([]);
  const [channelsLoaded, setChannelsLoaded] = useState(false);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [crew, setCrew] = useState<CrewRole[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [status, setStatus] = useState<Omit<Status, 'usage'> | null>(null);
  const [feedLive, setFeedLive] = useState(false);
  const [threadChannel, setThreadChannel] = useState<string | null>(null);
  const listeners = useRef(new Set<(e: FeedEvent) => void>());

  const reloadChannels = useCallback(async () => {
    try {
      const list = await api.get<ChannelWithRunning[]>('/channels');
      setChannels(list);
      setChannelsError(null);
    } catch (e) {
      setChannelsError(errorText(e));
    } finally {
      setChannelsLoaded(true);
    }
  }, []);

  const reloadStatus = useCallback(async () => {
    try {
      const s = await api.get<Status>('/status');
      setStatus({ running: s.running, queued: s.queued, maxConcurrent: s.maxConcurrent, maxUploadMb: s.maxUploadMb });
      if (s.usage) setUsage(s.usage);
    } catch {
      /* the channel list already surfaces connection errors */
    }
  }, []);

  const reloadCrew = useCallback(() => {
    api
      .get<CrewRole[]>('/crew')
      .then(setCrew)
      .catch(() => {});
  }, []);

  useEffect(() => {
    void reloadChannels();
    void reloadStatus();
    reloadCrew();
  }, [reloadChannels, reloadStatus, reloadCrew]);

  // Thread events arrive in bursts; refresh running counts at most every ~0.5s.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = undefined;
      void reloadChannels();
      void reloadStatus();
    }, 500);
  }, [reloadChannels, reloadStatus]);

  useEffect(() => {
    const emit = (e: FeedEvent) => listeners.current.forEach((fn) => fn(e));
    const h = openSSE(
      () => '/api/feed',
      (d) => {
        const e = d as FeedEvent;
        if (e.type === 'usage') {
          if (e.usage) setUsage(e.usage);
        } else if (e.type === 'thread') {
          scheduleRefresh();
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
            emit({ type: 'reconnect' });
          }
        },
        onDown: () => setFeedLive(false),
      },
    );
    return () => h.close();
  }, [scheduleRefresh, reloadCrew]);

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
      crew,
      usage,
      status,
      feedLive,
      subscribe,
      channel: (id: string) => channels.find((c) => c.id === id),
      threadChannel,
      setThreadChannel,
    }),
    [channels, channelsLoaded, channelsError, reloadChannels, crew, usage, status, feedLive, subscribe, threadChannel],
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
