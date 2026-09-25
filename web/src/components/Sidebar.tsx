import { Fragment, useRef, type ReactNode } from 'react';
import type { ChannelWithRunning, ThreadStub, UsageWindow } from '../api.ts';
import { untilLabel } from '../format.ts';
import { href, navigate, requestComposerFocus, useHash, useRoute } from '../router.ts';
import { useApp, useNow } from '../store.tsx';
import { ThemeSwitch } from './theme.tsx';
import { Icon, Kbd, Spinner, STATUS_LABEL, StatusDot, Thumb, Ticks, useSlidingThumb, Wordmark, type IconName } from './ui.tsx';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function UsageRow({ label, w }: { label: string; w?: UsageWindow }) {
  useNow(60_000);
  if (!w) {
    return (
      <div className="flex items-center gap-2.5">
        <span className="label-mono w-5">{label}</span>
        <Ticks value={0} count={22} height={12} className="flex-1 opacity-60" label={`${label} window: no data`} />
        <span className="w-8 text-right font-num text-[11px] text-fg-4">n/a</span>
      </div>
    );
  }
  const raw = w.utilization > 1.5 ? w.utilization / 100 : w.utilization;
  const pct = Math.max(0, Math.min(1, raw));
  const tone = pct >= 0.9 ? 'bad' : pct >= 0.7 ? 'warn' : undefined;
  return (
    <div title={`${label} window: ${Math.round(pct * 100)}% used, resets ${new Date(w.resetsAt * 1000).toLocaleString('en-GB')}`}>
      <div className="flex items-center gap-2.5">
        <span className="label-mono w-5">{label}</span>
        <Ticks value={pct} count={22} height={12} tone={tone} className="flex-1" label={`${label} usage`} />
        <span className="w-8 text-right font-num text-[11px] text-fg-2 tabular-nums">{Math.round(pct * 100)}%</span>
      </div>
      <div className="mt-1 pl-[30px] text-[10.5px] text-fg-4">resets {untilLabel(w.resetsAt)}</div>
    </div>
  );
}

function UsageCard() {
  const { usage, status, feedLive } = useApp();
  const st = usage?.status;
  const warn = st && st !== 'allowed' ? (st === 'rejected' ? 'Limit reached' : st.includes('warning') ? 'Near the limit' : st) : null;
  return (
    <div className="space-y-2.5 rounded-[20px] bg-bg/70 p-3 shadow-[var(--shadow-card)]">
      <UsageRow label="5h" w={usage?.five_hour} />
      <UsageRow label="7d" w={usage?.seven_day} />
      {warn && <div className="text-[11.5px] font-medium text-warn">{warn}</div>}
      <div className="flex items-center gap-2 border-t border-line pt-2.5 text-[11.5px] text-fg-3">
        <span className="relative inline-block h-1.5 w-1.5" title={feedLive ? 'Live' : 'Reconnecting'}>
          {feedLive && <span className="ping absolute inset-0 rounded-full bg-[var(--ok-dot)]" />}
          <span className={`absolute inset-0 rounded-full ${feedLive ? 'bg-[var(--ok-dot)]' : 'bg-fg-4'}`} />
        </span>
        {status ? (
          <span className="font-num text-[11px] tabular-nums">
            {status.running} running{status.queued ? ` · ${status.queued} queued` : ''} <span className="text-fg-4">/ {status.maxConcurrent}</span>
          </span>
        ) : (
          <span>{feedLive ? 'Connected' : 'Connecting'}</span>
        )}
      </div>
    </div>
  );
}

function NavLink({ to, icon, lead, active, children, right, onNavigate }: { to: string; icon?: IconName; lead?: ReactNode; active?: boolean; children: ReactNode; right?: ReactNode; onNavigate?: () => void }) {
  return (
    <a
      href={to}
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
    <span className="flex items-center gap-1.5 font-num text-[11px] text-info tabular-nums" title={`${n} running or queued`}>
      <span className="relative inline-block h-1.5 w-1.5">
        <span className="ping absolute inset-0 rounded-full bg-[var(--info-dot)]" />
        <span className="absolute inset-0 rounded-full bg-[var(--info-dot)]" />
      </span>
      {n}
    </span>
  );
}

/** A thread nested under its channel, like a Claude Code session under its project. */
function ThreadLink({ t, active, onNavigate }: { t: ThreadStub; active: boolean; onNavigate?: () => void }) {
  const title = t.title || 'Untitled';
  return (
    <a
      href={href.thread(t.id)}
      onClick={onNavigate}
      title={`${title} · ${STATUS_LABEL[t.status] ?? t.status}`}
      aria-current={active ? 'page' : undefined}
      data-active={active || undefined}
      className={`hov z-[1] ml-[25px] flex h-8 items-center gap-2 rounded-full px-3 text-[13px] transition-colors md:h-7 md:text-[12.5px] ${
        active ? 'font-medium text-fg [--hov:transparent]' : 'text-fg-3 hover:text-fg'
      }`}
    >
      <span className="grid w-3 shrink-0 place-items-center">
        {t.status === 'running' ? <Spinner size={11} className="text-info" /> : <StatusDot status={t.status} size={7} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
    </a>
  );
}

/** Past this many threads a channel shows "N more" and links to its full list. */
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
  const { channels, channelsError, openThread } = useApp();
  const listRef = useRef<HTMLDivElement>(null);

  const activeChannel = route.name === 'channel' ? route.id : null;
  const openId = route.name === 'thread' ? route.id : null;
  const conductor = channels.find((c) => c.id === 'conductor');
  const rest = channels.filter((c) => c.id !== 'conductor');
  const other = rest.filter((c) => !GROUPS.some((g) => g.kind === c.kind));

  // Running and queued threads, newest first. The open thread joins them with the page's fresher
  // copy and stays after it stops, so the highlight never jumps out from under you.
  const threadsOf = (c: ChannelWithRunning) => {
    const open = openThread && openThread.id === openId && openThread.channel_id === c.id ? openThread : null;
    const busy = (c.active ?? []).filter((t) => t.id !== open?.id);
    return (open ? [open, ...busy] : busy).sort(newestFirst);
  };
  // Rows appearing or leaving above the highlighted one move it, so they re-measure the thumb too.
  const rowsKey = channels.flatMap((c) => threadsOf(c).map((t) => t.id)).join();
  const box = useSlidingThumb(listRef, `${hash}:${channels.length}:${rowsKey}`, true, '[data-active="true"]');

  const threadLinks = (c: ChannelWithRunning) => {
    const list = threadsOf(c);
    const shown = list.filter((t, i) => i < MAX_THREADS || t.id === openId);
    return (
      <>
        {shown.map((t) => (
          <ThreadLink key={t.id} t={t} active={t.id === openId} onNavigate={onNavigate} />
        ))}
        {list.length > shown.length && (
          <a href={href.channel(c.id)} onClick={onNavigate} className="hov z-[1] ml-[25px] flex h-7 items-center rounded-full pr-3 pl-8 text-[12px] text-fg-4 transition-colors hover:text-fg-2">
            {list.length - shown.length} more
          </a>
        )}
      </>
    );
  };

  const channelLink = (c: ChannelWithRunning) => (
    <Fragment key={c.id}>
      <NavLink
        to={href.channel(c.id)}
        active={activeChannel === c.id}
        onNavigate={onNavigate}
        right={<RunningBadge n={c.running} />}
        lead={<span className={`w-[15px] text-center font-num text-[12px] ${activeChannel === c.id ? 'text-fg-2' : 'text-fg-4'}`}>#</span>}
      >
        {c.name}
      </NavLink>
      {threadLinks(c)}
    </Fragment>
  );

  return (
    <nav className="flex h-full flex-col bg-sidebar" aria-label="Main">
      <div className="flex h-14 items-center justify-between pr-3 pl-5">
        <a href={href.home()} onClick={onNavigate} aria-label="Omni home">
          <Wordmark size={19} />
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
                <NavLink to={href.channel('conductor')} icon="target" active={activeChannel === 'conductor'} onNavigate={onNavigate} right={<RunningBadge n={conductor.running} />}>
                  Conductor
                </NavLink>
                {threadLinks(conductor)}
              </>
            )}
          </div>

          {channelsError && <div className="rounded-2xl bg-bad-bg px-3 py-2 text-[12px] text-bad">{channelsError}</div>}

          {GROUPS.map((g) => {
            const list = rest.filter((c) => c.kind === g.kind);
            if (!list.length) return null;
            return (
              <div key={g.kind}>
                <div className="label-mono px-3 pt-1 pb-2">{g.label}</div>
                <div className="space-y-px">{list.map(channelLink)}</div>
              </div>
            );
          })}
          {other.length > 0 && <div className="space-y-px">{other.map(channelLink)}</div>}

          <NavLink to={href.newChannel()} icon="plus" active={route.name === 'new-channel'} onNavigate={onNavigate}>
            Add channel
          </NavLink>

          <div>
            <div className="label-mono px-3 pt-1 pb-2">Workspace</div>
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
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2.5 px-3 pt-1 pb-3">
        <UsageCard />
        <div className="flex items-center justify-between pl-2">
          <span className="label-mono">Theme</span>
          <ThemeSwitch />
        </div>
      </div>
    </nav>
  );
}
