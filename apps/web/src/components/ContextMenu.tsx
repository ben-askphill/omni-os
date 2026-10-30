import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Takeover } from '@omni/shared/handoff.ts';
import { threadMenu, type ThreadActionId } from '@omni/shared/thread-actions.ts';
import { useFolders } from '../folders.tsx';
import { mayTakeOver } from '../handoff.ts';
import { canMarkDone } from '../needs-you.ts';
import { useApp } from '../store.tsx';
import { openContinue } from './ContinueSheet.tsx';
import { useThreadMenuActions } from './useThreadMenuActions.ts';
import { ThreadReferencePanel } from './ThreadReference.tsx';
import { useHandoffTargets } from './thread/Handoff.tsx';
import { TakeoverConfirm } from './thread/Takeover.tsx';
import { FolderChoices, HandoffList, MenuGroups, containerItems, focusFirstItem, moveFocus, useMenuDismiss, useMenuPlacement, useThreadRow, type MenuItem } from './ContextMenuParts.tsx';

type Target = { kind: 'thread'; id: string } | { kind: 'channel'; id: string } | { kind: 'folder'; id: string };
type Open = { target: Target; x: number; y: number };

const OPEN_EVENT = 'omni:context-menu';

/** Open the menu for `target` at a point, as a right-click there would: the "…" button on a folder or the thread header, or a key. */
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
          key={`${open.target.kind}:${open.target.id}:${open.x}:${open.y}`}
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
  const { channel, status } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  // Set while the menu shows the title field in place of its items.
  const [draft, setDraft] = useState<string | null>(null);
  // Set while the menu lists the folders a thread can move to.
  const [moving, setMoving] = useState(false);
  // Set while the menu lists the Macs a running thread can be handed to.
  const [handingOff, setHandingOff] = useState(false);
  // Set while the menu shows the thread reference picker.
  const [referencing, setReferencing] = useState(false);
  const { archived, current, row, blocked, handoff, takeover } = useThreadRow(target.kind, target.id);
  const { error, sending, toggleArchive, rename: renameTo, togglePin, toggleDone, sendGrok, sendTo } = useThreadMenuActions({ id: target.id, row, archived, current, onClose });
  const targets = useHandoffTargets(row, { blocked, handoff, takeover });
  const folders = useFolders();

  const pos = useMenuPlacement(ref, open.x, open.y);

  // Keyboard: the first item takes the focus, arrows move it.
  useEffect(() => {
    focusFirstItem(ref);
  }, [moving, row, handingOff, targets.state]);
  const onKey = (e: ReactKeyboardEvent) => {
    // The reference picker's search and list keep their own keys.
    if (referencing || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    moveFocus(ref, e.key);
  };

  useMenuDismiss(ref, onClose);

  const folder = target.kind === 'folder' ? folders.find(target.id) : undefined;
  // The folders the thread can move to: its channel's, once its row has come.
  const choices = row ? (channel(row.channel_id)?.folders ?? []).filter((f) => !f.id.startsWith('tmp-')) : [];
  const moveTo = (folderId: string | null) => {
    if (row) void folders.moveThread({ id: row.id, channel_id: row.channel_id, title: row.title, status: row.status, created_at: row.created_at, folder_id: row.folder_id }, folderId);
    onClose();
  };

  // The thread's actions, from the list the phone and the Mac app render too. `off`: why one cannot run here, shown under it.
  const takeOverNow = takeover && mayTakeOver(takeover, handoff) ? takeover : null;
  const runs: Record<ThreadActionId, () => void> = {
    pin: () => void togglePin(),
    done: () => void toggleDone(),
    rename: () => setDraft(current ?? ''),
    move: () => setMoving(true),
    archive: () => void toggleArchive(),
    fork: () => (row && openContinue(row), onClose()),
    reference: () => setReferencing(true),
    handoff: () => setHandingOff(true),
    takeover: () => takeOverNow && onTakeOver(target.id, takeOverNow),
    grok: () => void sendGrok(),
  };
  const groups: { title?: string; items: MenuItem[] }[] =
    target.kind === 'thread'
      ? threadMenu({
          row: !!row,
          archived: !!archived,
          pinned: !!row?.pinned_at,
          done: !!row?.done_at,
          settled: !!row && canMarkDone(row.status),
          child: !!row?.parent_id,
          harness: row?.harness ?? null,
          handOff: targets.state === 'ready',
          takeOverFrom: takeOverNow?.from.name ?? null,
          grokBot: !!status?.grokBot,
        }).map((g) => ({ title: g.title, items: g.items.map((it) => ({ ...it, run: runs[it.id] })) }))
      : [{ items: containerItems(target, folders, onClose) }];
  const title = target.kind === 'channel' ? `#${channel(target.id)?.name ?? ''}` : folder ? folder.name : undefined;

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={target.kind === 'thread' ? (moving ? 'Move to folder' : handingOff ? 'Hand off to' : referencing ? 'Reference a thread' : 'Thread actions') : target.kind === 'folder' ? 'Folder actions' : 'Channel actions'}
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={onKey}
      className={`pop-in fixed z-[60] ${referencing ? 'max-h-[calc(100vh-1rem)] w-[min(23rem,calc(100vw-1rem))] overflow-y-auto rounded-[22px]' : 'min-w-[190px] max-w-[280px] rounded-[16px] p-1.5'} bg-elev shadow-[var(--shadow-menu)]`}
    >
      {title && <div className="caption truncate px-2.5 pt-1 pb-1.5 text-fg-4">{title}</div>}
      {referencing && row ? (
        <ThreadReferencePanel thread={row} onPicked={onClose} />
      ) : handingOff ? (
        <HandoffList targets={targets} loaded={!!row} sending={sending} onPick={(id) => void sendTo(id)} />
      ) : moving && row ? (
        <FolderChoices current={row.folder_id ?? null} choices={choices} onPick={moveTo} />
      ) : draft !== null ? (
        <input
          autoFocus
          value={draft}
          maxLength={200}
          aria-label="Thread title"
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && renameTo(draft)}
          className="h-8 w-[260px] rounded-[10px] bg-surface px-2.5 text-[13px] text-fg outline-none"
        />
      ) : (
        <MenuGroups groups={groups} />
      )}
      {error && <div className="px-2.5 py-1.5 text-[12px] leading-snug break-words text-pretty text-fg-3">{error}</div>}
    </div>
  );
}
