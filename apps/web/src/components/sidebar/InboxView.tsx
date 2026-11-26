import type { ReactNode } from 'react';
import { markLabel } from '@omni/shared/display.ts';
import { useTechnical } from '../../display.ts';
import { relTime } from '@omni/shared/format.ts';
import { ranOnLine } from '@omni/shared/ran-on.ts';
import { parseChannelIcon } from '@omni/shared/channel-icon.ts';
import type { BackgroundTask, Thread } from '../../api.ts';
import { useInbox } from '../../app/useInbox.ts';
import { useDoneKey } from '../../inbox-key.ts';
import { blockerMark, markOf, threadPhase, type RowStatus } from '@omni/shared/status.ts';
import type { InboxThread } from '../../inbox.ts';
import { canMarkDone } from '../../needs-you.ts';
import { href } from '../../router.ts';
import { useApp, useNeedOf, useNow, useUserName } from '../../store.tsx';
import { ownedByOther } from '@omni/shared/thread-owner.ts';
import { HarnessLogo, OmniMark } from '../brand.tsx';
import { Avatar, ChannelMark, DoneMark, Icon, StatusDot } from '../ui.tsx';
import { useMarkDone } from '../../done-confirm.tsx';
import { useJobTree, useTreesFold, type TreesFold } from '../../thread-tree.ts';
import { AgentRows, FoldTrees, TreeRows, TreeToggle, TreeToggleSpace } from '../ThreadTree.tsx';
import { RunElapsed } from '../RunElapsed.tsx';
import { ChannelRollup } from '../ChannelStack.tsx';
import { WorkspaceLinks } from './SidebarLinks.tsx';
import { AvatarMark, drawsFaces } from '../thread/AvatarMark.tsx';
import { useTooltip } from '../ui/tooltip.tsx';
import { RowCard } from '../rail/RowCard.tsx';
import { treeLabel } from '../../thread-tree.ts';

/**
 * The sidebar's Inbox view, T3 Code's default thread list: every channel's threads in one list, on four shelves in a
 * fixed order. Pinned cards on top, then Needs you (a question, a failure, a usage limit) and Finished (turns that
 * ended), the latest back on top in each, then Working, then Done folded away at the bottom. Marking a thread done
 * (the check on hover, or E on the selected card) moves it to Done, as Settle does in T3. `links`: the Workspace
 * links at the foot, which the classic sidebar needs and the rail has discs for. `variant`: 'card' is the classic
 * sidebar's three-line cards; 'row' is the rail's one-line 30px rows, whose detail is in the card shown on hover and
 * focus. `collapsed` (rows only): the rail's Collapsed list, marks and avatars with their text hidden.
 */
export function InboxView({ onNavigate, links = true, variant = 'card', collapsed = false }: { onNavigate?: () => void; links?: boolean; variant?: 'card' | 'row'; collapsed?: boolean }) {
  const { channels, tasks } = useApp();
  const markDone = useMarkDone();
  const { pinned, inbox, needs, finished, working, done, loaded, openId, status } = useInbox();
  const channelOf = (id: string) => channels.find((c) => c.id === id);
  const fold = useTreesFold(working.threads, 'inbox');
  useDoneKey((focusedId) => {
    const id = focusedId ?? openId;
    const t = id ? [...pinned, ...inbox, ...working.rows].find((r) => r.id === id) : undefined;
    if (!t || !canMarkDone(t.status)) return false;
    void markDone(t, true).catch(() => {});
    return true;
  });

  // Sub-agents show only under a card on the Working shelf, and go when they stop.
  const rows = variant === 'row';
  const card = (t: InboxThread, pinnedRow = false, agents?: BackgroundTask[]) => {
    const props = { t, channel: channelOf(t.channel_id), status: status(t), agents, active: t.id === openId, pinned: pinnedRow, onNavigate };
    return rows ? <InboxRow key={t.id} {...props} collapsed={collapsed} /> : <InboxCard key={t.id} {...props} />;
  };
  const shelfLabel = (label: string, count: number) => <ShelfLabel label={label} count={count} compact={rows} collapsed={collapsed} />;

  return (
    <div className="flex min-h-full flex-col">
      {pinned.length > 0 && <div className="space-y-px pb-3">{pinned.map((t) => card(t, true))}</div>}
      {needs.length > 0 && (
        <div className="space-y-px pb-3">
          {shelfLabel('Needs you', needs.length)}
          {needs.map((t) => card(t))}
        </div>
      )}
      {finished.length > 0 && (
        <div className="space-y-px pb-3">
          {shelfLabel('Finished', finished.length)}
          {finished.map((t) => card(t))}
        </div>
      )}
      {loaded && !pinned.length && !inbox.length && !collapsed && <p className="px-3 py-6 text-center text-[12.5px] text-fg-3">Nothing is waiting on you.</p>}

      {working.count > 0 && (
        <div className="space-y-px pt-1">
          {!rows && <div aria-hidden className="mx-3 mb-3 border-t border-line" />}
          <Shelf label="Working" count={working.count} open={working.open} onToggle={working.toggle} fold={working.open && !collapsed ? fold : undefined} compact={rows} collapsed={collapsed} />
          {working.rows.map((t) => card(t, false, tasks))}
        </div>
      )}

      <div className="mt-auto space-y-px pt-4">
        <Shelf label="Done" count={done.count} open={done.open} onToggle={done.toggle} compact={rows} collapsed={collapsed} />
        {done.rows.map((t) => (
          <DoneRow key={t.id} t={t} active={t.id === openId} onNavigate={onNavigate} compact={rows} collapsed={collapsed} />
        ))}
        {done.more > 0 && (
          <button
            type="button"
            onClick={done.showMore}
            aria-label={`Show ${done.more} more`}
            className={`item flex w-full items-center text-fg-3 hover:text-fg-2 ${rows ? 'crow' : 'h-8 gap-2 px-3 text-[12.5px]'}`}
          >
            <Icon name="chevronDown" size={12} />
            <span className={rows ? 'crow-x' : undefined}>Show {done.more} more</span>
          </button>
        )}
      </div>
      {links && (
        <div className="pt-4">
          <WorkspaceLinks onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
}

/** A shelf that does not fold: Needs you and Finished stay open, so nothing waiting on Ben hides. */
function ShelfLabel({ label, count, compact = false, collapsed = false }: { label: string; count: number; compact?: boolean; collapsed?: boolean }) {
  return (
    <div className={`caption flex items-center gap-2 ${compact ? 'crow-cap' : 'h-8 px-3'}`} role={collapsed ? 'group' : undefined} aria-label={collapsed ? `${label}, ${count}` : undefined}>
      {collapsed ? <ShelfRule /> : <>{label}<span className="font-num font-normal text-fg-3 tabular-nums">{count}</span></>}
    </div>
  );
}

/** A collapsed shelf's caption: a short rule centred in the strip, where the name and the count were. */
function ShelfRule() {
  return <span aria-hidden className="block h-px w-4 bg-line-strong" />;
}

/**
 * A shelf's header: its name, how many it holds, and a chevron that turns as it folds. `fold`: Working's button left
 * of the chevron that closes every card's tree at once, or opens them all again.
 */
function Shelf({ label, count, open, onToggle, fold, compact = false, collapsed = false }: { label: string; count: number; open: boolean; onToggle: () => void; fold?: TreesFold; compact?: boolean; collapsed?: boolean }) {
  const what = open ? `Hide ${label.toLowerCase()} threads` : `Show ${label.toLowerCase()} threads`;
  return (
    <div className="grid grid-cols-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={collapsed ? `${label}, ${count}` : undefined}
        title={what}
        className={`caption flex w-full items-center gap-2 text-left transition-colors [grid-area:1/1] hover:text-fg-2 ${compact ? 'crow-cap' : 'h-8 px-3'}`}
      >
        {collapsed ? (
          <ShelfRule />
        ) : (
          <>
            {label}
            <span className="font-num font-normal text-fg-3 tabular-nums">{count}</span>
            <Icon name="chevronDown" size={11} className={`ml-auto text-fg-3 transition-transform ${open ? '' : '-rotate-90'}`} />
          </>
        )}
      </button>
      {fold && fold.trees > 0 && <FoldTrees fold={fold} className={`${compact ? 'mr-8' : 'mr-7'} h-6 w-6 self-center justify-self-end [grid-area:1/1]`} size={13} />}
    </div>
  );
}

/** A card with nothing under it: its channel stack falls back to the channel's avatar. */
const NONE: readonly Thread[] = [];

function ChannelLead({ channel, size = 18 }: { channel: ReturnType<typeof useApp>['channels'][number] | undefined; size?: number }) {
  if (channel?.avatar_bg) return <Avatar name={channel.name} channelIcon={channel.icon} avatarBg={channel.avatar_bg} omni={channel.id === 'conductor'} size={size} />;
  if (channel && parseChannelIcon(channel.icon)) return <ChannelMark icon={channel.icon} avatarBg={channel.avatar_bg} size={Math.round(size * 0.67)} />;
  if (channel?.id === 'conductor') return <OmniMark size={Math.round(size * 0.72)} />;
  return <span className="font-num text-[11px] leading-none text-fg-3">#</span>;
}

type ChannelOf = ReturnType<typeof useApp>['channels'][number] | undefined;
type RowThread = InboxThread & Partial<Pick<Thread, 'branch' | 'owner'>>;

/** What an Inbox card and an Inbox row both say about a thread, worked out once, so the two never disagree on a mark. */
function useRowFacts(t: RowThread, channel: ChannelOf, status: RowStatus | null, agents?: BackgroundTask[]) {
  const technical = useTechnical();
  const now = useNow(60_000);
  const tree = useJobTree(t, 'inbox');
  const own = (agents ?? []).filter((k) => k.thread_id === t.id && k.subagent);
  const title = t.title || 'Untitled';
  // At work, the card names the phase: Starting, Running, Waiting on crew.
  const phase = status && (status.glyph === 'running' || status.glyph === 'queued') ? threadPhase(t) : null;
  // What holds it up names its kind: a question, the crew's question, a held message, a failed setup.
  const blocker = useNeedOf(t.id)?.blockers[0];
  const mark = status ? (blocker ? blockerMark(blocker) : markOf(status.glyph, phase)) : null;
  // With Show technical details off, every mark reads one of the five plain words.
  const said = mark && (blocker || phase || !technical) ? markLabel(mark, technical) : status?.label;
  const channelName = channel?.id === 'conductor' ? 'Conductor' : (channel?.name ?? t.channel_id);
  // Who it is for, when that is someone else (thread-owner.ts).
  const userName = useUserName();
  const forOwner = ownedByOther(t.owner, userName) ? `for ${t.owner!.trim()}` : null;
  // The machine it runs on or last ran on, with the run's time while it runs; the branch only without a machine.
  const where = ranOnLine(t, now);
  // A branch says nothing outside a code project: Show technical details, or a channel with a repo, brings it back.
  const label = where.machine ?? (technical || channel?.repo_path ? where.branch : null);
  return { technical, now, tree, own, title, phase, mark, said, channelName, forOwner, where, label };
}

/**
 * T3's card: the channel on top with the status or the time on its right, the title, then the machine it runs or ran
 * on with the run's time, and the harness. The branch and the machines before are in that line's tooltip. A job's
 * card has its tally there instead of the harness, and its tree under it. A job that works outside its channel shows
 * every channel it touches in place of the channel's avatar, its own first. `agents`: the live tasks, on the Working
 * shelf only, so a card there lists what runs under it.
 */
function InboxCard({
  t,
  channel,
  status,
  agents,
  active,
  pinned,
  onNavigate,
}: {
  t: InboxThread & Partial<Pick<Thread, 'branch' | 'owner'>>;
  channel: ReturnType<typeof useApp>['channels'][number] | undefined;
  status: RowStatus | null;
  agents?: BackgroundTask[];
  active: boolean;
  pinned: boolean;
  onNavigate?: () => void;
}) {
  const { setPinned } = useApp();
  const markDone = useMarkDone();
  const { now, tree, own, title, phase, mark, said, channelName, forOwner, where, label } = useRowFacts(t, channel, status, agents);
  // A job's tree toggle sits on this line, laid over the link (a link can't hold a button), so a job always has it.
  const line = !!label || !!t.run_started_at || !!tree;
  const harness = t.harness && !tree && (
    <span className="shrink-0 text-fg-3">
      <HarnessLogo harness={t.harness} size={11} />
    </span>
  );
  return (
    <div className="tree-group group/row grid grid-cols-1" data-inbox-thread={t.id}>
      <a
        href={href.thread(t.id)}
        onClick={onNavigate}
        title={`${title} · ${channelName}${forOwner ? ` · ${forOwner}` : ''}${status ? ` · ${said}` : ''}`}
        aria-current={active ? 'page' : undefined}
        data-active={active || undefined}
        className="item block [grid-area:1/1] px-3 py-2"
      >
        <span className="flex h-4 items-center gap-1.5 text-[11.5px] text-fg-3">
          <span className="grid min-w-3 shrink-0 place-items-center">
            <ChannelRollup threads={tree?.threads ?? NONE} own={t.channel_id} lead size={18} fallback={<ChannelLead channel={channel} />} />
          </span>
          {pinned && <Icon name="pin" size={11} className="shrink-0 text-fg-3" />}
          <span className="min-w-0 flex-1 truncate">
            {channelName}
            {forOwner && <span data-owner-line> · {forOwner}</span>}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 md:group-focus-within/row:invisible md:group-hover/row:invisible">
            {drawsFaces(t.members) ? (
              // A group thread's agents at work or waiting on the user: their faces are the mark (Q35).
              <AvatarMark members={t.members} size={16} />
            ) : status ? (
              <>
                <StatusDot mark={mark} size={phase ? 7 : 6} />
                <span className="text-fg-3">{said}</span>
              </>
            ) : (
              <span className="font-num tabular-nums">{relTime(t.updated_at ?? t.created_at, now)}</span>
            )}
          </span>
        </span>
        <span className={`mt-1 flex items-center gap-1.5 text-[13px] leading-5 ${active ? 'font-medium text-fg' : 'font-medium text-fg-2'}`}>
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {!line && harness}
        </span>
        {t.step && (
          <span className="mt-0.5 block truncate text-[12px] leading-4 text-fg-2" data-step>
            {t.step}
          </span>
        )}
        {line && (
          <span className="mt-0.5 flex h-4 items-center gap-1.5 text-[11.5px] text-fg-3" title={where.title || undefined} data-ran-on={where.machine ?? undefined}>
            {label && <Icon name={where.machine ? 'monitor' : 'branch'} size={11} className="shrink-0" />}
            {label && <span className="min-w-0 truncate">{label}</span>}
            {label && t.run_started_at && <span aria-hidden className="shrink-0">·</span>}
            <RunElapsed since={t.run_started_at} />
            <span className="min-w-0 flex-1" />
            {harness}
            {tree && <TreeToggleSpace tree={tree} />}
          </span>
        )}
      </a>
      {tree && line && <TreeToggle tree={tree} title={title} className="mr-3 mb-2 self-end justify-self-end [grid-area:1/1]" />}
      <span className="z-[2] mt-1.5 mr-1.5 flex items-center gap-0.5 self-start justify-self-end [grid-area:1/1] opacity-100 transition-opacity md:opacity-0 md:group-focus-within/row:opacity-100 md:group-hover/row:opacity-100">
        {pinned && <RowAction icon="pin" label={`Unpin ${title}`} onClick={() => void setPinned(t, false).catch(() => {})} />}
        {canMarkDone(t.status) && <RowAction icon="check" label={`Mark ${title} done`} text="Done" kbd="E" onClick={() => void markDone(t, true).catch(() => {})} />}
      </span>
      {(tree || own.length > 0) && (
        <div className="ml-[18px] [grid-area:2/1]">
          {own.length > 0 && <AgentRows tasks={own} variant="inbox" onNavigate={onNavigate} />}
          {tree && <TreeRows tree={tree} variant="inbox" agents={agents} onNavigate={onNavigate} />}
        </div>
      )}
    </div>
  );
}

/**
 * The rail's Inbox row: one 30px line, the thread's mark, its lead avatar, its title and, at the end, the time (or the
 * status word while it runs). What the card shows beyond that, the channel, the step, the machine and run time and a
 * job's tally, is in the card shown on hover and keyboard focus, expanded and collapsed alike. Collapsed, the title and
 * time hide and the actions and the job's tree go; `E` still marks the focused row done (`data-inbox-thread`).
 */
function InboxRow({ t, channel, status, agents, active, pinned, onNavigate, collapsed }: { t: RowThread; channel: ChannelOf; status: RowStatus | null; agents?: BackgroundTask[]; active: boolean; pinned: boolean; onNavigate?: () => void; collapsed: boolean }) {
  const { setPinned } = useApp();
  const markDone = useMarkDone();
  const { now, tree, own, title, mark, said, channelName, forOwner, where, label } = useRowFacts(t, channel, status, agents);
  const faces = drawsFaces(t.members);
  const when = status ? said : relTime(t.updated_at ?? t.created_at, now);
  const name = `${title}${status ? `, ${said}` : ''}`;
  const harness = t.harness && (
    <span className="shrink-0 text-fg-3">
      <HarnessLogo harness={t.harness} size={11} />
    </span>
  );
  const card = useTooltip(
    <RowCard
      head={
        <>
          <span className="grid min-w-3 shrink-0 place-items-center">
            <ChannelLead channel={channel} size={14} />
          </span>
          <span className="min-w-0 flex-1 truncate">
            {channelName}
            {forOwner && <span data-owner-line> · {forOwner}</span>}
          </span>
          <span className="shrink-0 font-num tabular-nums">{when}</span>
        </>
      }
      title={title}
      lines={[
        t.step && <span key="step" className="min-w-0 text-fg-2" data-step>{t.step}</span>,
        (label || t.run_started_at) && (
          <span key="where" className="flex min-w-0 items-center gap-1.5" data-ran-on={where.machine ?? undefined}>
            {label && <Icon name={where.machine ? 'monitor' : 'branch'} size={11} className="shrink-0" />}
            {label && <span className="min-w-0 truncate">{label}</span>}
            {label && t.run_started_at && <span aria-hidden className="shrink-0">·</span>}
            <RunElapsed since={t.run_started_at} />
            {!tree && harness}
          </span>
        ),
        tree && <span key="tree" className="min-w-0">{treeLabel(t, tree)}</span>,
      ].filter((x): x is NonNullable<typeof x> => !!x)}
    />,
    { side: 'right', variant: 'card' },
  );
  const cardTree = !collapsed && (tree || own.length > 0);
  return (
    <div className="tree-group group/row grid grid-cols-1" data-inbox-thread={t.id}>
      <a
        {...card.triggerProps}
        href={href.thread(t.id)}
        onClick={onNavigate}
        aria-label={name}
        aria-current={active ? 'page' : undefined}
        data-active={active || undefined}
        className={`item crow [grid-area:1/1] ${active ? 'text-fg' : 'text-fg-2'}`}
      >
        <span className="grid min-w-2 shrink-0 place-items-center" data-row-mark>
          <StatusDot mark={mark} size={8} />
        </span>
        <span className="grid min-w-3.5 shrink-0 place-items-center" data-row-lead>
          {faces ? (
            // A group thread's agents at work or waiting on the user: their faces are the mark (Q35).
            <AvatarMark members={t.members} size={14} />
          ) : (
            <ChannelRollup threads={tree?.threads ?? NONE} own={t.channel_id} lead size={14} fallback={<ChannelLead channel={channel} size={14} />} />
          )}
        </span>
        <span className="crow-x min-w-0 flex-1 truncate">{title}</span>
        {pinned && !collapsed && <Icon name="pin" size={11} className="shrink-0 text-fg-3" />}
        <span className="crow-x crow-time shrink-0 font-num tabular-nums md:group-focus-within/row:invisible md:group-hover/row:invisible">{when}</span>
      </a>
      {card.tip}
      {!collapsed && (
        <span className="z-[2] mr-1 flex items-center gap-0.5 self-center justify-self-end [grid-area:1/1] opacity-100 transition-opacity md:opacity-0 md:group-focus-within/row:opacity-100 md:group-hover/row:opacity-100">
          {pinned && <RowAction icon="pin" label={`Unpin ${title}`} onClick={() => void setPinned(t, false).catch(() => {})} />}
          {canMarkDone(t.status) && <RowAction icon="check" label={`Mark ${title} done`} kbd="E" onClick={() => void markDone(t, true).catch(() => {})} />}
        </span>
      )}
      {cardTree && (
        <div className="ml-[17px] [grid-area:2/1]">
          {own.length > 0 && <AgentRows tasks={own} variant="inbox" onNavigate={onNavigate} />}
          {tree && <TreeRows tree={tree} variant="inbox" agents={agents} onNavigate={onNavigate} />}
        </div>
      )}
    </div>
  );
}

/** A slim Done row: the title and when it was marked done, with an undo on hover. `compact`: the rail's 30px row. */
function DoneRow({ t, active, onNavigate, compact = false, collapsed = false }: { t: InboxThread; active: boolean; onNavigate?: () => void; compact?: boolean; collapsed?: boolean }) {
  const { setDone } = useApp();
  const now = useNow(60_000);
  const title = t.title || 'Untitled';
  const when = relTime(t.done_at ?? t.updated_at ?? t.created_at, now);
  const card = useTooltip(compact ? <RowCard head={<span>Marked done · {when}</span>} title={title} /> : null, { side: 'right', variant: 'card' });
  return (
    <div className="group/row grid grid-cols-1">
      <a
        {...card.triggerProps}
        href={href.thread(t.id)}
        onClick={onNavigate}
        title={compact ? undefined : `${title} · Marked done`}
        aria-label={compact ? `${title}, marked done` : undefined}
        aria-current={active ? 'page' : undefined}
        data-active={active || undefined}
        className={`item flex items-center [grid-area:1/1] ${compact ? 'crow' : 'h-8 gap-2 px-3 text-[12.5px]'} ${active ? 'font-medium text-fg' : 'text-fg-3 hover:text-fg'}`}
      >
        <span className={`grid shrink-0 place-items-center ${compact ? 'min-w-2' : 'w-3'}`}>
          <DoneMark size={7} />
        </span>
        <span className="crow-x min-w-0 flex-1 truncate">{title}</span>
        <span className="crow-x shrink-0 font-num text-[11px] text-fg-3 tabular-nums md:group-focus-within/row:invisible md:group-hover/row:invisible">{when}</span>
      </a>
      {card.tip}
      {!collapsed && (
        <span className={`z-[2] self-center justify-self-end [grid-area:1/1] opacity-100 transition-opacity md:opacity-0 md:group-focus-within/row:opacity-100 md:group-hover/row:opacity-100 ${compact ? 'mr-1' : 'mr-1.5'}`}>
          <RowAction icon="undo" label={`Move ${title} back to the inbox`} onClick={() => void setDone(t.id, false).catch(() => {})} />
        </span>
      )}
    </div>
  );
}

function RowAction({ icon, label, text, kbd, onClick }: { icon: 'check' | 'undo' | 'pin'; label: string; text?: ReactNode; kbd?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-keyshortcuts={kbd}
      title={kbd ? `${label} (${kbd})` : label}
      onClick={onClick}
      className="hov grid h-6 min-w-6 grid-flow-col place-items-center gap-1 rounded-full px-1.5 text-[11.5px] text-fg-3 transition-colors hover:text-fg"
    >
      <Icon name={icon} size={12} strokeWidth={2} />
      {text}
    </button>
  );
}
