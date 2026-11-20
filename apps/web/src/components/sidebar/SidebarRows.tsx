import { useState, type MouseEvent, type ReactNode } from 'react';
import { toDate } from '@omni/shared/format.ts';
import { type BackgroundTask, type ThreadStub } from '../../api.ts';
import { drag } from '../../folders.tsx';
import { duration, plural } from '../../format.ts';
import { href } from '../../router.ts';
import { readPref, useApp, useNow, writePref } from '../../store.tsx';
import { HarnessLogo } from '../brand.tsx';
import { Icon, StatusDot, ThreadDot, threadStatusText, type IconName } from '../ui.tsx';
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
 * Where a row's parts sit, by its indent: the tree line under its status mark, and its second line under its title.
 * `true`: under a channel or folder. `flush`: the Conductor's rows. `false`: the channel page's lists.
 */
const TREE_AT = { true: { line: 'ml-[43px]', meta: 'ml-[57px]' }, flush: { line: 'ml-[22px]', meta: 'ml-[36px]' }, false: { line: 'ml-[18px]', meta: 'ml-[32px]' } } as const;

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
 * a folder it files there; onto its channel's name, back to the ungrouped list.
 */
export function ThreadLink({ t, active, tasks, onNavigate, indent = true, tree }: { t: ThreadStub; active: boolean; tasks: BackgroundTask[]; onNavigate?: () => void; indent?: boolean | 'flush'; tree?: JobTree | null }) {
  const title = t.title || 'Untitled';
  // Sub-agents show only while the job is at work, as on the Inbox's Working shelf. With a tree, each thread's nest
  // under its own row there, so the job keeps only its own.
  const own = !showsAgents(t, tree?.phase) ? [] : tree ? tasks.filter((k) => k.thread_id === t.id) : tasks;
  const agents = own.length;
  // A thread whose turn ended still works while its sub-agents or the threads it delegated run.
  const busy = showsRunning(t) || agents > 0;
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
        className={`item group/row flex h-8 items-center gap-2 px-3 text-[13px] md:h-7 md:text-[12.5px] ${indent === 'flush' ? 'ml-1' : indent ? 'ml-[25px]' : ''} ${
          active ? 'font-medium text-fg' : 'text-fg-3 hover:text-fg'
        }`}
      >
        <span className="grid min-w-3 shrink-0 place-items-center">
          <ThreadDot t={t} busy={busy} />
        </span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {t.harness && (
          <span className={`shrink-0 ${active ? 'text-fg-3' : 'text-fg-3 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100'}`}>
            <HarnessLogo harness={t.harness} size={11} />
          </span>
        )}
      </a>
      {tree && <TreeUnder t={t} tree={tree} at={TREE_AT[String(indent) as keyof typeof TREE_AT]} onNavigate={onNavigate} />}
      {own.map((k, i) => (
        <AgentLink key={k.task_id} t={k} last={i === agents - 1} onNavigate={onNavigate} />
      ))}
    </>
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
 * A sub-agent running in a thread, nested under it on a tree line from the thread's status dot, like a Claude Desktop
 * task under its session. It links to the thread that started it. `flush`: under a Running row, whose dot sits nearer
 * the edge than a channel's thread's.
 */
function AgentLink({ t, last, flush = false, onNavigate }: { t: BackgroundTask; last: boolean; flush?: boolean; onNavigate?: () => void }) {
  const now = useNow(1000);
  const tip = [t.description, t.tool_uses ? plural(t.tool_uses, 'tool') : null, t.last_tool && `last ${t.last_tool}`].filter(Boolean).join(' · ');
  return (
    <a
      href={href.thread(t.thread_id)}
      onClick={onNavigate}
      title={tip}
      data-agent-row
      className={`item relative flex h-8 items-center gap-2 pr-3 pl-4 text-[12.5px] text-fg-3 hover:text-fg md:h-7 md:text-[12px] ${flush ? 'ml-[19px]' : 'ml-[43px]'}`}
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
 * A thread in the Running or Pinned section, flush with the channels: its status, its title and its
 * channel's name. In Pinned the name gives way on hover to the button that unpins it. It opens the thread as its row
 * under its channel does, and a right-click gives the same menu. `home`: the thread's only row (Running), which wears
 * the thumb while open and nests its running sub-agents. Otherwise (Pinned), open, it reads bold and the thumb stays
 * on the thread's own row.
 */
export function SectionLink({ t, channel, active, home = false, tasks, unpin, tree, onNavigate }: { t: ThreadStub; channel: string; active: boolean; home?: boolean; tasks: BackgroundTask[]; unpin?: boolean; tree?: JobTree | null; onNavigate?: () => void }) {
  const { setPinned } = useApp();
  const title = t.title || 'Untitled';
  const own = !showsAgents(t, tree?.phase) ? [] : tree ? tasks.filter((k) => k.thread_id === t.id) : tasks;
  const agents = own.length;
  const busy = showsRunning(t) || agents > 0;
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
        className={`item flex h-9 min-w-0 flex-1 items-center gap-2.5 px-3 text-[13.5px] md:h-8 md:text-[13px] ${active ? 'font-medium text-fg' : 'text-fg-2 hover:text-fg'}`}
      >
        <span className="grid min-w-[15px] shrink-0 place-items-center">
          <ThreadDot t={t} busy={busy} />
        </span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span
          className={`max-w-[45%] shrink-0 truncate text-[11px] font-normal text-fg-3 ${
            unpin ? 'mr-6 transition-opacity md:mr-0 md:group-focus-within/pin:opacity-0 md:group-hover/pin:opacity-0' : ''
          }`}
        >
          {channel}
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
    {home && tree && <TreeUnder t={t} tree={tree} at={{ line: 'ml-[19px]', meta: 'ml-[37px]' }} onNavigate={onNavigate} />}
    {home && own.map((k, i) => <AgentLink key={k.task_id} t={k} last={i === agents - 1} flush onNavigate={onNavigate} />)}
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
