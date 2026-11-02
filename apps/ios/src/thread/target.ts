import type { Folder, Thread, ThreadStatus, ThreadStub } from '@omni/client-core';
import { threadMenu, type ThreadMenuItem } from '@omni/shared/thread-actions.ts';

/**
 * What the menu needs to know about a thread. A list row has only the stub the channel list sends, the thread screen
 * has the whole row, and both build the same target, so the swipe actions and the header menu cannot disagree.
 */
export interface ThreadTarget {
  id: string;
  channelId: string;
  title: string;
  status: ThreadStatus;
  folderId: string | null;
  pinned: boolean;
  done: boolean;
  archived: boolean;
  /** It reports to a parent, so it sits under that parent and cannot move to a folder. */
  child: boolean;
  harness: string;
}

/** A running or queued thread brings its own result, so it cannot be marked done yet (the server refuses it too). */
export const canMarkDone = (status: ThreadStatus) => status !== 'running' && status !== 'queued';

export function targetOfThread(t: Thread): ThreadTarget {
  return {
    id: t.id,
    channelId: t.channel_id,
    title: t.title,
    status: t.status,
    folderId: t.folder_id,
    pinned: !!t.pinned_at,
    done: !!t.done_at,
    archived: !!t.archived,
    child: !!t.parent_id,
    harness: t.harness,
  };
}

/** The channel list leaves archived threads out, so a stub is never archived. */
export function targetOfStub(t: ThreadStub): ThreadTarget {
  return {
    id: t.id,
    channelId: t.channel_id,
    title: t.title,
    status: t.status,
    folderId: t.folder_id,
    pinned: !!t.pinned_at,
    done: !!t.done_at,
    archived: false,
    child: !!t.parent_id,
    harness: t.harness,
  };
}

export interface FolderChoice {
  /** Null: out of every folder. */
  id: string | null;
  name: string;
  /** How deep the folder nests, for the indent. */
  depth: number;
  current: boolean;
}

/**
 * Where the thread can move: out of its folder, then the channel's folders as a tree. The phone only moves threads into
 * folders that exist, it cannot make one, so an empty channel gets just the first row.
 */
export function folderChoices(folders: readonly Pick<Folder, 'id' | 'parent_id' | 'name'>[], folderId: string | null): FolderChoice[] {
  const byParent = new Map<string | null, Pick<Folder, 'id' | 'parent_id' | 'name'>[]>();
  const known = new Set(folders.map((f) => f.id));
  for (const f of folders) {
    const parent = f.parent_id && known.has(f.parent_id) ? f.parent_id : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), f]);
  }
  const out: FolderChoice[] = [{ id: null, name: 'No folder', depth: 0, current: folderId === null }];
  const walk = (parent: string | null, depth: number) => {
    for (const f of byParent.get(parent) ?? []) {
      out.push({ id: f.id, name: f.name, depth, current: f.id === folderId });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function menuFacts(target: ThreadTarget) {
  return {
    row: true,
    archived: target.archived,
    pinned: target.pinned,
    done: target.done,
    settled: canMarkDone(target.status),
    child: target.child,
    harness: target.harness,
    grokBot: false,
  };
}

/**
 * The thread's menu: the Organize actions from the list every client shares (`@omni/shared/thread-actions.ts`).
 * Reference and Grok Bot wait for the flows they open, so they are left out here rather than shown dead.
 */
export function organizeItems(target: ThreadTarget): ThreadMenuItem[] {
  return threadMenu(menuFacts(target)).find((g) => g.id === 'organize')?.items ?? [];
}

/** Fork thread, from the same list: its `off` says why a harness whose files are not on this machine cannot be forked. */
export function forkItem(target: ThreadTarget): ThreadMenuItem | null {
  return threadMenu(menuFacts(target)).find((g) => g.id === 'continue')?.items.find((i) => i.id === 'fork') ?? null;
}
