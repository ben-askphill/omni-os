import type { HarnessInfo, OmniApi, PendingMsg, Thread } from '@omni/client-core';

import type { MessageContext } from '@omni/shared/message-context.ts';

import { toUploadFiles, type Staged } from '../attachments/model';
import { createStore, type Store } from '../live/store';
import { beginSend, classifyFailure, EMPTY_OUTBOX, failSend, retrySend, settleSend, takeFailed, type Outbox, type OutboxItem } from './outbox';
import { sendModeFor } from './rules';

export interface SendState {
  outbox: Outbox;
  stopping: boolean;
  /** Why the last Stop failed. The next action clears it. */
  notice: string | null;
  /** How much of the files in the slot has gone out, 0 to 1. Null when none are going or the platform cannot say. */
  progress: number | null;
}

export const IDLE_SEND: SendState = { outbox: EMPTY_OUTBOX, stopping: false, notice: null, progress: null };

export interface SenderDeps {
  threadId: string;
  api(): OmniApi;
  /** Runs a request and, on a 401, once more after the session refreshed its credentials. */
  run<T>(call: () => Promise<T>): Promise<T>;
  /** The harness catalog as far as it has loaded. Null falls back to the harness's name. */
  catalog(): readonly HarnessInfo[] | null;
  newId(): string;
  /** A message left the slot because the server has it. */
  landed?(threadId: string, item: OutboxItem): void;
}

/** What the stream has shown of the thread, as far as it says whether a send landed. */
export interface FeedSight {
  pending: readonly PendingMsg[];
  /** The newest user row on the stream. A new one means a message was just read, and it may be this phone's. */
  userRowId: number | null;
}

/** What a thread's composer does, as one store the screen reads and a handful of calls the screen makes. */
export interface ThreadSender {
  readonly state: Store<SendState>;
  /** Sends `text`, `files` and `context` to `thread`, in the mode its status and harness call for. Resolves with the thread the server answered with, or null when nothing was sent or it failed (the outbox says which). */
  submit(thread: Thread, text: string, files?: readonly Staged[], context?: readonly MessageContext[]): Promise<Thread | null>;
  /** Sends the failed message again under its own request id, with the same files and context. */
  retry(): Promise<Thread | null>;
  /** Takes the failed message out of the outbox and returns its text and files. */
  edit(): { text: string; files: readonly Staged[] } | null;
  /** Stops the files going out. The message stays in the outbox as failed, to retry or edit. */
  cancelUpload(): void;
  stop(): Promise<Thread | null>;
  /**
   * Drops the message in the slot once the server turns out to have it, so it never shows twice: in the transcript and
   * here. A pending row carries the request id. A user row does not, so each new one is checked against the server's
   * list of accepted requests. Fed by the stream, and needs no reply.
   */
  observe(sight: FeedSight): void;
}

export function createSender(deps: SenderDeps): ThreadSender {
  const state = createStore<SendState>(IDLE_SEND);
  const patch = (next: Partial<SendState>) => state.set((s) => ({ ...s, ...next }));
  const outbox = (fn: (o: Outbox) => Outbox) => state.set((s) => ({ ...s, outbox: fn(s.outbox) }));
  const settle = (item: OutboxItem) => {
    const before = state.get().outbox.item;
    outbox((o) => settleSend(o, item.requestId));
    if (before?.requestId === item.requestId) deps.landed?.(deps.threadId, item);
  };

  let uploading: AbortController | null = null;

  async function transmit(item: OutboxItem): Promise<Thread | null> {
    const body = { prompt: item.text, mode: item.mode, request_id: item.requestId, context: item.context.length ? item.context : undefined };
    const controller = item.files.length ? new AbortController() : null;
    uploading = controller;
    let shown = -1;
    const withFiles = controller && {
      files: toUploadFiles(item.files),
      signal: controller.signal,
      onProgress: ({ sent, total }: { sent: number; total: number }) => {
        // A whole percent at a time: the stream of events is faster than the screen needs.
        const percent = total > 0 ? Math.min(100, Math.floor((sent / total) * 100)) : 0;
        if (percent === shown) return;
        shown = percent;
        patch({ progress: percent / 100 });
      },
    };
    try {
      const posted = await deps.run(() => deps.api().sendMessage(deps.threadId, body, withFiles ?? undefined));
      settle(item);
      return posted;
    } catch (e) {
      outbox((o) => failSend(o, item.requestId, classifyFailure(e)));
      return null;
    } finally {
      // A newer send may own the slot by now, so only the one that is still current resets the bar.
      if (uploading === controller) {
        uploading = null;
        patch({ progress: null });
      }
    }
  }

  let latest: FeedSight = { pending: [], userRowId: null };
  let checking = false;
  let checked: { requestId: string; rowId: number | null } | null = null;

  async function settleIfLanded(sight: FeedSight): Promise<void> {
    const item = state.get().outbox.item;
    // A refused send never reached the server, so nothing on the stream can be it.
    if (!item || (item.phase === 'failed' && !item.failure.ambiguous)) return;
    const landed = () => settle(item);
    if (sight.pending.some((m) => m.request_id === item.requestId)) return landed();
    if (sight.userRowId === null || checking) return;
    if (checked?.requestId === item.requestId && checked.rowId === sight.userRowId) return;
    checking = true;
    try {
      const accepted = await deps.run(() => deps.api().requests(deps.threadId));
      checked = { requestId: item.requestId, rowId: sight.userRowId };
      if (accepted.some((r) => r.request_id === item.requestId)) landed();
    } catch {
      // The next user row asks again.
    } finally {
      checking = false;
    }
    // A row that arrived during the check has not been asked about.
    if (latest !== sight) void settleIfLanded(latest);
  }

  return {
    state,
    observe(sight) {
      latest = sight;
      void settleIfLanded(sight);
    },
    async submit(thread, text, files = [], context = []) {
      const next = beginSend(state.get().outbox, text, sendModeFor(thread, deps.catalog()), deps.newId, files, context);
      if (!next?.item) return null;
      patch({ outbox: next, notice: null });
      return transmit(next.item);
    },
    async retry() {
      const next = retrySend(state.get().outbox);
      if (!next?.item) return null;
      patch({ outbox: next, notice: null });
      return transmit(next.item);
    },
    edit() {
      const taken = takeFailed(state.get().outbox);
      if (!taken) return null;
      patch({ outbox: taken.outbox });
      return { text: taken.text, files: taken.files };
    },
    cancelUpload() {
      uploading?.abort();
    },
    async stop() {
      if (state.get().stopping) return null;
      patch({ stopping: true, notice: null });
      try {
        return await deps.run(() => deps.api().stop(deps.threadId));
      } catch (e) {
        patch({ notice: classifyFailure(e).message });
        return null;
      } finally {
        patch({ stopping: false });
      }
    },
  };
}

/** The harness catalog, loaded once and kept. A failed load leaves it null, and sends fall back to each harness's usual behavior. */
export function createCatalog(load: () => Promise<readonly HarnessInfo[]>) {
  const store = createStore<readonly HarnessInfo[] | null>(null);
  let loading: Promise<void> | null = null;
  return {
    store,
    /** Loads it unless it is loaded or loading. Never rejects. */
    ensure(): Promise<void> {
      if (store.get() || loading) return loading ?? Promise.resolve();
      loading = load().then(
        (list) => store.set(list),
        () => undefined,
      ).finally(() => {
        loading = null;
      });
      return loading;
    },
  };
}

export function createSenders(deps: Omit<SenderDeps, 'threadId'>) {
  const senders = new Map<string, ThreadSender>();
  return {
    /** One sender per thread for the life of the hub, so a message that failed is still there when Ben comes back to the thread. */
    for(threadId: string): ThreadSender {
      let sender = senders.get(threadId);
      if (!sender) {
        sender = createSender({ ...deps, threadId });
        senders.set(threadId, sender);
      }
      return sender;
    },
  };
}

export function newRequestId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}
