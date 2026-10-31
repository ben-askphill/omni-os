import { useState, type DragEvent } from 'react';
import type { ChannelWithRunning, ThreadStub } from '../../api.ts';
import { folderOf } from '../../folder-groups.ts';
import { drag, type useFolders } from '../../folders.tsx';
import { foldAllAction, openFolderIds } from '../../sidebar-fold.ts';
import { readPref, writePref } from '../../store.tsx';

const newestFirst = (a: ThreadStub, b: ThreadStub) => b.created_at.localeCompare(a.created_at);

/** Channels whose folders and threads are hidden under their name, remembered on this device, and the fold-all button over them. */
export function useChannelFold(channels: ChannelWithRunning[], folders: ReturnType<typeof useFolders>) {
  // Channels whose folders and threads are hidden under their name, remembered on this device.
  const [collapsed, setCollapsed] = useState(() => new Set(readPref<string[]>('sidebar.collapsedChannels', [])));
  const setChannelOpen = (id: string, open: boolean) =>
    setCollapsed((prev) => {
      if (prev.has(id) === !open) return prev;
      const next = new Set(prev);
      if (open) next.delete(id);
      else next.add(id);
      writePref('sidebar.collapsedChannels', [...next]);
      return next;
    });
  // One click closes every channel and its open folders; with all closed, it opens the channels again. The open
  // thread still shows under its channel's name, so the highlight stays put.
  const foldAll = foldAllAction(channels, collapsed);
  const toggleAll = () => {
    if (foldAll === 'expand') {
      setCollapsed(new Set());
      writePref('sidebar.collapsedChannels', []);
      return;
    }
    const next = new Set(channels.map((c) => c.id));
    setCollapsed(next);
    writePref('sidebar.collapsedChannels', [...next]);
    void folders.collapseAll(openFolderIds(channels));
  };
  return { collapsed, setChannelOpen, foldAll, toggleAll };
}

/**
 * A channel's ungrouped threads, newest first. Running and queued ones, and the open thread with the page's fresher
 * copy, which stays after it stops so the highlight never jumps out from under you. The highlighted channel also
 * lists its latest threads of any status, so finished ones stay a click away. Threads in a folder are listed under
 * the folder instead.
 */
export function channelThreads(c: ChannelWithRunning, open: ThreadStub | null, focused: string | null): ThreadStub[] {
  const extra = c.id === focused ? (c.recent ?? []) : [];
  const seen = new Set(open ? [open.id] : []);
  const rest = [...(c.active ?? []), ...extra].filter((t) => !seen.has(t.id) && seen.add(t.id));
  return (open ? [open, ...rest] : rest).filter((t) => !folderOf(c, t)).sort(newestFirst);
}

/** The channel's folders, with the open thread under its own even past the listed ones. */
export function channelFolders(c: ChannelWithRunning, open: ThreadStub | null) {
  const home = open && folderOf(c, open);
  return (c.folders ?? []).map((f) =>
    f.id === home && !f.threads.some((t) => t.id === open!.id) ? { ...f, threads: [{ ...open!, folder_id: f.id }, ...f.threads] } : f,
  );
}

/** The channel's name as a drop target: a thread dragged out of one of its folders goes back to the ungrouped list. */
export function useUngroupDrop(folders: ReturnType<typeof useFolders>) {
  // The channel whose name a thread is being dragged over, to take it out of its folder.
  const [dropOn, setDropOn] = useState<string | null>(null);
  /** A thread dragged out of one of the channel's folders, dropped on the channel's name, goes back to the ungrouped list. */
  const ungroupDrop = (c: ChannelWithRunning) => {
    const ok = () => {
      const d = drag.get();
      return d?.kind === 'thread' && d.thread.channel_id === c.id && !!folderOf(c, d.thread);
    };
    return {
      onDragOver: (e: DragEvent) => {
        if (!ok()) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDropOn(c.id);
      },
      onDragLeave: () => setDropOn(null),
      onDrop: (e: DragEvent) => {
        setDropOn(null);
        const d = drag.get();
        if (!ok() || d?.kind !== 'thread') return;
        e.preventDefault();
        drag.end();
        void folders.moveThread({ ...d.thread, folder_id: folderOf(c, d.thread) }, null);
      },
    };
  };
  return { dropOn, ungroupDrop };
}
