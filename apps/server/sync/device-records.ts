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

const newer = (a: DeviceRecord, b: DeviceRecord) => a.at > b.at || (a.at === b.at && a.id > b.id);

/**
 * One record per machine. A machine whose sync state was reset comes back under a new id and leaves its old record
 * behind; the newest record is the live one. Records on the same Tailscale node are one machine. A record without a
 * node (Tailscale did not answer when it announced itself) is the same machine as the records under its name, as long
 * as those carry at most one node between them: the newest record stands for it, with the node an older one knew.
 * Same-named records on two different nodes stay apart: two machines can carry one name.
 */
export function currentRecords(records: DeviceRecord[]): DeviceRecord[] {
  const newest = new Map<string, DeviceRecord>();
  for (const d of records) {
    const node = d.tailscale?.nodeId;
    if (!node) continue;
    const had = newest.get(node);
    if (!had || newer(d, had)) newest.set(node, d);
  }
  const byNode = records.filter((d) => !d.tailscale?.nodeId || newest.get(d.tailscale.nodeId) === d);

  const byName = new Map<string, DeviceRecord[]>();
  for (const d of byNode) {
    const key = d.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), d]);
  }
  const merged = new Map<DeviceRecord, DeviceRecord | null>();
  for (const group of byName.values()) {
    const nodes = new Set(group.flatMap((d) => d.tailscale?.nodeId ?? []));
    if (group.length < 2 || nodes.size > 1 || group.every((d) => d.tailscale)) continue;
    const live = group.reduce((a, b) => (newer(b, a) ? b : a));
    const node = group.filter((d) => d.tailscale).reduce<DeviceRecord | null>((a, b) => (!a || newer(b, a) ? b : a), null)?.tailscale ?? null;
    for (const d of group) merged.set(d, d === live ? { ...live, tailscale: live.tailscale ?? node } : null);
  }
  return byNode.flatMap((d) => {
    if (!merged.has(d)) return [d];
    const m = merged.get(d);
    return m ? [m] : [];
  });
}
