import type { DeviceRecord } from '@omni/shared/handoff.ts';
import { kv } from '../db.ts';

// The synced machines' records in kv `devices.<sync id>`, read without the sync worker, so sync/owner.ts can name a
// machine without importing it. apps/server/sync/devices.ts writes this machine's record and lists the others.

export const PREFIX = 'devices.';

/** The caps a record carries, when they are a harness-to-count map. Anything else is dropped. */
function parseCaps(v: unknown): Record<string, number> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out = Object.entries(v as Record<string, unknown>).filter(([, n]) => typeof n === 'number' && Number.isInteger(n) && n >= 0);
  return out.length ? (Object.fromEntries(out) as Record<string, number>) : undefined;
}

/** A record as the other Mac wrote it, if it is one. Its id is the key's, whatever the value says. */
function parse(key: string, v: unknown): DeviceRecord | null {
  const r = v as Partial<DeviceRecord> | null;
  const ts = r?.tailscale;
  const node = ts === null || (typeof ts?.nodeId === 'string' && typeof ts.dnsName === 'string');
  if (typeof r?.name !== 'string' || !r.name || !node || typeof r.at !== 'string') return null;
  const sealKey = typeof r.sealKey === 'string' && r.sealKey ? { sealKey: r.sealKey } : {};
  const signKey = typeof r.signKey === 'string' && r.signKey ? { signKey: r.signKey } : {};
  const caps = parseCaps(r.caps);
  return { id: key.slice(PREFIX.length), name: r.name, tailscale: ts ? { nodeId: ts.nodeId, dnsName: ts.dnsName } : null, ...sealKey, ...signKey, ...(caps && { caps }), at: r.at };
}

export const deviceRecords = (): DeviceRecord[] =>
  kv.list<unknown>(PREFIX).flatMap(([key, v]) => parse(key, v) ?? []);

export const deviceRecord = (id: string): DeviceRecord | null => parse(PREFIX + id, kv.get<unknown>(PREFIX + id));

/**
 * One record per Tailscale node. A machine whose sync state was reset comes back under a new id and leaves its old
 * record behind; the newest record for a node is the live one. Records without a node are never merged.
 */
export function currentRecords(records: DeviceRecord[]): DeviceRecord[] {
  const newest = new Map<string, DeviceRecord>();
  for (const d of records) {
    const node = d.tailscale?.nodeId;
    if (!node) continue;
    const had = newest.get(node);
    if (!had || d.at > had.at || (d.at === had.at && d.id > had.id)) newest.set(node, d);
  }
  return records.filter((d) => !d.tailscale?.nodeId || newest.get(d.tailscale.nodeId) === d);
}
