import type { ReactNode } from 'react';
import { relTime } from '@omni/shared/format.ts';
import { ranOnLine } from '@omni/shared/ran-on.ts';
import { parseChannelIcon } from '@omni/shared/channel-icon.ts';
import type { BackgroundTask, Thread } from '../../api.ts';
import { useInbox } from '../../app/useInbox.ts';
import { useDoneKey } from '../../inbox-key.ts';
import { MARK, blockerMark, markOf, threadPhase, type RowStatus } from '@omni/shared/status.ts';
import type { InboxThread } from '../../inbox.ts';
import { canMarkDone } from '../../needs-you.ts';
import { href } from '../../router.ts';
import { useApp, useNeedOf, useNow } from '../../store.tsx';
import { HarnessLogo, OmniMark } from '../brand.tsx';
import { Avatar, ChannelMark, DoneMark, Icon, StatusDot } from '../ui.tsx';
import { useMarkDone } from '../../done-confirm.tsx';
import { useJobTree, useTreesFold, type TreesFold } from '../../thread-tree.ts';
import { AgentRows, FoldTrees, TreeRows, TreeToggle, TreeToggleSpace } from '../ThreadTree.tsx';
import { RunElapsed } from '../RunElapsed.tsx';
import { ChannelRollup } from '../ChannelStack.tsx';
import { WorkspaceLinks } from './SidebarLinks.tsx';

/**
 * The sidebar's Inbox view, T3 Code's default thread list: every channel's threads in one list, on four shelves in a
 * fixed order. Pinned cards on top, then Needs you (a question, a failure, a usage limit) and Finished (turns that
 * ended), the latest back on top in each, then Working, then Done folded away at the bottom. Marking a thread done
 * (the check on hover, or E on the selected card) moves it to Done, as Settle does in T3. `links`: the Workspace
 * links at the foot, which the classic sidebar needs and the rail has discs for.
 */
export function InboxView({ onNavigate, links = true }: { onNavigate?: () => void; links?: boolean }) {
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
  const card = (t: InboxThread, pinnedRow = false, agents?: BackgroundTask[]) => (
    <InboxCard
      key={t.id}
      t={t}
      channel={channelOf(t.channel_id)}
      status={status(t)}
      agents={agents}
      active={t.id === openId}
      pinned={pinnedRow}
      onNavigate={onNavigate}
    />
  );

  return (
    <div className="flex min-h-full flex-col">
      {pinned.length > 0 && <div className="space-y-px pb-3">{pinned.map((t) => card(t, true))}</div>}
      {needs.length > 0 && (
        <div className="space-y-px pb-3">
          <ShelfLabel label="Needs you" count={needs.length} />
          {needs.map((t) => card(t))}
        </div>
      )}
      {finished.length > 0 && (
        <div className="space-y-px pb-3">
          <ShelfLabel label="Finished" count={finished.length} />
          {finished.map((t) => card(t))}
        </div>
      )}
      {loaded && !pinned.length && !inbox.length && <p className="px-3 py-6 text-center text-[12.5px] text-fg-3">Nothing is waiting on you.</p>}

      {working.count > 0 && (
        <div className="space-y-px pt-1">
          <div aria-hidden className="mx-3 mb-3 border-t border-line" />
          <Shelf label="Working" count={working.count} open={working.open} onToggle={working.toggle} fold={working.open ? fold : undefined} />
          {working.rows.map((t) => card(t, false, tasks))}
        </div>
      )}

      <div className="mt-auto space-y-px pt-4">
        <Shelf label="Done" count={done.count} open={done.open} onToggle={done.toggle} />
        {done.rows.map((t) => (
          <DoneRow key={t.id} t={t} active={t.id === openId} onNavigate={onNavigate} />
        ))}
        {done.more > 0 && (
          <button
            type="button"
            onClick={done.showMore}
            className="item flex h-8 w-full items-center gap-2 px-3 text-[12.5px] text-fg-3 hover:text-fg-2"
          >
            <Icon name="chevronDown" size={12} />
            Show {done.more} more
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
function ShelfLabel({ label, count }: { label: string; count: number }) {
  return (
    <div className="caption flex h-8 items-center gap-2 px-3">
      {label}
      <span className="font-num font-normal text-fg-3 tabular-nums">{count}</span>
    </div>
  );
}

/**
 * A shelf's header: its name, how many it holds, and a chevron that turns as it folds. `fold`: Working's button left
 * of the chevron that closes every card's tree at once, or opens them all again.
 */
function Shelf({ label, count, open, onToggle, fold }: { label: string; count: number; open: boolean; onToggle: () => void; fold?: TreesFold }) {
  return (
    <div className="grid grid-cols-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        title={open ? `Hide ${label.toLowerCase()} threads` : `Show ${label.toLowerCase()} threads`}
        className="caption flex h-8 w-full items-center gap-2 px-3 text-left transition-colors [grid-area:1/1] hover:text-fg-2"
      >
        {label}
        <span className="font-num font-normal text-fg-3 tabular-nums">{count}</span>
        <Icon name="chevronDown" size={11} className={`ml-auto text-fg-3 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {fold && fold.trees > 0 && <FoldTrees fold={fold} className="mr-7 h-6 w-6 self-center justify-self-end [grid-area:1/1]" size={13} />}
    </div>
  );
}

/** A card with nothing under it: its channel stack falls back to the channel's avatar. */
const NONE: readonly Thread[] = [];

function ChannelLead({ channel }: { channel: ReturnType<typeof useApp>['channels'][number] | undefined }) {
  if (channel?.avatar_bg) return <Avatar name={channel.name} channelIcon={channel.icon} avatarBg={channel.avatar_bg} omni={channel.id === 'conductor'} size={18} />;
  if (channel && parseChannelIcon(channel.icon)) return <ChannelMark icon={channel.icon} avatarBg={channel.avatar_bg} size={12} />;
  if (channel?.id === 'conductor') return <OmniMark size={13} />;
  return <span className="font-num text-[11px] leading-none text-fg-3">#</span>;
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
  t: InboxThread & Partial<Pick<Thread, 'branch'>>;
  channel: ReturnType<typeof useApp>['channels'][number] | undefined;
  status: RowStatus | null;
  agents?: BackgroundTask[];
  active: boolean;
  pinned: boolean;
  onNavigate?: () => void;
}) {
  const { setPinned } = useApp();
  const markDone = useMarkDone();
  const now = useNow(60_000);
  const tree = useJobTree(t, 'inbox');
  const own = (agents ?? []).filter((k) => k.thread_id === t.id && k.subagent);
  const title = t.title || 'Untitled';
  // At work, the card names the phase: Starting, Running, Waiting on crew.
  const phase = status && (status.glyph === 'running' || status.glyph === 'queued') ? threadPhase(t) : null;
  // What holds it up names its kind: a question, the crew's question, a held message, a failed setup.
  const blocker = useNeedOf(t.id)?.blockers[0];
  const mark = status ? (blocker ? blockerMark(blocker) : markOf(status.glyph, phase)) : null;
  const said = mark && (blocker || phase) ? MARK[mark].label : status?.label;
  const channelName = channel?.id === 'conductor' ? 'Conductor' : (channel?.name ?? t.channel_id);
  // The machine it runs on or last ran on, with the run's time while it runs; the branch only without a machine.
  const where = ranOnLine(t, now);
  const label = where.machine ?? where.branch;
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
        title={`${title} · ${channelName}${status ? ` · ${said}` : ''}`}
        aria-current={active ? 'page' : undefined}
        data-active={active || undefined}
        className="item block [grid-area:1/1] px-3 py-2"
      >
        <span className="flex h-4 items-center gap-1.5 text-[11.5px] text-fg-3">
          <span className="grid min-w-3 shrink-0 place-items-center">
            <ChannelRollup threads={tree?.threads ?? NONE} own={t.channel_id} lead size={18} fallback={<ChannelLead channel={channel} />} />
          </span>
          {pinned && <Icon name="pin" size={11} className="shrink-0 text-fg-3" />}
          <span className="min-w-0 flex-1 truncate">{channelName}</span>
          <span className="flex shrink-0 items-center gap-1.5 md:group-focus-within/row:invisible md:group-hover/row:invisible">
            {status ? (
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

/** A slim Done row: the title and when it was marked done, with an undo on hover. */
function DoneRow({ t, active, onNavigate }: { t: InboxThread; active: boolean; onNavigate?: () => void }) {
  const { setDone } = useApp();
  const now = useNow(60_000);
  const title = t.title || 'Untitled';
  return (
    <div className="group/row grid grid-cols-1">
      <a
        href={href.thread(t.id)}
        onClick={onNavigate}
        title={`${title} · Marked done`}
        aria-current={active ? 'page' : undefined}
        data-active={active || undefined}
        className={`item flex h-8 items-center gap-2 px-3 text-[12.5px] [grid-area:1/1] ${active ? 'font-medium text-fg' : 'text-fg-3 hover:text-fg'}`}
      >
        <span className="grid w-3 shrink-0 place-items-center">
          <DoneMark size={7} />
        </span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="shrink-0 font-num text-[11px] text-fg-3 tabular-nums md:group-focus-within/row:invisible md:group-hover/row:invisible">
          {relTime(t.done_at ?? t.updated_at ?? t.created_at, now)}
        </span>
      </a>
      <span className="z-[2] mr-1.5 self-center justify-self-end [grid-area:1/1] opacity-100 transition-opacity md:opacity-0 md:group-focus-within/row:opacity-100 md:group-hover/row:opacity-100">
        <RowAction icon="undo" label={`Move ${title} back to the inbox`} onClick={() => void setDone(t.id, false).catch(() => {})} />
      </span>
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
