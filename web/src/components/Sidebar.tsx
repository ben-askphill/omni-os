import { Fragment, useRef, type ReactNode } from 'react';
import type { ChannelWithRunning, HarnessId, ThreadStub, Usage, UsageWindow } from '../api.ts';
import { untilLabel } from '../format.ts';
import { href, navigate, requestComposerFocus, useHash, useRoute } from '../router.ts';
import { useApp, useNow } from '../store.tsx';
import { ThemeSwitch } from './theme.tsx';
import { HarnessLogo, Loader, OmniMark } from './brand.tsx';
import { ErrorNote, Icon, Kbd, STATUS_LABEL, StatusDot, Thumb, Ticks, useSlidingThumb, Wordmark, type IconName } from './ui.tsx';

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

function UsageCard() {
  const { usage, status, feedLive } = useApp();
  const slots = status?.slots ?? {};
  const footer = HARNESS_ROWS.filter((r) => slots[r.id]).map((r) => `${r.name} ${slots[r.id]!.running}/${slots[r.id]!.cap}`).join(' · ');
  return (
    <div className="space-y-2 rounded-[20px] bg-bg/70 p-3 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2 pb-0.5 text-[11px] font-medium text-fg-4">
        <span className="w-[66px] shrink-0" />
        <span className="flex-1">5h</span>
        <span className="flex-1">Week</span>
      </div>
      {HARNESS_ROWS.map((r) => (
        <HarnessUsageRow key={r.id} id={r.id} name={r.name} usage={usage[r.id]} />
      ))}
      <div className="flex items-center gap-2 border-t border-line pt-2.5 text-[11px] text-fg-3">
        <span className="relative inline-block h-1.5 w-1.5 shrink-0" title={feedLive ? 'Live' : 'Reconnecting'}>
          {feedLive && <span className="ping absolute inset-0 rounded-full bg-done" />}
          <span className={`absolute inset-0 rounded-full ${feedLive ? 'bg-done' : 'bg-fg-4'}`} />
        </span>
        {footer ? (
          <span className="font-num tabular-nums">{footer}</span>
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
    <span className="flex items-center gap-1.5 font-num text-[11px] text-live-text tabular-nums" title={`${n} running or queued`}>
      <StatusDot status="running" size={6} />
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
        {t.status === 'running' ? <Loader size={11} className="text-live-text" /> : <StatusDot status={t.status} size={7} />}
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
          <Wordmark size={20} />
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
                <NavLink to={href.channel('conductor')} lead={<span className="grid w-[15px] place-items-center"><OmniMark size={17} /></span>} active={activeChannel === 'conductor'} onNavigate={onNavigate} right={<RunningBadge n={conductor.running} />}>
                  Conductor
                </NavLink>
                {threadLinks(conductor)}
              </>
            )}
          </div>

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
