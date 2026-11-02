import type { ChannelWithRunning, NeedsYou, ThreadStub } from '@omni/client-core';

type ConductorHandoff = NonNullable<ChannelWithRunning['handoffs']>[number];

import { targetOfStub, type ThreadTarget } from '../thread/target';

/** The channel list's groups, in the order the phone web app shows them. */
const GROUPS: readonly { label: string; kinds: readonly string[] }[] = [
  { label: 'Clients', kinds: ['client'] },
  { label: 'Internal', kinds: ['internal', 'system'] },
  { label: 'Personal', kinds: ['personal'] },
];

export interface ChannelSections {
  /** The Conductor, shown above the groups. Undefined until the list loads. */
  conductor: ChannelWithRunning | undefined;
  groups: { label: string; channels: ChannelWithRunning[] }[];
  /** Live channels other than the Conductor. */
  listedCount: number;
  /** Running threads across every channel, the Conductor included. */
  running: number;
}

export function channelSections(channels: readonly ChannelWithRunning[]): ChannelSections {
  const listed = channels.filter((c) => !c.archived && c.id !== 'conductor');
  return {
    conductor: channels.find((c) => c.id === 'conductor'),
    groups: GROUPS.map((g) => ({ label: g.label, channels: listed.filter((c) => g.kinds.includes(c.kind)) })).filter((g) => g.channels.length > 0),
    listedCount: listed.length,
    running: channels.reduce((n, c) => n + (c.running || 0), 0),
  };
}

export const CONDUCTOR_SUBTITLE = 'Delegates to crew threads in every channel';

/** The line under a channel's name: the Conductor's notes or its role, otherwise the store or repo the channel is for. */
export function channelSubtitle(channel: ChannelWithRunning): string | null {
  if (channel.id === 'conductor') return channel.notes || CONDUCTOR_SUBTITLE;
  return channel.store_domain || channel.github_repo || null;
}

/** How many threads wait on Ben in each channel. */
export function needsByChannel(needsYou: NeedsYou | null): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const item of needsYou?.items ?? []) counts.set(item.thread.channel_id, (counts.get(item.thread.channel_id) ?? 0) + 1);
  return counts;
}

/** A thread as a list row. `busy` is the running or queued state, which the list puts first. */
export interface ThreadRow {
  id: string;
  title: string;
  status: ThreadStub['status'];
  busy: boolean;
  /** The word after the title for a state worth naming. Null for a finished, done thread. */
  statusLabel: string | null;
  /** "now", "5m", "3h", "2d". */
  ago: string;
  pinned: boolean;
  /** What the swipe actions and the long-press menu act on. */
  target: ThreadTarget;
  /** The threads the Conductor delegated from this one, when it is a handoff parent. */
  handoff?: HandoffGroup;
}

/** A thread delegated from a Conductor thread, which can run in any channel. */
export interface HandoffChild {
  id: string;
  title: string;
  status: ThreadStub['status'];
  busy: boolean;
  channelId: string;
  /** The channel's name, or its id while the channel list does not have it. */
  channel: string;
}

export interface HandoffGroup {
  children: HandoffChild[];
  /** How many of the children run or wait to. */
  running: number;
}

const STATUS_LABEL: Partial<Record<ThreadStub['status'], string>> = {
  queued: 'Queued',
  running: 'Running',
  failed: 'Failed',
  stopped: 'Stopped',
};

/** Short relative time: "now", "5m", "3h", "2d". Clocks past a week show the date. */
export function shortAgo(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = Math.max(0, now - t);
  if (diff < 45_000) return 'now';
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))}m`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h`;
  if (diff < 7 * 86_400_000) return `${Math.round(diff / 86_400_000)}d`;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function threadRow(t: ThreadStub, now: number): ThreadRow {
  return {
    id: t.id,
    title: t.title || 'Untitled',
    status: t.status,
    busy: t.status === 'running' || t.status === 'queued',
    statusLabel: STATUS_LABEL[t.status] ?? null,
    ago: shortAgo(t.updated_at ?? t.created_at, now),
    pinned: !!t.pinned_at,
    target: targetOfStub(t),
  };
}

export interface FolderSection {
  id: string;
  name: string;
  collapsed: boolean;
  /** Every row in the folder, busy and finished. */
  count: number;
  running: number;
  active: ThreadRow[];
  recent: ThreadRow[];
}

/** One channel's threads: busy and finished, ungrouped and by folder. Team members are left out, as on the phone web. */
export interface ChannelThreads {
  active: ThreadRow[];
  recent: ThreadRow[];
  folders: FolderSection[];
}

interface Bucket {
  active: ThreadRow[];
  recent: ThreadRow[];
}

const split = (rows: ThreadRow[]): Bucket => ({ active: rows.filter((r) => r.busy), recent: rows.filter((r) => !r.busy) });

function handoffGroup(group: ConductorHandoff, channelName: (id: string) => string): HandoffGroup {
  const children = group.children.map((c): HandoffChild => ({
    id: c.id,
    title: c.title || 'Untitled',
    status: c.status,
    busy: c.status === 'running' || c.status === 'queued',
    channelId: c.channel_id,
    channel: channelName(c.channel_id),
  }));
  return { children, running: children.filter((c) => c.busy).length };
}

/**
 * `channelName` names the channels a handoff's children run in. The Conductor's delegated threads nest under their
 * parent and leave the list, and a parent with a running child counts as active even when it finished itself, as on
 * phone web.
 */
export function channelThreads(channel: ChannelWithRunning, now: number, channelName: (id: string) => string = (id) => id): ChannelThreads {
  const handoffs = (channel.id === 'conductor' ? channel.handoffs ?? [] : []).filter((g) => g.children.length > 0);
  const groups = new Map(handoffs.map((g) => [g.parent.id, handoffGroup(g, channelName)]));
  const seen = new Set(handoffs.flatMap((g) => g.children.map((c) => c.id)));
  const fresh = (stubs: readonly ThreadStub[] | undefined): ThreadStub[] =>
    (stubs ?? []).filter((t) => {
      if (t.source === 'team' || seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  const rowOf = (t: ThreadStub): ThreadRow => {
    const handoff = groups.get(t.id);
    return handoff ? { ...threadRow(t, now), handoff } : threadRow(t, now);
  };

  const folders = (channel.folders ?? []).map((f) => ({ folder: f, bucket: split(fresh(f.threads).map(rowOf)) }));
  const loose = split(fresh([...(channel.active ?? []), ...(channel.recent ?? [])]).filter((t) => !t.folder_id).map(rowOf));
  const buckets = [loose, ...folders.map((f) => f.bucket)];

  for (const group of handoffs) {
    const parent = group.parent;
    if (!groups.get(parent.id)?.running || buckets.some((b) => b.active.some((r) => r.id === parent.id))) continue;
    const home = folders.find((f) => f.folder.id === parent.folder_id)?.bucket ?? loose;
    const existing = buckets.flatMap((b) => b.recent).find((r) => r.id === parent.id);
    for (const b of buckets) b.recent = b.recent.filter((r) => r.id !== parent.id);
    home.active.push(existing ?? rowOf(parent));
  }

  return {
    active: loose.active,
    recent: loose.recent,
    folders: folders
      .filter((f) => f.bucket.active.length + f.bucket.recent.length > 0)
      .map(({ folder, bucket }) => ({
        id: folder.id,
        name: folder.name,
        collapsed: !!folder.collapsed,
        count: bucket.active.length + bucket.recent.length,
        running: [...bucket.active, ...bucket.recent].filter((r) => r.busy).length,
        ...bucket,
      })),
  };
}

/** One list section of a channel: the busy threads, a folder, or the finished ones. A closed folder keeps its header and no rows. */
export interface ThreadSection {
  key: string;
  title: string;
  folder: Pick<FolderSection, 'id' | 'collapsed' | 'count' | 'running'> | null;
  data: ThreadRow[];
}

export function threadSections(model: ChannelThreads): ThreadSection[] {
  const out: ThreadSection[] = [];
  if (model.active.length) out.push({ key: 'active', title: 'Active', folder: null, data: model.active });
  for (const f of model.folders) {
    out.push({ key: `folder-${f.id}`, title: f.name, folder: { id: f.id, collapsed: f.collapsed, count: f.count, running: f.running }, data: f.collapsed ? [] : [...f.active, ...f.recent] });
  }
  if (model.recent.length) out.push({ key: 'recent', title: 'Recent', folder: null, data: model.recent });
  return out;
}
