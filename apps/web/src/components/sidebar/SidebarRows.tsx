import { useState, type MouseEvent, type ReactNode } from 'react';
import { type BackgroundTask, type ChannelWithRunning, type ThreadStub } from '../../api.ts';
import { drag } from '../../folders.tsx';
import { duration, plural, toDate } from '../../format.ts';
import { href } from '../../router.ts';
import { readPref, useApp, useNow, writePref } from '../../store.tsx';
import { HarnessLogo, Loader } from '../brand.tsx';
import { DoneMark, Icon, STATUS_LABEL, StatusDot, type IconName } from '../ui.tsx';
import { ThreadHandoffs } from '../ThreadHandoffs.tsx';

export function NavLink({ to, icon, lead, active, children, right, onNavigate, channelId, expanded }: { channelId?: string; to: string; icon?: IconName; lead?: ReactNode; active?: boolean; children: ReactNode; right?: ReactNode; onNavigate?: (e: MouseEvent) => void; expanded?: boolean }) {
  return (
    <a
      href={to}
      data-channel-id={channelId}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      aria-expanded={expanded}
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
 * A thread nested under its channel, like a Claude Code session under its project, or under a folder (which sits flush
 * with its channel), with its running sub-agents nested under it and its harness's logo after the title. Dragged onto
 * a folder it files there; onto its channel's name, back to the ungrouped list.
 */
export function ThreadLink({ t, active, tasks, onNavigate, indent = true }: { t: ThreadStub; active: boolean; tasks: BackgroundTask[]; onNavigate?: () => void; indent?: boolean }) {
  const title = t.title || 'Untitled';
  const agents = tasks.length;
  // A thread whose turn ended still works while its sub-agents run.
  const busy = t.status === 'running' || agents > 0;
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
        title={`${title} · ${agents ? plural(agents, 'agent') + ' running' : t.done_at ? 'Marked done' : (STATUS_LABEL[t.status] ?? t.status)}`}
        aria-current={active ? 'page' : undefined}
        data-active={active || undefined}
        className={`hov z-[1] flex h-8 items-center gap-2 rounded-full px-3 text-[13px] transition-colors md:h-7 md:text-[12.5px] ${indent ? 'ml-[25px]' : ''} ${
          active ? 'font-medium text-fg [--hov:transparent]' : t.done_at ? 'text-fg-4 hover:text-fg' : 'text-fg-3 hover:text-fg'
        }`}
      >
        <span className="grid w-3 shrink-0 place-items-center">
          {busy ? <Loader size={11} className="text-live-text" /> : t.done_at ? <DoneMark size={7} /> : <StatusDot status={t.status} size={7} />}
        </span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {t.harness && (
          <span className={`shrink-0 ${active ? 'text-fg-3' : 'text-fg-4'}`}>
            <HarnessLogo harness={t.harness} size={11} />
          </span>
        )}
      </a>
      {tasks.map((k, i) => (
        <AgentLink key={k.task_id} t={k} last={i === agents - 1} onNavigate={onNavigate} />
      ))}
    </>
  );
}

export function ChannelThreadEntry({ t, active, tasks, handoffs, onNavigate }: {
  t: ThreadStub;
  active: boolean;
  tasks: BackgroundTask[];
  handoffs: ChannelWithRunning['handoffs'];
  onNavigate?: () => void;
}) {
  const group = handoffs?.find((g) => g.parent.id === t.id);
  if (!group?.children.length) return <ThreadLink t={t} active={active} tasks={tasks} onNavigate={onNavigate} />;
  return (
    <ThreadHandoffs
      idPrefix="channel-sidebar"
      parent={group.parent}
      children={group.children}
      channelIndent
      renderParent={<ThreadLink t={t} active={active} tasks={tasks} onNavigate={onNavigate} indent={false} />}
      onNavigate={onNavigate}
    />
  );
}

/**
 * A sub-agent running in a thread, nested under it on a tree line from the thread's status dot, like a Claude Desktop
 * task under its session. It links to the thread that started it.
 */
function AgentLink({ t, last, onNavigate }: { t: BackgroundTask; last: boolean; onNavigate?: () => void }) {
  const now = useNow(1000);
  const tip = [t.description, t.tool_uses ? plural(t.tool_uses, 'tool') : null, t.last_tool && `last ${t.last_tool}`].filter(Boolean).join(' · ');
  return (
    <a
      href={href.thread(t.thread_id)}
      onClick={onNavigate}
      title={tip}
      className={`hov relative z-[1] flex h-8 items-center gap-2 rounded-full pr-3 pl-4 text-[12.5px] text-fg-3 transition-colors hover:text-fg md:h-7 md:text-[12px] ml-[43px]`}
    >
      <span
        aria-hidden
        className={`pointer-events-none absolute top-0 left-0 w-2 border-l border-line-strong ${last ? 'h-1/2 rounded-bl-[6px] border-b' : 'h-full'}`}
      />
      <span className="min-w-0 flex-1 truncate">{t.description}</span>
      <Loader size={10} className="shrink-0 text-live-text" />
      <span className="shrink-0 font-num text-[11px] text-fg-4 tabular-nums">{duration(Math.max(0, now - toDate(t.started_at).getTime()))}</span>
    </a>
  );
}

/**
 * A thread in the Running or Pinned section, flush with the channels: its status, its title and its
 * channel's name. In Pinned the name gives way on hover to the button that unpins it. It opens the thread as its row
 * under its channel does, and a right-click gives the same menu. Open, it reads bold; the thumb stays on its row under
 * its channel.
 */
export function SectionLink({ t, channel, active, agents, unpin, onNavigate }: { t: ThreadStub; channel: string; active: boolean; agents: number; unpin?: boolean; onNavigate?: () => void }) {
  const { setPinned } = useApp();
  const title = t.title || 'Untitled';
  const busy = t.status === 'running' || agents > 0;
  return (
    <div className="group/pin flex items-center rounded-full">
      <a
        href={href.thread(t.id)}
        onClick={onNavigate}
        title={`${title} · ${channel} · ${agents ? plural(agents, 'agent') + ' running' : (STATUS_LABEL[t.status] ?? t.status)}`}
        className={`hov z-[1] flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-full px-3 text-[13.5px] transition-colors md:h-8 md:text-[13px] ${
          active ? 'font-medium text-fg [--hov:transparent]' : 'text-fg-2 hover:text-fg'
        }`}
      >
        <span className="grid w-[15px] shrink-0 place-items-center">
          {busy ? <Loader size={11} className="text-live-text" /> : t.done_at ? <DoneMark size={7} /> : <StatusDot status={t.status} size={7} />}
        </span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span
          className={`max-w-[45%] shrink-0 truncate text-[11px] font-normal text-fg-4 ${
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
        <Icon name={closed ? 'chevronRight' : 'chevronDown'} size={11} className="text-fg-4" />
        {closed && <span className="ml-auto font-num tabular-nums">{count}</span>}
      </button>
      {!closed && <div className="space-y-px">{children}</div>}
    </div>
  );
}
