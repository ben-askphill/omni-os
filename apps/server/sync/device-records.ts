import type { DeviceRecord } from '@omni/shared/handoff.ts';
import { kv, outbox } from '../db.ts';

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
  return { id: key.slice(PREFIX.length), name: r.name, tailscale: ts ? { nodeId: ts.nodeId, dnsName: ts.dnsName } : null, ...sealKey, ...signKey, ...(caps && { caps }), ...(r.syncPaused === true && { syncPaused: true }), at: r.at };
}

export const deviceRecords = (): DeviceRecord[] =>
  kv.list<unknown>(PREFIX).flatMap(([key, v]) => parse(key, v) ?? []);

export const deviceRecord = (id: string): DeviceRecord | null => parse(PREFIX + id, kv.get<unknown>(PREFIX + id));

const newer = (a: DeviceRecord, b: DeviceRecord) => a.at > b.at || (a.at === b.at && a.id > b.id);

/** A record as currentRecords hands it out. `carriedNode`: its node came from an older record of the same machine. */
export type CurrentRecord = DeviceRecord & { carriedNode?: true };

/**
 * One record per machine. A machine whose sync state was reset comes back under a new id and leaves its old record
 * behind; the newest record is the live one. Records on the same Tailscale node are one machine. A name (any case)
 * held by exactly two records, one on a node and one without (it announced itself while Tailscale did not answer),
 * is one machine too when their signing keys match or one has none: the newer record stands for it, and a live
 * record without a node keeps the older one's node, marked carried. Anything less clear stays apart: two signing
 * keys, same-named records without a node, or a name on two nodes can be two machines. This machine's own record
 * (`self`) is never dropped; a pair that would drop it stays apart.
 */
export function currentRecords(records: DeviceRecord[], self: string | null = outbox.machineId()): CurrentRecord[] {
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
  const replaced = new Map<DeviceRecord, CurrentRecord | null>();
  for (const group of byName.values()) {
    if (group.length !== 2) continue;
    const noded = group.find((d) => d.tailscale);
    const bare = group.find((d) => !d.tailscale);
    if (!noded || !bare) continue;
    // `at` only says which record changed last, not which machine is alive. The signing key survives a sync reset
    // (a global secret), so a machine's old and new records share it and two machines never do.
    if (noded.signKey && bare.signKey && noded.signKey !== bare.signKey) continue;
    const [live, stale] = newer(bare, noded) ? [bare, noded] : [noded, bare];
    if (stale.id === self) continue;
    replaced.set(stale, null);
    if (live === bare) replaced.set(bare, { ...bare, tailscale: noded.tailscale, carriedNode: true });
  }
  return byNode.flatMap((d) => {
    if (!replaced.has(d)) return [d];
    const r = replaced.get(d);
    return r ? [r] : [];
  });
}
