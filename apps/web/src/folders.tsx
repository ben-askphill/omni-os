// Sidebar folders: every edit shows at once in the channel list, then goes to the server; a refusal puts the list
// back and says why. Also the sidebar's shared folder state: which name is being edited, which delete is asked.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, errorText, type ChannelWithRunning, type Folder, type FolderWithThreads, type ThreadStub } from './api.ts';
import { useToast } from './components/Toaster.tsx';
import { ConfirmDialog } from './components/ui.tsx';
import { useApp } from './store.tsx';
import { cleanName, DEFAULT_FOLDER_NAME, draftKey, duplicateStandIn, FOLDER_NAME_MAX, freeName, newFolderStandIn, patchFolder, reorderedIds, settledFolder, sortFolders, withCollapsed, withFolders, withoutFolder, withThreadMoved } from './folder-edits.ts';

export { cleanName, DEFAULT_FOLDER_NAME, draftKey, FOLDER_NAME_MAX, freeName, sortFolders };

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
  /** Close these folders, all at once, as the sidebar's collapse-all does. */
  collapseAll: (ids: string[]) => Promise<void>;
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

  const settle = (channelId: string, tmpId: string, row: Folder) =>
    updateChannels((list) => list.map((c) => (c.id === channelId ? settledFolder(tmpId, row)(c) : c)));

  const create = useCallback(
    async (channelId: string, raw: string) => {
      const c = latest.current.find((x) => x.id === channelId);
      const id = `tmp-${++tmp}`;
      const stand = newFolderStandIn(id, channelId, c?.folders ?? [], raw);
      const name = stand.name;
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

  const collapseAll = useCallback(
    async (ids: string[]) => {
      const set = new Set(ids);
      if (!set.size) return;
      const before = latest.current;
      updateChannels(withCollapsed(set));
      const sent = await Promise.allSettled(ids.map((id) => api.patch<Folder>(`/folders/${encodeURIComponent(id)}`, { collapsed: true })));
      const failed = sent.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (!failed) return;
      // Some may have saved: put the list back, then take the server's word for each.
      updateChannels(() => before);
      toast({ title: "Couldn't save the folders", body: errorText(failed.reason), icon: 'folder' });
      void reloadChannels();
    },
    [updateChannels, reloadChannels, toast],
  );

  const duplicate = useCallback(
    async (id: string) => {
      const f = find(id);
      if (!f) return;
      const c = latest.current.find((x) => x.id === f.channel_id);
      const tmpId = `tmp-${++tmp}`;
      const stand = duplicateStandIn(f, tmpId, c?.folders ?? []);
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
      await optimistic(
        f.channel_id,
        withoutFolder(id),
        () => api.del(`/folders/${encodeURIComponent(id)}`),
        "Couldn't delete the folder",
      );
    },
    [find, optimistic],
  );

  const moveThread = useCallback(
    async (thread: ThreadStub, folderId: string | null) => {
      if ((thread.folder_id ?? null) === folderId || folderId?.startsWith('tmp-')) return;
      await optimistic(
        thread.channel_id,
        withThreadMoved(thread, folderId),
        () => api.patch(`/threads/${encodeURIComponent(thread.id)}`, { folder_id: folderId }),
        "Couldn't move the thread",
      );
    },
    [optimistic],
  );

  const reorder = useCallback(
    async (channelId: string, id: string, beforeId: string | null) => {
      const c = latest.current.find((x) => x.id === channelId);
      const ids = reorderedIds(c?.folders ?? [], id, beforeId);
      if (!ids) return;
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
      collapseAll,
      duplicate,
      remove,
      moveThread,
      reorder,
    }),
    // channels: `deleting` reads the latest list.
    [editing, deletingId, channels, find, create, rename, toggle, collapseAll, duplicate, remove, moveThread, reorder],
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
