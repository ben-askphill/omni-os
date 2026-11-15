// The thread tree: a job's delegated threads, team members and their own threads below them, nested under the job's
// row in the sidebar, the Inbox and the phone's Activity tab. The rules live here, pure, so every view reads them the
// same way (packages/shared/tests/thread-tree.test.ts): which state each thread shows, which rows a closed tree still
// shows, when a tree opens and closes by itself, and when marking the job done needs a second look.
import { isWorking } from './delegate-count.ts';
import { threadGlyph, type Glyph } from './status.ts';

/** The parts of a thread the tree reads, as the channel listing's stubs carry them. */
export interface TreeThread {
  id: string;
  channel_id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at?: string;
  done_at?: string | null;
  delegating?: boolean;
  limit_state?: string | null;
  harness?: string;
  model?: string | null;
}

/** A parent and the threads directly under it: the channel listing's `handoffs` (Conductor jobs) and `teams` (leads). */
export interface TreeGroup<T extends TreeThread = TreeThread> {
  parent: { id: string };
  children: readonly T[];
}

/**
 * What Needs you says about the threads under a job. `needs`: one asked and waits on Ben (a question, or its own
 * blocker). `failed`: its newest result failed and Ben has not seen it. Read off the blockers' `from` and the items.
 */
export interface TreeFlags {
  needs: ReadonlySet<string>;
  failed: ReadonlySet<string>;
}

export const NO_FLAGS: TreeFlags = { needs: new Set(), failed: new Set() };

export interface TreeNode<T extends TreeThread = TreeThread> {
  thread: T;
  /** The glyph its row shows: needs you or failed first, as Ben has to act on those, then its own. */
  state: Glyph;
  /** It waits on Ben or failed (read or not, until it is marked done): a closed tree still shows its row. */
  flagged: boolean;
  /** Not at work: its own turn and everything under it have ended. */
  finished: boolean;
  children: TreeNode<T>[];
}

/** Needs you's items, as far as the tree reads them. */
export interface TreeNeedsItem {
  thread: { id: string };
  result: { status: string } | null;
  blockers: readonly { kind: string; from?: readonly string[] }[];
}

/** Which threads under a job wait on Ben or failed unseen, from Needs you. A thread marked done is never flagged. */
export function treeFlags(items: readonly TreeNeedsItem[] | undefined): TreeFlags {
  const needs = new Set<string>();
  const failed = new Set<string>();
  for (const i of items ?? []) {
    for (const b of i.blockers) {
      if (b.kind === 'question') b.from?.forEach((id) => needs.add(id));
      else if (b.kind === 'child_failed') b.from?.forEach((id) => failed.add(id));
    }
    // A delegated thread's own item: its blocker (setup, a limit, a message to resend) or its failed result.
    if (i.blockers.some((b) => b.kind !== 'child_failed' && !(b.kind === 'question' && b.from?.length))) needs.add(i.thread.id);
    else if (i.result?.status === 'failed') failed.add(i.thread.id);
  }
  return { needs, failed };
}

/** The threads under each parent, from every group the channels list. A thread listed twice keeps its first copy. */
export function treeIndex<T extends TreeThread>(groups: readonly TreeGroup<T>[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const g of groups) {
    const list = out.get(g.parent.id) ?? [];
    for (const c of g.children) if (!list.some((x) => x.id === c.id)) list.push(c);
    out.set(g.parent.id, list);
  }
  return out;
}

/** Needs you, failed, at work, then the rest; the latest activity first within each. */
const RANK: Partial<Record<Glyph, number>> = { needs: 0, failed: 1, limited: 1, running: 2, queued: 3 };
const rank = (n: TreeNode) => (n.finished && !n.flagged ? 4 : (RANK[n.state] ?? 3));
const at = (t: TreeThread) => t.updated_at ?? t.created_at;
const byRank = (a: TreeNode, b: TreeNode) => rank(a) - rank(b) || at(b.thread).localeCompare(at(a.thread)) || a.thread.id.localeCompare(b.thread.id);

/** The state one thread's row shows. Marked done, it reads done whatever its last turn did. */
export function nodeState(t: TreeThread, flags: TreeFlags): { state: Glyph; flagged: boolean } {
  if (t.done_at) return { state: 'done', flagged: false };
  if (flags.needs.has(t.id)) return { state: 'needs', flagged: true };
  // Failed stays flagged once Ben read it: Needs you lets go of the job, but the row stays until the thread is done.
  if (flags.failed.has(t.id) || threadGlyph(t) === 'failed') return { state: 'failed', flagged: true };
  return { state: threadGlyph(t), flagged: false };
}

/** The tree under one thread, sorted. A cycle in bad data stops at the thread it came back to. */
export function buildTree<T extends TreeThread>(parentId: string, index: ReadonlyMap<string, readonly T[]>, flags: TreeFlags = NO_FLAGS, seen = new Set<string>([parentId])): TreeNode<T>[] {
  const out: TreeNode<T>[] = [];
  for (const t of index.get(parentId) ?? []) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    const children = buildTree(t.id, index, flags, seen);
    const { state, flagged } = nodeState(t, flags);
    const finished = !isWorking(t) && children.every((c) => c.finished);
    out.push({ thread: t, state, flagged, finished, children });
  }
  return out.sort(byRank);
}

/** Every node at any depth. */
export function everyNode<T extends TreeThread>(nodes: readonly TreeNode<T>[]): TreeNode<T>[] {
  return nodes.flatMap((n) => [n, ...everyNode(n.children)]);
}

/** Running while the job's own turn or anything under it still works, finished once all of it ended. */
export type TreePhase = 'running' | 'finished';

export function treePhase(parent: { status: string; delegating?: boolean }, nodes: readonly TreeNode[]): TreePhase {
  return isWorking(parent) || everyNode(nodes).some((n) => !n.finished) ? 'running' : 'finished';
}

/**
 * Ben opened or closed a tree by hand, and in which phase. It holds while the phase lasts: a tree he closed while the
 * job runs stays closed until the job finishes, and one he opened after it finished stays open until it runs again.
 */
export interface SavedOpen {
  open: boolean;
  phase: TreePhase;
}

/** Open while the job runs, closed once it finished, unless Ben chose otherwise in this phase. */
export function treeOpen(phase: TreePhase, saved: SavedOpen | null | undefined): boolean {
  return saved && saved.phase === phase ? saved.open : phase === 'running';
}

/**
 * Ben's choice, while it still holds: it ends when the job moves between running and finished, so a tree closed in one
 * run opens by itself in the next. Null means forget it (the views drop the saved value).
 */
export function keptChoice(saved: SavedOpen | null | undefined, phase: TreePhase): SavedOpen | null {
  return saved && saved.phase === phase ? saved : null;
}

/**
 * Sub-agents show only under a job at work, in the Inbox (its Working shelf) and the sidebar alike, and go when they
 * stop. `phase`: the job's, when it has a tree; a thread with nothing under it shows them while it works itself, so a
 * sub-agent a failed or stopped turn left behind never shows.
 */
export function showsAgents(t: { status: string; delegating?: boolean }, phase?: TreePhase): boolean {
  return phase ? phase === 'running' : isWorking(t);
}

/** Each view keeps its own choice per job: the sidebar's and the Inbox's never move each other. */
export type TreeView = 'sidebar' | 'inbox';
export const treePrefKey = (view: TreeView, jobId: string) => `tree.${view}.${jobId}`;

/** Finished rows an open tree lists before folding the rest into "n more done". */
export const FINISHED_SHOWN = 3;

export interface TreeRows<T extends TreeThread = TreeThread> {
  rows: TreeNode<T>[];
  /** What the "n more" row stands for: done rows past the first few (open), or everything not flagged (closed). */
  more: TreeNode<T>[];
}

/**
 * The rows a tree shows. Open: every row at work or flagged, then the latest FINISHED_SHOWN finished ones, the rest
 * behind "n more done" until `all`. Closed: only the flagged rows (and the rows that lead to one), the rest behind
 * "n more".
 */
/** It, or a thread under it, is flagged: a closed tree keeps its row so the flagged one below stays in sight. */
export const flaggedBelow = (n: TreeNode): boolean => n.flagged || n.children.some(flaggedBelow);

export function treeRows<T extends TreeThread>(nodes: readonly TreeNode<T>[], open: boolean, all = false): TreeRows<T> {
  if (!open) return { rows: nodes.filter(flaggedBelow), more: nodes.filter((n) => !flaggedBelow(n)) };
  const live = nodes.filter((n) => n.flagged || !n.finished);
  const finished = nodes.filter((n) => !n.flagged && n.finished);
  const shown = all ? finished : finished.slice(0, FINISHED_SHOWN);
  return { rows: [...live, ...shown], more: finished.slice(shown.length) };
}

/** How many threads directly under a job are in each state, for the tally on its row. */
export interface Tally {
  needs: number;
  failed: number;
  running: number;
  done: number;
}

export function treeTally(nodes: readonly TreeNode[]): Tally {
  const t: Tally = { needs: 0, failed: 0, running: 0, done: 0 };
  for (const n of nodes) {
    if (n.state === 'needs') t.needs++;
    else if (n.state === 'failed' || n.state === 'limited') t.failed++;
    else if (!n.finished) t.running++;
    else t.done++;
  }
  return t;
}

/** Marking the job done hides work that is not over: anything under it at work, failed or waiting on Ben. */
export function doneNeedsConfirm(nodes: readonly TreeNode[]): boolean {
  return everyNode(nodes).some((n) => !n.thread.done_at && (!n.finished || n.flagged || n.state === 'failed'));
}

/** The confirmation's sentence: what is still going on under the job. */
export function unfinishedLabel(nodes: readonly TreeNode[]): string {
  const all = everyNode(nodes).filter((n) => !n.thread.done_at);
  const parts: string[] = [];
  const needs = all.filter((n) => n.state === 'needs').length;
  const failed = all.filter((n) => n.state === 'failed' || n.state === 'limited').length;
  const working = all.filter((n) => !n.finished && n.state !== 'needs').length;
  if (working) parts.push(`${working} still ${working === 1 ? 'runs' : 'run'}`);
  if (needs) parts.push(`${needs} ${needs === 1 ? 'waits' : 'wait'} on you`);
  if (failed) parts.push(`${failed} failed`);
  return parts.join(', ');
}

/** A job whose threads sit in more than one channel shows each row's channel. */
export function spansChannels(nodes: readonly TreeNode[]): boolean {
  return new Set(nodes.map((n) => n.thread.channel_id)).size > 1;
}
