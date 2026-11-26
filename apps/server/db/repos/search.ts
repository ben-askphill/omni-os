import { db } from '../connection.ts';

export interface SearchHit {
  thread_id: string;
  title: string;
  channel_id: string;
  status: string;
  updated_at: string;
  snippet: string;
  /** The event a body hit matched, for opening the thread at it. Null for a thread only its title matched. */
  event_id: number | null;
}

export const SEARCH_LIMIT_DEFAULT = 40;
export const SEARCH_LIMIT_MAX = 100;

export function search(q: string, limit = SEARCH_LIMIT_DEFAULT, channel?: string): SearchHit[] {
  const terms = q
    .split(/\s+/)
    .map((t) => t.replace(/["*]/g, ''))
    .filter(Boolean)
    .map((t) => `"${t}"*`)
    .join(' ');
  if (!terms) return [];
  const cap = Math.min(Math.max(Math.trunc(limit) || SEARCH_LIMIT_DEFAULT, 1), SEARCH_LIMIT_MAX);
  const ch = channel?.trim() || undefined;
  const bodyCap = Math.max(cap * 5, 120);
  const bodyHits = db
    .prepare(
      `SELECT t.id AS thread_id, t.title, t.channel_id, t.status, t.updated_at,
              snippet(search_fts, 0, '<mark>', '</mark>', ' … ', 14) AS snippet, search_fts.event_id, bm25(search_fts) AS rank
       FROM search_fts JOIN threads t ON t.id = search_fts.thread_id
       WHERE search_fts MATCH ?${ch ? ' AND t.channel_id = ?' : ''} ORDER BY rank LIMIT ?`,
    )
    .all(...(ch ? [terms, ch, bodyCap] : [terms, bodyCap])) as unknown as (SearchHit & { rank: number })[];
  const titleHits = db
    .prepare(
      `SELECT id AS thread_id, title, channel_id, status, updated_at, '' AS snippet, NULL AS event_id FROM threads
       WHERE title LIKE ?${ch ? ' AND channel_id = ?' : ''} ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(...(ch ? [`%${q}%`, ch, cap] : [`%${q}%`, cap])) as unknown as SearchHit[];
  // A thread its title matched still carries its best body snippet and opens at that event, when it has one.
  const bodyByThread = new Map<string, { snippet: string; event_id: number | null }>();
  for (const h of bodyHits) {
    if (!bodyByThread.has(h.thread_id)) bodyByThread.set(h.thread_id, { snippet: h.snippet, event_id: h.event_id });
  }
  const missing = titleHits.map((h) => h.thread_id).filter((id) => !bodyByThread.has(id));
  if (missing.length) {
    const placeholders = missing.map(() => '?').join(', ');
    const extra = db
      .prepare(
        `SELECT thread_id, snippet(search_fts, 0, '<mark>', '</mark>', ' … ', 14) AS snippet, event_id, bm25(search_fts) AS rank
         FROM search_fts
         WHERE search_fts MATCH ? AND thread_id IN (${placeholders})
         ORDER BY rank`,
      )
      .all(terms, ...missing) as unknown as { thread_id: string; snippet: string; event_id: number | null }[];
    for (const h of extra) {
      if (!bodyByThread.has(h.thread_id)) bodyByThread.set(h.thread_id, { snippet: h.snippet, event_id: h.event_id });
    }
  }
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const h of [...titleHits, ...bodyHits]) {
    if (seen.has(h.thread_id)) continue;
    seen.add(h.thread_id);
    const body = bodyByThread.get(h.thread_id);
    out.push({
      thread_id: h.thread_id,
      title: h.title,
      channel_id: h.channel_id,
      status: h.status,
      updated_at: h.updated_at,
      snippet: h.snippet || body?.snippet || '',
      event_id: h.event_id ?? body?.event_id ?? null,
    });
    if (out.length >= cap) break;
  }
  return out;
}
