import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { api, errorText, type Thread, type ThreadDetail } from '../api.ts';
import { draftKey, useFolders } from '../folders.tsx';
import { navigate, href, openNewThread, useRoute } from '../router.ts';
import { useApp } from '../store.tsx';
import { Icon, type IconName } from './ui.tsx';

type Target = { kind: 'thread'; id: string } | { kind: 'channel'; id: string } | { kind: 'folder'; id: string };
type Open = { target: Target; x: number; y: number };

const OPEN_EVENT = 'omni:context-menu';

/** Open the menu for `target` at a point, as a right-click there would: the "…" button on a folder, or a key. */
export function openMenu(target: Target, x: number, y: number) {
  window.dispatchEvent(new CustomEvent<Open>(OPEN_EVENT, { detail: { target, x, y } }));
}

const THREAD_HREF = /^#\/t\/([^/?]+)/;

/** What was right-clicked: a link to a thread anywhere in the app, a sidebar folder, or a row marked data-channel-id. */
function targetOf(el: EventTarget | null): Target | null {
  if (!(el instanceof Element)) return null;
  const channel = el.closest<HTMLElement>('[data-channel-id]');
  const folder = el.closest<HTMLElement>('[data-folder-id]');
  const link = el.closest<HTMLAnchorElement>('a[href^="#/t/"]');
  // A thread row inside a channel's block wins over the channel: it is the more specific target.
  if (link) {
    const m = THREAD_HREF.exec(link.getAttribute('href') ?? '');
    if (m) return { kind: 'thread', id: decodeURIComponent(m[1]!) };
  }
  if (folder?.dataset.folderId) return { kind: 'folder', id: folder.dataset.folderId };
  if (channel?.dataset.channelId) return { kind: 'channel', id: channel.dataset.channelId };
  return null;
}

/**
 * One right-click menu for the whole app. Rather than wrapping every row, it listens at the document and
 * reads the target off the DOM, so a thread link is archivable wherever it is rendered.
 */
export function ContextMenuHost() {
  const [open, setOpen] = useState<Open | null>(null);
  useEffect(() => {
    const onMenu = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const target = targetOf(e.target);
      if (!target) return setOpen(null);
      e.preventDefault();
      setOpen({ target, x: e.clientX, y: e.clientY });
    };
    const onOpen = (e: Event) => setOpen((e as CustomEvent<Open>).detail);
    document.addEventListener('contextmenu', onMenu);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      document.removeEventListener('contextmenu', onMenu);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);
  if (!open) return null;
  return <Menu open={open} onClose={() => setOpen(null)} />;
}

function Menu({ open, onClose }: { open: Open; onClose: () => void }) {
  const { target } = open;
  const { channel, reloadChannels } = useApp();
  const route = useRoute();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: open.x, y: open.y });
  const [archived, setArchived] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState<string | null>(null);
  const [row, setRow] = useState<Thread | null>(null);
  // Set while the menu shows the title field in place of its items.
  const [draft, setDraft] = useState<string | null>(null);
  // Set while the menu lists the folders a thread can move to.
  const [moving, setMoving] = useState(false);
  const folders = useFolders();

  // Ask for the thread's state so the item reads "Unarchive" on one that is.
  useEffect(() => {
    if (target.kind !== 'thread') return;
    let live = true;
    api
      .get<ThreadDetail>(`/threads/${encodeURIComponent(target.id)}`)
      .then((d) => {
        if (!live) return;
        setArchived(!!d.thread.archived);
        setCurrent(d.thread.title);
        setRow(d.thread);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [target.kind, target.id]);

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ x: Math.max(8, Math.min(open.x, window.innerWidth - r.width - 8)), y: Math.max(8, Math.min(open.y, window.innerHeight - r.height - 8)) });
  }, [open.x, open.y, archived, error, moving]);

  // Keyboard: the first item takes the focus, arrows move it.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')?.focus();
  }, [moving, row]);
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };

  useEffect(() => {
    const away = (e: Event) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('contextmenu', away, true);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    window.addEventListener('hashchange', onClose);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('contextmenu', away, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('hashchange', onClose);
    };
  }, [onClose]);

  const toggleArchive = async () => {
    const next = !archived;
    try {
      const t = await api.patch<Thread>(`/threads/${encodeURIComponent(target.id)}`, { archived: next });
      await reloadChannels();
      // Archiving the thread you are reading leaves its channel's list.
      if (next && route.name === 'thread' && route.id === target.id) navigate(href.channel(t.channel_id));
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const rename = async () => {
    const next = (draft ?? '').replace(/\s+/g, ' ').trim();
    if (!next || next === current) return onClose();
    try {
      await api.patch<Thread>(`/threads/${encodeURIComponent(target.id)}`, { title: next });
      await reloadChannels();
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const folder = target.kind === 'folder' ? folders.find(target.id) : undefined;
  // The folders the thread can move to: its channel's, once its row has come.
  const choices = row ? (channel(row.channel_id)?.folders ?? []).filter((f) => !f.id.startsWith('tmp-')) : [];
  const moveTo = (folderId: string | null) => {
    if (row) void folders.moveThread({ id: row.id, channel_id: row.channel_id, title: row.title, status: row.status, created_at: row.created_at, folder_id: row.folder_id }, folderId);
    onClose();
  };

  const items: { label: string; icon: IconName; run: () => void }[] =
    target.kind === 'thread'
      ? [
          { label: 'Rename thread', icon: 'pencil', run: () => setDraft(current ?? '') },
          ...(row && !row.parent_id ? [{ label: 'Move to folder', icon: 'folder' as const, run: () => setMoving(true) }] : []),
          { label: archived ? 'Unarchive thread' : 'Archive thread', icon: 'archive', run: toggleArchive },
        ]
      : target.kind === 'folder'
        ? folder
          ? [
              { label: 'New thread here', icon: 'plus', run: () => (openNewThread({ channel: folder.channel_id, folder: { id: folder.id, name: folder.name } }), onClose()) },
              { label: 'Rename', icon: 'pencil', run: () => (folders.setEditing(folder.id), onClose()) },
              { label: 'Duplicate', icon: 'copy', run: () => (void folders.duplicate(folder.id), onClose()) },
              { label: 'Delete', icon: 'trash', run: () => (folders.askDelete(folder.id), onClose()) },
            ]
          : []
        : [
            { label: 'New folder', icon: 'folderPlus', run: () => (folders.setEditing(draftKey(target.id)), onClose()) },
            { label: 'Channel settings', icon: 'sliders', run: () => (navigate(href.settings(target.id)), onClose()) },
          ];
  const title = target.kind === 'channel' ? `#${channel(target.id)?.name ?? ''}` : folder ? folder.name : undefined;

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={target.kind === 'thread' ? (moving ? 'Move to folder' : 'Thread actions') : target.kind === 'folder' ? 'Folder actions' : 'Channel actions'}
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={onKey}
      className="pop-in fixed z-[60] min-w-[190px] max-w-[280px] rounded-[16px] bg-elev p-1.5 shadow-[var(--shadow-menu)]"
    >
      {title && <div className="caption truncate px-2.5 pt-1 pb-1.5 text-fg-4">{title}</div>}
      {moving && row ? (
        <>
          <div className="caption truncate px-2.5 pt-1 pb-1.5 text-fg-4">Move to folder</div>
          {[{ id: null as string | null, name: 'No folder' }, ...choices].map((f) => {
            const on = (row.folder_id ?? null) === f.id;
            return (
              <button
                key={f.id ?? ''}
                role="menuitemradio"
                aria-checked={on}
                onClick={() => moveTo(f.id)}
                className="hov flex h-8 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[13px] text-fg-2 hover:text-fg"
              >
                <Icon name={f.id ? 'folder' : 'minus'} size={14} className="text-fg-3" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                {on && <Icon name="check" size={14} className="text-fg-2" />}
              </button>
            );
          })}
          {!choices.length && <div className="px-2.5 py-1.5 text-[12px] text-fg-4">This channel has no folders yet. Add one with the + beside its name.</div>}
        </>
      ) : draft !== null ? (
        <input
          autoFocus
          value={draft}
          maxLength={200}
          aria-label="Thread title"
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && rename()}
          className="h-8 w-[260px] rounded-[10px] bg-surface px-2.5 text-[13px] text-fg outline-none"
        />
      ) : (
      items.map((it) => (
        <button key={it.label} role="menuitem" onClick={it.run} className="hov flex h-8 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[13px] text-fg-2 hover:text-fg">
          <Icon name={it.icon} size={14} className="text-fg-3" />
          {it.label}
        </button>
      )))}
      {error && <div className="px-2.5 py-1.5 text-[12px] text-fg-3">{error}</div>}
    </div>
  );
}
