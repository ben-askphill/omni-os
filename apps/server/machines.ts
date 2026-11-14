import { BLOCKER_GLYPH, asksForYou, resultGlyph } from '@omni/shared/status.ts';
import { harnessRank, type MachineHarness, type MachineLoad, type MachinesView } from '@omni/shared/machines.ts';
import type { DeviceRecord } from '@omni/shared/handoff.ts';
import { about } from './about.ts';
import { assignments, db, needsYou, outbox } from './db.ts';
import { syncedStats, watchStats } from './machine-stats.ts';
import { activeTasks, slotCaps } from './runner/state.ts';
import { currentRecords, deviceRecords } from './sync/devices.ts';
import { syncStatus } from './sync/worker.ts';
import { reachabilityOf, tailnet } from './tailscale.ts';

// GET /api/machines (@omni/shared/machines.ts): what each machine runs now. Every number comes from rows sync already
// carries: a running or queued thread row names the machine running it in run_machine (db/repos/threads.ts), the
// assignment names the machine that holds a thread, and devices.<id> names each machine and its caps. Only the
// in-process sub-agents are this machine's alone. CPU and memory come from each machine's sampler (machine-stats.ts):
// asking starts this machine's and, through sync, the others'.

type RunRow = { id: string; status: 'running' | 'queued'; harness: string | null; parent_id: string | null; run_machine: string | null };

const runRows = () =>
  db.prepare(`SELECT id, status, harness, parent_id, run_machine FROM threads WHERE status IN ('running', 'queued')`).all() as unknown as RunRow[];

/** The newest synced change each machine made, as sync stamped it on the rows it applied here. */
const lastChanges = () =>
  new Map(
    (db.prepare('SELECT machine_id, MAX(ts) AS ts FROM sync_meta GROUP BY machine_id').all() as { machine_id: string; ts: string }[]).map((r) => [r.machine_id, r.ts]),
  );

/** The machine a Needs you item belongs to: its thread's holder. Every item is this machine's while sync is off. */
function needsByMachine(self: string | null): Map<string | null, number> {
  const out = new Map<string | null, number>();
  for (const item of needsYou().items) {
    const b = item.blockers[0];
    if (!asksForYou(b ? BLOCKER_GLYPH[b.kind] : resultGlyph(item.result?.status ?? 'done'))) continue;
    const holder = self ? assignments.holder(item.thread.id) : null;
    if (self && !holder) continue;
    out.set(holder, (out.get(holder) ?? 0) + 1);
  }
  return out;
}

function load(rows: RunRow[], caps: Record<string, number> | undefined): Pick<MachineLoad, 'running' | 'queued' | 'delegated' | 'harnesses' | 'threadIds'> {
  const by = new Map<string, MachineHarness>(Object.entries(caps ?? {}).map(([id, cap]) => [id, { id, running: 0, queued: 0, cap }]));
  for (const r of rows) {
    const id = r.harness || 'claude-code';
    const h = by.get(id) ?? { id, running: 0, queued: 0, cap: caps?.[id] ?? null };
    h[r.status]++;
    by.set(id, h);
  }
  return {
    running: rows.filter((r) => r.status === 'running').length,
    queued: rows.filter((r) => r.status === 'queued').length,
    delegated: rows.filter((r) => r.parent_id).length,
    harnesses: [...by.values()].sort((a, b) => harnessRank(a.id) - harnessRank(b.id) || a.id.localeCompare(b.id)),
    threadIds: rows.map((r) => r.id),
  };
}

/** `stats` samples this machine even with no other machine to show it beside (the Conductor's `machines` tool). */
export async function machinesView({ stats: always = false } = {}): Promise<MachinesView> {
  const self = outbox.machineId();
  const sync = syncStatus();
  const syncLive = !!self && sync.configured && sync.enabled && !sync.signedOut && !sync.lastError;
  const rows = runRows();
  const needs = needsByMachine(self);
  const records = self ? currentRecords(deviceRecords()) : [];
  const own = records.find((d) => d.id === self);
  const others = records.filter((d) => d.id !== self).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const stats = await watchStats(others.length > 0, always);

  const here: MachineLoad = {
    id: self,
    name: own?.name ?? about.name,
    here: true,
    reachability: 'online',
    lastSeen: null,
    lastChangeAt: null,
    ...load(rows.filter((r) => r.run_machine === self), slotCaps()),
    agents: activeTasks().filter((t) => t.subagent).length,
    needsYou: needs.get(self) ?? 0,
    stats,
  };
  if (!others.length) return { syncLive, lastSyncAt: sync.lastSyncAt, machines: [here] };

  const net = await tailnet();
  const changes = lastChanges();
  const remote = others.map((d: DeviceRecord): MachineLoad => {
    const { reachability, lastSeen } = reachabilityOf(net, d);
    return {
      id: d.id,
      name: d.name,
      here: false,
      reachability,
      lastSeen,
      lastChangeAt: changes.get(d.id) ?? null,
      ...load(rows.filter((r) => r.run_machine === d.id), d.caps),
      agents: null,
      needsYou: needs.get(d.id) ?? 0,
      stats: syncedStats(d.id),
    };
  });
  return { syncLive, lastSyncAt: sync.lastSyncAt, machines: [here, ...remote] };
}
