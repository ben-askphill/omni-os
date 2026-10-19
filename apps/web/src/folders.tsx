// Sidebar folders: every edit shows at once in the channel list, then goes to the server; a refusal puts the list
// back and says why. Also the sidebar's shared folder state: which name is being edited, which delete is asked.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, errorText, type ChannelWithRunning, type Folder, type FolderWithThreads, type ThreadStub } from './api.ts';
import { useToast } from './components/Toaster.tsx';
import { ConfirmDialog } from './components/ui.tsx';
import { useApp } from './store.tsx';

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

/** What is being dragged in the sidebar right now. dataTransfer can't be read until the drop, so it lives here. */
export type Dragged = { kind: 'thread'; thread: ThreadStub } | { kind: 'folder'; id: string; channel_id: string };
let dragged: Dragged | null = null;
export const drag = {
  start: (d: Dragged) => void (dragged = d),
  end: () => void (dragged = null),
  get: () => dragged,
};

interface FolderState {
  /** The folder whose name field shows, or draftKey(channel) for a new one. */
  editing: string | null;
  setEditing: (id: string | null) => void;
  /** The folder whose delete is being confirmed. */
  deleting: FolderWithThreads | null;
  askDelete: (id: string) => void;
  cancelDelete: () => void;
  /** Find a folder in the channel list. */
  find: (id: string) => FolderWithThreads | undefined;
  create: (channelId: string, name: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  toggle: (id: string) => Promise<void>;
  duplicate: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** File a thread in a folder of its channel, or null for the ungrouped list. */
  moveThread: (thread: ThreadStub, folderId: string | null) => Promise<void>;
  /** Put the dragged folder just before `beforeId`, or last for null. */
  reorder: (channelId: string, id: string, beforeId: string | null) => Promise<void>;
}

const Ctx = createContext<FolderState | null>(null);

let tmp = 0;

export function FolderProvider({ children }: { children: ReactNode }) {
  const { channels, updateChannels, reloadChannels } = useApp();
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const latest = useRef(channels);
  latest.current = channels;

  const find = useCallback((id: string) => {
    for (const c of latest.current) {
      const f = c.folders?.find((x) => x.id === id);
      if (f) return f;
    }
    return undefined;
  }, []);

  /** Apply `edit` to one channel's folders now, run `send`, and put the list back if the server refuses. */
  const optimistic = useCallback(
    async <T,>(channelId: string, edit: (c: ChannelWithRunning) => ChannelWithRunning, send: () => Promise<T>, fail: string) => {
      const before = latest.current;
      updateChannels((list) => list.map((c) => (c.id === channelId ? edit(c) : c)));
      try {
        return await send();
      } catch (e) {
        updateChannels(() => before);
        toast({ title: fail, body: errorText(e), icon: 'folder' });
        void reloadChannels();
        return undefined;
      }
    },
    [updateChannels, reloadChannels, toast],
  );

  const withFolders = (c: ChannelWithRunning, fn: (list: FolderWithThreads[]) => FolderWithThreads[]) => ({ ...c, folders: sortFolders(fn(c.folders ?? [])) });
  const patchFolder = (id: string, patch: Partial<FolderWithThreads>) => (c: ChannelWithRunning) =>
    withFolders(c, (list) => list.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  /** Swap a stand-in folder for the server's row, keeping what the list knows about its threads. */
  const settle = (channelId: string, tmpId: string, row: Folder) =>
    updateChannels((list) =>
      list.map((c) => (c.id === channelId ? withFolders(c, (fs) => fs.map((f) => (f.id === tmpId ? { ...f, ...row } : f))) : c)),
    );

  const create = useCallback(
    async (channelId: string, raw: string) => {
      const c = latest.current.find((x) => x.id === channelId);
      const list = c?.folders ?? [];
      const name = freeName(list, cleanName(raw).slice(0, FOLDER_NAME_MAX) || DEFAULT_FOLDER_NAME);
      const max = list.reduce<number | null>((m, f) => (f.position === null ? m : Math.max(m ?? -1, f.position)), null);
      const now = new Date().toISOString();
      const id = `tmp-${++tmp}`;
      const stand: FolderWithThreads = {
        id, channel_id: channelId, parent_id: null, name, position: max === null ? null : max + 1, collapsed: 0, created_at: now, updated_at: now,
        count: 0, running: 0, threads: [],
      };
      const row = await optimistic(channelId, (ch) => withFolders(ch, (fs) => [...fs, stand]), () => api.post<Folder>('/folders', { channel: channelId, name }), "Couldn't create the folder");
      if (row) settle(channelId, id, row);
    },
    [optimistic],
  );

  const rename = useCallback(
    async (id: string, raw: string) => {
      const f = find(id);
      const name = cleanName(raw);
      if (!f || !name || name === f.name) return;
      await optimistic(f.channel_id, patchFolder(id, { name }), () => api.patch<Folder>(`/folders/${encodeURIComponent(id)}`, { name }), "Couldn't rename the folder");
    },
    [find, optimistic],
  );

  const toggle = useCallback(
    async (id: string) => {
      const f = find(id);
      if (!f) return;
      const collapsed = f.collapsed ? 0 : 1;
      await optimistic(f.channel_id, patchFolder(id, { collapsed }), () => api.patch<Folder>(`/folders/${encodeURIComponent(id)}`, { collapsed: !!collapsed }), "Couldn't save the folder");
    },
    [find, optimistic],
  );

  const duplicate = useCallback(
    async (id: string) => {
      const f = find(id);
      if (!f) return;
      const c = latest.current.find((x) => x.id === f.channel_id);
      const tmpId = `tmp-${++tmp}`;
      const base = `${[...f.name].slice(0, FOLDER_NAME_MAX - ' copy'.length).join('').trimEnd()} copy`;
      const stand: FolderWithThreads = { ...f, id: tmpId, name: freeName(c?.folders ?? [], base), position: f.position === null ? null : f.position + 0.5, count: 0, running: 0, threads: [] };
      const row = await optimistic(f.channel_id, (ch) => withFolders(ch, (fs) => [...fs, stand]), () => api.post<Folder>(`/folders/${encodeURIComponent(id)}/duplicate`, {}), "Couldn't duplicate the folder");
      // The copy lands after the original, which moves every folder below it: take the server's order.
      if (row) (settle(f.channel_id, tmpId, row), void reloadChannels());
    },
    [find, optimistic, reloadChannels],
  );

  const remove = useCallback(
    async (id: string) => {
      const f = find(id);
      if (!f) return;
      setDeletingId(null);
      const unfile = (t: ThreadStub) => (t.folder_id === id ? { ...t, folder_id: null } : t);
      await optimistic(
        f.channel_id,
        (c) => ({ ...withFolders(c, (fs) => fs.filter((x) => x.id !== id)), active: c.active?.map(unfile), recent: c.recent?.map(unfile) }),
        () => api.del(`/folders/${encodeURIComponent(id)}`),
        "Couldn't delete the folder",
      );
    },
    [find, optimistic],
  );

  const moveThread = useCallback(
    async (thread: ThreadStub, folderId: string | null) => {
      if ((thread.folder_id ?? null) === folderId || folderId?.startsWith('tmp-')) return;
      const moved = { ...thread, folder_id: folderId };
      const swap = (t: ThreadStub) => (t.id === thread.id ? moved : t);
      await optimistic(
        thread.channel_id,
        (c) => ({
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
        }),
        () => api.patch(`/threads/${encodeURIComponent(thread.id)}`, { folder_id: folderId }),
        "Couldn't move the thread",
      );
    },
    [optimistic],
  );

  const reorder = useCallback(
    async (channelId: string, id: string, beforeId: string | null) => {
      const c = latest.current.find((x) => x.id === channelId);
      const ids = (c?.folders ?? []).map((f) => f.id).filter((x) => x !== id);
      if (ids.some((x) => x.startsWith('tmp-')) || id.startsWith('tmp-')) return;
      const at = beforeId ? ids.indexOf(beforeId) : -1;
      ids.splice(at < 0 ? ids.length : at, 0, id);
      if (ids.join() === (c?.folders ?? []).map((f) => f.id).join()) return;
      await optimistic(
        channelId,
        (ch) => withFolders(ch, (fs) => fs.map((f) => ({ ...f, position: ids.indexOf(f.id) }))),
        () => api.put('/folders/order', { channel: channelId, ids }),
        "Couldn't reorder the folders",
      );
    },
    [optimistic],
  );

  const value = useMemo<FolderState>(
    () => ({
      editing,
      setEditing,
      deleting: deletingId ? (find(deletingId) ?? null) : null,
      askDelete: setDeletingId,
      cancelDelete: () => setDeletingId(null),
      find,
      create,
      rename,
      toggle,
      duplicate,
      remove,
      moveThread,
      reorder,
    }),
    // channels: `deleting` reads the latest list.
    [editing, deletingId, channels, find, create, rename, toggle, duplicate, remove, moveThread, reorder],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFolders() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFolders outside FolderProvider');
  return v;
}

/** The delete confirm for a folder, from its menu or the Delete key. Mounted once, at the app's root. */
export function FolderDeleteDialog() {
  const folders = useFolders();
  const f = folders.deleting;
  return (
    <ConfirmDialog
      open={!!f}
      title={`Delete "${f?.name ?? ''}"?`}
      confirmLabel="Delete folder"
      danger
      onConfirm={() => f && void folders.remove(f.id)}
      onCancel={folders.cancelDelete}
    >
      <p>
        {f?.count
          ? `${f.count === 1 ? 'The thread inside is' : `The ${f.count} threads inside are`} not deleted. ${f.count === 1 ? 'It moves' : 'They move'} back to the channel's ungrouped list.`
          : 'The folder is empty. No threads are deleted.'}
      </p>
    </ConfirmDialog>
  );
}
