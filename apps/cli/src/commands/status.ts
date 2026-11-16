// `omni status`: this Omni's version, running turns, Needs you, sync and update state. `--machine` reads another
// synced machine as this Omni sees it (GET /machines and the update fleet), so it needs no route to that machine.
import type { ServerStatus, SyncStatus } from '@omni/client-core';
import { freeSize } from '@omni/shared/disk-space.ts';
import type { MachineLoad } from '@omni/shared/machines.ts';
import type { FleetMachine } from '@omni/shared/update-fleet.ts';
import { flag, parseArgs, value } from '../args.ts';
import { client } from '../connection.ts';
import { clip, fields, json, when } from '../format.ts';
import { CliError, EXIT, UsageError, type Io } from '../io.ts';

/** GET /status as the CLI reads it: the typed part, and what the Web UI's status bar reads besides. */
type FullStatus = ServerStatus & {
  running?: number;
  queued?: number;
  server?: ServerStatus['server'] & { pid?: number; port?: number; name?: string };
};

/** The value, or null when the call failed: an older server lacks some of these routes. */
const settled = async <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

export function updateText(row: FleetMachine | null): string | null {
  if (!row) return null;
  const s = row.status;
  const running = s?.version ? ` (runs ${s.version})` : '';
  const next = s?.available ?? 'an update';
  switch (row.state) {
    case 'up-to-date':
      return `up to date${running}`;
    case 'available':
      return `${next} available${running}`;
    case 'downloading':
      return `downloading ${next}${s?.progress !== null && s?.progress !== undefined ? ` (${Math.round(s.progress)}%)` : ''}`;
    case 'ready':
      return `${next} downloaded, applies on restart${running}`;
    case 'waiting':
      return `restarting for ${next} once ${s?.waitingFor ?? 0} running turn${s?.waitingFor === 1 ? '' : 's'} end`;
    case 'failed':
      return `update failed${s?.error ? `: ${clip(s.error, 100)}` : ''}${running}`;
    case 'offline':
      return 'offline';
    case 'sent':
      return 'asked to update, not taken yet';
    case 'expired':
      return 'asked to update, never took it';
    case 'not-reporting':
      return 'runs an Omni from before Update all machines';
    default:
      return `${row.state}${running}`;
  }
}

export function syncText(s: SyncStatus | null, now: number): string | null {
  if (!s) return null;
  if (!s.configured) return 'off';
  if (s.signedOut) return 'signed out: sign in again in Settings > Sync';
  if (!s.enabled) return 'paused';
  if (s.lastError) return `failing${s.failures > 1 ? ` (${s.failures} in a row)` : ''}: ${clip(s.lastError, 100)}`;
  const last = s.lastSyncAt ? `last synced ${when(s.lastSyncAt, now)}` : 'not synced yet';
  return `on, ${last}${s.pending ? `, ${s.pending} to push` : ''}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function statusCommand(argv: string[], io: Io): Promise<number> {
  const p = parseArgs(argv, { machine: { value: true }, json: {} }, 'status');
  if (p.positional.length) throw new UsageError(`unexpected ${p.positional[0]}`, 'status');
  const machine = value(p, 'machine');
  return machine ? machineStatus(io, machine, flag(p, 'json')) : ownStatus(io, flag(p, 'json'));
}

async function ownStatus(io: Io, asJson: boolean): Promise<number> {
  const c = client(io);
  // The one call that must answer: it says whether the server is there and takes the token.
  const status = (await c.api.status()) as FullStatus;
  const [needs, sync, fleet] = await Promise.all([settled(c.api.needsYou()), settled(c.api.syncStatus()), settled(c.api.updateFleet())]);
  const update = fleet?.machines.find((m) => m.current) ?? null;
  const now = io.now();
  if (asJson) {
    io.out(json({ url: c.conn.baseUrl, machine: status.device?.name ?? null, server: status.server ?? null, running: status.running ?? null, queued: status.queued ?? null, needs_you: needs ? { unread: needs.unread, blocked: needs.blocked } : null, sync, update }));
    return EXIT.ok;
  }
  const s = status.server;
  io.out(`${['Omni', s?.version].filter(Boolean).join(' ')} on ${status.device?.name ?? 'this machine'} (${c.conn.baseUrl})\n`);
  io.out(
    fields([
      ['server', s ? `up since ${when(s.startedAt, now)}${s.pid ? `, pid ${s.pid}` : ''}${s.gitHead ? `, commit ${s.gitHead.slice(0, 8)}` : ''}` : null],
      ['turns', status.running !== undefined ? `${status.running} running, ${status.queued ?? 0} queued` : null],
      ['needs you', needs ? `${plural(needs.unread, 'unread result')}, ${plural(needs.blocked, 'blocked thread')}` : null],
      ['sync', syncText(sync, now)],
      ['update', updateText(update)],
    ]),
  );
  return EXIT.ok;
}

/** A machine by its sync id, its name (any case) or "here". */
export function findMachine(machines: MachineLoad[], query: string): MachineLoad | null {
  const q = query.trim().toLowerCase();
  if (q === 'here') return machines.find((m) => m.here) ?? null;
  return machines.find((m) => m.id?.toLowerCase() === q) ?? machines.find((m) => m.name.toLowerCase() === q) ?? null;
}

async function machineStatus(io: Io, query: string, asJson: boolean): Promise<number> {
  const c = client(io);
  const [view, fleet] = await Promise.all([c.api.machineLoads(true), settled(c.api.updateFleet())]);
  const m = findMachine(view.machines, query);
  if (!m) {
    const names = view.machines.map((x) => x.name).join(', ');
    const hint = view.machines.length === 1 ? ' Sync is off, so this Omni knows only itself.' : '';
    throw new CliError(`No machine named ${query}. Machines: ${names}.${hint}`);
  }
  const update = fleet?.machines.find((f) => (m.id ? f.id === m.id : f.current)) ?? null;
  const now = io.now();
  if (asJson) {
    io.out(json({ machine: m, update, sync_live: view.syncLive, last_sync_at: view.lastSyncAt }));
    return EXIT.ok;
  }
  const where = m.here ? 'this machine' : `${m.reachability}${m.reachability === 'offline' && m.lastSeen ? `, last seen ${when(m.lastSeen, now)}` : ''}`;
  io.out(`${m.name} (${where})\n`);
  const st = m.stats;
  io.out(
    fields([
      ['turns', `${m.running} running, ${m.queued} queued${m.delegated ? `, ${m.delegated} delegated` : ''}`],
      ['sub-agents', m.agents ? String(m.agents) : null],
      ['needs you', `${plural(m.needsYou, 'thread')} asking for you`],
      ['cpu', st && st.cpu !== null ? `${Math.round(st.cpu)}%${st.cores ? ` of ${st.cores} cores` : ''}${st.load ? `, load ${st.load.map((l) => l.toFixed(2)).join(' ')}` : ''}` : null],
      ['memory', st?.memory ? `${freeSize(st.memory.used)} of ${freeSize(st.memory.total)} in use` : null],
      ['sampled', st ? when(st.sampledAt, now) : null],
      ['last change', m.here ? null : m.lastChangeAt ? when(m.lastChangeAt, now) : 'none synced yet'],
      ['update', updateText(update)],
      ['sync', m.here ? null : view.syncLive ? `live, last synced ${when(view.lastSyncAt, now) || 'never'}` : 'not live: these numbers may be old'],
    ]),
  );
  return EXIT.ok;
}
