import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, errorText, type Thread, type ThreadDetail } from '../api.ts';
import { navigate, href, useRoute } from '../router.ts';
import { useApp } from '../store.tsx';
import { Icon, type IconName } from './ui.tsx';

type Target = { kind: 'thread'; id: string } | { kind: 'channel'; id: string };
type Open = { target: Target; x: number; y: number };

const THREAD_HREF = /^#\/t\/([^/?]+)/;

/** What was right-clicked: a link to a thread anywhere in the app, or a row marked data-channel-id. */
function targetOf(el: EventTarget | null): Target | null {
  if (!(el instanceof Element)) return null;
  const channel = el.closest<HTMLElement>('[data-channel-id]');
  const link = el.closest<HTMLAnchorElement>('a[href^="#/t/"]');
  // A thread row inside a channel's block wins over the channel: it is the more specific target.
  if (link) {
    const m = THREAD_HREF.exec(link.getAttribute('href') ?? '');
    if (m) return { kind: 'thread', id: decodeURIComponent(m[1]!) };
  }
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
    document.addEventListener('contextmenu', onMenu);
    return () => document.removeEventListener('contextmenu', onMenu);
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

  // Ask for the thread's state so the item reads "Unarchive" on one that is.
  useEffect(() => {
    if (target.kind !== 'thread') return;
    let live = true;
    api
      .get<ThreadDetail>(`/threads/${encodeURIComponent(target.id)}`)
      .then((d) => live && setArchived(!!d.thread.archived))
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
  }, [open.x, open.y, archived, error]);

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

  const items: { label: string; icon: IconName; run: () => void }[] =
    target.kind === 'thread'
      ? [{ label: archived ? 'Unarchive thread' : 'Archive thread', icon: 'archive', run: toggleArchive }]
      : [
          { label: 'Channel settings', icon: 'sliders', run: () => (navigate(href.settings(target.id)), onClose()) },
        ];
  const title = target.kind === 'channel' ? channel(target.id)?.name : undefined;

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={target.kind === 'thread' ? 'Thread actions' : 'Channel actions'}
      style={{ left: pos.x, top: pos.y }}
      className="pop-in fixed z-[60] min-w-[190px] rounded-[16px] bg-elev p-1.5 shadow-[var(--shadow-menu)]"
    >
      {title && <div className="caption truncate px-2.5 pt-1 pb-1.5 text-fg-4">#{title}</div>}
      {items.map((it) => (
        <button key={it.label} role="menuitem" onClick={it.run} className="hov flex h-8 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[13px] text-fg-2 hover:text-fg">
          <Icon name={it.icon} size={14} className="text-fg-3" />
          {it.label}
        </button>
      ))}
      {error && <div className="px-2.5 py-1.5 text-[12px] text-fg-3">{error}</div>}
    </div>
  );
}
