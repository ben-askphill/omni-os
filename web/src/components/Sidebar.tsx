import { useEffect, useState, type ReactNode } from 'react';
import type { ChannelWithRunning, UsageWindow } from '../api.ts';
import { untilLabel } from '../format.ts';
import { href, navigate, requestComposerFocus, useRoute } from '../router.ts';
import { useApp, useNow } from '../store.tsx';
import { Icon, type IconName } from './ui.tsx';

function Bar({ label, w }: { label: string; w?: UsageWindow }) {
  useNow(60_000);
  if (!w) {
    return (
      <div className="flex items-center gap-2 text-[11.5px] text-fg-4">
        <span className="w-5 font-medium">{label}</span>
        <div className="h-1 flex-1 rounded-full bg-surface-3" />
        <span className="w-8 text-right">n/a</span>
      </div>
    );
  }
  const raw = w.utilization > 1.5 ? w.utilization / 100 : w.utilization;
  const pct = Math.max(0, Math.min(1, raw));
  const color = pct >= 0.9 ? 'var(--bad-dot)' : pct >= 0.7 ? 'var(--warn-dot)' : 'var(--fg-2)';
  return (
    <div className="text-[11.5px]" title={`${label} window: ${Math.round(pct * 100)}% used, resets ${new Date(w.resetsAt * 1000).toLocaleString('en-GB')}`}>
      <div className="flex items-center gap-2">
        <span className="w-5 font-medium text-fg-3">{label}</span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
          <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(2, pct * 100)}%`, background: color }} />
        </div>
        <span className="w-8 text-right font-medium text-fg-2 tabular-nums">{Math.round(pct * 100)}%</span>
      </div>
      <div className="mt-0.5 pl-7 text-[11px] text-fg-4">resets {untilLabel(w.resetsAt)}</div>
    </div>
  );
}

function UsageMeter() {
  const { usage, status, feedLive } = useApp();
  const st = usage?.status;
  const warn = st && st !== 'allowed' ? (st === 'rejected' ? 'Limit reached' : st.includes('warning') ? 'Near the limit' : st) : null;
  return (
    <div className="space-y-1.5 rounded-lg border border-line bg-surface/60 px-2.5 py-2">
      <Bar label="5h" w={usage?.five_hour} />
      <Bar label="7d" w={usage?.seven_day} />
      {warn && <div className="text-[11.5px] font-medium text-warn">{warn}</div>}
      <div className="flex items-center gap-1.5 border-t border-line pt-1.5 text-[11.5px] text-fg-3">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${feedLive ? 'bg-ok' : 'bg-fg-4'}`} title={feedLive ? 'Live' : 'Reconnecting'} />
        {status ? (
          <span className="tabular-nums">
            {status.running} running{status.queued ? ` · ${status.queued} queued` : ''} <span className="text-fg-4">/ {status.maxConcurrent} slots</span>
          </span>
        ) : (
          <span>{feedLive ? 'Connected' : 'Connecting'}</span>
        )}
      </div>
    </div>
  );
}

function NavLink({ to, icon, active, children, right, onNavigate }: { to: string; icon?: IconName; active?: boolean; children: ReactNode; right?: ReactNode; onNavigate?: () => void }) {
  return (
    <a
      href={to}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`flex h-8 items-center gap-2 rounded-md px-2 text-[13.5px] transition-colors md:h-7 md:text-[13px] ${
        active ? 'bg-surface-3 font-medium text-fg' : 'text-fg-2 hover:bg-surface-2 hover:text-fg'
      }`}
    >
      {icon && <Icon name={icon} size={15} className={active ? 'text-fg' : 'text-fg-3'} />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {right}
    </a>
  );
}

function RunningBadge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="flex items-center gap-1 text-[11px] font-medium text-info tabular-nums" title={`${n} running or queued`}>
      <span className="pulse inline-block h-1.5 w-1.5 rounded-full bg-[var(--info-dot)]" />
      {n}
    </span>
  );
}

const GROUPS: { kind: string; label: string }[] = [
  { kind: 'client', label: 'Clients' },
  { kind: 'internal', label: 'Internal' },
  { kind: 'personal', label: 'Personal' },
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const route = useRoute();
  const { channels, channelsError, threadChannel } = useApp();
  const [q, setQ] = useState(route.name === 'search' ? route.q : '');

  useEffect(() => {
    if (route.name === 'search') setQ(route.q);
  }, [route]);

  const activeChannel = route.name === 'channel' ? route.id : route.name === 'thread' ? threadChannel : null;
  const conductor = channels.find((c) => c.id === 'conductor');
  const rest = channels.filter((c) => c.id !== 'conductor');
  const other = rest.filter((c) => !GROUPS.some((g) => g.kind === c.kind));

  const channelLink = (c: ChannelWithRunning) => (
    <NavLink key={c.id} to={href.channel(c.id)} active={activeChannel === c.id} onNavigate={onNavigate} right={<RunningBadge n={c.running} />}>
      <span className="text-fg-4">#</span> {c.name}
    </NavLink>
  );

  return (
    <nav className="flex h-full flex-col bg-sidebar" aria-label="Main">
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <a href={href.home()} onClick={onNavigate} className="flex items-center gap-1.5 text-[17px] font-bold tracking-[-0.045em]">
          Omni
          <span className="inline-block h-1.5 w-1.5 translate-y-[-5px] rounded-full bg-accent" />
        </a>
      </div>

      <div className="space-y-2 px-3">
        <UsageMeter />
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (!q.trim()) return;
            navigate(`/search?q=${encodeURIComponent(q.trim())}`);
            onNavigate?.();
          }}
        >
          <label className="flex h-8 items-center gap-2 rounded-md border border-line bg-surface px-2 text-fg-3 focus-within:border-fg-4">
            <Icon name="search" size={14} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search threads"
              aria-label="Search threads"
              enterKeyHint="search"
              className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-4"
            />
          </label>
        </form>
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            if (route.name === 'channel') {
              if (route.tab !== 'threads') navigate(`/c/${encodeURIComponent(route.id)}`);
            } else if (route.name !== 'home') navigate('/');
            requestComposerFocus();
          }}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-fg text-[13px] font-medium text-bg transition-opacity hover:opacity-90"
        >
          <Icon name="plus" size={15} /> New thread
        </button>
      </div>

      <div className="scroll-thin mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        <div className="space-y-px">
          <NavLink to={href.home()} icon="home" active={route.name === 'home'} onNavigate={onNavigate}>
            Home
          </NavLink>
          {conductor && (
            <NavLink to={href.channel('conductor')} icon="target" active={activeChannel === 'conductor'} onNavigate={onNavigate} right={<RunningBadge n={conductor.running} />}>
              Conductor
            </NavLink>
          )}
        </div>

        {channelsError && <div className="rounded-md bg-bad-bg px-2 py-1.5 text-[12px] text-bad">{channelsError}</div>}

        {GROUPS.map((g) => {
          const list = rest.filter((c) => c.kind === g.kind);
          if (!list.length) return null;
          return (
            <div key={g.kind}>
              <div className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-fg-4 uppercase">{g.label}</div>
              <div className="space-y-px">{list.map(channelLink)}</div>
            </div>
          );
        })}
        {other.length > 0 && <div className="space-y-px">{other.map(channelLink)}</div>}

        <NavLink to={href.newChannel()} icon="plus" active={route.name === 'new-channel'} onNavigate={onNavigate}>
          Add channel
        </NavLink>

        <div className="space-y-px border-t border-line pt-3">
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
    </nav>
  );
}
