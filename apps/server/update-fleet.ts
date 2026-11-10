import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Reachability } from '@omni/shared/handoff.ts';
import {
  ASK_PREFIX,
  ASK_WINDOW_MS,
  askKey,
  askTaken,
  FLEET_ACTIONS,
  rowState,
  skipReason,
  statusKey,
  type DesktopUpdateReply,
  type FleetAction,
  type FleetMachine,
  type FleetResult,
  type FleetSkip,
  type FleetView,
  type MachinePhase,
  type MachineUpdateStatus,
  type UpdateAsk,
  type UpdateTrack,
} from '@omni/shared/update-fleet.ts';
import { about } from './about.ts';
import { bus, type FeedEvent } from './bus.ts';
import { BUNDLED } from './config.ts';
import { connectEnabled, connectMachines } from './connect/service.ts';
import { kv, outbox } from './db.ts';
import { runningCount } from './runner.ts';
import { currentRecords, deviceRecord, deviceRecords, machineFor, ownName } from './sync/devices.ts';
import { activeWorker, beforeSync, onSynced } from './sync/worker.ts';
import { reachabilityOf, tailnet } from './tailscale.ts';
import { updater } from './update.ts';
import { CheckoutTrack, DesktopTrack, desktopReport, type Track } from './update-tracks.ts';

// Update all machines: this machine's half of the contract in @omni/shared/update-fleet.ts. It keeps its own status in
// kv `update.status.<self>`, takes the asks other machines sync to it, and asks them in turn through
// `update.ask.<self>.<target>`. Each record has one writer, as secret-drop.ts's do, so the relay's last-writer-wins
// never loses one. Every step is read from the records as they stand, never from what an earlier run meant to do:
// the status takes an ask before the action runs, so a restart in the middle or a second sync finds nothing left to
// do. The status is written before each sync and on each change, only when something in it changed, and never on a
// timer, since every write goes to the relay.

/** How long the relay's view of who is on Connect is kept: it is a relay call per refresh. */
const CONNECT_CACHE_MS = 30_000;

const options: { track?: Track } = {};
/** For tests: the track this machine updates on. By default the desktop app's bundle updates through the app, a checkout through update.ts. */
export function configureFleet(o: { track?: Track }) {
  Object.assign(options, o);
}

let defaultTrack: Track | null = null;
function track(): Track {
  if (options.track) return options.track;
  defaultTrack ??= BUNDLED ? new DesktopTrack({ runningTurns: runningCount, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) : new CheckoutTrack(updater);
  return defaultTrack;
}

// ---------- the records, as the other machines wrote them ----------

const TRACKS: Record<UpdateTrack, true> = { checkout: true, desktop: true, manual: true };
const PHASES: Record<MachinePhase, true> = { idle: true, checking: true, 'up-to-date': true, available: true, downloading: true, ready: true, waiting: true, applying: true, restarting: true, failed: true };

const str = (v: unknown): v is string => typeof v === 'string';
const strOrNull = (v: unknown) => v === null || str(v);
const numOrNull = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v));
const isTime = (v: unknown): v is string => str(v) && Number.isFinite(Date.parse(v));
const isTaken = (v: unknown): v is Record<string, string> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(str);

/** Every field the list shows, checked: another machine wrote it, and a bad one should drop its row, not the page. */
const isStatus = (v: unknown): v is MachineUpdateStatus => {
  const s = v as Partial<MachineUpdateStatus> | null;
  return (
    !!s && str(s.id) && str(s.name) && str(s.track) && Object.hasOwn(TRACKS, s.track) && str(s.phase) && Object.hasOwn(PHASES, s.phase) && isTime(s.since) &&
    strOrNull(s.version) && strOrNull(s.available) && strOrNull(s.error) && numOrNull(s.behind) && numOrNull(s.progress) && typeof s.waitingFor === 'number' && isTaken(s.taken)
  );
};
const isAsk = (v: unknown): v is UpdateAsk => {
  const a = v as Partial<UpdateAsk> | null;
  return !!a && str(a.id) && str(a.sender) && str(a.target) && FLEET_ACTIONS.includes(a.action as FleetAction) && isTime(a.at) && isTime(a.expiresAt);
};
const statusOf = (id: string): MachineUpdateStatus | null => {
  const s = kv.get<unknown>(statusKey(id));
  return isStatus(s) ? s : null;
};
const askOf = (sender: string, target: string): UpdateAsk | null => {
  const a = kv.get<unknown>(askKey(sender, target));
  return isAsk(a) ? a : null;
};

// ---------- this machine's status ----------

/** This machine's status as it stands. `since` holds while the phase does, and `taken` unless given. */
function ownStatus(id: string, name: string, prev: MachineUpdateStatus | null, now: number, taken = prev?.taken ?? {}): MachineUpdateStatus {
  const t = track();
  const state = t.state();
  const since = prev && prev.phase === state.phase ? prev.since : new Date(now).toISOString();
  return { id, name, track: t.kind, ...state, taken, since };
}

/** Progress is written at every tenth, not every percent. */
const tenth = (p: number | null) => (p === null ? null : Math.floor(p / 10));
const same = (a: MachineUpdateStatus, b: MachineUpdateStatus) =>
  a.phase === b.phase &&
  a.version === b.version &&
  a.available === b.available &&
  a.behind === b.behind &&
  a.error === b.error &&
  a.waitingFor === b.waitingFor &&
  JSON.stringify(a.taken) === JSON.stringify(b.taken) &&
  a.track === b.track &&
  a.name === b.name &&
  tenth(a.progress) === tenth(b.progress);

/**
 * Write this machine's status when something in it changed. A no-op while sync is off, and until this machine has
 * described itself (sync/devices.ts): the status carries the name from that record, and would otherwise go out twice.
 */
export function publishStatus(now = Date.now()): void {
  const self = outbox.machineId();
  if (!self || !deviceRecord(self)) return;
  const prev = statusOf(self);
  const next = ownStatus(self, ownName(self), prev, now);
  if (prev && same(prev, next)) return;
  kv.set(statusKey(self), next);
}

/**
 * After a sync: take every ask for this machine that its status has not taken yet, and run the newest one still in its
 * window. The status takes them before the action runs, so a restart in the middle never runs one twice. Safe to run
 * any number of times.
 */
export function reconcileAsks(now = Date.now()): void {
  const self = outbox.machineId();
  if (!self) return;
  const prev = statusOf(self);
  const asks = kv.list<unknown>(ASK_PREFIX).flatMap(([, v]) => (isAsk(v) && v.target === self && !askTaken(v, prev) ? [v] : []));
  if (!asks.length) return;
  const taken = { ...prev?.taken };
  for (const a of asks) taken[a.sender] = a.id;
  kv.set(statusKey(self), ownStatus(self, ownName(self), prev, now, taken));
  const newest = asks.filter((a) => Date.parse(a.expiresAt) > now).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  if (newest) void run(newest.action);
}

/** Run an action on this machine's track. What the updater itself refuses or fails shows in the status; anything else is logged. */
const run = (action: FleetAction) => track()[action]().catch((err) => console.error(`[update] ${action} failed:`, (err as Error).message));

// ---------- the list ----------

let connectSeen: { at: number; online: Map<string, boolean> } | null = null;
let connectRefresh: Promise<void> | null = null;

/** Ask the relay who is on Connect, once at a time. A relay that cannot say leaves the last answer in place. */
function refreshConnect(): Promise<void> {
  connectRefresh ??= connectMachines()
    .then((list) => {
      connectSeen = { at: Date.now(), online: new Map(list.map((m) => [m.id, m.online])) };
    })
    .catch(() => undefined)
    .finally(() => {
      connectRefresh = null;
    });
  return connectRefresh;
}

/** Who Omni Connect's relay sees up. Null while Connect is off, or until the relay has answered once. */
async function connectReach(now: number): Promise<Map<string, boolean> | null> {
  if (!connectEnabled()) return null;
  if (!connectSeen) await refreshConnect();
  else if (now - connectSeen.at > CONNECT_CACHE_MS) void refreshConnect();
  return connectSeen?.online ?? null;
}

const withState = (r: Omit<FleetMachine, 'state'>, now: number): FleetMachine => ({ ...r, state: rowState(r, now) });

function ownRow(id: string, name: string, now: number): FleetMachine {
  const self = outbox.machineId();
  return withState({ id, name, current: true, reach: 'online', status: ownStatus(id, name, statusOf(id), now), ask: self ? askOf(self, id) : null }, now);
}

/** Every synced machine, this one first and then by name, each with its update as this machine sees it. This machine alone while sync is off. */
export async function fleetView(now = Date.now()): Promise<FleetView> {
  const self = outbox.machineId();
  if (!self) return { machines: [ownRow('here', about.name, now)], synced: false };
  const [net, connect] = await Promise.all([tailnet(), connectReach(now)]);
  const others = currentRecords(deviceRecords())
    .filter((d) => d.id !== self)
    .map((d) => {
      const online = connect?.get(d.id);
      const reach: Reachability = online === undefined ? reachabilityOf(net, d).reachability : online ? 'online' : 'offline';
      return withState({ id: d.id, name: d.name, current: false, reach, status: statusOf(d.id), ask: askOf(self, d.id) }, now);
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { machines: [ownRow(self, ownName(self), now), ...others], synced: true };
}

const fleetRequest = z.object({
  action: z.enum(FLEET_ACTIONS),
  machines: z.array(z.string().trim().min(1)).optional(),
  force: z.boolean().optional(),
});

/**
 * Ask machines to check, download or update: every synced one, or those named (ids, names or "here"). One a source
 * says is offline, one that runs an older Omni, one whose server nothing restarts and one busy with it already are
 * left out and said so; `force` asks the offline ones too. The asks go out on the next sync and this machine takes
 * its own at once. Each machine runs on its own, so one that fails never holds up another.
 */
export async function requestFleet(raw: unknown, now = Date.now()): Promise<FleetResult> {
  const req = fleetRequest.parse(raw);
  const self = outbox.machineId();
  const resolve = (asked: string): string => {
    if (asked.toLowerCase() === 'here') return self ?? 'here';
    if (!self) throw Object.assign(new Error('Sync is off, so there is only this machine. Leave machines out, or pass "here".'), { status: 404 });
    return machineFor(asked).id;
  };
  const ids = req.machines ? new Set(req.machines.map(resolve)) : null;
  const skipped: FleetSkip[] = [];
  const asked: FleetMachine[] = [];
  for (const m of (await fleetView(now)).machines) {
    if (ids && !ids.has(m.id)) continue;
    const reason = skipReason(m, req.action, req.force);
    if (reason) skipped.push({ id: m.id, name: m.name, reason });
    else asked.push(m);
  }
  if (self) {
    const at = new Date(now).toISOString();
    const expiresAt = new Date(now + ASK_WINDOW_MS).toISOString();
    for (const m of asked) kv.set(askKey(self, m.id), { id: randomUUID(), sender: self, target: m.id, action: req.action, at, expiresAt } satisfies UpdateAsk);
    void activeWorker()?.syncNow();
    reconcileAsks(now);
  } else if (asked.length) {
    void run(req.action);
  }
  return { ...(await fleetView(now)), skipped };
}

/** POST /api/update/desktop: the desktop app's main process reports its updater and gets the command to run next. A server that is not the app's has none. */
export function reportDesktop(raw: unknown): DesktopUpdateReply {
  const report = desktopReport.parse(raw);
  return track().report?.(report) ?? { command: null };
}

/** A listener that throws would stop the Updater's step or the sync's other listeners with it. */
const guarded = (what: string, fn: () => void) => {
  try {
    fn();
  } catch (err) {
    console.error(`[update] ${what}:`, (err as Error).message);
  }
};

bus.on('feed', (e: FeedEvent) => {
  if (e.type === 'update') guarded('could not write the status', publishStatus);
});
// Before the push, so the status goes out in the same sync as anything it waited for; the asks come in with the pull.
beforeSync(() => guarded('could not write the status', publishStatus));
onSynced(() => guarded('could not take an ask', reconcileAsks));
