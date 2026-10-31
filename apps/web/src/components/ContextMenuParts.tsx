import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { api, type Thread, type ThreadDetail } from '../api.ts';
import { draftKey, type useFolders } from '../folders.tsx';
import { navigate, href, openNewThread } from '../router.ts';
import { Icon, type IconName } from './ui.tsx';

/** A thread's row and the state that decides its menu, asked for once the menu opens so "Unarchive" reads right. */
export function useThreadRow(kind: string, id: string) {
  const [archived, setArchived] = useState<boolean | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [row, setRow] = useState<Thread | null>(null);
  useEffect(() => {
    if (kind !== 'thread') return;
    let live = true;
    api
      .get<ThreadDetail>(`/threads/${encodeURIComponent(id)}`)
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
  }, [kind, id]);
  return { archived, current, row };
}

/** Keep the menu inside the window, also as the reference picker's list comes in and grows it. */
export function useMenuPlacement(ref: RefObject<HTMLDivElement | null>, x: number, y: number) {
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const r = el.getBoundingClientRect();
      setPos({ x: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), y: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) });
    };
    place();
    const watch = new ResizeObserver(place);
    watch.observe(el);
    return () => watch.disconnect();
  }, [ref, x, y]);
  return pos;
}

/** Close on a press or right-click outside, Escape, and anything that moves the page under the menu. */
export function useMenuDismiss(ref: RefObject<HTMLDivElement | null>, onClose: () => void) {
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
  }, [ref, onClose]);
}

const ITEMS = '[role="menuitem"], [role="menuitemradio"]';

/** Focus the first item whenever the menu swaps what it shows. */
export function focusFirstItem(ref: RefObject<HTMLDivElement | null>) {
  ref.current?.querySelector<HTMLElement>(ITEMS)?.focus();
}

/** Arrow keys walk the items, wrapping at the ends. */
export function moveFocus(ref: RefObject<HTMLDivElement | null>, key: 'ArrowDown' | 'ArrowUp') {
  const items = [...(ref.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
  const i = items.indexOf(document.activeElement as HTMLElement);
  items[(i + (key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
}

const CAPTION = 'caption truncate px-2.5 pt-1 pb-1.5 text-fg-4';

export function MenuCaption({ children }: { children: string }) {
  return <div className={CAPTION}>{children}</div>;
}

/** The folders a thread can move to, its own marked. */
export function FolderChoices({ current, choices, onPick }: { current: string | null; choices: { id: string; name: string }[]; onPick: (folderId: string | null) => void }) {
  return (
    <>
      <MenuCaption>Move to folder</MenuCaption>
      {[{ id: null as string | null, name: 'No folder' }, ...choices].map((f) => {
        const on = current === f.id;
        return (
          <button
            key={f.id ?? ''}
            role="menuitemradio"
            aria-checked={on}
            onClick={() => onPick(f.id)}
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
  );
}

export type MenuItem = { id?: string; label: string; icon: IconName; run: () => void; hint?: string; off?: string | null };

/** The menu's items, in titled groups; one that cannot run here says why under its label. */
export function MenuGroups({ groups }: { groups: { title?: string; items: MenuItem[] }[] }) {
  return (
    <>
      {groups.map((g, gi) => (
        <div key={g.title ?? gi} role={g.title ? 'group' : undefined} aria-label={g.title}>
          {g.title && <div className={`caption truncate px-2.5 pb-1 text-fg-4 ${gi ? 'mt-1 border-t border-line pt-2' : 'pt-1'}`}>{g.title}</div>}
          {g.items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              aria-disabled={!!it.off || undefined}
              title={it.off ? undefined : it.hint}
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
          ))}
        </div>
      ))}
    </>
  );
}

/** The folder menu (new thread here, rename, duplicate, delete) or the channel menu (new folder, settings). */
export function containerItems(target: { kind: 'folder' | 'channel'; id: string }, folders: ReturnType<typeof useFolders>, onClose: () => void): MenuItem[] {
  if (target.kind === 'channel') {
    return [
      { label: 'New folder', icon: 'folderPlus', run: () => (folders.setEditing(draftKey(target.id)), onClose()) },
      { label: 'Channel settings', icon: 'sliders', run: () => (navigate(href.settings(target.id)), onClose()) },
    ];
  }
  const folder = folders.find(target.id);
  if (!folder) return [];
  return [
    { label: 'New thread here', icon: 'plus', run: () => (openNewThread({ channel: folder.channel_id, folder: { id: folder.id, name: folder.name } }), onClose()) },
    { label: 'Rename', icon: 'pencil', run: () => (folders.setEditing(folder.id), onClose()) },
    { label: 'Duplicate', icon: 'copy', run: () => (void folders.duplicate(folder.id), onClose()) },
    { label: 'Delete', icon: 'trash', run: () => (folders.askDelete(folder.id), onClose()) },
  ];
}
