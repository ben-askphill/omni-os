// A thread as the phone lists it: in Activity, in a channel and in search. Pure.
import type { Thread, ThreadStub } from '../api.ts';
import { relTime } from '../format.ts';

export interface RowItem {
  id: string;
  title: string;
  /** The channel's name, shown as #name. */
  channel: string;
  channelId: string;
  channelIcon: string | null;
  role: string | null;
  /** The thread's status, drawn as its glyph. */
  status: string;
  /** Finished: the title drops to fg-2. */
  settled: boolean;
  time: string;
  /** What follows the channel on the second line. */
  meta: string | null;
}

export interface ChannelInfo {
  name: string;
  icon: string | null;
}

/** Enough of a thread to list it: a full row, or the stub the pinned list types it as. */
export type ListedThread = ThreadStub & Partial<Pick<Thread, 'role' | 'updated_at'>>;

/** "3m", "2h", "now": a list's time column, without the "ago". */
export const shortTime = (iso: string, now: number) => relTime(iso, now).replace(/ ago$/, '').replace(/^just now$/, 'now');

const META: Record<string, string> = { queued: 'Queued', running: 'Running', failed: 'Failed', stopped: 'Stopped' };

export function rowOf(t: ListedThread, channel: ChannelInfo | undefined, now: number): RowItem {
  return {
    id: t.id,
    title: t.title || 'Untitled',
    channel: channel?.name ?? t.channel_id,
    channelId: t.channel_id,
    channelIcon: channel?.icon ?? null,
    role: t.role ?? null,
    status: t.status,
    settled: t.status !== 'running' && t.status !== 'queued',
    time: shortTime(t.updated_at ?? t.created_at, now),
    meta: META[t.status] ?? null,
  };
}
