import { useMemo, useRef, useState, type ReactNode } from 'react';
import { relTime } from '@omni/shared/format.ts';
import { delegatedIds, delegatesByParent } from '@omni/shared/delegate-count.ts';
import { parseChannelIcon } from '@omni/shared/channel-icon.ts';
import { taskHost, type NeedsYouItem, type Thread, type ThreadStub } from '../../api.ts';
import { DONE_INITIAL, DONE_PAGE, inboxLayout, rowStatus, type InboxThread } from '../../inbox.ts';
import { href, useHash, useRoute } from '../../router.ts';
import { readPref, useApp, useNow, writePref } from '../../store.tsx';
import { HarnessLogo, Loader, OmniMark } from '../brand.tsx';
import { useLiveThreads } from '../ThreadList.tsx';
import { ChannelMark, DoneMark, Icon, StatusDot, Thumb, useSlidingThumb } from '../ui.tsx';
import { DelegateCount, DelegateCountSpace } from '../DelegateCount.tsx';
import { useRowDelegates } from './SidebarRows.tsx';
import { WorkspaceLinks } from './SidebarLinks.tsx';

/** Enough recent threads to fill the inbox; Needs you, Running and Pinned add any older thread they hold. */
const RECENT_LIMIT = 200;
const acceptAll = () => true;

/** A shelf's open state on this device. Every shelf starts folded, as T3's do. */
function useShelf(pref: string): [open: boolean, toggle: () => void] {
  const [open, setOpen] = useState(() => readPref<boolean>(pref, false));
  const toggle = () =>
    setOpen((prev) => {
      writePref(pref, !prev);
      return !prev;
    });
  return [open, toggle];
}

/**
 * The sidebar's Inbox view, T3 Code's default thread list: every channel's threads in one list. Pinned cards, then the
 * threads waiting on Ben, the latest back on top. Working and Done fold away at the bottom. Marking a thread done
 * (the check on hover) moves it to Done, as Settle does in T3.
 */
export function InboxView({ onNavigate }: { onNavigate?: () => void }) {
  const route = useRoute();
  const hash = useHash();
  const { channels, pinned, needsYou, openThread, tasks } = useApp();
  const recent = useLiveThreads(`/recent?limit=${RECENT_LIMIT}`, acceptAll, RECENT_LIMIT);
  const [workingOpen, toggleWorking] = useShelf('sidebar.inbox.workingOpen');
  const [doneOpen, toggleDone] = useShelf('sidebar.inbox.doneOpen');
  const [doneLimit, setDoneLimit] = useState(DONE_INITIAL);
  const listRef = useRef<HTMLDivElement>(null);

  const openId = route.name === 'thread' ? route.id : null;
  const openCopy = openThread && openThread.id === openId ? openThread : null;
  const handoffs = channels.find((c) => c.id === 'conductor')?.handoffs;
  const needs = needsYou?.items ?? [];
  const layout = useMemo(
    () =>
      inboxLayout({
        threads: [...(recent.data ?? []), ...pinned, ...channels.flatMap((c) => c.active ?? []), ...needs.map((n) => n.thread)],
        needs,
        delegated: delegatedIds(handoffs),
        open: openCopy,
      }),
    [recent.data, pinned, channels, needs, handoffs, openCopy],
  );
  const needOf = useMemo(() => new Map(needs.map((n) => [n.thread.id, n])), [needs]);
  const delegates = delegatesByParent(handoffs);
  const channelOf = (id: string) => channels.find((c) => c.id === id);

  // A folded shelf still lists the open thread, so the highlight never vanishes into it.
  const shown = (open: boolean, list: InboxThread[]) => (open ? list : list.filter((t) => t.id === openId));
  const working = shown(workingOpen, layout.working);
  const done = shown(doneOpen, layout.done.slice(0, doneLimit).concat(layout.done.slice(doneLimit).filter((t) => t.id === openId)));
  const hiddenDone = Math.max(0, layout.done.length - doneLimit);

  const rowsKey = [layout.pinned, layout.inbox, working, done].map((l) => l.map((t) => t.id).join()).join('|');
  const box = useSlidingThumb(listRef, `${hash}:${rowsKey}`, true, '[data-active="true"]');

  const card = (t: InboxThread, pinnedRow = false) => (
    <InboxCard
      key={t.id}
      t={t}
      channel={channelOf(t.channel_id)}
      need={needOf.get(t.id)}
      agents={tasks.filter((k) => taskHost(k) === t.id).length}
      delegated={delegates.get(t.id)}
      active={t.id === openId}
      pinned={pinnedRow}
      onNavigate={onNavigate}
    />
  );

  return (
    <div ref={listRef} className="relative flex min-h-full flex-col">
      <Thumb box={box} />
      <div className="space-y-px">
        {layout.pinned.map((t) => card(t, true))}
        {layout.inbox.map((t) => card(t))}
        {recent.data && !layout.pinned.length && !layout.inbox.length && (
          <p className="px-3 py-6 text-center text-[12.5px] text-fg-4">Nothing is waiting on you.</p>
        )}
      </div>

      <div className="mt-auto space-y-px pt-4">
        {layout.working.length > 0 && (
          <>
            <Shelf label="Working" count={layout.working.length} open={workingOpen} onToggle={toggleWorking} />
            {working.map((t) => card(t))}
          </>
        )}
        <Shelf label="Done" count={layout.done.length} open={doneOpen} onToggle={toggleDone} />
        {done.map((t) => (
          <DoneRow key={t.id} t={t} active={t.id === openId} onNavigate={onNavigate} />
        ))}
        {doneOpen && hiddenDone > 0 && (
          <button
            type="button"
            onClick={() => setDoneLimit((n) => n + DONE_PAGE)}
            className="hov z-[1] flex h-8 w-full items-center gap-2 rounded-full px-3 text-[12.5px] text-fg-4 transition-colors hover:text-fg-2"
          >
            <Icon name="chevronDown" size={12} />
            Show {Math.min(hiddenDone, DONE_PAGE)} more
          </button>
        )}
      </div>
      <div className="pt-4">
        <WorkspaceLinks onNavigate={onNavigate} />
      </div>
    </div>
  );
}

/** A shelf's header: its name, how many it holds, and a chevron that turns as it folds. */
function Shelf({ label, count, open, onToggle }: { label: string; count: number; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      title={open ? `Hide ${label.toLowerCase()} threads` : `Show ${label.toLowerCase()} threads`}
      className="caption flex h-8 w-full items-center gap-2 px-3 text-left transition-colors hover:text-fg-2"
    >
      {label}
      <span className="font-num font-normal text-fg-4 tabular-nums">{count}</span>
      <Icon name="chevronDown" size={11} className={`ml-auto text-fg-4 transition-transform ${open ? '' : '-rotate-90'}`} />
    </button>
  );
}

function ChannelLead({ channel }: { channel: ReturnType<typeof useApp>['channels'][number] | undefined }) {
  if (channel?.id === 'conductor') return <OmniMark size={13} />;
  if (channel && parseChannelIcon(channel.icon)) return <ChannelMark icon={channel.icon} size={12} />;
  return <span className="font-num text-[11px] leading-none text-fg-4">#</span>;
}

/** T3's card: the channel on top with the status or the time on its right, the title, then the branch and harness. */
function InboxCard({
  t,
  channel,
  need,
  agents,
  delegated,
  active,
  pinned,
  onNavigate,
}: {
  t: InboxThread & Partial<Pick<Thread, 'branch'>>;
  channel: ReturnType<typeof useApp>['channels'][number] | undefined;
  need: NeedsYouItem | undefined;
  agents: number;
  delegated: readonly ThreadStub[] | undefined;
  active: boolean;
  pinned: boolean;
  onNavigate?: () => void;
}) {
  const { setDone, setPinned } = useApp();
  const now = useNow(60_000);
  const delegates = useRowDelegates(t.id, delegated, onNavigate);
  const status = rowStatus(t, need, agents);
  const title = t.title || 'Untitled';
  const channelName = channel?.id === 'conductor' ? 'Conductor' : (channel?.name ?? t.channel_id);
  // Work in progress recedes, as in T3: what waits on Ben stands out.
  const receded = !active && status?.glyph === 'running';
  const harness = t.harness && !delegates && (
    <span className="shrink-0 text-fg-4">
      <HarnessLogo harness={t.harness} size={11} />
    </span>
  );
  return (
    <div className="group/row grid grid-cols-1">
      <a
        href={href.thread(t.id)}
        onClick={onNavigate}
        title={`${title} · ${channelName}${status ? ` · ${status.label}` : ''}`}
        aria-current={active ? 'page' : undefined}
        data-active={active || undefined}
        className={`hov z-[1] block rounded-[14px] [grid-area:1/1] px-3 py-2 transition-colors ${active ? '[--hov:transparent]' : ''} ${receded ? 'opacity-70' : ''}`}
      >
        <span className="flex h-4 items-center gap-1.5 text-[11.5px] text-fg-4">
          <span className="grid w-3 shrink-0 place-items-center">
            <ChannelLead channel={channel} />
          </span>
          {pinned && <Icon name="pin" size={11} className="shrink-0 text-fg-3" />}
          <span className="min-w-0 flex-1 truncate">{channelName}</span>
          <span className="flex shrink-0 items-center gap-1.5 md:group-focus-within/row:invisible md:group-hover/row:invisible">
            {status ? (
              <>
                {status.glyph === 'running' ? <Loader size={10} className="text-live-text" /> : <StatusDot status={status.glyph} size={6} />}
                <span className="text-fg-3">{status.label}</span>
              </>
            ) : (
              <span className="font-num tabular-nums">{relTime(t.updated_at ?? t.created_at, now)}</span>
            )}
          </span>
        </span>
        <span className={`mt-1 flex items-center gap-1.5 text-[13px] leading-5 ${active ? 'font-medium text-fg' : receded ? 'text-fg-3' : 'font-medium text-fg-2'}`}>
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {!t.branch && harness}
          {!t.branch && delegates && <DelegateCountSpace summary={delegates.summary} />}
        </span>
        {t.branch && (
          <span className="mt-0.5 flex h-4 items-center gap-1.5 text-[11.5px] text-fg-4">
            <Icon name="branch" size={11} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t.branch}</span>
            {harness}
            {delegates && <DelegateCountSpace summary={delegates.summary} />}
          </span>
        )}
      </a>
      {delegates && <DelegateCount summary={delegates.summary} onOpen={delegates.open} className="z-[2] mr-2 mb-2 self-end justify-self-end [grid-area:1/1]" />}
      <span className="z-[2] mt-1.5 mr-1.5 flex items-center gap-0.5 self-start justify-self-end [grid-area:1/1] opacity-100 transition-opacity md:opacity-0 md:group-focus-within/row:opacity-100 md:group-hover/row:opacity-100">
        {pinned && <RowAction icon="pin" label={`Unpin ${title}`} onClick={() => void setPinned(t, false).catch(() => {})} />}
        <RowAction icon="check" label={`Mark ${title} done`} text="Done" onClick={() => void setDone(t.id, true).catch(() => {})} />
      </span>
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
        className={`hov z-[1] flex h-8 items-center gap-2 rounded-full px-3 text-[12.5px] [grid-area:1/1] transition-colors ${active ? 'font-medium text-fg [--hov:transparent]' : 'text-fg-3 hover:text-fg'}`}
      >
        <span className="grid w-3 shrink-0 place-items-center">
          <DoneMark size={7} />
        </span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="shrink-0 font-num text-[11px] text-fg-4 tabular-nums md:group-focus-within/row:invisible md:group-hover/row:invisible">
          {relTime(t.done_at ?? t.updated_at ?? t.created_at, now)}
        </span>
      </a>
      <span className="z-[2] mr-1.5 self-center justify-self-end [grid-area:1/1] opacity-100 transition-opacity md:opacity-0 md:group-focus-within/row:opacity-100 md:group-hover/row:opacity-100">
        <RowAction icon="undo" label={`Move ${title} back to the inbox`} onClick={() => void setDone(t.id, false).catch(() => {})} />
      </span>
    </div>
  );
}

function RowAction({ icon, label, text, onClick }: { icon: 'check' | 'undo' | 'pin'; label: string; text?: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="hov grid h-6 min-w-6 grid-flow-col place-items-center gap-1 rounded-full px-1.5 text-[11.5px] text-fg-3 transition-colors hover:text-fg"
    >
      <Icon name={icon} size={12} strokeWidth={2} />
      {text}
    </button>
  );
}
