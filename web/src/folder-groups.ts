// A channel's threads grouped by its sidebar folders, for the sidebar and the channel's Threads tab alike. Pure, so
// the rules are tested on their own and both lists put every thread in the same place.
import type { ChannelWithRunning, FolderWithThreads, ThreadStub } from './api.ts';

type Filing = Pick<ChannelWithRunning, 'folders' | 'active' | 'recent'>;

/** The folder a thread sits in, as the list knows it now: a move shows before the open thread's own copy hears of it. */
export function folderOf(c: Filing, t: Pick<ThreadStub, 'id' | 'folder_id'>): string | null {
  const inFolder = c.folders?.find((f) => f.threads.some((x) => x.id === t.id));
  if (inFolder) return inFolder.id;
  const stub = [...(c.active ?? []), ...(c.recent ?? [])].find((x) => x.id === t.id);
  const id = (stub ?? t).folder_id ?? null;
  return id && c.folders?.some((f) => f.id === id) ? id : null;
}

export interface FolderGroup<T> {
  folder: FolderWithThreads;
  threads: T[];
}

/**
 * Every folder of the channel in the sidebar's order, empty ones too, each with its threads from `threads`, then the
 * threads in none. Each list keeps the order `threads` came in.
 */
export function groupByFolder<T extends Pick<ThreadStub, 'id' | 'folder_id'>>(threads: T[], c: Filing): { folders: FolderGroup<T>[]; unfiled: T[] } {
  const groups = (c.folders ?? []).map((folder) => ({ folder, threads: [] as T[] }));
  const byId = new Map(groups.map((g) => [g.folder.id, g]));
  const unfiled: T[] = [];
  for (const t of threads) {
    const id = folderOf(c, t);
    (id ? byId.get(id)!.threads : unfiled).push(t);
  }
  return { folders: groups, unfiled };
}
