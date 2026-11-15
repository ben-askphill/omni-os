// The thread tree from the Web UI's side: the tree under a job, read off the channel listing (Conductor `handoffs`
// and every channel's `teams`) and Needs you, with its open state on this device for one view. The rules are
// @omni/shared/thread-tree.ts.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildTree,
  keptChoice,
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
import { dropPref, readPref, useApp, writePref } from './store.tsx';

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
  const phase = nodes.length ? treePhase(parent, nodes) : null;
  const kept = phase ? keptChoice(saved, phase) : saved;
  // The job moved between running and finished: Ben's choice ended with the phase it was made in.
  useEffect(() => {
    if (!saved || kept) return;
    dropPref(key);
    setSaved(null);
  }, [saved, kept, key]);
  if (!phase) return null;
  const open = treeOpen(phase, kept);
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

/**
 * Forgets each view's choice for a job once it moves between running and finished, for the views that are not on
 * screen (useJobTree does it for the ones that are). Mounted once, under the app's lists.
 */
export function useForgetTreeChoices() {
  const { channels, needsYou } = useApp();
  const seen = useRef(new Map<string, TreePhase>());
  useEffect(() => {
    const { index, flags } = treeSource(channels, needsYou);
    for (const g of channels.flatMap((c) => [...(c.handoffs ?? []), ...(c.teams ?? [])])) {
      const phase = treePhase(g.parent, buildTree(g.parent.id, index, flags));
      const was = seen.current.get(g.parent.id);
      seen.current.set(g.parent.id, phase);
      if (!was || was === phase) continue;
      for (const view of ['sidebar', 'inbox'] as const) {
        const key = treePrefKey(view, g.parent.id);
        if (!keptChoice(readPref<SavedOpen | null>(key, null), phase)) dropPref(key);
      }
    }
  }, [channels, needsYou]);
}

/** The line under a job's title: its branch, or what sits under it. */
export function treeLabel(parent: ThreadStub, tree: JobTree): string {
  if (parent.branch) return parent.branch;
  const n = tree.nodes.length;
  return tree.team ? `Team of ${n}` : `${n} delegated`;
}
