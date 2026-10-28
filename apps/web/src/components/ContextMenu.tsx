import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { HandoffView, Takeover } from '@omni/shared/handoff.ts';
import { api, errorText, type Thread, type ThreadDetail } from '../api.ts';
import { sendThreadToGrokBot } from '../grokbot.ts';
import { useToast } from './Toaster.tsx';
import { draftKey, useFolders } from '../folders.tsx';
import { deviceRows, mayTakeOver } from '../handoff.ts';
import { canMarkDone } from '../needs-you.ts';
import { navigate, href, openNewThread, useRoute } from '../router.ts';
import { useApp } from '../store.tsx';
import { handOff, useHandoffTargets } from './thread/Handoff.tsx';
import { TakeoverConfirm } from './thread/Takeover.tsx';
import { Icon, Loader, StatusDot, type IconName } from './ui.tsx';

type Target = { kind: 'thread'; id: string } | { kind: 'channel'; id: string } | { kind: 'folder'; id: string };
/** `handoff`: open straight on the list of Macs the thread can go to, as the thread header's button does. */
type Open = { target: Target; x: number; y: number; handoff?: boolean };

const OPEN_EVENT = 'omni:context-menu';

/** Open the menu for `target` at a point, as a right-click there would: the "…" button on a folder, or a key. */
export function openMenu(target: Target, x: number, y: number, handoff?: boolean) {
  window.dispatchEvent(new CustomEvent<Open>(OPEN_EVENT, { detail: { target, x, y, handoff } }));
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
  // Take over's confirm outlives the menu, which closes on the first click outside it.
  const [taking, setTaking] = useState<{ threadId: string; takeover: Takeover } | null>(null);
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
  return (
    <>
      {/* A new open starts fresh, even over one already showing. */}
      {open && (
        <Menu
          key={`${open.target.kind}:${open.target.id}:${open.x}:${open.y}:${!!open.handoff}`}
          open={open}
          onClose={() => setOpen(null)}
          onTakeOver={(threadId, takeover) => {
            setOpen(null);
            setTaking({ threadId, takeover });
          }}
        />
      )}
      {/* The thread's stream brings the request to an open thread page. */}
      {taking && <TakeoverConfirm threadId={taking.threadId} takeover={taking.takeover} onClose={() => setTaking(null)} onChanged={() => {}} />}
    </>
  );
}

function Menu({ open, onClose, onTakeOver }: { open: Open; onClose: () => void; onTakeOver: (threadId: string, takeover: Takeover) => void }) {
  const { target } = open;
  const { channel, reloadChannels, setPinned, setDone } = useApp();
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
  // Set while the menu lists the Macs a running thread can be handed to.
  const [handingOff, setHandingOff] = useState(!!open.handoff);
  const [sending, setSending] = useState<string | null>(null);
  const sendingGrok = useRef(false);
  const toast = useToast();
  const [blocked, setBlocked] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<HandoffView | null>(null);
  const [takeover, setTakeover] = useState<Takeover | null>(null);
  const targets = useHandoffTargets(row, { blocked, handoff, takeover });
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
        setBlocked(d.blocked ?? null);
        setHandoff(d.handoff ?? null);
        setTakeover(d.takeover ?? null);
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
  }, [open.x, open.y, archived, error, moving, handingOff, targets.state]);

  // Keyboard: the first item takes the focus, arrows move it.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')?.focus();
  }, [moving, row, handingOff, targets.state]);
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

  const togglePin = async () => {
    if (!row) return;
    try {
      await setPinned(row, !row.pinned_at);
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const toggleDone = async () => {
    if (!row) return;
    try {
      await setDone(row.id, !row.done_at);
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

  const sendGrok = async () => {
    if (target.kind !== 'thread' || sendingGrok.current) return;
    sendingGrok.current = true;
    setError('');
    const result = await sendThreadToGrokBot(target.id);
    sendingGrok.current = false;
    if (result.ok) {
      toast({ title: 'Sent to Grok Bot', icon: 'external' });
      onClose();
      return;
    }
    setError(result.error);
  };

  const sendTo = async (to: string) => {
    if (!row) return;
    setSending(to);
    setError('');
    try {
      await handOff(row.id, to);
      onClose();
    } catch (e) {
      setError(errorText(e));
      setSending(null);
    }
  };

  // `off`: why the item cannot run here, shown under it.
  const items: { label: string; icon: IconName; run: () => void; off?: string | null }[] =
    target.kind === 'thread'
      ? [
          // Archived threads are out of the lists, so out of Pinned too.
          ...(row && !archived ? [{ label: row.pinned_at ? 'Unpin thread' : 'Pin thread', icon: 'pin' as const, run: () => void togglePin() }] : []),
          // A running thread brings its own result; done waits until it ends.
          ...(row && (row.done_at || canMarkDone(row.status))
            ? [{ label: row.done_at ? 'Mark as not done' : 'Mark as done', icon: 'check' as const, run: () => void toggleDone() }]
            : []),
          { label: 'Rename thread', icon: 'pencil', run: () => setDraft(current ?? '') },
          ...(row && !row.parent_id ? [{ label: 'Move to folder', icon: 'folder' as const, run: () => setMoving(true) }] : []),
          ...(targets.state === 'ready' ? [{ label: 'Hand off to…', icon: 'share' as const, run: () => setHandingOff(true) }] : []),
          ...(takeover && mayTakeOver(takeover, handoff)
            ? [{ label: `Take over from ${takeover.from.name}`, icon: 'download' as const, run: () => onTakeOver(target.id, takeover) }]
            : []),
          { label: 'Send to Grok Bot', icon: 'grok', run: () => void sendGrok() },
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
      aria-label={target.kind === 'thread' ? (moving ? 'Move to folder' : handingOff ? 'Hand off to' : 'Thread actions') : target.kind === 'folder' ? 'Folder actions' : 'Channel actions'}
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={onKey}
      className="pop-in fixed z-[60] min-w-[190px] max-w-[280px] rounded-[16px] bg-elev p-1.5 shadow-[var(--shadow-menu)]"
    >
      {title && <div className="caption truncate px-2.5 pt-1 pb-1.5 text-fg-4">{title}</div>}
      {handingOff ? (
        <>
          <div className="caption truncate px-2.5 pt-1 pb-1.5 text-fg-4">Hand off to</div>
          {!row || targets.state === 'loading' ? (
            <div className="flex h-8 items-center gap-2 px-2.5 text-[12px] text-fg-4">
              <Loader size={12} /> Looking for your other Macs
            </div>
          ) : targets.state === 'none' ? (
            <div className="px-2.5 py-1.5 text-[12px] text-fg-4">{targets.reason}</div>
          ) : (
            deviceRows(targets.devices).map((d) => (
              <button
                key={d.id}
                role="menuitem"
                disabled={!d.pickable || !!sending}
                aria-disabled={!d.pickable || undefined}
                onClick={() => void sendTo(d.id)}
                title={d.pickable ? `Continue this thread on ${d.name}` : `${d.name} is asleep or offline`}
                className="hov flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left text-fg-2 hover:text-fg disabled:pointer-events-none disabled:opacity-45"
              >
                {sending === d.id ? <Loader size={12} /> : <StatusDot status={d.dot} size={8} className="mx-[3px]" />}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] leading-snug">{d.name}</span>
                  <span className="truncate text-[11.5px] leading-snug text-fg-4">{d.label}</span>
                </span>
              </button>
            ))
          )}
        </>
      ) : moving && row ? (
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
        <button
          key={it.label}
          role="menuitem"
          aria-disabled={!!it.off || undefined}
          onClick={it.off ? undefined : it.run}
          className={`${it.off ? 'opacity-45' : 'hov hover:text-fg'} flex min-h-8 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[13px] text-fg-2`}
        >
          <Icon name={it.icon} size={14} className="text-fg-3" />
          {it.off ? (
            <span className="flex min-w-0 flex-col py-1.5">
              <span>{it.label}</span>
              <span className="text-[11.5px] leading-snug text-fg-4">{it.off}</span>
            </span>
          ) : (
            it.label
          )}
        </button>
      )))}
      {error && <div className="px-2.5 py-1.5 text-[12px] leading-snug break-words text-pretty text-fg-3">{error}</div>}
    </div>
  );
}
