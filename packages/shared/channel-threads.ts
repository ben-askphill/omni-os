// A channel's threads, page by page (GET /api/channels/:id/threads?paged=1&limit=&cursor=). The phone, iOS and the
// desktop channel page list every thread this way instead of the sidebar's previews, so older threads and running
// filed ones never drop out of the list.

/** Threads per page. */
export const CHANNEL_THREADS_PAGE = 50;
/** The query parameter that carries the server's opaque `next` cursor. */
export const CHANNEL_THREADS_CURSOR = 'cursor';

export interface ChannelThreadsPage<T> {
  threads: T[];
  /** The cursor for the next (older) page, or null when this was the last. */
  next: string | null;
}

/** The API path (without `/api`) for one page of a channel's threads, the first when `cursor` is null. */
export function channelThreadsPath(channelId: string, cursor: string | null = null, limit = CHANNEL_THREADS_PAGE): string {
  const q = new URLSearchParams({ paged: '1', limit: String(limit) });
  if (cursor) q.set(CHANNEL_THREADS_CURSOR, cursor);
  return `/channels/${encodeURIComponent(channelId)}/threads?${q}`;
}

/**
 * A page from the server's answer. A server from before paging ignores `paged=1` and sends the plain array of up to 200
 * threads: that is the whole list, with no next page.
 */
export function readChannelThreadsPage<T>(body: unknown): ChannelThreadsPage<T> {
  if (Array.isArray(body)) return { threads: body as T[], next: null };
  if (body && typeof body === 'object' && Array.isArray((body as { threads?: unknown }).threads)) {
    const { threads, next } = body as { threads: T[]; next?: unknown };
    return { threads, next: typeof next === 'string' && next ? next : null };
  }
  return { threads: [], next: null };
}

/** `have` with an older `page` added after it. A thread already listed keeps its place and its newer copy. */
export function appendPage<T extends { id: string }>(have: T[], page: T[]): T[] {
  const seen = new Set(have.map((t) => t.id));
  return [...have, ...page.filter((t) => !seen.has(t.id))];
}

/**
 * The list after the first page is read again (a feed change, a pull to refresh): the fresh first page, then the older
 * threads already paged in that it does not reach. When the fresh page is the last, it is the whole list.
 */
export function withFreshFirstPage<T extends { id: string; updated_at: string }>(have: T[], page: ChannelThreadsPage<T>): T[] {
  if (page.next === null || !page.threads.length) return page.threads;
  const oldest = page.threads.reduce((min, t) => (t.updated_at < min ? t.updated_at : min), page.threads[0].updated_at);
  const fresh = new Set(page.threads.map((t) => t.id));
  return [...page.threads, ...have.filter((t) => !fresh.has(t.id) && t.updated_at < oldest)];
}
