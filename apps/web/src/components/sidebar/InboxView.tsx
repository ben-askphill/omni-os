import { useRef, type ReactNode } from 'react';
import { relTime } from '@omni/shared/format.ts';
import { parseChannelIcon } from '@omni/shared/channel-icon.ts';
import type { Thread, ThreadStub } from '../../api.ts';
import { useInbox } from '../../app/useInbox.ts';
import type { InboxThread, RowStatus } from '../../inbox.ts';
import { canMarkDone } from '../../needs-you.ts';
import { href, useHash } from '../../router.ts';
import { useApp, useNow } from '../../store.tsx';
import { HarnessLogo, Loader, OmniMark } from '../brand.tsx';
import { ChannelMark, DoneMark, Icon, StatusDot, Thumb, useSlidingThumb } from '../ui.tsx';
import { DelegateCount, DelegateCountSpace } from '../DelegateCount.tsx';
import { useRowDelegates } from './SidebarRows.tsx';
import { WorkspaceLinks } from './SidebarLinks.tsx';

/**
 * The sidebar's Inbox view, T3 Code's default thread list: every channel's threads in one list. Pinned cards, then the
 * threads waiting on Ben, the latest back on top. Working and Done fold away at the bottom. Marking a thread done
 * (the check on hover) moves it to Done, as Settle does in T3.
 */
export function InboxView({ onNavigate }: { onNavigate?: () => void }) {
  const hash = useHash();
  const { channels } = useApp();
  const { pinned, inbox, working, done, loaded, openId, status, delegates } = useInbox();
  const listRef = useRef<HTMLDivElement>(null);
  const channelOf = (id: string) => channels.find((c) => c.id === id);

  const rowsKey = [pinned, inbox, working.rows, done.rows].map((l) => l.map((t) => t.id).join()).join('|');
  const box = useSlidingThumb(listRef, `${hash}:${rowsKey}`, true, '[data-active="true"]');

  const card = (t: InboxThread, pinnedRow = false) => (
    <InboxCard
      key={t.id}
      t={t}
      channel={channelOf(t.channel_id)}
      status={status(t)}
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
        {pinned.map((t) => card(t, true))}
        {inbox.map((t) => card(t))}
        {loaded && !pinned.length && !inbox.length && <p className="px-3 py-6 text-center text-[12.5px] text-fg-4">Nothing is waiting on you.</p>}
      </div>

      <div className="mt-auto space-y-px pt-4">
        {working.count > 0 && (
          <>
            <Shelf label="Working" count={working.count} open={working.open} onToggle={working.toggle} />
            {working.rows.map((t) => card(t))}
          </>
        )}
        <Shelf label="Done" count={done.count} open={done.open} onToggle={done.toggle} />
        {done.rows.map((t) => (
          <DoneRow key={t.id} t={t} active={t.id === openId} onNavigate={onNavigate} />
        ))}
        {done.more > 0 && (
          <button
            type="button"
            onClick={done.showMore}
            className="hov z-[1] flex h-8 w-full items-center gap-2 rounded-full px-3 text-[12.5px] text-fg-4 transition-colors hover:text-fg-2"
          >
            <Icon name="chevronDown" size={12} />
            Show {done.more} more
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
  status,
  delegated,
  active,
  pinned,
  onNavigate,
}: {
  t: InboxThread & Partial<Pick<Thread, 'branch'>>;
  channel: ReturnType<typeof useApp>['channels'][number] | undefined;
  status: RowStatus | null;
  delegated: readonly ThreadStub[] | undefined;
  active: boolean;
  pinned: boolean;
  onNavigate?: () => void;
}) {
  const { setDone, setPinned } = useApp();
  const now = useNow(60_000);
  const delegates = useRowDelegates(t.id, delegated, onNavigate);
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
        {canMarkDone(t.status) && <RowAction icon="check" label={`Mark ${title} done`} text="Done" onClick={() => void setDone(t.id, true).catch(() => {})} />}
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
