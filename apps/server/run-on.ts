// Where a thread runs: this machine, or another synced one (a Linux box with the CPU to spare), picked per thread in
// the composer with Settings > Server's default (user config `runOn.device`). This machine stays the hub Ben talks
// to: a thread sent elsewhere is created here, goes out as a fresh handoff offer (handoff.ts sendNewThread), runs on
// the other machine, and syncs back as it goes. Ben's later messages, and Stop, are forwarded to whichever machine
// holds it, as synced kv records with one writer each:
// - `runon.thread.<thread>`: the machine this one sent the thread to. Marks a routed thread; written once.
// - `runon.msgs.<thread>.<sender>`: the messages this machine forwarded, newest last, capped. Also the reports of
//   delegated threads that ran here for a parent that runs elsewhere (runner/queue.ts reportToParent).
// - `runon.stop.<thread>.<sender>`: when this machine last asked the holder to stop it.
// The holder reads them after each sync (reconcileRunOn) and sends each message once, keyed by its id.
import { randomUUID } from 'node:crypto';
import { publishFeed } from './bus.ts';
import { kv, messageRequests, outbox, threads, type Thread } from './db.ts';
import { inFlight } from './handoff/records.ts';
import { interruptThread, saveOwn, wake } from './runner.ts';
import { fileReport } from './runner/queue.ts';
import { computerName, deviceName, deviceRecord } from './sync/devices.ts';
import { safeSegment } from './sync/paths.ts';
import { activeWorker, onSynced, syncStatus, type SyncWorker } from './sync/worker.ts';
import { reachabilityOf, tailnet } from './tailscale.ts';
import { userConfig } from './user-config.ts';

const THREAD = 'runon.thread.';
const MSGS = 'runon.msgs.';
const STOP = 'runon.stop.';
/** Messages a sender keeps in its record. The holder has sent older ones long before. */
const KEEP = 50;
/** A forwarded message older than this is not sent: the holder was away, and it is no longer wanted. */
const FRESH_MS = 24 * 60 * 60_000;
/** A Stop older than this is not acted on, so a restart never stops a later turn with an old one. */
const STOP_FRESH_MS = 2 * 60_000;

export interface Forwarded {
  id: string;
  prompt: string;
  mode: 'steer' | 'queue' | 'interrupt';
  /** Who wrote it here: Ben, or the Conductor. */
  from?: 'ben' | 'conductor';
  at: string;
  /** A delegated thread's report to its parent, with the key it is saved under and its payload. */
  report?: { key: string; payload: Record<string, unknown> };
}

type Mac = { id: string; name: string };

const refused = (message: string, status = 409) => Object.assign(new Error(message), { status });
const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(v);
const fresh = (at: string, now: number, within = FRESH_MS) => now - Date.parse(at) < within;

/** The machine a thread was sent to, when it was routed. */
export const routedTo = (threadId: string): string | null => {
  const v = kv.get<unknown>(THREAD + threadId);
  return isId(v) ? v : null;
};

/**
 * The machine that runs a routed thread now, when that is not this one: where Ben's messages and Stop go. Null for a
 * thread that was never routed, one taken back here, or one on its way between machines (the handoff decides then).
 */
export function remoteHolder(t: Pick<Thread, 'id'>): string | null {
  const self = outbox.machineId();
  if (!self || !routedTo(t.id) || inFlight(t.id)) return null;
  const holder = threads.holder(t.id) ?? routedTo(t.id);
  return holder && holder !== self ? holder : null;
}

/** Why this machine cannot reach another now, said as Settings would. */
function syncProblem(): string {
  const status = syncStatus();
  if (!status.machineId || !status.configured) return 'Sync is not set up on this machine. Running a thread on another machine needs sync on both.';
  if (!status.enabled) return 'Sync is paused on this machine. Resume it on the Sync page to run threads on another machine.';
  return 'Sync is set up but not running, so the other machine cannot be told. Check the Sync page, then try again.';
}

/**
 * Where a new thread should run. `asked`: the composer's pick, a synced machine's id, or "here" for this machine;
 * left out, Settings' default. Null means this machine. Refuses a machine that is not synced or that Tailscale sees
 * offline, so the thread is never made for a machine that will not take it.
 */
export async function targetFor(asked: string | null | undefined): Promise<{ from: Mac; to: Mac } | null> {
  const pick = asked === undefined || asked === null ? userConfig().runOn.device : asked;
  const self = outbox.machineId();
  if (!pick || pick === 'here' || pick === self) return null;
  if (!self || !activeWorker()) throw refused(syncProblem());
  const target = deviceRecord(pick);
  if (!target) {
    // A stale default (the machine was removed) falls back to this one; a pick Ben just made does not.
    if (asked === undefined || asked === null) return null;
    throw refused('No synced machine has that id. A machine shows up once it has synced with this one.');
  }
  const [net, name] = await Promise.all([tailnet(), deviceName(self) ?? computerName()]);
  const reach = reachabilityOf(net, target);
  if (reach.reachability === 'offline') {
    throw refused(`${target.name} is offline on Tailscale${reach.lastSeen ? `, last seen ${reach.lastSeen}` : ''}. Wake it, or run this thread here.`);
  }
  return { from: { id: self, name }, to: { id: target.id, name: target.name } };
}

/** Mark the thread as routed to `to`. Its offer goes out separately (handoff.ts sendNewThread). */
export function markRouted(threadId: string, to: string) {
  kv.set(THREAD + threadId, to);
}

function sent(threadId: string, self: string): Forwarded[] {
  const v = kv.get<unknown>(`${MSGS}${threadId}.${self}`);
  return Array.isArray(v) ? (v as Forwarded[]) : [];
}

/**
 * Ben's message to a routed thread that runs elsewhere: written for the holder to send, and answered as accepted.
 * The message shows in the transcript once the holder's turn syncs back. Attachments do not travel yet.
 */
export function forwardMessage(
  t: Thread,
  prompt: string,
  opts: { mode: Forwarded['mode']; from: 'ben' | 'conductor'; requestId?: string; hasFiles: boolean },
) {
  const { mode, from } = opts;
  const self = outbox.machineId()!;
  const holder = remoteHolder(t)!;
  if (opts.hasFiles) throw refused(`Files cannot go to ${deviceName(holder) ?? 'the other machine'} yet. Send the message without them, or Take over the thread here.`, 400);
  const id = opts.requestId && isId(opts.requestId) ? opts.requestId : randomUUID();
  const list = sent(t.id, self);
  const at = new Date().toISOString();
  if (!list.some((m) => m.id === id)) kv.set(`${MSGS}${t.id}.${self}`, [...list, { id, prompt, mode, from, at }].slice(-KEEP));
  void activeWorker()?.syncNow();
  publishFeed({ type: 'thread', thread: t });
  return { ...t, request: { id, request_id: id, state: 'accepted' as const, accepted_at: at }, forwarded_to: deviceName(holder) ?? holder };
}

/** A delegated thread's report for a parent that another machine holds: that machine files it on its next sync. */
export function forwardReport(parentId: string, key: string, prompt: string, payload: Record<string, unknown>) {
  const self = outbox.machineId()!;
  const list = sent(parentId, self);
  const id = randomUUID();
  if (!list.some((m) => m.report?.key === key)) {
    kv.set(`${MSGS}${parentId}.${self}`, [...list, { id, prompt, mode: 'steer', at: new Date().toISOString(), report: { key, payload } }].slice(-KEEP));
  }
  void activeWorker()?.syncNow();
}

/** Ben's Stop on a routed thread that runs elsewhere: the holder stops it at its next sync. */
export function forwardStop(t: Thread): Thread {
  kv.set(`${STOP}${t.id}.${outbox.machineId()}`, new Date().toISOString());
  void activeWorker()?.syncNow();
  return t;
}

/** Stops this machine has acted on, by record and time, so a later sync does not stop the next turn too. */
const stopped = new Map<string, string>();

/**
 * After each sync, on the machine that holds a routed thread: send what the other machines forwarded, each message
 * once (its id is the request id, so a second sync finds it saved), and stop a turn that a newer Stop asked for.
 */
export function reconcileRunOn(worker: SyncWorker, now = Date.now()) {
  const self = worker.machineId;
  for (const [key, value] of kv.list<unknown>(MSGS)) {
    try {
      const [threadId] = key.slice(MSGS.length).split('.');
      if (!safeSegment(threadId) || threads.holder(threadId) !== self || inFlight(threadId) || !Array.isArray(value)) continue;
      for (const m of value as Forwarded[]) {
        if (!isId(m?.id) || typeof m.prompt !== 'string' || typeof m.at !== 'string' || !fresh(m.at, now)) continue;
        if (m.report) {
          // Saved under the report's own key, so a second sync files nothing more.
          if (typeof m.report.key === 'string' && m.report.payload && typeof m.report.payload === 'object') fileReport(threadId, m.report.key, m.prompt, m.report.payload);
          continue;
        }
        if (messageRequests.byRequestId(threadId, `runon:${m.id}`)) continue;
        const mode = m.mode === 'queue' || m.mode === 'interrupt' ? m.mode : 'steer';
        const from = m.from === 'conductor' ? 'conductor' : 'ben';
        const row = saveOwn(threadId, `runon:${m.id}`, { prompt: m.prompt, kind: 'user', payload: { text: m.prompt, source: from }, source: from, mode });
        if (row) {
          threads.setDone(threadId, false);
          wake(row);
        }
      }
    } catch (err) {
      console.error(`[run-on] ${key}:`, (err as Error).message);
    }
  }
  for (const [key, value] of kv.list<unknown>(STOP)) {
    const [threadId] = key.slice(STOP.length).split('.');
    if (!safeSegment(threadId) || typeof value !== 'string' || !fresh(value, now, STOP_FRESH_MS) || threads.holder(threadId) !== self) continue;
    if (stopped.get(key) === value) continue;
    stopped.set(key, value);
    const t = threads.get(threadId);
    if (t && (t.status === 'running' || t.status === 'queued')) interruptThread(threadId);
  }
}

onSynced((worker) => reconcileRunOn(worker));
