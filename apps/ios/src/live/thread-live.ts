import {
  apiPath,
  OmniHttpError,
  openThreadLive,
  ThreadHistory,
  type AnswerResult,
  type HarnessInfo,
  type HistoryEvent,
  type HttpClient,
  type OmniApi,
  type PendingMsg,
  type SSEClient,
  type SSETransport,
  type Thread,
  type ThreadOpen,
} from '@omni/client-core';
import type { HandoffView, Takeover } from '@omni/shared/handoff.ts';
import { earlierCursor, type HistoryPage } from '@omni/shared/history.ts';
import type { Answer } from '@omni/shared/question.ts';
import type { OutputChunk } from '@omni/shared/tool-output.ts';

import { latestUserRowId } from '../send/rules';
import type { ThreadSender } from '../send/sender';
import { runNeedsAction, type NeedsAction } from '../needs/actions';
import { createStore, type Store } from './store';
import type { OmniSession } from './session';
import type { ThreadLive, ThreadView } from './hub';

export function isStatus(e: unknown, status: number): boolean {
  return e instanceof OmniHttpError && e.failure.kind === 'http' && e.failure.status === status;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function messageOf(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return 'Something went wrong';
}

/** What one open thread needs from the hub. The hub keeps which thread is on screen. */
export interface ThreadLiveEnv {
  api: OmniApi | null;
  withAuth: <T>(run: () => Promise<T>) => Promise<T>;
  requireApi: () => OmniApi;
  requireHttp: () => HttpClient;
  session: OmniSession;
  transport: SSETransport;
  catalog: { store: Store<readonly HarnessInfo[] | null>; ensure: () => Promise<void> };
  senders: { for: (threadId: string) => ThreadSender };
  refreshNeedsYou: () => Promise<void> | void;
  recomputeLink: () => void;
  /** The open thread's stream changed. The hub folds that into the header when this thread is the one on screen. */
  onStreamState: (thread: ThreadLiveHandle) => void;
  /** The thread closed. The hub drops it, and clears the header when it was the one on screen. */
  forget: (thread: ThreadLiveHandle) => void;
}

/** `ThreadLive`, plus what the hub calls while the thread stays open. */
export interface ThreadLiveHandle extends ThreadLive {
  start(): Promise<void>;
  pause(): void;
  resume(): void;
  applyThread(thread: Thread): void;
  applyHandoff(thread: Thread, handoff: HandoffView | null): void;
}

export function createThreadLive(env: ThreadLiveEnv, threadId: string): ThreadLiveHandle {
  return new ThreadLiveImpl(env, threadId);
}

class ThreadLiveImpl implements ThreadLiveHandle {
  readonly view: Store<ThreadView>;
  readonly send: ThreadSender;
  readonly catalog: Store<readonly HarnessInfo[] | null>;
  private history: ThreadHistory<HistoryEvent> | null = null;
  private stream: SSEClient | null = null;
  private following = true;
  private opening: Promise<void> | null = null;
  private closed = false;
  private readonly unwatch: () => void;

  constructor(
    private readonly env: ThreadLiveEnv,
    private readonly threadId: string,
  ) {
    this.catalog = env.catalog.store;
    this.send = this.applying(env.senders.for(threadId));
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
    if (!this.env.api) {
      this.patch({ status: 'error', error: 'Not paired' });
      return Promise.resolve();
    }
    this.patch({ error: null, status: this.view.get().thread ? 'ready' : 'loading' });
    void this.env.catalog.ensure();
    this.opening = this.open().finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  private async open(): Promise<void> {
    const id = this.threadId;
    const { env } = this;
    try {
      const live = await openThreadLive<HistoryEvent, ThreadOpen>({
        load: () => env.withAuth(() => env.requireApi().thread(id)),
        streamUrl: (after) => env.requireHttp().url(apiPath`/threads/${id}/stream`, { after }),
        token: () => env.session.token(),
        transport: env.transport,
        refreshAuth: () => env.session.refreshAuth(),
        onDetail: (detail) => this.applyDetail(detail),
        onHistory: (history) => {
          this.history = history as ThreadHistory<HistoryEvent>;
          this.publishRows();
        },
        onOther: (message) => this.applyOther(message),
        onState: (state) => {
          this.patch({ link: state });
          env.onStreamState(this);
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
      return await this.env.withAuth(() => this.env.requireApi().answerQuestion(this.threadId, questionId, answers));
    } finally {
      void this.env.refreshNeedsYou();
    }
  }

  async act(action: NeedsAction): Promise<void> {
    const recovered = await this.env.withAuth(() => runNeedsAction(this.env.requireApi(), this.threadId, action));
    if (!this.closed) this.patch({ thread: recovered.thread, pending: recovered.pending });
    void this.env.refreshNeedsYou();
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
        this.env.withAuth(() => this.env.requireHttp().request<HistoryPage<HistoryEvent>>('GET', apiPath`/threads/${id}/history`, { query })),
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
    await this.history.fullRow(eventId, (rowId) => this.env.withAuth(() => this.env.requireApi().event(id, rowId)));
    this.publishRows();
  }

  loadOutput(eventId: number, offset: number): Promise<OutputChunk> {
    const id = this.threadId;
    return this.env.withAuth(() => this.env.requireHttp().request<OutputChunk>('GET', apiPath`/threads/${id}/events/${eventId}/output`, { query: { offset } }));
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
    this.env.forget(this);
  }
}
