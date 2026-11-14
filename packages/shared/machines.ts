import { relTime } from './format.ts';
import { HARNESS } from './brand.ts';
import type { Reachability } from './handoff.ts';

// GET /api/machines: how much each machine under this account runs right now, for the Inbox dashboard's machine
// tiles and the phone's Activity strip. apps/server/machines.ts builds it from the thread rows sync already carries
// (run_machine on a running or queued row names the machine running it), the devices.<id> records and this machine's
// Tailscale. Only this machine sees its own processes, so in-process sub-agents are counted here only. CPU and memory
// come from each machine's own sampler (apps/server/machine-stats.ts), synced in kv machine-stats.<id>.

/**
 * A machine's CPU and memory as it sampled them itself. A stat the platform has no correct source for is null, never
 * a guess or a zero.
 */
export interface MachineStats {
  /** When that machine took the sample, by its own clock. */
  sampledAt: string;
  /** Share of all cores busy since its previous sample, 0 to 100. Null on a first sample. */
  cpu: number | null;
  /** Logical cores. */
  cores: number | null;
  /**
   * Memory in use as the OS counts it, and the total, in bytes. macOS: app memory, wired and compressed from vm_stat,
   * as Activity Monitor's Memory Used. Linux: MemTotal less MemAvailable from /proc/meminfo, as `free` does. Null elsewhere.
   */
  memory: { used: number; total: number; source: 'vm_stat' | 'meminfo' } | null;
  /** 1, 5 and 15 minute load averages. Null on Windows, where Node reports zeros. */
  load: [number, number, number] | null;
}

/** One harness's share of a machine's threads. */
export interface MachineHarness {
  id: string;
  running: number;
  queued: number;
  /** Its concurrency cap there. Null for a machine on a build that does not announce its caps. */
  cap: number | null;
}

export interface MachineLoad {
  /** Its sync machine id, or null for this machine while sync is not set up. */
  id: string | null;
  name: string;
  /** The machine this server runs on. */
  here: boolean;
  /** Always online for this machine; another machine as this machine's Tailscale sees it. */
  reachability: Reachability;
  /** Tailscale's last-seen time for an offline machine. */
  lastSeen: string | null;
  /** The newest change from it that sync applied here. Null for this machine, or before it changed anything. */
  lastChangeAt: string | null;
  /** Threads running there: their own turn runs. Delegated threads count too. */
  running: number;
  /** Threads waiting there for a free slot. */
  queued: number;
  /** Of the running and queued, the ones another thread started: delegated crew threads and team members. */
  delegated: number;
  /** Sub-agents the threads' processes run (Agent calls, workflows, forks, teammates). Null on another machine: only it sees its processes. */
  agents: number | null;
  /** Needs you items for threads this machine holds. */
  needsYou: number;
  /** Every harness that has a cap there or a thread running or queued there, in the usual harness order. */
  harnesses: MachineHarness[];
  /** The running and queued threads, so the Running list can show one machine's. */
  threadIds: string[];
  /** Its latest CPU and memory sample: this machine's own, another's as it last synced it. Null before any. */
  stats: MachineStats | null;
}

export interface MachinesView {
  /** Sync carries the other machines' changes here now: set up, on, signed in and not failing. */
  syncLive: boolean;
  /** When this machine last synced, for numbers that stopped moving. */
  lastSyncAt: string | null;
  /** This machine first, then the others by name. Only this machine while sync is off. */
  machines: MachineLoad[];
}

/** The harnesses in the order the usage rows and pickers list them. */
export const HARNESS_ORDER = ['claude-code', 'codex', 'cursor', 'hermes', 'cursor-cloud'];
export const harnessRank = (id: string) => {
  const i = HARNESS_ORDER.indexOf(id);
  return i < 0 ? HARNESS_ORDER.length : i;
};

const harnessName = (id: string) => HARNESS[id]?.label ?? id;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** How a tile shows a machine. `value` null shows a dash: the number is not known now. */
export interface MachineTileView {
  /** A StatusDot glyph: running while it runs something, done when up and idle, settled offline, idle when unknown. */
  dot: 'running' | 'done' | 'settled' | 'idle';
  /** The dot in words, for screen readers and its tooltip. */
  state: string;
  value: number | null;
  /** What the number is, then the rest: "running · 1 queued · 2 delegated". */
  detail: string;
  /** The harness line, or why the numbers are not live. */
  foot: string;
  /** The numbers are a while old: sync here is not carrying changes, or the machine is offline. */
  stale: boolean;
}

function counts(m: MachineLoad): string {
  return [
    'running',
    m.queued ? `${m.queued} queued` : '',
    m.delegated ? `${m.delegated} delegated` : '',
    m.agents ? plural(m.agents, 'sub-agent') : '',
    m.needsYou ? `${m.needsYou} need${m.needsYou === 1 ? 's' : ''} you` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "Claude Code 2 of 12 · Codex 1 queued": the harnesses at work, else the first one's free slots. */
export function harnessLine(m: MachineLoad): string {
  const busy = m.harnesses.filter((h) => h.running || h.queued);
  const one = (h: MachineHarness) =>
    [`${harnessName(h.id)} ${h.cap === null ? `${h.running} running` : `${h.running} of ${h.cap}`}`, h.queued ? `${h.queued} queued` : ''].filter(Boolean).join(', ');
  if (busy.length) return busy.map(one).join(' · ');
  const first = m.harnesses.find((h) => h.cap !== null);
  return first ? `${harnessName(first.id)} · 0 of ${first.cap} slots` : 'Nothing running';
}

export function machineTile(m: MachineLoad, view: Pick<MachinesView, 'syncLive' | 'lastSyncAt'>, now = Date.now()): MachineTileView {
  const busy = m.running + m.queued > 0;
  if (!m.here && m.reachability === 'offline') {
    const seen = m.lastSeen ? `Offline · seen ${relTime(m.lastSeen, now)}` : 'Offline';
    // What it said last stays visible, as last reported, never as zero.
    const last = busy ? `Last reported ${m.running} running${m.queued ? `, ${m.queued} queued` : ''}` : m.lastChangeAt ? `Last change ${relTime(m.lastChangeAt, now)}` : 'No changes from it yet';
    return { dot: 'settled', state: 'Offline', value: null, detail: seen, foot: last, stale: true };
  }
  const dot = busy ? 'running' : m.here || m.reachability === 'online' ? 'done' : 'idle';
  const state = m.here || m.reachability === 'online' ? (busy ? 'Online, running' : 'Online') : 'Reachability unknown';
  if (!m.here && !view.syncLive) {
    const at = view.lastSyncAt ? `as of ${relTime(view.lastSyncAt, now)}` : 'not synced yet';
    return { dot, state, value: m.running, detail: counts(m), foot: `Sync is not live here · ${at}`, stale: true };
  }
  const foot = !m.here && m.reachability === 'unknown' ? `No Tailscale to ask · ${harnessLine(m)}` : harnessLine(m);
  return { dot, state, value: m.running, detail: counts(m), foot, stale: false };
}

/** A sample older than this shows as stale. A watched machine sends one every 15 seconds. */
export const STATS_STALE_MS = 60_000;

/** One meter row on a tile. `value` null draws an empty meter and a dash: the number is not known yet. */
export interface StatRow {
  key: 'cpu' | 'memory';
  label: 'CPU' | 'RAM';
  /** The meter's fill, 0 to 1. */
  value: number | null;
  /** "23%", "17.8/24 GB", or a dash. */
  text: string;
  /** The row's tooltip: load average and cores, or how much memory and from where. */
  title: string;
}

export interface MachineStatsView {
  /** CPU, then RAM, each only where that machine has a source for it. */
  rows: StatRow[];
  /** Not live: an old sample, an offline machine, or sync here not carrying changes. Never shown as live or as zeros. */
  stale: boolean;
  /** Why the rows are grey or missing ("Sampled 4m ago"). Null while live. */
  note: string | null;
  /** Seconds since the sample. Null without one. */
  ageSeconds: number | null;
}

const GB = 2 ** 30;
const gb = (n: number) => {
  const g = n / GB;
  return String(g >= 100 ? Math.round(g) : Math.round(g * 10) / 10);
};
const ago = (iso: string, ms: number, now: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s ago` : relTime(iso, now));
const DASH = '–';
const SAMPLING: StatRow[] = [
  { key: 'cpu', label: 'CPU', value: null, text: DASH, title: 'Sampling' },
  { key: 'memory', label: 'RAM', value: null, text: DASH, title: 'Sampling' },
];

function cpuRow(s: MachineStats): StatRow | null {
  if (s.cores === null && s.cpu === null) return null;
  const load = s.load ? `Load average ${s.load.map((n) => n.toFixed(2)).join(', ')} over 1, 5 and 15 minutes` : '';
  const title = [s.cpu === null ? 'CPU: first sample, busy share follows' : `CPU ${Math.round(s.cpu)}% busy across all cores`, load, s.cores ? plural(s.cores, 'core') : '']
    .filter(Boolean)
    .join(' · ');
  return { key: 'cpu', label: 'CPU', value: s.cpu === null ? null : s.cpu / 100, text: s.cpu === null ? DASH : `${Math.round(s.cpu)}%`, title };
}

function memoryRow(s: MachineStats): StatRow | null {
  const m = s.memory;
  if (!m || !(m.total > 0)) return null;
  const share = Math.min(1, m.used / m.total);
  const how = m.source === 'vm_stat' ? 'app memory, wired and compressed (vm_stat)' : 'total less available (/proc/meminfo)';
  return { key: 'memory', label: 'RAM', value: share, text: `${gb(m.used)}/${gb(m.total)} GB`, title: `${gb(m.used)} of ${gb(m.total)} GB in use (${Math.round(share * 100)}%): ${how}` };
}

/** How a tile shows a machine's CPU and memory, and whether they are live. */
export function machineStats(m: MachineLoad, view: Pick<MachinesView, 'syncLive'>, now = Date.now()): MachineStatsView {
  const s = m.stats;
  const at = s ? Date.parse(s.sampledAt) : NaN;
  if (!s || !Number.isFinite(at)) {
    // This machine samples once it is watched: empty meters for the moment that takes. Another may be on an older build.
    if (m.here) return { rows: SAMPLING, stale: false, note: null, ageSeconds: null };
    return { rows: [], stale: true, note: 'No CPU or memory stats from it yet', ageSeconds: null };
  }
  const age = Math.max(0, now - at);
  const rows = [cpuRow(s), memoryRow(s)].filter((r): r is StatRow => !!r);
  const stale = age > STATS_STALE_MS || (!m.here && (m.reachability === 'offline' || !view.syncLive));
  const note = !rows.length ? 'No CPU or memory stats on this platform' : stale ? `Sampled ${ago(s.sampledAt, age, now)}` : null;
  return { rows, stale, note, ageSeconds: Math.round(age / 1000) };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** A machine's stats as the Conductor's `machines` tool reports them: plain numbers, the sample's age and whether it is stale. */
export function statsReport(m: MachineLoad, view: Pick<MachinesView, 'syncLive'>, now = Date.now()) {
  const v = machineStats(m, view, now);
  const s = m.stats;
  if (!s || v.ageSeconds === null) return { stats: null, statsNote: v.note };
  const mem = s.memory;
  return {
    stats: {
      sampledAt: s.sampledAt,
      ageSeconds: v.ageSeconds,
      stale: v.stale,
      cpuPercent: s.cpu,
      cores: s.cores,
      loadAverage: s.load,
      memory: mem && { usedGB: round1(mem.used / GB), totalGB: round1(mem.total / GB), percent: Math.round((mem.used / mem.total) * 100), source: mem.source },
    },
    statsNote: v.note,
  };
}

/**
 * Worth asking again in a moment: this machine has no CPU share yet (its first sample), or an online machine that
 * sends stats has only a stale one while sync is live, since asking just told it to send.
 */
export function awaitingStats(view: MachinesView, now = Date.now()): boolean {
  return view.machines.some((m) =>
    m.here ? !m.stats || (m.stats.cpu === null && m.stats.cores !== null) : view.syncLive && m.reachability !== 'offline' && !!m.stats && machineStats(m, view, now).stale,
  );
}
