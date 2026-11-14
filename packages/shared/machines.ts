import { relTime } from './format.ts';
import { HARNESS } from './brand.ts';
import type { Reachability } from './handoff.ts';

// GET /api/machines: how much each machine under this account runs right now, for the Inbox dashboard's machine
// tiles and the phone's Activity strip. apps/server/machines.ts builds it from the thread rows sync already carries
// (run_machine on a running or queued row names the machine running it), the devices.<id> records and this machine's
// Tailscale. Only this machine sees its own processes, so in-process sub-agents are counted here only.

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
