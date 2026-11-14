import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import type { MachineStats } from '@omni/shared/machines.ts';
import { publishFeed } from './bus.ts';
import { kv, outbox } from './db.ts';

// This machine's CPU and memory for the dashboard's machine tiles (@omni/shared/machines.ts), sampled every 5 seconds
// while someone watches and not at all otherwise. Watching means a client here asked GET /api/machines in the last
// minute (Home and phone Activity ask every 15 seconds), or another machine's watch record (kv machine-watch.<id>)
// synced in within the last 90 seconds. A watching machine renews its record every 45 seconds. While one watches,
// this machine writes its sample to kv machine-stats.<id> every 15 seconds: sync carries it like the slot caps in
// devices.<id>, and the relay keeps only the newest per key.
//
// Sources, all Node built-ins or the OS's own tools:
// - CPU: the busy share of os.cpus() times summed over all cores, between two samples. Never one snapshot, which
//   would be the average since boot.
// - Memory on macOS: vm_stat, used = app memory (anonymous pages less purgeable) + wired + compressed, as Activity
//   Monitor counts Memory Used; total from os.totalmem(). os.freemem() there counts only free pages, so a Mac with a
//   full file cache would look out of memory.
// - Memory on Linux: /proc/meminfo, used = MemTotal less MemAvailable, as `free` counts it. None before kernel 3.14.
// - Memory elsewhere: none. Load average: os.loadavg(), none on Windows, where Node reports zeros.

export const STATS_PREFIX = 'machine-stats.';
export const WATCH_PREFIX = 'machine-watch.';

export interface CpuTimes {
  user: number;
  nice: number;
  sys: number;
  idle: number;
  irq: number;
}

/** Every core's times added up. */
export interface CpuSnapshot {
  busy: number;
  total: number;
  cores: number;
}

export function cpuSnapshot(cpus: { times: CpuTimes }[]): CpuSnapshot | null {
  if (!cpus.length) return null;
  let busy = 0;
  let total = 0;
  for (const { times: t } of cpus) {
    const all = t.user + t.nice + t.sys + t.idle + t.irq;
    total += all;
    busy += all - t.idle;
  }
  return { busy, total, cores: cpus.length };
}

/** The busy share of all cores between two snapshots, 0 to 100 to one decimal. Null when they cannot compare: a core came or went, or a counter went back. */
export function cpuPercent(prev: CpuSnapshot | null, next: CpuSnapshot | null): number | null {
  if (!prev || !next || prev.cores !== next.cores) return null;
  const total = next.total - prev.total;
  const busy = next.busy - prev.busy;
  if (total <= 0 || busy < 0) return null;
  return Math.round(Math.min(1, busy / total) * 1000) / 10;
}

type Memory = { used: number; total: number };

/** vm_stat's output as the bytes Activity Monitor calls Memory Used. Null when a line it needs is missing. */
export function parseVmStat(out: string, total: number): Memory | null {
  const page = Number(/page size of (\d+) bytes/.exec(out)?.[1]);
  const pages = (label: string) => {
    const m = new RegExp(`^${label}:\\s+(\\d+)\\.?\\s*$`, 'm').exec(out);
    return m ? Number(m[1]) : null;
  };
  const anonymous = pages('Anonymous pages');
  const purgeable = pages('Pages purgeable');
  const wired = pages('Pages wired down');
  const compressed = pages('Pages occupied by compressor');
  if (!page || !(total > 0) || anonymous === null || purgeable === null || wired === null || compressed === null) return null;
  const used = (Math.max(0, anonymous - purgeable) + wired + compressed) * page;
  return { used: Math.min(used, total), total };
}

/** /proc/meminfo as the bytes `free` calls used: MemTotal less MemAvailable. Null without MemAvailable. */
export function parseMeminfo(text: string): Memory | null {
  const kb = (key: string) => {
    const m = new RegExp(`^${key}:\\s+(\\d+) kB`, 'm').exec(text);
    return m ? Number(m[1]) * 1024 : null;
  };
  const total = kb('MemTotal');
  const available = kb('MemAvailable');
  if (!total || available === null) return null;
  return { used: Math.max(0, total - available), total };
}

/** Where a sample comes from. Tests pass their own. */
export interface StatsSource {
  platform: NodeJS.Platform;
  cpus(): { times: CpuTimes }[];
  loadavg(): number[];
  totalmem(): number;
  vmStat(): Promise<string>;
  meminfo(): Promise<string>;
}

export const nodeSource: StatsSource = {
  platform: process.platform,
  cpus: () => os.cpus(),
  loadavg: () => os.loadavg(),
  totalmem: () => os.totalmem(),
  vmStat: () =>
    new Promise((resolve, reject) => execFile('/usr/bin/vm_stat', { timeout: 3_000 }, (err, out) => (err ? reject(err) : resolve(out)))),
  meminfo: () => readFile('/proc/meminfo', 'utf8'),
};

export async function readMemory(src: StatsSource): Promise<MachineStats['memory']> {
  try {
    if (src.platform === 'darwin') {
      const m = parseVmStat(await src.vmStat(), src.totalmem());
      return m && { ...m, source: 'vm_stat' };
    }
    if (src.platform === 'linux') {
      const m = parseMeminfo(await src.meminfo());
      return m && { ...m, source: 'meminfo' };
    }
  } catch (err) {
    console.error('[machine-stats] could not read memory:', (err as Error).message);
  }
  return null;
}

function readLoad(src: StatsSource): MachineStats['load'] {
  if (src.platform === 'win32') return null;
  const l = src.loadavg();
  if (l.length !== 3 || !l.every((n) => Number.isFinite(n) && n >= 0)) return null;
  return l.map((n) => Math.round(n * 100) / 100) as [number, number, number];
}

/** One sample: CPU against the snapshot before (none on a first sample), memory and load now. */
export async function takeSample(src: StatsSource, prev: CpuSnapshot | null, now: number): Promise<{ stats: MachineStats; cpu: CpuSnapshot | null }> {
  const cpu = cpuSnapshot(src.cpus());
  const memory = await readMemory(src);
  return { cpu, stats: { sampledAt: new Date(now).toISOString(), cpu: cpuPercent(prev, cpu), cores: cpu?.cores ?? null, memory, load: readLoad(src) } };
}

/** A sample as another machine synced it, if it is one. Anything out of shape is dropped, never filled in. */
export function parseStats(v: unknown): MachineStats | null {
  const r = v as Partial<MachineStats> | null;
  if (!r || typeof r !== 'object' || typeof r.sampledAt !== 'string' || !Number.isFinite(Date.parse(r.sampledAt))) return null;
  const num = (n: unknown, max = Infinity) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max ? n : null);
  const m = r.memory;
  const total = num(m?.total);
  const used = num(m?.used);
  const memory = m && total && used !== null && used <= total && (m.source === 'vm_stat' || m.source === 'meminfo') ? { used, total, source: m.source } : null;
  const load = Array.isArray(r.load) && r.load.length === 3 && r.load.every((n) => num(n) !== null) ? (r.load as [number, number, number]) : null;
  const cores = num(r.cores);
  return { sampledAt: r.sampledAt, cpu: num(r.cpu, 100), cores: cores && Number.isInteger(cores) ? cores : null, memory, load };
}

/** Another machine's latest sample, as sync last brought it. */
export const syncedStats = (id: string): MachineStats | null => parseStats(kv.get<unknown>(STATS_PREFIX + id));

// ---------- the sampler ----------

const options = {
  source: nodeSource,
  /** Between samples while watched. */
  sampleMs: 5_000,
  /** From the first sample to the second, the first with a CPU share. */
  firstMs: 1_000,
  /** How long a GET /api/machines keeps it sampling. */
  localLeaseMs: 60_000,
  /** How long another machine's watch record keeps it sampling and sending. */
  remoteLeaseMs: 90_000,
  /** How often it writes its sample for the other machines while one watches. */
  sendMs: 15_000,
  /** How often this machine renews its own watch record while a client here watches. */
  watchMs: 45_000,
  now: () => Date.now(),
};

/** For tests: the source, the clock and the timings. */
export function configureMachineStats(o: Partial<typeof options>) {
  Object.assign(options, o);
}

/** Clients get an unchanged sample at most this often, so this machine's tile never looks stale while sampling. */
const FEED_HEARTBEAT_MS = 30_000;

let active = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let inflight: Promise<void> | null = null;
let latest: MachineStats | null = null;
let prevCpu: CpuSnapshot | null = null;
let localUntil = 0;
let remoteUntil = 0;
let sentAt = 0;
let watchedAt = 0;
let feedAt = 0;
let feedKey = '';

const watched = (now: number) => now < localUntil || now < remoteUntil;

/** What a tile would show: an event that would not change it waits for the heartbeat. */
const shown = (s: MachineStats) => `${s.cpu === null ? '-' : Math.round(s.cpu)}|${s.memory ? Math.round((s.memory.used / 2 ** 30) * 10) : '-'}|${s.load?.[0].toFixed(1) ?? '-'}`;

/** Write the sample for the other machines, while one watches and once it has a CPU share. */
function send(now: number) {
  const id = outbox.machineId();
  if (!id || !latest || now >= remoteUntil || now - sentAt < options.sendMs) return;
  if (latest.cpu === null && latest.cores !== null) return;
  sentAt = now;
  kv.set(STATS_PREFIX + id, latest);
}

async function sampleOnce() {
  const now = options.now();
  const { stats, cpu } = await takeSample(options.source, prevCpu, now);
  if (!active) return;
  prevCpu = cpu;
  latest = stats;
  const key = shown(stats);
  if (key !== feedKey || now - feedAt >= FEED_HEARTBEAT_MS) {
    feedKey = key;
    feedAt = now;
    publishFeed({ type: 'machine_stats', id: outbox.machineId(), stats });
  }
  send(now);
}

function run(): Promise<void> {
  return (inflight ??= sampleOnce()
    .catch((err) => console.error('[machine-stats] sample failed:', (err as Error).message))
    .finally(() => (inflight = null)));
}

function schedule(ms: number) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    timer = undefined;
    if (!watched(options.now())) return stopMachineStats();
    await run();
    if (active && !timer) schedule(options.sampleMs);
  }, ms);
  timer.unref?.();
}

/** Start sampling if it is not: a first sample now (memory and load), the first CPU share a second later. */
function start(): Promise<void> {
  if (active) return inflight ?? Promise.resolve();
  active = true;
  latest = null;
  prevCpu = null;
  feedKey = '';
  const first = run();
  schedule(options.firstMs);
  return first;
}

/** Stop sampling and forget the last sample, so a later watcher never gets an old one as this machine's now. */
export function stopMachineStats() {
  active = false;
  clearTimeout(timer);
  timer = undefined;
  latest = null;
  prevCpu = null;
}

/**
 * GET /api/machines: a client here watches the machine tiles, which show once there are other machines, or the
 * Conductor asks (`always`). Keeps the sampler going for a minute and asks the other machines for theirs. Resolves
 * with this machine's latest sample. With no other machines and no `always`, nothing shows it: it only reads.
 */
export async function watchStats(others: boolean, always = false): Promise<MachineStats | null> {
  if (!others && !always) return latest;
  const now = options.now();
  localUntil = Math.max(localUntil, now + options.localLeaseMs);
  const self = outbox.machineId();
  if (self && others && now - watchedAt >= options.watchMs) {
    watchedAt = now;
    kv.set(WATCH_PREFIX + self, { at: new Date(now).toISOString() });
  }
  await start();
  return latest;
}

/**
 * A kv machine-watch.* or machine-stats.* change synced in from another machine (sync/handlers/kv.ts). A watch is
 * timed from when it arrived here, by this machine's clock, so the two clocks need not agree.
 */
export function noteSynced(key: string, value: unknown) {
  if (key.startsWith(WATCH_PREFIX)) {
    if (key.slice(WATCH_PREFIX.length) === outbox.machineId()) return;
    const now = options.now();
    remoteUntil = now + options.remoteLeaseMs;
    sentAt = 0;
    if (active) send(now);
    else void start();
    return;
  }
  if (!key.startsWith(STATS_PREFIX)) return;
  const stats = parseStats(value);
  if (stats) publishFeed({ type: 'machine_stats', id: key.slice(STATS_PREFIX.length), stats });
}
