// The shapes and wording behind Settings' install token, MCP clients, sync keys and refused changes (PRD #667).
// Pure, so the rules are tested on their own.

/** GET /api/mcp/clients: an OAuth client that reached this Omni's /mcp. */
export interface McpClient {
  id: string;
  name: string | null;
  status: 'approved' | 'pending' | 'removed';
  firstSeen: string;
  lastSeen: string;
  /** How its token matched: the RFC 8707 audience, the approved client id, or not yet. */
  via: 'audience' | 'client' | null;
}

/** GET /api/sync/devices: a machine that syncs with this one, and the signing key this Mac pinned for it. */
export interface SyncDeviceKey {
  id: string;
  name: string;
  current: boolean;
  /** The key its device record carries now. */
  fingerprint: string | null;
  /** The key this Mac pinned at pairing. Null until first seen. */
  pinnedFingerprint: string | null;
  /** Both set and different: changes that make this Mac act wait until Ben confirms the new key. */
  keyChanged: boolean;
}

/** GET /api/sync/refused: a change this Mac would not apply. */
export interface RefusedChange {
  id: string;
  at: string;
  machine: string;
  entity: string;
  entityId: string;
  reason: string;
}

/** The clients to list: removed ones stay out. Pending ones first, so an approval is never below the fold. */
export function listedMcpClients(list: McpClient[]): McpClient[] {
  const rank = (c: McpClient) => (c.status === 'pending' ? 0 : 1);
  return list.filter((c) => c.status !== 'removed').sort((a, b) => rank(a) - rank(b) || b.lastSeen.localeCompare(a.lastSeen));
}

export const mcpClientName = (c: McpClient) => c.name?.trim() || c.id;

/** A key fingerprint to read aloud: hex in groups of four, the first 16 characters. */
export function fingerprintLabel(fp: string | null): string {
  if (!fp) return 'No signing key yet';
  const hex = fp.replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (!hex) return fp.slice(0, 19);
  return (hex.slice(0, 16).match(/.{1,4}/g) ?? []).join(' ');
}

/** The words for a synced entity in the refused list. */
const ENTITY_LABEL: Record<string, string> = {
  remote_command: 'Remote command',
  assignment: 'Thread assignment',
  secret_drop: 'Secret',
  'automations.owner': 'Automations owner',
  thread: 'Thread',
  channel: 'Channel',
};

export function entityLabel(entity: string): string {
  if (ENTITY_LABEL[entity]) return ENTITY_LABEL[entity];
  if (entity.startsWith('update.ask')) return 'Update request';
  return entity.replace(/[_.]/g, ' ');
}
