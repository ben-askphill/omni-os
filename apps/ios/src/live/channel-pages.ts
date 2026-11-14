import type { Thread } from '@omni/client-core';
import { appendPage, withFreshFirstPage, type ChannelThreadsPage } from '@omni/shared/channel-threads.ts';

/** A channel's paged thread list as the channel screen holds it (U3: every thread, not the sidebar previews). */
export interface ChannelPages {
  channelId: string;
  threads: Thread[];
  /** The cursor for the next older page, null once the whole list is in. */
  next: string | null;
  /** Pages read so far: a refresh of the first page keeps the older ones it does not reach. */
  pages: number;
}

/** The list after its first page is read, on open or on a refresh after a feed change. */
export function afterFirstPage(prev: ChannelPages | null, channelId: string, page: ChannelThreadsPage<Thread>): ChannelPages {
  if (!prev || prev.channelId !== channelId || prev.pages <= 1 || page.next === null) return { channelId, threads: page.threads, next: page.next, pages: 1 };
  return { channelId, threads: withFreshFirstPage(prev.threads, page), next: prev.next, pages: prev.pages };
}

/** The list after the next older page arrived. A page for another channel, or one the list already moved past, is dropped. */
export function afterNextPage(prev: ChannelPages | null, channelId: string, cursor: string, page: ChannelThreadsPage<Thread>): ChannelPages | null {
  if (!prev || prev.channelId !== channelId || prev.next !== cursor) return prev;
  return { channelId, threads: appendPage(prev.threads, page.threads), next: page.next, pages: prev.pages + 1 };
}
