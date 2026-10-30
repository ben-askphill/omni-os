import { useRef, useState, type DragEvent } from 'react';
import { taskHost, type BackgroundTask, type ChannelWithRunning, type FolderWithThreads } from '../../api.ts';
import { FOLDER_NAME_MAX, drag, draftKey, useFolders } from '../../folders.tsx';
import { openMenu } from '../ContextMenu.tsx';
import { plural } from '../../format.ts';
import { Loader } from '../brand.tsx';
import { Icon } from '../ui.tsx';
import { ChannelThreadEntry } from './SidebarRows.tsx';

/** A folder's name being typed: Enter or leaving the field saves, Escape cancels. */
export function FolderNameField({ initial, onSave, onCancel }: { initial: string; onSave: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  // Escape blurs the field too; it must not then save.
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) onSave(value);
    else onCancel();
  };
  return (
    <div className="flex h-8 items-center gap-2 rounded-full pr-1.5 pl-3 md:h-7">
      <Icon name="folder" size={13} className="shrink-0 text-fg-3" />
      <input
        autoFocus
        value={value}
        maxLength={FOLDER_NAME_MAX}
        aria-label="Folder name"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') finish(true);
          else if (e.key === 'Escape') finish(false);
        }}
        onBlur={() => finish(true)}
        className="h-6 min-w-0 flex-1 rounded-[8px] bg-surface px-2 text-[12.5px] text-fg shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none"
      />
    </div>
  );
}

/** Whether a drop on this folder would do something: a thread of its channel from elsewhere, or another of its folders. */
function accepts(f: FolderWithThreads) {
  const d = drag.get();
  if (!d || f.id.startsWith('tmp-')) return false;
  if (d.kind === 'thread') return d.thread.channel_id === f.channel_id && d.thread.folder_id !== f.id;
  return d.channel_id === f.channel_id && d.id !== f.id;
}

/**
 * A folder under its channel: chevron, name, thread count and a loader while any thread in it runs. Click opens and
 * closes it, double-click or F2 renames, Delete asks to delete, and the "…" button or a right-click opens its menu.
 * Drop a thread on it to file it; drop another folder on it to put that one just above.
 */
export function FolderRow({ f, openId, tasks, handoffs, onNavigate }: { f: FolderWithThreads; openId: string | null; tasks: BackgroundTask[]; handoffs: ChannelWithRunning['handoffs']; onNavigate?: () => void }) {
  const folders = useFolders();
  const [over, setOver] = useState<'thread' | 'folder' | null>(null);
  const [all, setAll] = useState(false);
  const editing = folders.editing === f.id;
  const open = !f.collapsed;
  const agents = (id: string) => tasks.filter((k) => taskHost(k) === id);
  const busy = f.running > 0 || f.threads.some((t) => agents(t.id).length > 0);
  // Closed, it still shows the open thread, so the highlight never vanishes into it.
  const list = open ? f.threads : f.threads.filter((t) => t.id === openId);
  // Past the limit it still shows the open thread and any with agents running, so they never hide behind "N more".
  const shown = all ? list : list.filter((t, i) => i < MAX_FOLDER_THREADS || t.id === openId || agents(t.id).length > 0);
  const label = `${f.name}, ${plural(f.count, 'thread')}${f.running ? `, ${f.running} running` : ''}`;

  const onOver = (e: DragEvent) => {
    if (!accepts(f)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setOver(drag.get()!.kind);
  };
  const onDrop = (e: DragEvent) => {
    const d = drag.get();
    setOver(null);
    if (!d || !accepts(f)) return;
    e.preventDefault();
    drag.end();
    if (d.kind === 'thread') void folders.moveThread(d.thread, f.id);
    else void folders.reorder(f.channel_id, d.id, f.id);
  };

  return (
    <div>
      {editing ? (
        <FolderNameField
          initial={f.name}
          onSave={(name) => (folders.setEditing(null), void folders.rename(f.id, name))}
          onCancel={() => folders.setEditing(null)}
        />
      ) : (
        <div
          data-folder-id={f.id}
          className={`group/folder flex items-center rounded-full transition-shadow ${
            over === 'thread' ? 'bg-wash shadow-[inset_0_0_0_1px_var(--line-strong)]' : over === 'folder' ? 'shadow-[inset_0_2px_0_0_var(--fg-3)]' : ''
          }`}
          onDragOver={onOver}
          onDragLeave={() => setOver(null)}
          onDrop={onDrop}
        >
          <button
            type="button"
            draggable
            onDragStart={(e) => {
              drag.start({ kind: 'folder', id: f.id, channel_id: f.channel_id });
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', f.name);
            }}
            onDragEnd={() => (drag.end(), setOver(null))}
            onClick={() => void folders.toggle(f.id)}
            onDoubleClick={(e) => {
              e.preventDefault();
              folders.setEditing(f.id);
            }}
            onKeyDown={(e) => {
              if (e.key === 'F2') (e.preventDefault(), folders.setEditing(f.id));
              else if (e.key === 'Delete' || (e.key === 'Backspace' && (e.metaKey || e.ctrlKey))) (e.preventDefault(), folders.askDelete(f.id));
              else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                openMenu({ kind: 'folder', id: f.id }, r.left + 24, r.bottom);
              }
            }}
            aria-expanded={open}
            aria-label={label}
            title={`${label}. Double-click or F2 to rename.`}
            className="hov z-[1] flex h-8 min-w-0 flex-1 items-center gap-2 rounded-full pr-1 pl-3 text-left text-[13px] text-fg-2 transition-colors hover:text-fg md:h-7 md:text-[12.5px]"
          >
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} className="-ml-0.5 shrink-0 text-fg-4" />
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
            {busy && <Loader size={11} className="shrink-0 text-live-text" />}
            <span className="shrink-0 font-num text-[11px] text-fg-4 tabular-nums transition-opacity md:group-focus-within/folder:opacity-0 md:group-hover/folder:opacity-0">
              {f.count}
            </span>
          </button>
          <button
            type="button"
            aria-label={`${f.name} actions`}
            title="Folder actions"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              openMenu({ kind: 'folder', id: f.id }, r.left, r.bottom + 4);
            }}
            className="hov relative z-[2] -ml-7 grid h-6 w-6 shrink-0 place-items-center rounded-full text-fg-3 opacity-100 transition-opacity hover:text-fg focus-visible:opacity-100 md:opacity-0 md:group-hover/folder:opacity-100 md:group-focus-within/folder:opacity-100"
          >
            <Icon name="more" size={14} />
          </button>
        </div>
      )}
      {shown.map((t) => (
        <ChannelThreadEntry key={t.id} t={t} active={t.id === openId} tasks={agents(t.id)} handoffs={handoffs} onNavigate={onNavigate} />
      ))}
      {open && !all && list.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="hov z-[1] ml-[25px] flex h-7 items-center rounded-full pr-3 pl-8 text-[12px] text-fg-4 transition-colors hover:text-fg-2">
          {list.length - shown.length} more
        </button>
      )}
      {open && f.count > f.threads.length && all && (
        <span className="ml-[25px] flex h-7 items-center pr-3 pl-8 text-[12px] text-fg-4">{f.count - f.threads.length} older not shown</span>
      )}
      {open && f.count === 0 && <div className="ml-[25px] truncate pr-3 pl-8 text-[12px] leading-7 text-fg-4">No threads yet</div>}
    </div>
  );
}

/** The "+" beside a channel's name: a new folder under it, with its name field open. */
export function AddFolderButton({ c, onOpen }: { c: ChannelWithRunning; onOpen: () => void }) {
  const folders = useFolders();
  return (
    <button
      type="button"
      aria-label={`New folder in ${c.name}`}
      title="New folder"
      onClick={() => (onOpen(), folders.setEditing(draftKey(c.id)))}
      className="hov relative z-[2] -ml-8 mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-full text-fg-3 transition-opacity hover:text-fg focus-visible:opacity-100 md:opacity-0 md:group-hover/ch:opacity-100 md:group-focus-within/ch:opacity-100"
    >
      <Icon name="folderPlus" size={14} />
    </button>
  );
}

/** Past this many threads an open folder shows "N more". */
const MAX_FOLDER_THREADS = 8;
