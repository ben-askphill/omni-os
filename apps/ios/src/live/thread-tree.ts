// The thread tree on the Activity tab: a job's delegated threads, team members and their own threads, nested under
// its row as phone web's Activity shows them (apps/web/src/thread-tree.ts, apps/web/src/mobile/InboxRows.tsx). Read off
// the channel listing (the Conductor's `handoffs` and every channel's `teams`) and Needs you. The rules are
// @omni/shared/thread-tree.ts; this file only feeds them the phone's lists. Pure.
import type { BackgroundTask, ChannelWithRunning, NeedsYou, ThreadStub } from '@omni/client-core';
import {
  buildTree,
  doneNeedsConfirm,
  keptChoice,
  spansChannels,
  treeFlags,
  treeIndex,
  treeOpen,
  treePhase,
  treeTally,
  unfinishedLabel,
  type SavedOpen,
  type Tally,
  type TreeFlags,
  type TreeNode,
  type TreePhase,
} from '@omni/shared/thread-tree.ts';

export type StubNode = TreeNode<ThreadStub>;

/** Every parent's threads, and which of them Needs you flags. */
export interface TreeSource {
  index: ReadonlyMap<string, readonly ThreadStub[]>;
  flags: TreeFlags;
}

const groupsOf = (channels: readonly ChannelWithRunning[] | null) => (channels ?? []).flatMap((c) => [...(c.handoffs ?? []), ...(c.teams ?? [])]);

export function treeSource(channels: readonly ChannelWithRunning[] | null, needsYou: NeedsYou | null): TreeSource {
  return { index: treeIndex<ThreadStub>(groupsOf(channels)), flags: treeFlags(needsYou?.items) };
}

/** What sits under a job, before Ben's open or closed choice. */
export interface JobTree {
  nodes: StubNode[];
  /** Running while the job or anything under it works. Opens the tree by itself, and ends a choice made in the other phase. */
  phase: TreePhase;
  tally: Tally;
  /** The threads under it sit in more than one channel, so each row names its channel. */
  spans: boolean;
  /** Every thread under it is a member of its team. */
  team: boolean;
}

/** The tree under one thread, or null when nothing sits under it. */
export function jobTree(parent: { id: string; status: string; delegating?: boolean }, source: TreeSource): JobTree | null {
  const nodes = buildTree(parent.id, source.index, source.flags);
  if (!nodes.length) return null;
  return {
    nodes,
    phase: treePhase(parent, nodes),
    tally: treeTally(nodes),
    spans: spansChannels(nodes),
    team: nodes.every((n) => n.thread.source === 'team'),
  };
}

/** Open while the job runs and closed once it finished, unless Ben opened or closed it in this phase. */
export const treeIsOpen = (tree: Pick<JobTree, 'phase'>, saved: SavedOpen | null | undefined) => treeOpen(tree.phase, keptChoice(saved, tree.phase));

/** The phase each parent the lists know is in, so a choice made in the other phase can be dropped. */
export function treePhases(channels: readonly ChannelWithRunning[] | null, source: TreeSource): Map<string, TreePhase> {
  const out = new Map<string, TreePhase>();
  for (const g of groupsOf(channels)) out.set(g.parent.id, treePhase(g.parent, buildTree(g.parent.id, source.index, source.flags)));
  return out;
}

/** One state's word and count, for the tally on a job's row and its VoiceOver label. */
export const TALLY_ORDER: readonly { key: keyof Tally; label: string }[] = [
  { key: 'needs', label: 'need you' },
  { key: 'failed', label: 'failed' },
  { key: 'running', label: 'running' },
  { key: 'done', label: 'done' },
];

/** "1 need you, 2 running, 3 done". */
export const tallyLabel = (t: Tally) =>
  TALLY_ORDER.filter((x) => t[x.key])
    .map((x) => `${t[x.key]} ${x.label}`)
    .join(', ');

/** The tally of the rows a "n more" row stands for (web: ThreadTree.tsx tallyOf). */
export const tallyOf = (nodes: readonly StubNode[]): Tally => ({
  needs: nodes.filter((n) => n.state === 'needs').length,
  failed: nodes.filter((n) => n.state === 'failed' || n.state === 'limited').length,
  running: nodes.filter((n) => !n.finished && n.state !== 'needs' && n.state !== 'failed').length,
  done: nodes.filter((n) => n.finished && n.state !== 'needs' && n.state !== 'failed' && n.state !== 'limited').length,
});

/** How many sub-agents each thread runs now. Background shells and monitors are not agents. */
export function agentsByThread(tasks: readonly BackgroundTask[] | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const k of tasks ?? []) if (k.subagent) out.set(k.thread_id, (out.get(k.thread_id) ?? 0) + 1);
  return out;
}

/** The question marking a job done asks first, or null when nothing under it still runs, failed or waits on Ben. */
export interface DoneQuestion {
  title: string;
  message: string;
}

export function doneQuestion(job: { id: string; title?: string | null }, channels: readonly ChannelWithRunning[] | null, needsYou: NeedsYou | null): DoneQuestion | null {
  const source = treeSource(channels, needsYou);
  const nodes = buildTree(job.id, source.index, source.flags);
  if (!doneNeedsConfirm(nodes)) return null;
  const name = job.title || groupsOf(channels).find((g) => g.parent.id === job.id)?.parent.title || 'Untitled';
  return {
    title: 'Mark as done?',
    message: `Under ${name}, ${unfinishedLabel(nodes)}. Done takes it out of Activity and Needs you until something new happens in it.`,
  };
}
