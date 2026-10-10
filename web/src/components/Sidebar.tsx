import { Fragment, useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { BackgroundTask, ChannelWithRunning, FolderWithThreads, HarnessId, ThreadStub, Usage, UsageWindow } from '../api.ts';
import { DEFAULT_FOLDER_NAME, FOLDER_NAME_MAX, drag, draftKey, freeName, useFolders } from '../folders.tsx';
import { openMenu } from './ContextMenu.tsx';
import { duration, plural, toDate, untilLabel } from '../format.ts';
import { href, navigate, requestComposerFocus, useHash, useRoute } from '../router.ts';
import { readPref, useApp, useNow, writePref } from '../store.tsx';
import { parseChannelIcon } from '../../../shared/channel-icon.ts';
import { ThemeSwitch } from './theme.tsx';
import { HarnessLogo, Loader, OmniMark } from './brand.tsx';
import { ChannelMark, ErrorNote, Icon, Kbd, STATUS_LABEL, StatusDot, Thumb, Ticks, useSlidingThumb, Wordmark, type IconName } from './ui.tsx';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const HARNESS_ROWS: { id: HarnessId; name: string }[] = [
  { id: 'claude-code', name: 'Claude' },
  { id: 'codex', name: 'Codex' },
  { id: 'cursor', name: 'Cursor' },
  { id: 'hermes', name: 'Hermes' },
];

const windowPct = (w?: UsageWindow) => {
  if (!w) return null;
  const raw = w.utilization > 1.5 ? w.utilization / 100 : w.utilization;
  return Math.max(0, Math.min(1, raw));
};

/** One window's tick bar and percentage, with the reset time on hover. */
function WindowCell({ w, label }: { w?: UsageWindow; label: string }) {
  const pct = windowPct(w);
  if (pct === null) return <span className="flex-1 text-center font-num text-[10px] text-fg-4">—</span>;
  const tone = pct >= 0.9 ? 'needs' : undefined;
  return (
    <div
      className="flex flex-1 items-center gap-1.5"
      title={`${label}: ${Math.round(pct * 100)}% used, resets ${new Date(w!.resetsAt * 1000).toLocaleString('en-GB')} (${untilLabel(w!.resetsAt)})`}
    >
      <Ticks value={pct} count={10} height={10} tone={tone} className="flex-1" label={`${label} usage`} />
      <span className="w-7 text-right font-num text-[10px] text-fg-2 tabular-nums">{Math.round(pct * 100)}%</span>
    </div>
  );
}

/** One plan's row: the 5-hour and weekly windows, or "no data" for a harness that reports none. */
function HarnessUsageRow({ id, name, usage }: { id: HarnessId; name: string; usage?: Usage | null }) {
  useNow(60_000);
  const noData = !usage || (!usage.five_hour && !usage.seven_day);
  return (
    <div className="flex items-center gap-2">
      <span className="caption inline-flex w-[66px] shrink-0 items-center gap-1.5 text-fg-2">
        <span className="text-fg"><HarnessLogo harness={id} size={12} /></span>
        {name}
      </span>
      {noData ? (
        <span className="flex-1 text-[10.5px] text-fg-4">no data</span>
      ) : (
        <>
          <WindowCell w={usage!.five_hour} label={`${name} 5h`} />
          <WindowCell w={usage!.seven_day} label={`${name} week`} />
        </>
      )}
    </div>
  );
}

/** Plan usage per harness. Collapsed by default to one row with the live dot and the busiest window; click to open. */
function UsageCard() {
  const { usage, status, feedLive } = useApp();
  const [open, setOpen] = useState(() => readPref('usage.open', false));
  const toggle = () => setOpen((o) => { writePref('usage.open', !o); return !o; });
  const slots = status?.slots ?? {};
  const footer = HARNESS_ROWS.filter((r) => slots[r.id]).map((r) => `${r.name} ${slots[r.id]!.running}/${slots[r.id]!.cap}`).join(' · ');
  const peak = HARNESS_ROWS.reduce<number | null>((max, r) => {
    const u = usage[r.id];
    for (const p of [windowPct(u?.five_hour), windowPct(u?.seven_day)]) if (p !== null && (max === null || p > max)) max = p;
    return max;
  }, null);
  return (
    <div className="rounded-[20px] bg-bg/70 shadow-[var(--shadow-card)]">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-[20px] px-3 py-2.5 text-[11px] text-fg-3 hover:text-fg"
      >
        <span className="relative inline-block h-1.5 w-1.5 shrink-0" title={feedLive ? 'Live' : 'Reconnecting'}>
          {feedLive && <span className="ping absolute inset-0 rounded-full bg-done" />}
          <span className={`absolute inset-0 rounded-full ${feedLive ? 'bg-done' : 'bg-fg-4'}`} />
        </span>
        <span className="font-medium text-fg-2">Usage</span>
        <span className="min-w-0 flex-1 truncate text-left font-num tabular-nums">
          {open ? '' : footer || (feedLive ? 'Connected' : 'Connecting')}
        </span>
        {peak !== null && !open && (
          <span className={`font-num text-[10px] tabular-nums ${peak >= 0.9 ? 'text-needs' : 'text-fg-2'}`} title="Highest window across plans">
            {Math.round(peak * 100)}%
          </span>
        )}
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} className="shrink-0 text-fg-4" />
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-3">
          <div className="flex items-center gap-2 pb-0.5 text-[11px] font-medium text-fg-4">
            <span className="w-[66px] shrink-0" />
            <span className="flex-1">5h</span>
            <span className="flex-1">Week</span>
          </div>
          {HARNESS_ROWS.map((r) => (
            <HarnessUsageRow key={r.id} id={r.id} name={r.name} usage={usage[r.id]} />
          ))}
          <div className="flex items-center gap-2 border-t border-line pt-2.5 text-[11px] text-fg-3">
            {footer ? (
              <span className="font-num tabular-nums">{footer}</span>
            ) : (
              <span>{feedLive ? 'Connected' : 'Connecting'}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NavLink({ to, icon, lead, active, children, right, onNavigate, channelId }: { channelId?: string; to: string; icon?: IconName; lead?: ReactNode; active?: boolean; children: ReactNode; right?: ReactNode; onNavigate?: () => void }) {
  return (
    <a
      href={to}
      data-channel-id={channelId}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      data-active={active || undefined}
      className={`hov z-[1] flex h-9 items-center gap-2.5 rounded-full px-3 text-[13.5px] transition-colors md:h-8 md:text-[13px] ${
        active ? 'font-medium text-fg [--hov:transparent]' : 'text-fg-2 hover:text-fg'
      }`}
    >
      {icon && <Icon name={icon} size={15} className={active ? 'text-fg' : 'text-fg-3'} />}
      {lead}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {right}
    </a>
  );
}

function RunningBadge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="flex items-center gap-1.5 font-num text-[11px] text-live-text tabular-nums" title={`${n} running or queued`}>
      <StatusDot status="running" size={6} />
      {n}
    </span>
  );
}

/**
 * A thread nested under its channel, like a Claude Code session under its project, or one level deeper in a folder.
 * Dragged onto a folder it files there; onto its channel's name, back to the ungrouped list.
 */
function ThreadLink({ t, active, agents, onNavigate, nested }: { t: ThreadStub; active: boolean; agents: number; onNavigate?: () => void; nested?: boolean }) {
  const title = t.title || 'Untitled';
  // A thread whose turn ended still works while its sub-agents run.
  const busy = t.status === 'running' || agents > 0;
  return (
    <a
      href={href.thread(t.id)}
      onClick={onNavigate}
      draggable
      onDragStart={(e) => {
        drag.start({ kind: 'thread', thread: t });
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', title);
      }}
      onDragEnd={drag.end}
      title={`${title} · ${agents ? plural(agents, 'agent') + ' running' : (STATUS_LABEL[t.status] ?? t.status)}`}
      aria-current={active ? 'page' : undefined}
      data-active={active || undefined}
      className={`hov z-[1] flex h-8 items-center gap-2 rounded-full px-3 text-[13px] transition-colors md:h-7 md:text-[12.5px] ${nested ? 'ml-[43px]' : 'ml-[25px]'} ${
        active ? 'font-medium text-fg [--hov:transparent]' : 'text-fg-3 hover:text-fg'
      }`}
    >
      <span className="grid w-3 shrink-0 place-items-center">
        {busy ? <Loader size={11} className="text-live-text" /> : <StatusDot status={t.status} size={7} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
    </a>
  );
}

/** A sub-agent running anywhere, linking to the thread that started it. */
function AgentLink({ t, channel, onNavigate }: { t: BackgroundTask; channel?: string; onNavigate?: () => void }) {
  const now = useNow(1000);
  const tip = [t.description, channel && `#${channel}`, t.tool_uses ? plural(t.tool_uses, 'tool') : null, t.last_tool && `last ${t.last_tool}`].filter(Boolean).join(' · ');
  return (
    <a href={href.thread(t.thread_id)} onClick={onNavigate} title={tip} className="hov z-[1] flex h-9 items-center gap-2.5 rounded-full px-3 text-[13px] text-fg-2 transition-colors hover:text-fg md:h-8 md:text-[12.5px]">
      <span className="grid w-[15px] shrink-0 place-items-center">
        <Loader size={11} className="text-live-text" />
      </span>
      <span className="min-w-0 flex-1 truncate">{t.description}</span>
      <span className="shrink-0 font-num text-[11px] text-fg-4 tabular-nums">{duration(Math.max(0, now - toDate(t.started_at).getTime()))}</span>
    </a>
  );
}

/** A folder's name being typed: Enter or leaving the field saves, Escape cancels. */
function FolderNameField({ initial, onSave, onCancel }: { initial: string; onSave: (name: string) => void; onCancel: () => void }) {
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
    <div className="ml-[25px] flex h-8 items-center gap-2 rounded-full pr-1.5 pl-3 md:h-7">
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
function FolderRow({ f, openId, tasks, onNavigate }: { f: FolderWithThreads; openId: string | null; tasks: BackgroundTask[]; onNavigate?: () => void }) {
  const folders = useFolders();
  const [over, setOver] = useState<'thread' | 'folder' | null>(null);
  const [all, setAll] = useState(false);
  const editing = folders.editing === f.id;
  const open = !f.collapsed;
  const agents = (id: string) => tasks.filter((k) => k.thread_id === id).length;
  const busy = f.running > 0 || f.threads.some((t) => agents(t.id) > 0);
  // Closed, it still shows the open thread, so the highlight never vanishes into it.
  const list = open ? f.threads : f.threads.filter((t) => t.id === openId);
  const shown = all ? list : list.filter((t, i) => i < MAX_FOLDER_THREADS || t.id === openId);
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
          className={`group/folder ml-[25px] flex items-center rounded-full transition-shadow ${
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
        <ThreadLink key={t.id} t={t} nested active={t.id === openId} agents={agents(t.id)} onNavigate={onNavigate} />
      ))}
      {open && !all && list.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="hov z-[1] ml-[43px] flex h-7 items-center rounded-full pr-3 pl-8 text-[12px] text-fg-4 transition-colors hover:text-fg-2">
          {list.length - shown.length} more
        </button>
      )}
      {open && f.count > f.threads.length && all && (
        <span className="ml-[43px] flex h-7 items-center pr-3 pl-8 text-[12px] text-fg-4">{f.count - f.threads.length} older not shown</span>
      )}
      {open && f.count === 0 && <div className="ml-[43px] truncate pr-3 pl-8 text-[12px] leading-7 text-fg-4">No threads yet</div>}
    </div>
  );
}

/** The "+" beside a channel's name: a new folder under it, with its name field open. */
function AddFolderButton({ c }: { c: ChannelWithRunning }) {
  const folders = useFolders();
  return (
    <button
      type="button"
      aria-label={`New folder in ${c.name}`}
      title="New folder"
      onClick={() => folders.setEditing(draftKey(c.id))}
      className="hov relative z-[2] -ml-8 mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-full text-fg-3 transition-opacity hover:text-fg focus-visible:opacity-100 md:opacity-0 md:group-hover/ch:opacity-100 md:group-focus-within/ch:opacity-100"
    >
      <Icon name="folderPlus" size={14} />
    </button>
  );
}

/** Past this many threads an open folder shows "N more". */
const MAX_FOLDER_THREADS = 8;

/** Past this many threads a channel shows "N more" (or "See all threads" when highlighted) and links to its full list. */
const MAX_THREADS = 5;

const newestFirst = (a: ThreadStub, b: ThreadStub) => b.created_at.localeCompare(a.created_at);

const GROUPS: { kind: string; label: string }[] = [
  { kind: 'client', label: 'Clients' },
  { kind: 'internal', label: 'Internal' },
  { kind: 'personal', label: 'Personal' },
];

export function Sidebar({ onNavigate, onSearch }: { onNavigate?: () => void; onSearch: () => void }) {
  const route = useRoute();
  const hash = useHash();
  const { channels, channelsError, openThread, tasks } = useApp();
  const folders = useFolders();
  const listRef = useRef<HTMLDivElement>(null);
  // The channel whose name a thread is being dragged over, to take it out of its folder.
  const [dropOn, setDropOn] = useState<string | null>(null);

  const activeChannel = route.name === 'channel' ? route.id : null;
  const openId = route.name === 'thread' ? route.id : null;
  const conductor = channels.find((c) => c.id === 'conductor');
  const rest = channels.filter((c) => c.id !== 'conductor');
  const other = rest.filter((c) => !GROUPS.some((g) => g.kind === c.kind));

  // The highlighted channel: the one open, or the one the open thread belongs to.
  const focused = activeChannel ?? (openThread && openThread.id === openId ? openThread.channel_id : null);

  // The folder a thread sits in, as the list knows it now: a move shows before the open thread's own copy hears of it.
  const folderOf = (c: ChannelWithRunning, t: ThreadStub) => {
    const inFolder = c.folders?.find((f) => f.threads.some((x) => x.id === t.id));
    if (inFolder) return inFolder.id;
    const stub = [...(c.active ?? []), ...(c.recent ?? [])].find((x) => x.id === t.id);
    const id = (stub ?? t).folder_id ?? null;
    return id && c.folders?.some((f) => f.id === id) ? id : null;
  };
  const openIn = (c: ChannelWithRunning) => (openThread && openThread.id === openId && openThread.channel_id === c.id ? openThread : null);

  // Running and queued threads, newest first. The open thread joins them with the page's fresher
  // copy and stays after it stops, so the highlight never jumps out from under you. The highlighted
  // channel also lists its latest threads of any status, so finished ones stay a click away.
  // Threads in a folder are listed under the folder instead.
  const threadsOf = (c: ChannelWithRunning) => {
    const open = openIn(c);
    const extra = c.id === focused ? (c.recent ?? []) : [];
    const seen = new Set(open ? [open.id] : []);
    const rest = [...(c.active ?? []), ...extra].filter((t) => !seen.has(t.id) && seen.add(t.id));
    return (open ? [open, ...rest] : rest).filter((t) => !folderOf(c, t)).sort(newestFirst);
  };
  /** The channel's folders, with the open thread under its own even past the listed ones. */
  const foldersOf = (c: ChannelWithRunning) => {
    const open = openIn(c);
    const home = open && folderOf(c, open);
    return (c.folders ?? []).map((f) =>
      f.id === home && !f.threads.some((t) => t.id === open!.id) ? { ...f, threads: [{ ...open!, folder_id: f.id }, ...f.threads] } : f,
    );
  };
  // Rows appearing or leaving above the highlighted one move it, so they re-measure the thumb too.
  const rowsKey = channels
    .flatMap((c) => [...foldersOf(c).flatMap((f) => [f.id, f.collapsed, ...f.threads.map((t) => t.id)]), ...threadsOf(c).map((t) => t.id)])
    .join();
  const box = useSlidingThumb(listRef, `${hash}:${channels.length}:${rowsKey}:${folders.editing}`, true, '[data-active="true"]');

  const threadLinks = (c: ChannelWithRunning) => {
    const list = threadsOf(c);
    const shown = list.filter((t, i) => i < MAX_THREADS || t.id === openId);
    return (
      <>
        {foldersOf(c).map((f) => (
          <FolderRow key={f.id} f={f} openId={openId} tasks={tasks} onNavigate={onNavigate} />
        ))}
        {folders.editing === draftKey(c.id) && (
          <FolderNameField
            initial={freeName(c.folders ?? [], DEFAULT_FOLDER_NAME)}
            onSave={(name) => (folders.setEditing(null), void folders.create(c.id, name))}
            onCancel={() => folders.setEditing(null)}
          />
        )}
        {shown.map((t) => (
          <ThreadLink key={t.id} t={t} active={t.id === openId} agents={tasks.filter((k) => k.thread_id === t.id).length} onNavigate={onNavigate} />
        ))}
        {c.id === focused ? (
          <a href={href.channel(c.id)} onClick={onNavigate} className="hov z-[1] ml-[25px] flex h-7 items-center rounded-full pr-3 pl-8 text-[12px] text-fg-4 transition-colors hover:text-fg-2">
            See all threads
          </a>
        ) : (
          list.length > shown.length && (
            <a href={href.channel(c.id)} onClick={onNavigate} className="hov z-[1] ml-[25px] flex h-7 items-center rounded-full pr-3 pl-8 text-[12px] text-fg-4 transition-colors hover:text-fg-2">
              {list.length - shown.length} more
            </a>
          )
        )}
      </>
    );
  };

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

  const channelRow = (c: ChannelWithRunning, label: ReactNode, lead: ReactNode) => (
    <div
      className={`group/ch flex items-center rounded-full ${dropOn === c.id ? 'bg-wash shadow-[inset_0_0_0_1px_var(--line-strong)]' : ''}`}
      title={dropOn === c.id ? 'Drop to take it out of its folder' : undefined}
      {...ungroupDrop(c)}
    >
      <div className="min-w-0 flex-1">
        <NavLink
          to={href.channel(c.id)}
          channelId={c.id}
          active={activeChannel === c.id}
          onNavigate={onNavigate}
          right={
            <span className="mr-6 flex items-center md:mr-0 md:group-focus-within/ch:mr-6 md:group-hover/ch:mr-6">
              <RunningBadge n={c.running} />
            </span>
          }
          lead={lead}
        >
          {label}
        </NavLink>
      </div>
      <AddFolderButton c={c} />
    </div>
  );

  const channelLink = (c: ChannelWithRunning) => (
    <Fragment key={c.id}>
      {channelRow(
        c,
        c.name,
        parseChannelIcon(c.icon) ? (
          <span className={`grid w-[15px] place-items-center ${activeChannel === c.id ? 'text-fg-2' : 'text-fg-3'}`}>
            <ChannelMark icon={c.icon} size={14} />
          </span>
        ) : (
          <span className={`w-[15px] text-center font-num text-[12px] ${activeChannel === c.id ? 'text-fg-2' : 'text-fg-4'}`}>#</span>
        ),
      )}
      {threadLinks(c)}
    </Fragment>
  );


  return (
    <nav className="flex h-full flex-col bg-sidebar" aria-label="Main">
      <div className="flex h-14 items-center justify-between pr-3 pl-5">
        <a href={href.home()} onClick={onNavigate} aria-label="Omni home" className="wordmark-write">
          <Wordmark size={18} />
        </a>
      </div>

      <div className="space-y-2 px-3">
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            onSearch();
          }}
          className="press flex h-10 w-full items-center gap-2.5 rounded-full bg-bg/70 pr-2 pl-3.5 text-[13px] text-fg-4 shadow-[var(--shadow-card)] transition-colors hover:text-fg-3"
        >
          <Icon name="search" size={15} />
          <span className="flex-1 text-left">Search or jump to</span>
          <Kbd className="bg-surface-2">{isMac ? '⌘K' : 'Ctrl K'}</Kbd>
        </button>
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            if (route.name === 'channel') {
              if (route.tab !== 'threads') navigate(`/c/${encodeURIComponent(route.id)}`);
            } else if (route.name !== 'home') navigate('/');
            requestComposerFocus();
          }}
          className="press flex h-10 w-full items-center justify-center gap-2 rounded-full bg-fg text-[13px] font-medium text-on-ink transition-colors hover:bg-fg/88"
        >
          <Icon name="plus" size={15} strokeWidth={2} /> New thread
        </button>
      </div>

      <div className="scroll-thin mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div ref={listRef} className="relative space-y-4">
          <Thumb box={box} />
          <div className="space-y-px">
            <NavLink to={href.home()} icon="home" active={route.name === 'home'} onNavigate={onNavigate}>
              Home
            </NavLink>
            {conductor && (
              <>
                {channelRow(conductor, 'Conductor', <span className="grid w-[15px] place-items-center"><OmniMark size={17} /></span>)}
                {threadLinks(conductor)}
              </>
            )}
          </div>

          {tasks.length > 0 && (
            <div>
              <div className="caption flex items-center justify-between px-3 pt-1 pb-2">
                <span>Agents</span>
                <span className="font-num text-live-text tabular-nums">{tasks.length}</span>
              </div>
              <div className="space-y-px">
                {tasks.map((t) => (
                  <AgentLink key={t.task_id} t={t} channel={channels.find((c) => c.id === t.channel_id)?.name} onNavigate={onNavigate} />
                ))}
              </div>
            </div>
          )}

          {channelsError && <ErrorNote>{channelsError}</ErrorNote>}

          {GROUPS.map((g) => {
            const list = rest.filter((c) => c.kind === g.kind);
            if (!list.length) return null;
            return (
              <div key={g.kind}>
                <div className="caption px-3 pt-1 pb-2">{g.label}</div>
                <div className="space-y-px">{list.map(channelLink)}</div>
              </div>
            );
          })}
          {other.length > 0 && <div className="space-y-px">{other.map(channelLink)}</div>}

          <NavLink to={href.newChannel()} icon="plus" active={route.name === 'new-channel'} onNavigate={onNavigate}>
            Add channel
          </NavLink>

          <div>
            <div className="caption px-3 pt-1 pb-2">Workspace</div>
            <div className="space-y-px">
              <NavLink to={href.artifacts()} icon="layers" active={route.name === 'artifacts'} onNavigate={onNavigate}>
                Artifacts
              </NavLink>
              <NavLink to={href.automations()} icon="zap" active={route.name === 'automations'} onNavigate={onNavigate}>
                Automations
              </NavLink>
              <NavLink to={href.secrets()} icon="key" active={route.name === 'secrets'} onNavigate={onNavigate}>
                Secrets
              </NavLink>
              <NavLink to={href.sync()} icon="refresh" active={route.name === 'sync'} onNavigate={onNavigate}>
                Sync
              </NavLink>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2.5 px-3 pt-1 pb-3">
        <UsageCard />
        <div className="flex items-center justify-between pl-2">
          <span className="caption">Theme</span>
          <ThemeSwitch />
        </div>
      </div>
    </nav>
  );
}
