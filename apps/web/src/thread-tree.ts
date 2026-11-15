// The thread tree from the Web UI's side: the tree under a job, read off the channel listing (Conductor `handoffs`
// and every channel's `teams`) and Needs you, with its open state on this device for one view. The rules are
// @omni/shared/thread-tree.ts.
import { useMemo, useState } from 'react';
import {
  buildTree,
  spansChannels,
  treeFlags,
  treeIndex,
  treeOpen,
  treePhase,
  treePrefKey,
  treeTally,
  type SavedOpen,
  type Tally,
  type TreeNode,
  type TreePhase,
  type TreeView,
} from '@omni/shared/thread-tree.ts';
import type { ChannelWithRunning, NeedsYou, ThreadStub } from './api.ts';
import { readPref, useApp, writePref } from './store.tsx';

export type StubNode = TreeNode<ThreadStub>;

export interface JobTree {
  nodes: StubNode[];
  phase: TreePhase;
  open: boolean;
  toggle: () => void;
  tally: Tally;
  /** The threads under it sit in more than one channel, so each row names its channel. */
  spans: boolean;
  /** Every thread under it is a member of its team, so its line reads "Team of n". */
  team: boolean;
}

/** Every parent's threads, and what Needs you flags among them, from the store. */
export function treeSource(channels: readonly ChannelWithRunning[], needsYou: NeedsYou | null) {
  return {
    index: treeIndex<ThreadStub>(channels.flatMap((c) => [...(c.handoffs ?? []), ...(c.teams ?? [])])),
    flags: treeFlags(needsYou?.items),
  };
}

export function useTreeSource() {
  const { channels, needsYou } = useApp();
  return useMemo(() => treeSource(channels, needsYou), [channels, needsYou]);
}

/** The tree under one thread in a view, or null when nothing sits under it. */
export function useJobTree(parent: ThreadStub, view: TreeView): JobTree | null {
  const { index, flags } = useTreeSource();
  const nodes = useMemo(() => buildTree(parent.id, index, flags), [parent.id, index, flags]);
  const key = treePrefKey(view, parent.id);
  const [saved, setSaved] = useState<SavedOpen | null>(() => readPref<SavedOpen | null>(key, null));
  if (!nodes.length) return null;
  const phase = treePhase(parent, nodes);
  const open = treeOpen(phase, saved);
  return {
    nodes,
    phase,
    open,
    toggle: () => {
      const next: SavedOpen = { open: !open, phase };
      writePref(key, next);
      setSaved(next);
    },
    tally: treeTally(nodes),
    spans: spansChannels(nodes),
    team: nodes.every((n) => n.thread.source === 'team'),
  };
}

/** The line under a job's title: its branch, or what sits under it. */
export function treeLabel(parent: ThreadStub, tree: JobTree): string {
  if (parent.branch) return parent.branch;
  const n = tree.nodes.length;
  return tree.team ? `Team of ${n}` : `${n} delegated`;
}
