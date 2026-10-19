import { db } from '../connection.ts';

export interface SearchHit {
  thread_id: string;
  title: string;
  channel_id: string;
  status: string;
  updated_at: string;
  snippet: string;
}

export function search(q: string, limit = 40): SearchHit[] {
  const terms = q
    .split(/\s+/)
    .map((t) => t.replace(/["*]/g, ''))
    .filter(Boolean)
    .map((t) => `"${t}"*`)
    .join(' ');
  if (!terms) return [];
  const bodyHits = db
    .prepare(
      `SELECT t.id AS thread_id, t.title, t.channel_id, t.status, t.updated_at,
              snippet(search_fts, 0, '<mark>', '</mark>', ' … ', 14) AS snippet, bm25(search_fts) AS rank
       FROM search_fts JOIN threads t ON t.id = search_fts.thread_id
       WHERE search_fts MATCH ? ORDER BY rank LIMIT ?`,
    )
    .all(terms, limit * 3) as unknown as (SearchHit & { rank: number })[];
  const titleHits = db
    .prepare(
      `SELECT id AS thread_id, title, channel_id, status, updated_at, '' AS snippet FROM threads
       WHERE title LIKE ? ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(`%${q}%`, limit) as unknown as SearchHit[];
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const h of [...titleHits, ...bodyHits]) {
    if (seen.has(h.thread_id)) continue;
    seen.add(h.thread_id);
    out.push({ thread_id: h.thread_id, title: h.title, channel_id: h.channel_id, status: h.status, updated_at: h.updated_at, snippet: h.snippet });
    if (out.length >= limit) break;
  }
  return out;
}
