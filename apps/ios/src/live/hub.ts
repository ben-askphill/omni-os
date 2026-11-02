import {
  apiPath,
  createHttpClient,
  createOmniApi,
  OmniHttpError,
  openFeed,
  openThreadLive,
  parseBaseUrl,
  ThreadHistory,
  type AnswerResult,
  type Artifact,
  type Channel,
  type ChannelWithRunning,
  type Fetch,
  type HarnessInfo,
  type HistoryEvent,
  type HttpClient,
  type NeedsYou,
  type OmniApi,
  type PendingMsg,
  type Recovered,
  type RawResponse,
  type SSEClient,
  type SSEState,
  type SSETransport,
  type Thread,
  type ThreadOpen,
  type UploadTransport,
} from '@omni/client-core';
import type { HandoffView, Takeover } from '@omni/shared/handoff.ts';
import { earlierCursor, type HistoryPage, type Span } from '@omni/shared/history.ts';
import type { Answer } from '@omni/shared/question.ts';
import type { OutputChunk } from '@omni/shared/tool-output.ts';

import { DEFAULT_MAX_MB } from '../attachments/model';
import { settleDraftContext } from '../context/draft';
import { latestUserRowId } from '../send/rules';
import { createCatalog, createSenders, newRequestId, type ThreadSender } from '../send/sender';
import { runNeedsAction, type NeedsAction } from '../needs/actions';
import { withoutResult } from '../needs/inbox';
import { coalesced } from './coalesce';
import { createActionsLive, type ActionsLive } from './actions';
import { createActivityLive, type ActivityState } from './activity';
import { createFolderCollapse, createPendingFolders } from './folders';
import { linkOf, type Link } from './connection';
import { createLibraryLive, type LibraryState } from './library';
import type { OmniSession } from './session';
import { createStore, type Store } from './store';

/** Feed messages that change the channel list's counts and rows. Usage and mod lines do not. */
const LIST_CHANGES = new Set(['thread', 'channel', 'tasks', 'folder']);
/** Feed messages that change what waits on Ben: a result arrived or was read, or a blocker came or went. */
const NEEDS_YOU = 'needs_you';
/** A burst of feed messages refetches the list once, this long after the last one. */
export const REFRESH_DEBOUNCE_MS = 300;

export interface ChannelsState {
  channels: readonly ChannelWithRunning[] | null;
  loading: boolean;
  /** The last refetch's failure. The channels it held stay on screen. */
  error: string | null;
  loadedAt: number | null;
}

export interface ThreadView {
  threadId: string;
  status: 'loading' | 'ready' | 'missing' | 'error';
  error: string | null;
  thread: Thread | null;
  channel: Channel | null;
  parent: Thread | null;
  children: Thread[];
  artifacts: Artifact[];
  pending: PendingMsg[];
  live: boolean;
  blocked: string | null;
  /** The handoff in flight on this thread, from either machine's side. Null when there is none. */
  handoff: HandoffView | null;
  /** Another machine holds the thread and this server could take it. Null when this one holds it. */
  takeover: Takeover | null;
  /** The loaded rows in order: the newest page, then any older pages Ben loaded. */
  rows: readonly HistoryEvent[];
  /** The spans of the loaded history. A row outside them only informs the fold and never shows. */
  spans: readonly Span[];
  hasOlder: boolean;
  loadingOlder: boolean;
  /** The thread's stream state. Null before it opens. */
  link: SSEState | null;
}

export interface NeedsYouState {
  /** Unread results and blockers across the server's threads. Null until the first load. */
  data: NeedsYou | null;
  /** The last load's failure. The inbox it held stays on screen. */
  error: string | null;
}

/** One open thread: its detail, its bounded history and its stream. Created by `LiveHub.openThread`. */
export interface ThreadLive {
  readonly view: Store<ThreadView>;
  /** Sends the answers to a question the agent asked. A 409 means it was answered already. */
  answerQuestion(questionId: string, answers: Answer[]): Promise<AnswerResult>;
  /** Runs a needs-you card's button. The thread and its pending list update from the server's answer. Throws when the call fails. */
  act(action: NeedsAction): Promise<void>;
  /** Tries the thread again after a failed open. A no-op while it is open or opening. */
  retry(): void;
  loadOlder(): Promise<void>;
  /** Replaces a clipped row with its whole payload. */
  loadFullRow(eventId: number): Promise<void>;
  loadOutput(eventId: number, offset: number): Promise<OutputChunk>;
  /** False while Ben reads older rows, so a new row does not trim what is on screen. */
  setFollowing(following: boolean): void;
  /** What the composer does for this thread: send, retry and stop. Each answer lands in `view`. */
  readonly send: ThreadSender;
  /** The harness catalog behind steer-or-queue. Null until it loads. */
  readonly catalog: Store<readonly HarnessInfo[] | null>;
  close(): void;
}

export interface LiveHub {
  readonly channels: Store<ChannelsState>;
  /** The header's link state, reduced from the feed and the open thread. */
  readonly link: Store<Link>;
  readonly needsYou: Store<NeedsYouState>;
  readonly activity: Store<ActivityState>;
  readonly library: Store<LibraryState>;
  refreshChannels(): Promise<void>;
  /** Runs one API call with the session's credentials, retried once after a 401. Rejects with 'Not paired' without a server. */
  request<T>(call: (api: OmniApi) => Promise<T>): Promise<T>;
  /** Puts a thread row the server just returned into the open thread's view and refetches the channel lists. */
  applyThread(thread: Thread): void;
  refreshNeedsYou(): Promise<void>;
  refreshActivity(): Promise<void>;
  /** Ben saw this result. The inbox drops it now and the server confirms. */
  markResultRead(uid: string): Promise<void>;
  refreshLibrary(): Promise<void>;
  /** The file's bytes, fetched with the token here and handed on as content. Nothing downstream holds the token. */
  fetchArtifactFile(artifact: Pick<Artifact, 'id' | 'updated_at'>, signal?: AbortSignal): Promise<RawResponse>;
  /** Puts the thread and handoff a handoff, takeover or cancel answer carried into the open thread's view, before the stream repeats them. */
  applyHandoff(thread: Thread, handoff: HandoffView | null): void;
  /** The most one file may weigh, in MB, as the server says. The default until it answers. Asked once. */
  uploadLimitMb(): Promise<number>;
  /** Where an uploaded file of a thread is read from, and the credentials that go with it. Null without a server. */
  fileSource(threadId: string, name: string, options?: { download?: boolean }): Promise<FileSource | null>;
  /** Opens or closes a folder for every client. Resolves to the failure's message, or null. */
  setFolderCollapsed(folderId: string, collapsed: boolean): Promise<string | null>;
  openThread(threadId: string): ThreadLive;
  openActions(threadId: string): ActionsLive;
  /** Pauses the streams while the app is in the background, and reconnects and refetches when it returns. */
  setForeground(active: boolean): void;
  /** Connects now instead of waiting out a backoff, as when the network comes back. */
  kick(): void;
  close(): void;
}

/** A request for a file: the address and the header that lets the server answer it. */
export interface FileSource {
  uri: string;
  headers: { Authorization: string };
}

export interface LiveHubOptions {
  session: OmniSession;
  transport: SSETransport;
  fetch?: Fetch;
  /** Sends multipart requests. Defaults to `fetch`, which cannot report progress. */
  upload?: UploadTransport;
  now?: () => number;
}

export function createLiveHub(options: LiveHubOptions): LiveHub {
  const { session, transport } = options;
  const now = options.now ?? Date.now;
  const baseUrl = session.serverUrl ? parseBaseUrl(session.serverUrl) : null;
  const paired = baseUrl !== null;
  const http: HttpClient | null = baseUrl ? createHttpClient({ baseUrl, token: () => session.token(), fetch: options.fetch, upload: options.upload }) : null;
  const api: OmniApi | null = http ? createOmniApi(http) : null;

  const channels = createStore<ChannelsState>({ channels: null, loading: false, error: null, loadedAt: null });
  const link = createStore<Link>(linkOf({ paired, foreground: true, feed: null, thread: null }));
  const openThreads = new Set<ThreadLiveImpl>();
  const openActions = new Set<ActionsLive>();
  let activeThread: ThreadLiveImpl | null = null;
  let foreground = true;
  let feed: SSEClient | null = null;
  let feedState: SSEState | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  function recomputeLink() {
    link.set(linkOf({ paired, foreground, feed: feedState, thread: activeThread?.view.get().link ?? null }));
  }

  /** Runs a request, and on a 401 asks the session for fresh credentials and runs it once more. */
  async function withAuth<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (isUnauthorized(e) && (await session.refreshAuth())) return run();
      throw e;
    }
  }

  const activity = createActivityLive({ api, withAuth, now });
  const library = createLibraryLive({ api, withAuth, now });

  function requireApi(): OmniApi {
    if (!api) throw new Error('Not paired');
    return api;
  }

  const catalog = createCatalog(() => withAuth(() => requireApi().harnesses()));
  const senders = createSenders({
    api: requireApi,
    run: withAuth,
    catalog: catalog.store.get,
    newId: newRequestId,
    landed: (threadId, item) => settleDraftContext(threadId, item.context.map((c) => c.id)),
  });

  let uploadLimit: Promise<number> | null = null;
  function uploadLimitMb(): Promise<number> {
    if (!api) return Promise.resolve(DEFAULT_MAX_MB);
    // Activity reads the same status when it loads, so a server that has answered once is not asked again.
    const known = activity.state.get().maxUploadMb;
    if (known !== null && known > 0) return Promise.resolve(known);
    uploadLimit ??= withAuth(() => requireApi().status()).then(
      (status) => (typeof status.maxUploadMb === 'number' && status.maxUploadMb > 0 ? status.maxUploadMb : DEFAULT_MAX_MB),
      () => {
        // Not cached: the next ask tries again. The server checks the size either way.
        uploadLimit = null;
        return DEFAULT_MAX_MB;
      },
    );
    return uploadLimit;
  }

  async function fileSource(threadId: string, name: string, opts?: { download?: boolean }): Promise<FileSource | null> {
    if (!http) return null;
    const token = await session.token();
    if (!token) return null;
    const uri = http.url(apiPath`/threads/${threadId}/uploads/${name}`, opts?.download ? { download: '1' } : undefined);
    return { uri, headers: { Authorization: `Bearer ${token}` } };
  }

  function requireHttp(): HttpClient {
    if (!http) throw new Error('Not paired');
    return http;
  }

  const pendingFolders = createPendingFolders();

  // One refetch at a time. A call that arrives meanwhile asks for one more pass, so the last state wins.
  let refreshing: Promise<void> | null = null;
  let refreshAgain = false;
  function refreshChannels(): Promise<void> {
    if (!api) return Promise.resolve();
    if (refreshing) {
      refreshAgain = true;
      return refreshing;
    }
    channels.set((s) => ({ ...s, loading: true }));
    refreshing = (async () => {
      do {
        refreshAgain = false;
        try {
          const list = await withAuth(() => requireApi().channels());
          channels.set({ channels: pendingFolders.apply(list), loading: false, error: null, loadedAt: now() });
        } catch (e) {
          channels.set((s) => ({ ...s, loading: false, error: messageOf(e) }));
        }
      } while (refreshAgain);
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  const needsYou = createStore<NeedsYouState>({ data: null, error: null });
  let readsMarked = 0;
  const refreshNeedsYou = coalesced(async () => {
    if (!api) return;
    const readsAtStart = readsMarked;
    try {
      const data = await withAuth(() => requireApi().needsYou());
      if (readsAtStart === readsMarked) needsYou.set({ data, error: null });
    } catch (e) {
      needsYou.set((s) => ({ ...s, error: messageOf(e) }));
    }
  });

  async function markResultRead(uid: string): Promise<void> {
    readsMarked += 1;
    needsYou.set((s) => (s.data ? { ...s, data: withoutResult(s.data, uid) } : s));
    await withAuth(() => requireApi().markResultRead(uid)).catch(refreshInstead);
    await refreshNeedsYou();
  }
  const setFolderCollapsed = createFolderCollapse({ api, withAuth, channels, refresh: refreshChannels, pending: pendingFolders });

  function scheduleRefresh() {
    if (refreshTimer !== null) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void refreshChannels();
    }, REFRESH_DEBOUNCE_MS);
  }

  function startFeed(client: HttpClient) {
    feed = openFeed({
      url: client.url(apiPath`/feed`),
      token: () => session.token(),
      transport,
      refreshAuth: () => session.refreshAuth(),
      onMessage: (message) => {
        if (isListChange(message)) scheduleRefresh();
        if (isNeedsYouChange(message)) void refreshNeedsYou();
        activity.applyFeed(message);
        library.applyFeed(message);
      },
      // The feed keeps no replay, so every reconnect refetches the list. The open thread catches up through its own stream.
      onReconnect: () => {
        void refreshChannels();
        void refreshNeedsYou();
        void activity.refresh();
        void library.refresh();
      },
      onState: (state) => {
        feedState = state;
        recomputeLink();
      },
    });
  }

  class ThreadLiveImpl implements ThreadLive {
    readonly view: Store<ThreadView>;
    readonly send: ThreadSender;
    readonly catalog = catalog.store;
    private history: ThreadHistory<HistoryEvent> | null = null;
    private stream: SSEClient | null = null;
    private following = true;
    private opening: Promise<void> | null = null;
    private closed = false;
    private readonly unwatch: () => void;

    constructor(private readonly threadId: string) {
      this.send = this.applying(senders.for(threadId));
      this.view = createStore<ThreadView>({
        threadId,
        status: 'loading',
        error: null,
        thread: null,
        channel: null,
        parent: null,
        children: [],
        artifacts: [],
        pending: [],
        live: false,
        blocked: null,
        handoff: null,
        takeover: null,
        rows: [],
        spans: [],
        hasOlder: false,
        loadingOlder: false,
        link: null,
      });
      // What the stream shows decides whether a message this phone is still sending has already landed.
      this.unwatch = this.view.subscribe(() => {
        const { pending, rows } = this.view.get();
        this.send.observe({ pending, userRowId: latestUserRowId(rows) });
      });
    }

    private patch(next: Partial<ThreadView>) {
      this.view.set((v) => ({ ...v, ...next }));
    }

    /** The sender, with what each answer says about the thread put on screen before the stream repeats it. */
    private applying(sender: ThreadSender): ThreadSender {
      const thread = (t: Thread | null) => {
        if (t && !this.closed) this.patch({ thread: t });
        return t;
      };
      return {
        state: sender.state,
        submit: async (t, text, files, context) => thread(await sender.submit(t, text, files, context)),
        retry: async () => thread(await sender.retry()),
        edit: () => sender.edit(),
        cancelUpload: () => sender.cancelUpload(),
        observe: (sight) => sender.observe(sight),
        stop: async () => thread(await sender.stop()),
      };
    }

    start(): Promise<void> {
      if (this.closed) return Promise.resolve();
      if (this.opening) return this.opening;
      if (!api) {
        this.patch({ status: 'error', error: 'Not paired' });
        return Promise.resolve();
      }
      this.patch({ error: null, status: this.view.get().thread ? 'ready' : 'loading' });
      void catalog.ensure();
      this.opening = this.open().finally(() => {
        this.opening = null;
      });
      return this.opening;
    }

    private async open(): Promise<void> {
      const id = this.threadId;
      try {
        const live = await openThreadLive<HistoryEvent, ThreadOpen>({
          load: () => withAuth(() => requireApi().thread(id)),
          streamUrl: (after) => requireHttp().url(apiPath`/threads/${id}/stream`, { after }),
          token: () => session.token(),
          transport,
          refreshAuth: () => session.refreshAuth(),
          onDetail: (detail) => this.applyDetail(detail),
          onHistory: (history) => {
            this.history = history as ThreadHistory<HistoryEvent>;
            this.publishRows();
          },
          onOther: (message) => this.applyOther(message),
          onState: (state) => {
            this.patch({ link: state });
            if (activeThread === this) recomputeLink();
          },
          follows: () => this.following,
        });
        this.stream = live.stream;
        if (this.closed) live.stream.close();
      } catch (e) {
        if (this.closed) return;
        if (isStatus(e, 404)) this.patch({ status: 'missing', error: null });
        else this.patch({ status: 'error', error: messageOf(e) });
      }
    }

    private applyDetail(detail: Partial<ThreadOpen>) {
      const prev = this.view.get();
      this.patch({
        status: 'ready',
        error: null,
        thread: detail.thread ?? prev.thread,
        channel: detail.channel ?? null,
        parent: detail.parent ?? null,
        children: detail.children ?? prev.children,
        artifacts: detail.artifacts ?? prev.artifacts,
        pending: detail.pending ?? [],
        live: detail.live ?? false,
        blocked: detail.blocked ?? null,
        handoff: detail.handoff ?? null,
        takeover: detail.takeover ?? null,
      });
    }

    /** A status change arrives as a `thread` message on the stream, not as rows. */
    private applyOther(message: unknown) {
      if (!isRecord(message) || message.kind !== 'thread' || !isRecord(message.thread)) return;
      this.patch({
        status: 'ready',
        thread: message.thread as unknown as Thread,
        pending: Array.isArray(message.pending) ? (message.pending as PendingMsg[]) : [],
        live: message.live === true,
        blocked: typeof message.blocked === 'string' ? message.blocked : null,
        handoff: isRecord(message.handoff) ? (message.handoff as unknown as HandoffView) : null,
        takeover: isRecord(message.takeover) ? (message.takeover as unknown as Takeover) : null,
      });
    }

    async answerQuestion(questionId: string, answers: Answer[]): Promise<AnswerResult> {
      try {
        return await withAuth(() => requireApi().answerQuestion(this.threadId, questionId, answers));
      } finally {
        void refreshNeedsYou();
      }
    }

    async act(action: NeedsAction): Promise<void> {
      const recovered = await withAuth(() => runNeedsAction(requireApi(), this.threadId, action));
      if (!this.closed) this.patch({ thread: recovered.thread, pending: recovered.pending });
      void refreshNeedsYou();
    }

    private publishRows() {
      if (!this.history) return;
      const h = this.history.history;
      this.patch({ rows: h.rows, spans: h.spans, hasOlder: earlierCursor(h) !== null });
    }

    async loadOlder(): Promise<void> {
      if (!this.history || this.view.get().loadingOlder) return;
      const cursor = earlierCursor(this.history.history);
      if (!cursor) return;
      const id = this.threadId;
      this.patch({ loadingOlder: true });
      try {
        await this.history.page(cursor, (query) =>
          withAuth(() => requireHttp().request<HistoryPage<HistoryEvent>>('GET', apiPath`/threads/${id}/history`, { query })),
        );
        this.publishRows();
      } catch (e) {
        this.patch({ error: messageOf(e) });
      } finally {
        this.patch({ loadingOlder: false });
      }
    }

    async loadFullRow(eventId: number): Promise<void> {
      if (!this.history) return;
      const id = this.threadId;
      await this.history.fullRow(eventId, (rowId) => withAuth(() => requireApi().event(id, rowId)));
      this.publishRows();
    }

    loadOutput(eventId: number, offset: number): Promise<OutputChunk> {
      const id = this.threadId;
      return withAuth(() => requireHttp().request<OutputChunk>('GET', apiPath`/threads/${id}/events/${eventId}/output`, { query: { offset } }));
    }

    setFollowing(following: boolean) {
      this.following = following;
    }

    applyThread(thread: Thread) {
      if (thread.id === this.threadId) this.patch({ thread });
    }

    applyHandoff(thread: Thread, handoff: HandoffView | null) {
      if (thread.id === this.threadId) this.patch({ thread, handoff, takeover: null });
    }

    pause() {
      this.stream?.pause();
    }

    resume() {
      if (this.stream) this.stream.resume();
      else if (this.view.get().status === 'error') void this.start();
    }

    retry() {
      void this.start();
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      this.unwatch();
      this.stream?.close();
      this.stream = null;
      openThreads.delete(this);
      if (activeThread === this) {
        activeThread = null;
        recomputeLink();
      }
    }
  }

  if (http) {
    startFeed(http);
    void refreshChannels();
    void refreshNeedsYou();
    void activity.refresh();
    void library.refresh();
  }
  recomputeLink();

  return {
    channels,
    link,
    needsYou,
    activity: activity.state,
    library: library.state,
    refreshChannels,
    request: (call) => withAuth(() => call(requireApi())),
    uploadLimitMb,
    fileSource,
    applyThread(thread) {
      for (const t of openThreads) t.applyThread(thread);
      void refreshChannels();
    },
    refreshNeedsYou,
    markResultRead,
    refreshActivity: activity.refresh,
    refreshLibrary: library.refresh,
    fetchArtifactFile: (artifact, signal) => withAuth(() => requireApi().artifactFile(artifact, signal)),
    applyHandoff(thread, handoff) {
      for (const t of openThreads) t.applyHandoff(thread, handoff);
      void refreshChannels();
    },
    setFolderCollapsed,
    openActions(threadId) {
      const actions = createActionsLive({ api, withAuth, threadId });
      if (!foreground) actions.pause();
      const close = actions.close;
      openActions.add(actions);
      return {
        ...actions,
        close() {
          openActions.delete(actions);
          close();
        },
      };
    },
    openThread(threadId) {
      const thread = new ThreadLiveImpl(threadId);
      openThreads.add(thread);
      activeThread = thread;
      recomputeLink();
      void thread.start();
      return thread;
    },
    setForeground(active) {
      foreground = active;
      if (!active) {
        feed?.pause();
        for (const t of openThreads) t.pause();
        for (const a of openActions) a.pause();
      } else {
        feed?.resume();
        for (const t of openThreads) t.resume();
        for (const a of openActions) a.resume();
        void refreshChannels();
        void refreshNeedsYou();
        void activity.refresh();
        void library.refresh();
      }
      recomputeLink();
    },
    kick() {
      if (!foreground) return;
      feed?.resume();
      for (const t of openThreads) t.resume();
    },
    close() {
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      refreshTimer = null;
      library.close();
      feed?.close();
      feed = null;
      for (const t of [...openThreads]) t.close();
      for (const a of [...openActions]) a.close();
      openActions.clear();
    },
  };
}

const refreshInstead = (): void => undefined;

function isUnauthorized(e: unknown): boolean {
  return isStatus(e, 401);
}

function isStatus(e: unknown, status: number): boolean {
  return e instanceof OmniHttpError && e.failure.kind === 'http' && e.failure.status === status;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isListChange(message: unknown): boolean {
  return isRecord(message) && typeof message.type === 'string' && LIST_CHANGES.has(message.type);
}

/** What can change the inbox: the server says so, or a thread changed, which is how a result lands or a blocker clears. */
function isNeedsYouChange(message: unknown): boolean {
  if (!isRecord(message)) return false;
  if (message.type === NEEDS_YOU) return true;
  return message.type === 'thread' && isRecord(message.thread) && typeof message.thread.id === 'string';
}

function messageOf(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return 'Something went wrong';
}
