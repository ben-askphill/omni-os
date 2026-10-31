import type { ChannelWithRunning, Folder, FolderWithThreads, ThreadStub } from './api.ts';

export const FOLDER_NAME_MAX = 60;
export const DEFAULT_FOLDER_NAME = 'New folder';

/** What `editing` holds while the name field of a folder that does not exist yet shows under a channel. */
export const draftKey = (channelId: string) => `new:${channelId}`;

/** Manually placed folders first, in their order, then the rest by name. The server's order (db/repos/folders.ts). */
export function sortFolders<T extends Pick<Folder, 'position' | 'name' | 'created_at'>>(list: T[]) {
  return [...list].sort(
    (a, b) =>
      (a.position === null ? 1 : 0) - (b.position === null ? 1 : 0) ||
      (a.position ?? 0) - (b.position ?? 0) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
      a.created_at.localeCompare(b.created_at),
  );
}

/** `base`, or `base 2`, `base 3`…: the first name no other folder in the list has, ignoring case. */
export function freeName(list: Pick<Folder, 'id' | 'name'>[], base: string, exceptId?: string) {
  const taken = new Set(list.filter((f) => f.id !== exceptId).map((f) => f.name.toLocaleLowerCase()));
  if (!taken.has(base.toLocaleLowerCase())) return base;
  for (let n = 2; ; n++) {
    const name = `${[...base].slice(0, FOLDER_NAME_MAX - ` ${n}`.length).join('').trimEnd()} ${n}`;
    if (!taken.has(name.toLocaleLowerCase())) return name;
  }
}

/** One line, trimmed. */
export const cleanName = (s: string) => s.replace(/\s+/g, ' ').trim();

const busy = (t: Pick<ThreadStub, 'status'>) => t.status === 'running' || t.status === 'queued';

export const withFolders = (c: ChannelWithRunning, fn: (list: FolderWithThreads[]) => FolderWithThreads[]) => ({ ...c, folders: sortFolders(fn(c.folders ?? [])) });
export const patchFolder = (id: string, patch: Partial<FolderWithThreads>) => (c: ChannelWithRunning) =>
  withFolders(c, (list) => list.map((f) => (f.id === id ? { ...f, ...patch } : f)));

/** Swap a stand-in folder for the server's row, keeping what the list knows about its threads. */
export const settledFolder = (tmpId: string, row: Folder) => (c: ChannelWithRunning) =>
  withFolders(c, (fs) => fs.map((f) => (f.id === tmpId ? { ...f, ...row } : f)));

/** The folder a create shows until the server answers: named, and last among the placed ones. */
export function newFolderStandIn(id: string, channelId: string, list: FolderWithThreads[], raw: string): FolderWithThreads {
  const name = freeName(list, cleanName(raw).slice(0, FOLDER_NAME_MAX) || DEFAULT_FOLDER_NAME);
  const max = list.reduce<number | null>((m, f) => (f.position === null ? m : Math.max(m ?? -1, f.position)), null);
  const now = new Date().toISOString();
  return { id, channel_id: channelId, parent_id: null, name, position: max === null ? null : max + 1, collapsed: 0, created_at: now, updated_at: now, count: 0, running: 0, threads: [] };
}

/** The copy a duplicate shows until the server answers: "<name> copy", just after the original. */
export function duplicateStandIn(f: FolderWithThreads, tmpId: string, list: FolderWithThreads[]): FolderWithThreads {
  const base = `${[...f.name].slice(0, FOLDER_NAME_MAX - ' copy'.length).join('').trimEnd()} copy`;
  return { ...f, id: tmpId, name: freeName(list, base), position: f.position === null ? null : f.position + 0.5, count: 0, running: 0, threads: [] };
}

/** The list without folder `id`; the threads that were in it go back to the ungrouped list. */
export const withoutFolder = (id: string) => (c: ChannelWithRunning): ChannelWithRunning => {
  const unfile = (t: ThreadStub) => (t.folder_id === id ? { ...t, folder_id: null } : t);
  return { ...withFolders(c, (fs) => fs.filter((x) => x.id !== id)), active: c.active?.map(unfile), recent: c.recent?.map(unfile) };
};

/** `thread` filed in `folderId` (null: ungrouped), counts and running totals included. */
export const withThreadMoved = (thread: ThreadStub, folderId: string | null) => (c: ChannelWithRunning): ChannelWithRunning => {
  const moved = { ...thread, folder_id: folderId };
  const swap = (t: ThreadStub) => (t.id === thread.id ? moved : t);
  return {
    ...withFolders(c, (fs) =>
      fs.map((f) => {
        const had = f.threads.some((t) => t.id === thread.id) || thread.folder_id === f.id;
        if (f.id === folderId && !had)
          return { ...f, count: f.count + 1, running: f.running + (busy(thread) ? 1 : 0), threads: [moved, ...f.threads].sort((a, b) => b.created_at.localeCompare(a.created_at)) };
        if (f.id !== folderId && had)
          return { ...f, count: Math.max(0, f.count - 1), running: Math.max(0, f.running - (busy(thread) ? 1 : 0)), threads: f.threads.filter((t) => t.id !== thread.id) };
        return f;
      }),
    ),
    active: c.active?.map(swap),
    // An ungrouped thread the list has not got yet shows there right away.
    recent: folderId === null && !c.recent?.some((t) => t.id === thread.id) ? [moved, ...(c.recent ?? [])] : c.recent?.map(swap),
  };
};

/** Close the folders in `set`, in whichever channels hold them. */
export const withCollapsed = (set: ReadonlySet<string>) => (list: ChannelWithRunning[]) =>
  list.map((c) => (c.folders?.some((f) => set.has(f.id)) ? { ...c, folders: c.folders.map((f) => (set.has(f.id) ? { ...f, collapsed: 1 } : f)) } : c));

/** The channel's folder ids with `id` put just before `beforeId` (last for null); null when nothing would move or a stand-in is involved. */
export function reorderedIds(folders: FolderWithThreads[], id: string, beforeId: string | null) {
  const ids = folders.map((f) => f.id).filter((x) => x !== id);
  if (ids.some((x) => x.startsWith('tmp-')) || id.startsWith('tmp-')) return null;
  const at = beforeId ? ids.indexOf(beforeId) : -1;
  ids.splice(at < 0 ? ids.length : at, 0, id);
  return ids.join() === folders.map((f) => f.id).join() ? null : ids;
}
