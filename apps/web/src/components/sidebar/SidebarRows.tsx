import { useState, type MouseEvent, type ReactNode } from 'react';
import { toDate } from '@omni/shared/format.ts';
import { type BackgroundTask, type ThreadStub } from '../../api.ts';
import { drag } from '../../folders.tsx';
import { duration, plural } from '../../format.ts';
import { href } from '../../router.ts';
import { readPref, useApp, useNow, writePref } from '../../store.tsx';
import { HarnessLogo } from '../brand.tsx';
import { Icon, RowDot, StatusDot, threadStatusText, useRowMark, type IconName } from '../ui.tsx';
import { rowShows } from '@omni/shared/crew-eyes.ts';
import type { RowMark } from '../ui/status.tsx';
import { ThreadAvatar } from '../ThreadAvatar.tsx';
import { AvatarMark, drawsFaces } from '../thread/AvatarMark.tsx';
import { showsRunning } from '@omni/shared/delegate-count.ts';
import { showsAgents } from '@omni/shared/thread-tree.ts';
import { useJobTree, treeLabel, type JobTree } from '../../thread-tree.ts';
import { TreeRows, TreeToggle } from '../ThreadTree.tsx';
import { ChannelRollup } from '../ChannelStack.tsx';

export function NavLink({ to, icon, lead, active, children, right, onNavigate, channelId, expanded }: { channelId?: string; to: string; icon?: IconName; lead?: ReactNode; active?: boolean; children: ReactNode; right?: ReactNode; onNavigate?: (e: MouseEvent) => void; expanded?: boolean }) {
  return (
    <a
      href={to}
      data-channel-id={channelId}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      aria-expanded={expanded}
      data-active={active || undefined}
      className={`item flex h-9 items-center gap-2.5 px-3 text-[13.5px] md:h-8 md:text-[13px] ${active ? 'font-medium text-fg' : 'text-fg-2 hover:text-fg'}`}
    >
      {icon && <Icon name={icon} size={15} className={active ? 'text-fg' : 'text-fg-3'} />}
      {lead}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {right}
    </a>
  );
}

export function RunningBadge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="flex items-center gap-1.5 font-num text-[11px] text-live-text tabular-nums" title={`${n} running or queued`}>
      <StatusDot status="running" size={6} />
      {n}
    </span>
  );
}

/**
 * Where a row's parts sit, by its indent: the tree line under the middle of its avatar, and its second line under its
 * title. `true`: under a channel or folder. `flush`: the Conductor's rows and the rail's list. `false`: the Running
 * and Pinned rows.
 */
const TREE_AT = { true: { line: 'ml-[46px]', meta: 'ml-[63px]' }, flush: { line: 'ml-[25px]', meta: 'ml-[42px]' }, false: { line: 'ml-[21px]', meta: 'ml-[38px]' } } as const;

/** A sidebar row's avatar (ADR 0021, D23): 18px in a 32px row, 8px before the title. */
const ROW_AVATAR = 18;

/**
 * A job's second line (the other channels it works in, its branch or what sits under it, and the tally that opens and
 * closes the tree) and its tree. Each thread in it nests its own running sub-agents, from the store's live tasks,
 * while the job is at work.
 */
function TreeUnder({ t, tree, at, onNavigate }: { t: ThreadStub; tree: JobTree; at: { line: string; meta: string }; onNavigate?: () => void }) {
  const { tasks } = useApp();
  return (
    <>
      <div className={`-mt-1 flex h-5 min-w-0 items-center pr-3 ${at.meta}`}>
        <ChannelRollup threads={tree.threads} own={t.channel_id} size={14} className="mr-1.5" />
        <TreeToggle tree={tree} title={t.title || 'Untitled'} label={treeLabel(t, tree)} className="max-w-full" />
      </div>
      <TreeRows tree={tree} variant="sidebar" agents={showsAgents(t, tree.phase) ? tasks : undefined} onNavigate={onNavigate} className={at.line} />
    </>
  );
}

/**
 * A thread nested under its channel, like a Claude Code session under its project, or under a folder (which sits flush
 * with its channel), with its running sub-agents nested under it and its harness's logo after the title. Dragged onto
 * a folder it files there; onto its channel's name, back to the ungrouped list. The 32px row leads with the thread's
 * agent (else its channel) and ends with its status mark (ADR 0021, D23), in the rail's list and the classic sidebar.
 */
export function ThreadLink({ t, active, tasks, onNavigate, indent = true, tree }: { t: ThreadStub; active: boolean; tasks: BackgroundTask[]; onNavigate?: () => void; indent?: boolean | 'flush'; tree?: JobTree | null }) {
  const title = t.title || 'Untitled';
  // Sub-agents show only while the job is at work, as on the Inbox's Working shelf. With a tree, each thread's nest
  // under its own row there, so the job keeps only its own.
  const own = !showsAgents(t, tree?.phase) ? [] : tree ? tasks.filter((k) => k.thread_id === t.id) : tasks;
  const agents = own.length;
  // A thread whose turn ended still works while its sub-agents or the threads it delegated run.
  const busy = showsRunning(t) || agents > 0;
  // One mark for the row: the avatar's eyes at its start and the dot at its end draw the same.
  const row = useRowMark(t, { busy });
  const at = TREE_AT[String(indent) as keyof typeof TREE_AT];
  return (
    <>
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
        title={`${title} · ${agents ? plural(agents, 'agent') + ' running' : t.done_at ? 'Marked done' : threadStatusText(t)}`}
        aria-current={active ? 'page' : undefined}
        data-active={active || undefined}
        className={`item group/row flex h-[var(--h-nav)] items-center gap-2 px-3 text-[13px] md:text-[12.5px] ${indent === 'flush' ? 'ml-1' : indent ? 'ml-[25px]' : ''} ${
          active ? 'font-medium text-fg' : 'text-fg-3 hover:text-fg'
        }`}
      >
        <RowLead t={t} row={row} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {t.harness && (
          <span className={`shrink-0 ${active ? 'text-fg-3' : 'text-fg-3 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100'}`}>
            <HarnessLogo harness={t.harness} size={11} />
          </span>
        )}
        <RowEnd row={row} />
      </a>
      {tree && <TreeUnder t={t} tree={tree} at={at} onNavigate={onNavigate} />}
      {own.map((k, i) => (
        <AgentLink key={k.task_id} t={k} last={i === agents - 1} line={at.line} onNavigate={onNavigate} />
      ))}
    </>
  );
}

/**
 * A sidebar row's start: the thread's agent, its eyes on the row's mark (useRowMark, worked out once per row), else its
 * channel's avatar; a group thread whose agents run or wait on Ben draws their faces there instead (AvatarMark), with
 * the row's mark at its far end (RowEnd).
 */
function RowLead({ t, row }: { t: ThreadStub; row: RowMark }) {
  const { channels } = useApp();
  const ch = channels.find((c) => c.id === t.channel_id);
  return (
    <span className="grid shrink-0 place-items-center" style={{ minWidth: ROW_AVATAR, height: ROW_AVATAR }} data-row-lead>
      {drawsFaces(t.members) ? (
        <AvatarMark members={t.members} size={ROW_AVATAR} facesOnly />
      ) : (
        <ThreadAvatar role={t.role} channel={t.channel_id} channelIcon={ch?.icon} avatarBg={ch?.avatar_bg} shows={rowShows(row.mark, { done: row.done, members: t.members })} size={ROW_AVATAR} />
      )}
    </span>
  );
}

/** A sidebar row's status mark, at its far end. A group thread's too: its faces are in the avatar's slot. */
function RowEnd({ row }: { row: RowMark }) {
  return (
    <span className="grid min-w-3 shrink-0 place-items-center" data-row-mark>
      <RowDot row={row} />
    </span>
  );
}

/**
 * A thread under its channel. A job (a Conductor thread that delegated, a team lead) carries its tree: the threads
 * under it nest below its row, and each keeps its own row in its channel too (`flush`: the Conductor's rows, which
 * sit almost flush with its name).
 */
export function ChannelThreadEntry({ t, active, tasks, flush = false, onNavigate }: {
  t: ThreadStub;
  active: boolean;
  tasks: BackgroundTask[];
  flush?: boolean;
  onNavigate?: () => void;
}) {
  const tree = useJobTree(t, 'sidebar');
  return <ThreadLink t={t} active={active} tasks={tasks} onNavigate={onNavigate} indent={flush ? 'flush' : true} tree={tree} />;
}

/**
 * A sub-agent running in a thread, nested under it on a tree line from the middle of the thread's avatar (`line`), like
 * a Claude Desktop task under its session. It links to the thread that started it.
 */
function AgentLink({ t, last, line, onNavigate }: { t: BackgroundTask; last: boolean; line: string; onNavigate?: () => void }) {
  const now = useNow(1000);
  const tip = [t.description, t.tool_uses ? plural(t.tool_uses, 'tool') : null, t.last_tool && `last ${t.last_tool}`].filter(Boolean).join(' · ');
  return (
    <a
      href={href.thread(t.thread_id)}
      onClick={onNavigate}
      title={tip}
      data-agent-row
      className={`item relative flex h-8 items-center gap-2 pr-3 pl-4 text-[12.5px] text-fg-3 hover:text-fg md:h-7 md:text-[12px] ${line}`}
    >
      <span
        aria-hidden
        className={`pointer-events-none absolute top-0 left-0 w-2 border-l border-line-strong ${last ? 'h-1/2 rounded-bl-[6px] border-b' : 'h-full'}`}
      />
      <span className="min-w-0 flex-1 truncate">{t.description}</span>
      <StatusDot status="running" size={6} className="shrink-0" />
      <span className="shrink-0 font-num text-[11px] text-fg-3 tabular-nums">{duration(Math.max(0, now - toDate(t.started_at).getTime()))}</span>
    </a>
  );
}

/**
 * A thread in the Running or Pinned section, flush with the channels: its agent's avatar, its title, its channel's name
 * and its status mark at the far end (ADR 0021, D23). In Pinned the name and the mark give way on hover to the button
 * that unpins it. It opens the thread as its row under its channel does, and a right-click gives the same menu.
 * `home`: the thread's only row (Running), which wears the thumb while open and nests its running sub-agents.
 * Otherwise (Pinned), open, it reads bold and the thumb stays on the thread's own row.
 */
export function SectionLink({ t, channel, active, home = false, tasks, unpin, tree, onNavigate }: { t: ThreadStub; channel: string; active: boolean; home?: boolean; tasks: BackgroundTask[]; unpin?: boolean; tree?: JobTree | null; onNavigate?: () => void }) {
  const { setPinned } = useApp();
  const title = t.title || 'Untitled';
  const own = !showsAgents(t, tree?.phase) ? [] : tree ? tasks.filter((k) => k.thread_id === t.id) : tasks;
  const agents = own.length;
  const busy = showsRunning(t) || agents > 0;
  const row = useRowMark(t, { busy });
  // One block with its tree and sub-agents, so a job stands apart from the next row (index.css, .tree-group).
  return (
    <div className="tree-group space-y-px">
    <div className="group/pin flex items-center">
      <a
        href={href.thread(t.id)}
        onClick={onNavigate}
        title={`${title} · ${channel} · ${agents ? plural(agents, 'agent') + ' running' : threadStatusText(t)}`}
        aria-current={active && home ? 'page' : undefined}
        data-active={(active && home) || undefined}
        className={`item flex h-9 min-w-0 flex-1 items-center gap-2 px-3 text-[13.5px] md:h-[var(--h-nav)] md:text-[13px] ${active ? 'font-medium text-fg' : 'text-fg-2 hover:text-fg'}`}
      >
        <RowLead t={t} row={row} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span
          className={`flex max-w-[45%] shrink-0 items-center gap-2 ${
            unpin ? 'mr-6 transition-opacity md:mr-0 md:group-focus-within/pin:opacity-0 md:group-hover/pin:opacity-0' : ''
          }`}
        >
          <span className="min-w-0 truncate text-[11px] font-normal text-fg-3">{channel}</span>
          <RowEnd row={row} />
        </span>
      </a>
      {unpin && (
        <button
          type="button"
          aria-label={`Unpin ${title}`}
          title="Unpin"
          onClick={() => void setPinned(t, false).catch(() => {})}
          className="hov relative z-[2] -ml-7 mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-full text-fg-3 opacity-100 transition-opacity hover:text-fg focus-visible:opacity-100 md:opacity-0 md:group-hover/pin:opacity-100 md:group-focus-within/pin:opacity-100"
        >
          <Icon name="pin" size={13} />
        </button>
      )}
    </div>
    {home && tree && <TreeUnder t={t} tree={tree} at={TREE_AT.false} onNavigate={onNavigate} />}
    {home && own.map((k, i) => <AgentLink key={k.task_id} t={k} last={i === agents - 1} line={TREE_AT.false.line} onNavigate={onNavigate} />)}
    </div>
  );
}

/** A section that folds on its own, apart from the channels, remembered on this device under `pref`. */
export function useSectionFold(pref: string): [closed: boolean, toggle: () => void] {
  const [closed, setClosed] = useState(() => readPref<boolean>(pref, false));
  const toggle = () =>
    setClosed((prev) => {
      writePref(pref, !prev);
      return !prev;
    });
  return [closed, toggle];
}

/**
 * Running or Pinned: a caption that folds its rows away, with the count beside it while folded. The
 * caller leaves it out when it has nothing to list.
 */
export function ThreadSection({ label, closed, onToggle, count, children }: { label: string; closed: boolean; onToggle: () => void; count: number; children: ReactNode }) {
  const what = label.toLowerCase().replace(/ threads$/, '');
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!closed}
        title={closed ? `Show ${what} threads` : `Hide ${what} threads`}
        className="caption flex w-full items-center gap-1 px-3 pt-1 pb-2 text-left transition-colors hover:text-fg-2"
      >
        {label}
        <Icon name={closed ? 'chevronRight' : 'chevronDown'} size={11} className="text-fg-3" />
        {closed && <span className="ml-auto font-num tabular-nums">{count}</span>}
      </button>
      {!closed && <div className="space-y-px">{children}</div>}
    </div>
  );
}
