import type { McpClient } from '@omni/client-core';

import { shortAgo } from '../live/channel-model';
import { isNotFound } from './optional-remote';

// Settings, Sharing & access on the phone: Rotate install token and the MCP clients list, in the words the Web UI and
// docs/user use.

export const ROTATE_LABEL = 'Rotate install token';

export const ROTATE_CONFIRMATION = {
  title: 'Rotate install token?',
  message: 'Every signed-in device, this iPhone included, has to pair again.',
  confirmLabel: 'Rotate',
} as const;

/**
 * What a failed rotation leaves on screen. `missing`: the server predates rotation, so the button goes. `refused`: the
 * server's own sentence, as for a 403 when this phone's session may not rotate it.
 */
export function rotateFailure(error: unknown): { kind: 'missing'; message: string } | { kind: 'refused'; message: string } {
  if (isNotFound(error)) return { kind: 'missing', message: 'This server is older and cannot rotate its install token. Update it, or rotate the token on the computer.' };
  return { kind: 'refused', message: error instanceof Error && error.message ? error.message : 'Something went wrong. Try again.' };
}

/** "First seen 12 Oct", "Last seen 5m ago", "Last seen just now". Empty when the time is unknown. */
export function seenLabel(prefix: 'First seen' | 'Last seen', iso: string | null | undefined, now: number): string {
  if (!iso) return '';
  const ago = shortAgo(iso, now);
  if (!ago) return '';
  if (ago === 'now') return `${prefix} just now`;
  return /^\d+[mhd]$/.test(ago) ? `${prefix} ${ago} ago` : `${prefix} ${ago}`;
}

export interface McpClientRow {
  id: string;
  name: string;
  detail: string;
  pending: boolean;
  /** A second line under the detail, for a bound client. */
  hint: string | null;
  /** Null on an approved client. */
  approveLabel: string | null;
  removeLabel: string;
}

/** Its name, else its id, as the Web UI names it: the server sends no name yet. */
export function mcpClientName(c: Pick<McpClient, 'id' | 'name'>): string {
  return c.name?.trim() || c.id;
}

const STATUS_RANK: Record<McpClient['status'], number> = { pending: 0, bound: 1, approved: 2, removed: 3 };
const STATUS_LABEL: Partial<Record<McpClient['status'], string>> = { pending: 'Pending', bound: 'Bound to this Omni' };

/**
 * The clients the list shows: removed ones hidden, then pending, bound and approved, each most recently seen first.
 * Approve on a pending or bound client (bound lets in only tokens with this install's audience), Remove on every one.
 */
export function mcpClientRows(clients: readonly McpClient[], now: number): McpClientRow[] {
  const ordered = clients
    .filter((c) => c.status !== 'removed')
    .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.lastSeen.localeCompare(a.lastSeen));
  return ordered.map((c) => {
    const name = mcpClientName(c);
    return {
      id: c.id,
      name,
      detail: [STATUS_LABEL[c.status] ?? '', seenLabel('First seen', c.firstSeen, now), seenLabel('Last seen', c.lastSeen, now)].filter(Boolean).join(' · '),
      pending: c.status === 'pending',
      hint: c.status === 'bound' ? 'Approve also lets in tokens without an audience.' : null,
      approveLabel: c.status === 'pending' || c.status === 'bound' ? `Approve ${name}` : null,
      removeLabel: `Remove ${name}`,
    };
  });
}

export function removeClientConfirmation(row: Pick<McpClientRow, 'name'>): { title: string; message: string } {
  return { title: `Remove ${row.name}?`, message: 'It can no longer use Omni through /mcp.' };
}

/** The list after an approve answered with the client's row. */
export function withClient(clients: readonly McpClient[], next: McpClient): McpClient[] {
  return clients.map((c) => (c.id === next.id ? next : c));
}

/** The list after a remove. */
export function withoutClient(clients: readonly McpClient[], id: string): McpClient[] {
  return clients.filter((c) => c.id !== id);
}
