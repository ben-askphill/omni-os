import type { ReactNode } from 'react';
import type { ChannelWithRunning, Thread, ThreadStub } from '../../api.ts';
import { relTime } from '../../format.ts';
import { href, navigate, startNewThread, type Route } from '../../router.ts';
import { setTheme } from '../theme.tsx';
import { Avatar, Icon, StatusDot, type IconName } from '../ui.tsx';

export interface Item {
  id: string;
  group: string;
  label: string;
  sub?: string;
  lead: ReactNode;
  right?: ReactNode;
  run: () => void;
}

const go = (h: string) => {
  window.location.hash = h;
};

const lead = (icon: IconName) => (
  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-fg-3">
    <Icon name={icon} size={14} />
  </span>
);

/** What the palette lists for `q`: pages, channels, recent threads and the theme, filtered by every word typed, plus a search row. */
export function paletteItems(q: string, channels: ChannelWithRunning[], recent: Thread[] | undefined, route: Route, openThread: ThreadStub | null): Item[] {
  const s = q.trim().toLowerCase();
  const words = s.split(/\s+/).filter(Boolean);
  const match = (i: Item) => !words.length || words.every((w) => `${i.label} ${i.sub ?? ''}`.toLowerCase().includes(w));

  const newThread = () => startNewThread(route, openThread);

  const base: Item[] = [
    { id: 'a:new', group: 'Actions', label: 'New thread', sub: 'Start a task', lead: lead('plus'), run: newThread },
    { id: 'p:home', group: 'Go to', label: 'Home', lead: lead('home'), run: () => go(href.home()) },
    { id: 'p:artifacts', group: 'Go to', label: 'Artifacts', lead: lead('layers'), run: () => go(href.artifacts()) },
    { id: 'p:automations', group: 'Go to', label: 'Automations', lead: lead('zap'), run: () => go(href.automations()) },
    { id: 'p:settings', group: 'Go to', label: 'Settings', sub: 'General: you, theme, notifications', lead: lead('sliders'), run: () => go(href.settingsPage()) },
    { id: 'p:workspace', group: 'Go to', label: 'Workspace', sub: 'Settings: folders and GitHub owner', lead: lead('folder'), run: () => go(href.settingsSection('workspace')) },
    { id: 'p:machines', group: 'Go to', label: 'Machines', sub: 'Settings: this machine, sync and storage', lead: lead('monitor'), run: () => go(href.settingsSection('machines')) },
    { id: 'p:secrets', group: 'Go to', label: 'Secrets', sub: 'Settings', lead: lead('key'), run: () => go(href.settingsSection('secrets')) },
    { id: 'p:new-channel', group: 'Go to', label: 'Add channel', lead: lead('hash'), run: () => go(href.newChannel()) },
    ...channels.map<Item>((c) => ({
      id: `c:${c.id}`,
      group: 'Channels',
      label: c.id === 'conductor' ? 'Conductor' : `#${c.name}`,
      sub: c.store_domain ?? c.github_repo ?? undefined,
      lead: <Avatar name={c.name} channelIcon={c.icon} icon={c.id === 'conductor' ? 'target' : undefined} size={28} />,
      right: c.running ? <span className="font-num text-[11px] text-live-text">{c.running} running</span> : undefined,
      run: () => go(href.channel(c.id)),
    })),
    ...(recent ?? []).map<Item>((t) => ({
      id: `t:${t.id}`,
      group: 'Recent threads',
      label: t.title || 'Untitled',
      sub: `#${t.channel_id}`,
      lead: (
        <span className="grid h-7 w-7 shrink-0 place-items-center">
          <StatusDot status={t.status} />
        </span>
      ),
      right: <span className="font-num text-[11px] text-fg-4">{relTime(t.updated_at)}</span>,
      run: () => go(href.thread(t.id)),
    })),
    { id: 'x:light', group: 'Theme', label: 'Light theme', lead: lead('sun'), run: () => setTheme('light') },
    { id: 'x:dark', group: 'Theme', label: 'Dark theme', lead: lead('moon'), run: () => setTheme('dark') },
    { id: 'x:system', group: 'Theme', label: 'Match system theme', lead: lead('monitor'), run: () => setTheme('system') },
  ];

  let list = base.filter(match);
  if (!words.length) {
    // Keep the empty state short: a few threads, no theme rows.
    let n = 0;
    list = list.filter((i) => i.group !== 'Theme' && (i.group !== 'Recent threads' || n++ < 6));
  }
  if (s) {
    list.unshift({
      id: 'search',
      group: 'Search',
      label: `Search threads for “${q.trim()}”`,
      sub: 'Titles, prompts, replies and tool output',
      lead: lead('search'),
      run: () => navigate(`/search?q=${encodeURIComponent(q.trim())}`),
    });
  }
  return list;
}
