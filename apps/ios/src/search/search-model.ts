import type { ChannelWithRunning, SearchHit, Thread } from '@omni/client-core';
import { statusLabel } from '@omni/shared/status.ts';

import { shortAgo } from '../live/channel-model';

export const SEARCH_DEBOUNCE_MS = 200;

export function searchQuery(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export interface SnippetPart {
  text: string;
  match: boolean;
}

export function snippetParts(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  for (const [i, chunk] of snippet.split(/<\/?mark>/).entries()) {
    if (chunk) parts.push({ text: chunk, match: i % 2 === 1 });
  }
  return parts;
}

export interface ChannelMatch {
  id: string;
  name: string;
  icon: string | null;
  avatar_bg?: string | null;
  label: string;
  detail: string | null;
}

export function matchChannels(channels: readonly ChannelWithRunning[] | null, query: string): ChannelMatch[] {
  const needle = query.toLowerCase();
  if (!needle) return [];
  return (channels ?? [])
    .filter((c) => !c.archived && `${c.name} ${c.id}`.toLowerCase().includes(needle))
    .map((c) => ({ id: c.id, name: c.name, icon: c.icon ?? null, avatar_bg: c.avatar_bg, label: c.id === 'conductor' ? 'Conductor' : `#${c.name}`, detail: c.store_domain || c.github_repo || null }));
}

export interface HitRow {
  threadId: string;
  title: string;
  channel: string;
  status: SearchHit['status'];
  statusLabel: string | null;
  ago: string;
  snippet: SnippetPart[];
}

export function hitRows(hits: readonly SearchHit[], channels: readonly ChannelWithRunning[] | null, now: number): HitRow[] {
  const names = new Map((channels ?? []).map((c) => [c.id, c.name]));
  return hits.map((h) => ({
    threadId: h.thread_id,
    title: h.title || 'Untitled',
    channel: names.get(h.channel_id) ?? h.channel_id,
    status: h.status,
    statusLabel: h.status === 'done' || h.status === 'imported' ? null : statusLabel(h.status),
    ago: shortAgo(h.updated_at, now),
    snippet: snippetParts(h.snippet),
  }));
}

/** The latest threads, as shown before anything is typed. Team members and archived threads are left out, as on phone web. */
export function recentThreads(recent: readonly Thread[] | null, limit = 30): Thread[] {
  return (recent ?? []).filter((t) => t.source !== 'team' && !t.archived).slice(0, limit);
}

export function noMatchMessage(query: string): string {
  return `Nothing matches "${query}". Prefix matches work, so checko finds checkout.`;
}
