import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { Thread, Channel, EventRow, Artifact } from '../../server/db.ts';
import type { Attachment } from '../../server/uploads.ts';
import type { HarnessInfo, ModelEntry, HarnessId } from '../../server/harness/types.ts';
import type { CommandList as HarnessCommands } from '../../server/commands.ts';

export type { Thread, Channel, EventRow, Artifact, Attachment, HarnessInfo, ModelEntry, HarnessId };

/** A harness in the catalog, plus how many of its threads are running now. */
export type HarnessWithRunning = HarnessInfo & { running: number };

/** A thread's `/` menu: its harness's commands, and the names Ben used last on that harness, newest first. */
export type CommandList = HarnessCommands & { recent?: string[] };

// ---------- response shapes ----------

/** Just enough of a thread to list it under its channel in the sidebar. */
export type ThreadStub = Pick<Thread, 'id' | 'channel_id' | 'title' | 'status' | 'created_at'>;
/** `active`: the channel's running and queued threads. `recent`: its latest threads of any status. */
export type ChannelWithRunning = Channel & { running: number; active?: ThreadStub[]; recent?: ThreadStub[] };
export type ArtifactWithThread = Artifact & { thread_title: string; channel_id: string };

export interface UsageWindow {
  utilization: number;
  resetsAt: number;
}
export interface Usage {
  five_hour?: UsageWindow;
  seven_day?: UsageWindow;
  status?: string;
  updated_at?: string;
}
export type HarnessUsage = Partial<Record<HarnessId, Usage | null>>;
export interface HarnessSlot {
  running: number;
  cap: number;
}
export interface Status {
  usage: HarnessUsage;
  slots: Partial<Record<HarnessId, HarnessSlot>>;
  running: number;
  queued: number;
  maxConcurrent: number;
  maxUploadMb: number;
}

export interface ThreadDetail {
  thread: Thread;
  channel: Channel | undefined;
  events: EventRow[];
  artifacts: Artifact[];
  children: Thread[];
  /** Members of the teams among `children`. Older servers leave it out. */
  team?: Thread[];
  parent: Thread | null;
  pending?: PendingMsg[];
  /** A warm CLI process is attached (idle or mid-turn), so the next message starts instantly. */
  live?: boolean;
  /** Why this Mac cannot start a turn in the thread (sync: it runs on the other Mac, or its folder is not here). */
  blocked?: string;
}

/** How a message reaches a busy thread: read at its next step, run after the turn, or interrupt then run. */
export type SendMode = 'steer' | 'queue' | 'interrupt';

/**
 * A message the agent has not seen yet; it enters the transcript when the CLI replays it.
 * `waiting`: no free slot yet. `sent`: written to the CLI, read at its next step. `held`: runs after this turn.
 */
export interface PendingMsg {
  uuid: string;
  kind: 'user' | 'crew_report';
  text: string;
  source?: string;
  mode: SendMode;
  state: 'waiting' | 'sent' | 'held';
  task_id?: string | null;
  role?: string | null;
  attachments?: Attachment[];
}

export interface CrewRole {
  id: string;
  name: string;
  description: string;
  harness?: string;
  model?: string;
  effort?: string;
  channel?: string;
  mcp: string[];
  charter: string;
  error?: string;
}

export interface SearchHit {
  thread_id: string;
  title: string;
  channel_id: string;
  status: string;
  updated_at: string;
  snippet: string;
}

export interface Checks {
  passed: number;
  failed: number;
  pending: number;
}
export interface PRSummary {
  number: number;
  title: string;
  author: { login: string } | null;
  headRefName: string;
  baseRefName: string;
  state?: string;
  isDraft: boolean;
  updatedAt: string;
  reviewDecision: string | null;
  url: string;
  additions: number;
  deletions: number;
  mergeable: string;
  checks: Checks;
}
export interface PRDetail extends PRSummary {
  body: string;
  files: { path: string; additions: number; deletions: number }[];
  reviews: { author: { login: string } | null; state: string; body: string; submittedAt?: string }[];
  comments: { author: { login: string } | null; body: string; createdAt?: string }[];
  checkRuns: { name: string; state: string; url?: string }[];
  diff: string;
}

export interface AutomationRun {
  thread_id: string | null;
  trigger: string;
  created_at: string;
  status: string | null;
  title: string | null;
}
export interface Automation {
  id: string;
  name: string;
  cron: string;
  timezone: string;
  channel: string;
  role?: string;
  model?: string;
  prompt: string;
  enabled: boolean;
  file?: string;
  error?: string;
  next?: string | null;
  runs: AutomationRun[];
}

export interface SecretRow {
  scope: string;
  name: string;
  updated_at: string;
}

/** GET /api/sync/status. */
export type { SyncStatus } from '../../server/sync/worker.ts';
/** POST /api/sync/setup: a code went out by email, or the sign-in worked. */
export type SyncSetupResult = { state: 'code_sent'; email: string } | { state: 'signed_in'; email: string; relayChanged: boolean };

/** A sub-agent or background task the CLI is running, as GET /api/tasks and the feed's 'tasks' event carry it. */
export interface BackgroundTask {
  thread_id: string;
  channel_id: string;
  task_id: string;
  tool_use_id?: string;
  description: string;
  subagent_type?: string;
  task_type?: string;
  background: boolean;
  /** ISO time. */
  started_at: string;
  last_tool?: string;
  tool_uses?: number;
  tokens?: number;
  summary?: string;
}

export type FeedEvent =
  | { type: 'thread'; thread: Thread }
  | { type: 'tasks'; tasks: BackgroundTask[] }
  | { type: 'usage'; harness?: HarnessId; usage: Usage | null }
  | { type: 'artifact'; artifact: Artifact }
  | { type: 'channel'; id: string }
  | { type: 'reconnect' };

// ---------- fetch helpers ----------

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  // FormData carries its own multipart content type, so never set one for it.
  const form = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body !== undefined && !form ? { 'Content-Type': 'application/json' } : undefined,
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Cannot reach the Omni server. Is it running?', 0);
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : typeof data === 'string' && data
          ? data.slice(0, 300)
          : `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  /** Same body as `post`, plus attachments. Falls back to plain JSON when there are none. */
  send: <T>(path: string, body: Record<string, unknown>, files: File[]) => {
    if (!files.length) return request<T>('POST', path, body);
    const fd = new FormData();
    fd.append('payload', JSON.stringify(body));
    for (const f of files) fd.append('files', f, f.name);
    return request<T>('POST', path, fd);
  },
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const artifactUrl = (a: Pick<Artifact, 'id' | 'updated_at'>, download = false) =>
  `/api/artifacts/${a.id}/raw?v=${encodeURIComponent(a.updated_at)}${download ? '&download=1' : ''}`;

export const uploadUrl = (threadId: string, a: Pick<Attachment, 'name'>, download = false) =>
  `/api/threads/${encodeURIComponent(threadId)}/uploads/${encodeURIComponent(a.name)}${download ? '?download=1' : ''}`;

// ---------- hooks ----------

export interface Async<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
  setData: (fn: T | ((prev: T | undefined) => T)) => void;
}

/** Fetch on mount and whenever the key changes. `reload` refetches without clearing data. */
export function useApi<T>(path: string | null): Async<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!!path);
  const [tick, setTick] = useState(0);
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    let alive = true;
    if (lastPath.current !== path) {
      setDataState(undefined);
      lastPath.current = path;
    }
    setLoading(true);
    api
      .get<T>(path)
      .then((d) => {
        if (!alive) return;
        setDataState(d);
        setError(null);
      })
      .catch((e) => alive && setError(errorText(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((fn: T | ((prev: T | undefined) => T)) => {
    setDataState((prev) => (typeof fn === 'function' ? (fn as (p: T | undefined) => T)(prev) : fn));
  }, []);
  return { data, error, loading, reload, setData };
}

// ---------- SSE with reconnect ----------

export interface SSEHandle {
  close: () => void;
}

/**
 * Opens an EventSource and keeps it alive. On any error it closes and reconnects with backoff,
 * calling `buildUrl` again so callers can pass `after=<lastEventId>`. Named `ping` events are
 * ignored because only unnamed messages reach `onmessage`.
 */
export function openSSE(
  buildUrl: () => string,
  onData: (data: unknown) => void,
  opts: { onOpen?: (reconnected: boolean) => void; onDown?: () => void } = {},
): SSEHandle {
  let es: EventSource | null = null;
  let closed = false;
  let retry = 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let opened = false;

  // The server pings every 20s. A proxy (vite dev, tailscale serve) can keep the socket open after
  // the server restarts, so EventSource never errors; treat silence as a dead connection.
  const beat = (src: EventSource) => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => src.onerror?.(new Event('error')), 50_000);
  };

  const connect = () => {
    if (closed || es) return;
    clearTimeout(timer);
    const src = new EventSource(buildUrl());
    es = src;
    beat(src);
    src.addEventListener('ping', () => beat(src));
    src.onopen = () => {
      retry = 1000;
      beat(src);
      opts.onOpen?.(opened);
      opened = true;
    };
    src.onmessage = (e) => {
      beat(src);
      if (!e.data) return;
      let d: unknown;
      try {
        d = JSON.parse(e.data);
      } catch {
        return;
      }
      onData(d);
    };
    src.onerror = () => {
      src.close();
      if (es !== src) return; // already replaced
      es = null;
      clearTimeout(watchdog);
      if (closed) return;
      opts.onDown?.();
      timer = setTimeout(connect, retry);
      retry = Math.min(retry * 2, 15_000);
    };
  };

  // Phones drop connections in the background; reconnect as soon as the tab is visible again.
  const onVisible = () => {
    if (document.visibilityState === 'visible' && !es && !closed) {
      retry = 1000;
      connect();
    }
  };
  document.addEventListener('visibilitychange', onVisible);
  connect();

  return {
    close() {
      closed = true;
      clearTimeout(timer);
      clearTimeout(watchdog);
      es?.close();
      es = null;
      document.removeEventListener('visibilitychange', onVisible);
    },
  };
}

export type StreamMessage =
  | { type: 'event'; event: EventRow }
  | { type: 'artifact'; artifact: Artifact }
  | { type: 'thread'; thread: Thread; pending?: PendingMsg[]; live?: boolean; blocked?: string };

function classifyStream(d: unknown): StreamMessage | null {
  if (!d || typeof d !== 'object') return null;
  const o = d as Record<string, unknown>;
  if (o.kind === 'artifact' && o.artifact) return { type: 'artifact', artifact: o.artifact as Artifact };
  if (o.kind === 'thread' && o.thread)
    return {
      type: 'thread', thread: o.thread as Thread, pending: o.pending as PendingMsg[] | undefined, live: typeof o.live === 'boolean' ? o.live : undefined,
      blocked: typeof o.blocked === 'string' ? o.blocked : undefined,
    };
  if (typeof o.id === 'number' && typeof o.payload === 'string') return { type: 'event', event: o as unknown as EventRow };
  return null;
}

/**
 * Live stream for one thread. `lastId` is read on every (re)connect so no events are missed or
 * duplicated; the caller still dedupes by id. Starts only when `ready` is true (after the
 * initial GET has populated lastId).
 */
export function useThreadStream(
  threadId: string,
  ready: boolean,
  lastId: RefObject<number>,
  onMessage: (m: StreamMessage) => void,
  onReconnect: () => void,
) {
  const handler = useRef(onMessage);
  const reconnect = useRef(onReconnect);
  handler.current = onMessage;
  reconnect.current = onReconnect;
  // True until a connection actually drops, so a slow first byte does not read as "reconnecting".
  const [live, setLive] = useState(true);

  useEffect(() => {
    if (!ready) return;
    const h = openSSE(
      () => `/api/threads/${encodeURIComponent(threadId)}/stream?after=${lastId.current ?? 0}`,
      (d) => {
        const m = classifyStream(d);
        if (m) handler.current(m);
      },
      {
        onOpen: (again) => {
          setLive(true);
          if (again) reconnect.current();
        },
        onDown: () => setLive(false),
      },
    );
    return () => h.close();
  }, [threadId, ready, lastId]);

  return live;
}

// ---------- model helpers ----------

export const MODELS = ['opus', 'sonnet', 'haiku', 'fable'] as const;

export function parsePayload<T = Record<string, unknown>>(e: EventRow): T {
  try {
    return JSON.parse(e.payload) as T;
  } catch {
    return {} as T;
  }
}
