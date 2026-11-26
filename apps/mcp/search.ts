// search_history (omni.ts) and search_threads (external/tools.ts): GET /api/search with a bounded default,
// optional channel filter, non-empty plain-text snippets and no UI-only fields (such as event_id).
//
// Erasable TypeScript only: external/stdio.ts runs under plain `node`.
import { compactRow } from '@omni/shared/mcp-compact.ts';
import { z } from 'zod';

export const SEARCH_DEFAULT_LIMIT = 10;
export const SEARCH_MAX_LIMIT = 100;

export const searchInput = {
  query: z.string().min(1),
  channel: z.string().optional().describe('Channel id to limit results to.'),
  limit: z.number().int().min(1).max(SEARCH_MAX_LIMIT).optional().describe(`Hits to return, 1 to ${SEARCH_MAX_LIMIT}. Default ${SEARCH_DEFAULT_LIMIT}.`),
};

export interface ApiSearchHit {
  thread_id: string;
  title: string;
  channel_id: string;
  status: string;
  updated_at: string;
  snippet?: string;
  event_id?: number | null;
}

export function searchPath(args: { query: string; channel?: string; limit?: number }): string {
  const q = new URLSearchParams({ q: args.query, limit: String(args.limit ?? SEARCH_DEFAULT_LIMIT) });
  if (args.channel) q.set('channel', args.channel);
  return `/search?${q}`;
}

export function formatSearchHits(hits: readonly ApiSearchHit[], limit = SEARCH_DEFAULT_LIMIT) {
  return hits.slice(0, limit).map((h) => {
    const snippet = (h.snippet ?? '').replace(/<\/?mark>/g, '').trim() || h.title || '(untitled)';
    return compactRow({
      thread_id: h.thread_id,
      title: h.title,
      channel_id: h.channel_id,
      status: h.status,
      updated_at: h.updated_at,
      snippet,
    });
  });
}
