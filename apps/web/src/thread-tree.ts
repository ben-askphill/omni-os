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

// A tree's choice can change outside the hook that shows it (Collapse all, or the same view mounted twice), so every
// mounted tree reads its saved choice again when one is written.
const savedListeners = new Set<() => void>();
const savedChanged = () => savedListeners.forEach((fn) => fn());
function useSavedChanged(fn: () => void, deps: readonly unknown[]) {
  useEffect(() => {
    savedListeners.add(fn);
    return () => void savedListeners.delete(fn);
  }, deps);
}

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
  useSavedChanged(() => setSaved(readPref<SavedOpen | null>(key, null)), [key]);
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
      // Tell the other trees first: this tree's own listener re-reads storage, which holds nothing when the write
      // failed (private mode), and setting `next` after it keeps the chevron working anyway.
      savedChanged();
      setSaved(next);
    },
    tally: treeTally(nodes),
    spans: spansChannels(nodes),
    team: nodes.every((n) => n.thread.source === 'team'),
  };
}

/** Every job tree on a shelf at once: whether one is open, and the button that closes them all or opens them all. */
export interface TreesFold {
  /** How many of the threads have a tree under them. */
  trees: number;
  /** What the button does now: close every tree while any is open, else open them all. */
  action: 'collapse' | 'expand';
  toggle: () => void;
}

/**
 * Each tree's phase and open state, as useJobTree reads them. A thread with nothing under it has no tree. `read`: the
 * saved choice for a key (readPref, or a stub in tests).
 */
export function treesOpenState(
  parents: readonly ThreadStub[],
  view: TreeView,
  source: ReturnType<typeof treeSource>,
  read: (key: string) => SavedOpen | null,
): { id: string; phase: TreePhase; open: boolean }[] {
  return parents.flatMap((p) => {
    const nodes = buildTree(p.id, source.index, source.flags);
    if (!nodes.length) return [];
    const phase = treePhase(p, nodes);
    return [{ id: p.id, phase, open: treeOpen(phase, keptChoice(read(treePrefKey(view, p.id)), phase)) }];
  });
}

/**
 * Collapse all and Expand all for the trees under `parents` in a view. It saves the same per-job choice the job's own
 * chevron saves, so each chevron still works on its own afterwards, and the choice lasts as long as a chevron's does:
 * until that job moves between running and finished.
 */
export function useTreesFold(parents: readonly ThreadStub[], view: TreeView): TreesFold {
  const source = useTreeSource();
  const [, reread] = useState(0);
  useSavedChanged(() => reread((n) => n + 1), []);
  const states = treesOpenState(parents, view, source, (key) => readPref<SavedOpen | null>(key, null));
  const action = states.some((s) => s.open) ? 'collapse' : 'expand';
  return {
    trees: states.length,
    action,
    toggle: () => {
      for (const s of states) writePref(treePrefKey(view, s.id), { open: action === 'expand', phase: s.phase } satisfies SavedOpen);
      savedChanged();
    },
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
