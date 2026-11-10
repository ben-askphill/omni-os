import type { DesktopUpdateView } from './desktop-bridge.ts';
import type { Reachability } from './handoff.ts';

// Update all machines (apps/server/update-fleet.ts): one action checks for, downloads or applies Omni's update on every
// synced machine at once. Asks and answers travel as synced kv records, each written by one machine only, so
// last-writer-wins never loses one:
// - `update.status.<machine>`, by that machine: how it updates, what it runs, and where its update stands.
// - `update.ask.<sender>.<target>`, by the machine that asked: check, download or update, and when.
// After each sync a machine takes the newest ask for it that its status has not taken yet, once, and runs it on its own
// updater: a checkout's Update (update.ts) or the packaged desktop app's (apps/desktop/src/updates.ts).

/**
 * How a machine updates. `checkout`: a server from a git checkout that a supervisor restarts (update.ts). `desktop`:
 * the packaged desktop app's own server, which the app replaces when it updates itself. `manual`: a checkout server
 * nothing restarts, so it can check and download but its update is applied by hand.
 */
export type UpdateTrack = 'checkout' | 'desktop' | 'manual';

/** `update` downloads what is missing, then restarts once no turn runs there. */
export type FleetAction = 'check' | 'download' | 'update';
export const FLEET_ACTIONS: readonly FleetAction[] = ['check', 'download', 'update'];

/** Where a machine's update stands, as the machine itself reports it. */
export type MachinePhase =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  /** Found, not downloaded yet. */
  | 'available'
  | 'downloading'
  /** Downloaded: applying restarts. */
  | 'ready'
  /** Applying, held until the running turns end. */
  | 'waiting'
  | 'applying'
  | 'restarting'
  | 'failed';

/** kv `update.status.<machine id>`, written only by that machine. */
export interface MachineUpdateStatus {
  id: string;
  name: string;
  track: UpdateTrack;
  /** What it runs: the short commit of a checkout, the desktop app's version. */
  version: string | null;
  /** What it would move to, while it knows of something newer. */
  available: string | null;
  /** Commits on main a checkout does not have. Null for the desktop app. */
  behind: number | null;
  phase: MachinePhase;
  /** Download percent, 0 to 100, while downloading. */
  progress: number | null;
  /** Running turns the restart waits for, while waiting. */
  waitingFor: number;
  error: string | null;
  /** The `at` of the newest ask it took. An ask at or before it is never run again. */
  takenAt: string | null;
  /** When `phase` last changed. */
  since: string;
}

/** kv `update.ask.<sender>.<target>`, written only by the sender. */
export interface UpdateAsk {
  id: string;
  sender: string;
  target: string;
  action: FleetAction;
  at: string;
  /** A target that syncs after this drops the ask instead of restarting long after anyone asked. */
  expiresAt: string;
}

/** How long a target has to take an ask. */
export const ASK_WINDOW_MS = 30 * 60_000;

export const STATUS_PREFIX = 'update.status.';
export const ASK_PREFIX = 'update.ask.';
export const statusKey = (machine: string) => `${STATUS_PREFIX}${machine}`;
export const askKey = (sender: string, target: string) => `${ASK_PREFIX}${sender}.${target}`;

/**
 * A row as the asking machine shows it: the machine's own phase, or what the asker knows on top of it. `offline`: a
 * source says it is off, so it is skipped and Retry sends anyway. `sent`: asked, not taken yet. `expired`: asked and
 * never taken in time. `not-reporting`: it runs an Omni from before Update all machines, so it is updated there once.
 */
export type FleetRowState = MachinePhase | 'offline' | 'sent' | 'expired' | 'not-reporting';

/** A row of GET /api/update/fleet. */
export interface FleetMachine {
  id: string;
  name: string;
  /** The machine that answered this request. */
  current: boolean;
  /** Omni Connect's health check where Connect is on, else Tailscale. This machine is always online. */
  reach: Reachability;
  status: MachineUpdateStatus | null;
  /** The newest ask this machine sent it. */
  ask: UpdateAsk | null;
  state: FleetRowState;
}

/** GET /api/update/fleet. */
export interface FleetView {
  machines: FleetMachine[];
  /** Sync is on. Without it the list is this machine alone. */
  synced: boolean;
}

/** POST /api/update/fleet. `machines`: ids or names, or "here"; every machine when left out. */
export interface FleetRequest {
  action: FleetAction;
  machines?: string[];
  /** Ask machines a source says are offline too: Retry. They take it when they next sync, within the window. */
  force?: boolean;
}

export interface FleetSkip {
  id: string;
  name: string;
  reason: string;
}

/** What POST /api/update/fleet answers: the list as it stands after asking, and who was left out and why. */
export interface FleetResult extends FleetView {
  skipped: FleetSkip[];
}

/** An ask counts as taken once the target's status has taken it or a newer one. */
export const askTaken = (ask: Pick<UpdateAsk, 'at'>, status: Pick<MachineUpdateStatus, 'takenAt'> | null): boolean =>
  !!status?.takenAt && status.takenAt >= ask.at;

/** A restarting machine drops off Connect and Tailscale for a moment: keep showing it as restarting. */
const SHOWN_WHILE_OFFLINE = new Set<MachinePhase>(['restarting']);

export function rowState(m: Pick<FleetMachine, 'current' | 'reach' | 'status' | 'ask'>, now = Date.now()): FleetRowState {
  if (m.ask && !askTaken(m.ask, m.status)) return Date.parse(m.ask.expiresAt) <= now ? 'expired' : 'sent';
  if (!m.current && m.reach === 'offline' && !(m.status && SHOWN_WHILE_OFFLINE.has(m.status.phase))) return 'offline';
  return m.status ? m.status.phase : 'not-reporting';
}

const BUSY: Record<FleetAction, ReadonlySet<FleetRowState>> = {
  check: new Set(['checking', 'downloading', 'applying', 'restarting']),
  download: new Set(['downloading', 'applying', 'restarting']),
  update: new Set(['waiting', 'applying', 'restarting']),
};

/** Why `action` leaves a machine out, or null when it is asked. */
export function skipReason(m: Pick<FleetMachine, 'state' | 'status'>, action: FleetAction, force = false): string | null {
  if (m.state === 'not-reporting') return 'Runs an older Omni. Update it there once, then it updates from here.';
  if (m.state === 'offline' && !force) return 'Offline. Retry asks it anyway: it takes the ask when it next syncs.';
  if (action === 'update' && m.status?.track === 'manual') return 'Nothing restarts its server. Apply its update there by hand.';
  if (BUSY[action].has(m.state)) return action === 'update' ? 'Already updating.' : `Already ${m.state === 'checking' ? 'checking' : 'updating'}.`;
  return null;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The state as a row says it. */
export function rowLabel(m: Pick<FleetMachine, 'state' | 'status'>): string {
  const s = m.status;
  switch (m.state) {
    case 'idle':
      return 'Not checked yet';
    case 'checking':
      return 'Checking';
    case 'up-to-date':
      return 'Up to date';
    case 'available':
      return 'Update available';
    case 'downloading':
      return s?.progress != null ? `Downloading ${Math.round(s.progress)}%` : 'Downloading';
    case 'ready':
      return s?.track === 'desktop' ? 'Downloaded, ready to restart' : s?.behind ? `${plural(s.behind, 'new commit')}, ready to update` : 'Ready to update';
    case 'waiting':
      return `Waiting for ${plural(s?.waitingFor ?? 0, 'running turn')}`;
    case 'applying':
      return 'Installing';
    case 'restarting':
      return 'Restarting';
    case 'failed':
      return 'Failed';
    case 'offline':
      return 'Offline';
    case 'sent':
      return 'Asked, waiting for it to sync';
    case 'expired':
      return 'Did not answer';
    case 'not-reporting':
      return 'Not reporting';
  }
}

/** The status dot for a row, in the Web UI's StatusDot glyphs. */
export function rowTone(state: FleetRowState): 'running' | 'needs' | 'done' | 'settled' | 'idle' | 'queued' {
  switch (state) {
    case 'up-to-date':
      return 'done';
    case 'checking':
    case 'downloading':
    case 'applying':
    case 'restarting':
      return 'running';
    case 'waiting':
    case 'sent':
      return 'queued';
    case 'available':
    case 'ready':
      return 'settled';
    case 'failed':
    case 'expired':
      return 'needs';
    default:
      return 'idle';
  }
}

export const TRACK_LABEL: Record<UpdateTrack, string> = { checkout: 'Checkout', desktop: 'Desktop app', manual: 'Checkout, applied by hand' };

/** "a1b2c3d4 → e5f6a7b8" or "0.4.1 → 0.4.2": what it runs, and what it would move to. */
export function versionLine(s: Pick<MachineUpdateStatus, 'version' | 'available'> | null): string | null {
  if (!s?.version) return null;
  return s.available && s.available !== s.version ? `${s.version} → ${s.available}` : s.version;
}

/** "2 of 3 up to date, 1 failed": the card's header line. */
export function fleetSummary(machines: Pick<FleetMachine, 'state'>[]): string {
  const count = (states: FleetRowState[]) => machines.filter((m) => states.includes(m.state)).length;
  const parts = [`${count(['up-to-date'])} of ${machines.length} up to date`];
  const busy = count(['checking', 'downloading', 'waiting', 'applying', 'restarting', 'sent']);
  const failed = count(['failed', 'expired']);
  if (busy) parts.push(`${busy} in progress`);
  if (failed) parts.push(`${failed} failed`);
  return parts.join(', ');
}

// ---------- the packaged desktop app and its server ----------

/** POST /api/update/desktop, from the desktop app's main process to the server it started: its updater as it stands. */
export interface DesktopUpdateReport {
  /** The app's version. */
  version: string;
  view: DesktopUpdateView;
  /** The id of the newest command it carried out, so the server stops handing it out. */
  done: string | null;
}

/**
 * What the server asks the app's updater to do for an ask. `download`: check first when nothing is found yet.
 * `install`: relaunch into the downloaded update; the server sends it only once no turn runs.
 */
export interface DesktopUpdateCommand {
  id: string;
  action: 'check' | 'download' | 'install';
}

/** The answer to a report: the command to carry out, if any. */
export interface DesktopUpdateReply {
  command: DesktopUpdateCommand | null;
}
