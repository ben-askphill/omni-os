import type { Artifact, Channel, HistoryEvent, PendingMsg, SSEState, Thread, ThreadOpen } from '@omni/client-core';
import type { HandoffView, Takeover } from '@omni/shared/handoff.ts';
import type { Span } from '@omni/shared/history.ts';
import { withOpening, type Opening } from '@omni/shared/opening.ts';

export interface ThreadView {
  threadId: string;
  status: 'loading' | 'ready' | 'missing' | 'error';
  error: string | null;
  thread: Thread | null;
  channel: Channel | null;
  parent: Thread | null;
  children: Thread[];
  artifacts: Artifact[];
  /** The messages the agent has not read yet, less the one drawn as the turn's opening message. */
  pending: PendingMsg[];
  live: boolean;
  blocked: string | null;
  /** The handoff in flight on this thread, from either machine's side. Null when there is none. */
  handoff: HandoffView | null;
  /** Another machine holds the thread and this server could take it. Null when this one holds it. */
  takeover: Takeover | null;
  /** The thread's first message until its transcript has it (packages/shared/opening.ts). */
  opening: Opening | null;
  /** The loaded rows in order, with the running turn's opening message joined in: the newest page, then any older pages Ben loaded. */
  rows: readonly HistoryEvent[];
  /** What the server sent, before the opening message is joined in. What decides whether a send landed reads these. */
  held: { rows: readonly HistoryEvent[]; pending: PendingMsg[] };
  /** The spans of the loaded history. A row outside them only informs the fold and never shows. */
  spans: readonly Span[];
  hasOlder: boolean;
  loadingOlder: boolean;
  /** The thread's stream state. Null before it opens. */
  link: SSEState | null;
}

/** GET /threads/:id and the stream's `sync`, with the opening message the server sends beside them. */
export type ThreadDetail = ThreadOpen & { opening?: Opening | null };

/** A change to the view. `rows` and `pending` are the server's: the opening message is joined in after. */
export type ThreadChanges = Partial<Omit<ThreadView, 'threadId' | 'rows' | 'pending' | 'held'>> & {
  rows?: readonly HistoryEvent[];
  pending?: PendingMsg[];
};

const NONE = { rows: [], pending: [] };

export function emptyThreadView(threadId: string): ThreadView {
  return {
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
    opening: null,
    rows: [],
    held: NONE,
    spans: [],
    hasOlder: false,
    loadingOlder: false,
    link: null,
  };
}

/** The view with `changes` applied and the opening message joined in again when anything it reads moved. */
export function withChanges(view: ThreadView, changes: ThreadChanges): ThreadView {
  const { rows, pending, ...rest } = changes;
  const held = rows === undefined && pending === undefined ? view.held : { rows: rows ?? view.held.rows, pending: pending ?? view.held.pending };
  return joined(view, { ...view, ...rest, held });
}

/** The thread's state from a detail: the first load's, or a stream sync's. */
export function withDetail(view: ThreadView, detail: Partial<ThreadDetail>): ThreadView {
  return withChanges(view, {
    status: 'ready',
    error: null,
    thread: detail.thread ?? view.thread,
    channel: detail.channel ?? null,
    parent: detail.parent ?? null,
    children: detail.children ?? view.children,
    artifacts: detail.artifacts ?? view.artifacts,
    pending: detail.pending ?? [],
    opening: detail.opening ?? null,
    live: detail.live ?? false,
    blocked: detail.blocked ?? null,
    handoff: detail.handoff ?? null,
    takeover: detail.takeover ?? null,
  });
}

/**
 * The next view after one message from the thread's stream or the feed. Returns `view` itself when the message
 * changes nothing here.
 *
 * - `{ kind: 'thread' }` from the stream, for this thread: its row, pending list, opening message, warm process,
 *   blocker, handoff and takeover. The feed's `{ type: 'thread' }` for this thread is left to the stream, which
 *   repeats it with all of those.
 * - A `thread` message (either shape) for a thread this one delegated to: upserted into `children` by id, so its
 *   delegation row follows it and one created after the thread was opened appears.
 * - A `thread` message for this thread's parent: replaces `parent`.
 * - `{ kind: 'artifact' }`: upserted into `artifacts` by id.
 */
export function reduceThread(view: ThreadView, message: unknown): ThreadView {
  if (!isRecord(message)) return view;
  if (message.kind === 'artifact') return isArtifact(message.artifact, view.threadId) ? withArtifact(view, message.artifact) : view;

  const fromStream = message.kind === 'thread';
  if (!fromStream && message.type !== 'thread') return view;
  const thread = message.thread;
  if (!isRecord(thread) || typeof thread.id !== 'string') return view;
  const t = thread as unknown as Thread;

  if (t.id === view.threadId) return fromStream ? withOwnThread(view, t, message) : view;
  let next = view;
  if (t.parent_id === view.threadId) next = { ...next, children: upsert(next.children, t) };
  if (next.parent && next.parent.id === t.id) next = { ...next, parent: t };
  return next;
}

function withOwnThread(view: ThreadView, thread: Thread, m: Record<string, unknown>): ThreadView {
  return withChanges(view, {
    status: 'ready',
    thread,
    pending: Array.isArray(m.pending) ? (m.pending as PendingMsg[]) : [],
    // Left out: the server did not say, so the opening message held stays.
    ...(m.opening !== undefined && { opening: isRecord(m.opening) && typeof m.opening.text === 'string' ? (m.opening as unknown as Opening) : null }),
    live: m.live === true,
    blocked: typeof m.blocked === 'string' ? m.blocked : null,
    handoff: isRecord(m.handoff) ? (m.handoff as unknown as HandoffView) : null,
    takeover: isRecord(m.takeover) ? (m.takeover as unknown as Takeover) : null,
  });
}

function withArtifact(view: ThreadView, artifact: Artifact): ThreadView {
  return { ...view, artifacts: upsert(view.artifacts, artifact) };
}

/** Replaces the item with the same id where it sits, or adds it last. */
function upsert<T extends { id: string | number }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i < 0) return [...list, item];
  const next = list.slice();
  next[i] = item;
  return next;
}

/** Joins the opening message into the rows and out of the pending list, unless nothing it reads changed. */
function joined(prev: ThreadView, next: ThreadView): ThreadView {
  if (next.held === prev.held && next.opening === prev.opening && next.thread === prev.thread) return next;
  const { rows, pending } = next.held;
  if (!next.thread) return { ...next, rows, pending };
  const shown = withOpening(rows as HistoryEvent[], pending, next.opening, next.thread);
  return { ...next, rows: shown.events, pending: shown.pending };
}

function isArtifact(v: unknown, threadId: string): v is Artifact {
  return isRecord(v) && typeof v.id === 'number' && (v.thread_id === undefined || v.thread_id === threadId);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
