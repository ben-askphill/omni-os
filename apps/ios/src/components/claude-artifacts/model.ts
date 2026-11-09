import { freshness, typeLabel, updatedLabel, type ClaudeArtifact, type ClaudeArtifactsState } from '@omni/shared/claude-artifacts.ts';

import { shortAgo } from '../../live/channel-model';
import type { IconName } from '../../ui/Icon';

// What the claude.ai rows and freshness line say, apart from how they are drawn, so it can be tested without React Native.

const TYPE_ICONS: Record<string, IconName> = {
  page: 'file',
  slides: 'square',
  docs: 'type',
  design: 'pencil',
  dashboard: 'gauge',
  motion: 'play',
  'design-system': 'grid',
};

/** The row's leading drawing: its type's, or a globe while the type is not known yet. */
export const typeIcon = (type: string | null): IconName => (type && TYPE_ICONS[type]) || 'globe';

/** The row's second line: whose it is, when claude.ai last changed it (own pages only) and the thread that published it. */
export function rowDetail(a: Pick<ClaudeArtifact, 'scope' | 'updated_on' | 'local'>, now: number): string {
  const parts = [a.scope === 'mine' ? 'Mine' : 'Shared', a.updated_on ? `Updated ${updatedLabel(a.updated_on, now)}` : null, a.local ? `From \u201c${a.local.thread_title}\u201d` : null];
  return parts.filter(Boolean).join(' \u00b7 ');
}

/** What VoiceOver reads for a row: title, type, then the second line. */
export const rowLabel = (a: Pick<ClaudeArtifact, 'title' | 'type' | 'scope' | 'updated_on' | 'local'>, now: number) =>
  [a.title, a.type ? typeLabel(a.type) : null, rowDetail(a, now)].filter(Boolean).join(', ');

export interface FreshnessText {
  text: string;
  /** `warn`: the list is a day old or the last listing failed. */
  tone: 'quiet' | 'warn';
  busy: boolean;
}

/** "Fetched 12m ago · 142 artifacts", "Refreshing", or a warning when the list is old or the last listing failed. */
export function freshnessText(server: ClaudeArtifactsState | null, now: number): FreshnessText {
  if (!server) return { text: 'Loading', tone: 'quiet', busy: true };
  if (server.refreshing) return { text: server.last_success_at ? 'Refreshing from claude.ai' : 'Fetching your artifacts from claude.ai', tone: 'quiet', busy: true };
  const f = freshness(server, now);
  if (f === 'never') return { text: server.error ? 'Never fetched' : 'Not fetched yet', tone: server.error ? 'warn' : 'quiet', busy: false };
  const ago = shortAgo(server.last_success_at!, now);
  const when = ago === 'now' ? 'Fetched just now' : /^\d+[mhd]$/.test(ago) ? `Fetched ${ago} ago` : `Fetched on ${ago}`;
  const count = server.total !== null ? ` · ${server.total} artifact${server.total === 1 ? '' : 's'}` : '';
  return { text: `${when}${count}`, tone: f === 'stale' || server.error ? 'warn' : 'quiet', busy: false };
}
