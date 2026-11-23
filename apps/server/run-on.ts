// Where a thread runs: this machine, or another synced one (a Linux box with the CPU to spare), picked per thread in
// the composer with Settings > Threads' default (user config `runOn.device`). This machine stays the hub Ben talks
// to: a thread sent elsewhere is created here, goes out as a fresh handoff offer (handoff.ts sendNewThread), runs on
// the other machine, and syncs back as it goes. Ben's later messages, Stop, his actions on a usage-limit stop, and
// the reports of delegated threads that ran here for a parent that runs elsewhere (runner/queue.ts reportToParent)
// are forwarded to whichever machine holds it as remote commands (db/repos/remote-commands.ts): one synced row each,
// written before the client hears "accepted", answered by the holder (accepted, rejected with why) or expired by
// whichever machine finds it overdue, so none is lost without a visible outcome (docs/internals/delivery.md). The
// holder reads them after each sync (reconcileRunOn) and acts on each once: a message's command id is the request id
// (`runon:<id>`), so a second sync finds it saved. Files Ben attached go to Storage first (sync/files.ts sendSaved)
// and the holder fetches them before it sends the message.
// Which machine holds a thread is its assignment (apps/server/ownership.ts); a thread sent elsewhere is assigned to
// that machine, marked routed, before its offer goes out. Synced kv records from machines on an older version:
// - `runon.msgs.<thread>.<sender>` and `runon.stop.<thread>.<sender>`: the arrays an older version forwards with.
//   Read here, never written, while machines run mixed versions.
// - `runon.accepted.<thread>.<message>`: durable acceptance, synced so a new holder never replays it.
import type { MessageContext } from '@omni/shared/message-context.ts';
import { isCrewReport, type CrewReport } from '@omni/shared/report-shape.ts';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { publishFeed } from './bus.ts';
import { assignments, db, kv, outbox, remoteCommands, threads, tx, type RemoteCommand, type Thread } from './db.ts';
import { reportCommandId } from './db/repos/remote-commands.ts';
import { inFlight } from './handoff/records.ts';
import { COMMAND_WINDOW_MS, expiryReason, recordOutcome } from './remote-outcomes.ts';
import { holderOf, remoteHolder } from './ownership.ts';
import { applyQueued, cancelLimitResume, fenceStale, interruptThread, resumeLimitNow, saveOwn, scheduleLimitResume, wakePrepared } from './runner.ts';
import { fileReport } from './runner/queue.ts';
import { computerName, deviceName, deviceRecord } from './sync/devices.ts';
import { livesOnRefusal } from './sync/guard.ts';
import { safeSegment } from './sync/paths.ts';
import { RUN_ON_NEEDS, syncProblem } from './sync/problem.ts';
import { activeWorker, onSynced, type SyncWorker } from './sync/worker.ts';
import { receiveUploads, sendSaved, type UploadRef } from './sync/files.ts';
import { reachabilityOf, tailnet } from './tailscale.ts';
import type { Attachment } from './uploads.ts';
import { userConfig } from './user-config.ts';

export { assignRouted, remoteHolder } from './ownership.ts';

const MSGS = 'runon.msgs.';
const STOP = 'runon.stop.';
/** An older version's forwarded message older than this is not sent: the holder was away, and it is no longer wanted. */
const FRESH_MS = COMMAND_WINDOW_MS.message;
/** An older version's Stop older than this is not acted on, so a restart never stops a later turn with an old one. */
const STOP_FRESH_MS = COMMAND_WINDOW_MS.stop;
/**
 * A sender expires its own unanswered command this much after the holder would, so the holder's answer, which says
 * what happened, usually gets there first. The answer wins anyway if it comes later (remote-commands.ts).
 */
const SENDER_GRACE_MS = 60_000;

/** A message, report or limit action as an older version forwards it, in `runon.msgs.<thread>.<sender>`. */
export interface Forwarded {
  id: string;
  prompt: string;
  mode: 'steer' | 'queue' | 'interrupt';
  /** Who wrote it here: Ben, or the Conductor. */
  from?: 'ben' | 'conductor';
  at: string;
  context?: MessageContext[];
  /** Files Ben attached, in Storage by sha. */
  files?: UploadRef[];
  /** A delegated thread's report to its parent, with the key it is saved under and its payload. */
  report?: { key: string; payload: Record<string, unknown> };
  /** Ben's Resume, Resume at reset or its cancel on the thread's limit stop, for the holder to act on as its own. */
  limit?: LimitAction;
}

export type LimitAction = 'resume' | 'schedule' | 'cancel';

type Mac = { id: string; name: string };

const refused = (message: string, status = 409) => Object.assign(new Error(message), { status });
const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(v);
const fresh = (at: string, now: number, within = FRESH_MS) => now - Date.parse(at) < within;
const deadline = (kind: RemoteCommand['kind'], now = Date.now()) => new Date(now + COMMAND_WINDOW_MS[kind]).toISOString();

/**
 * Where a new thread should run. `asked`: the composer's pick, a synced machine's id, or "here" for this machine;
 * left out, Settings' default. Null means this machine. Refuses a machine that is not synced or that Tailscale sees
 * offline, so the thread is never made for a machine that will not take it.
 */
export async function targetFor(asked: string | null | undefined): Promise<{ from: Mac; to: Mac } | null> {
  const pick = asked === undefined || asked === null ? userConfig().runOn.device : asked;
  const self = outbox.machineId();
  if (!pick || pick === 'here' || pick === self) return null;
  if (!self || !activeWorker()) throw refused(syncProblem(RUN_ON_NEEDS));
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

/** The holder's name as the clients show it, or its id until this machine has heard of it. */
const nameOf = (machine: string) => deviceName(machine) ?? machine;

/** Write a command for the machine that holds the thread, and ask for a sync. The same id again is the first command. */
function send(c: Omit<Parameters<typeof remoteCommands.add>[0], 'sender' | 'target' | 'target_name' | 'expires_at'> & { target: string }) {
  const self = outbox.machineId()!;
  const saved = remoteCommands.add({ ...c, sender: self, target_name: nameOf(c.target), expires_at: deadline(c.kind) });
  void activeWorker()?.syncNow();
  return saved.command;
}

/** When Tailscale sees the machine asleep or offline: when it last saw it. Null while it is up, or with no Tailscale to ask. */
async function asleep(machine: string): Promise<{ lastSeen: string | null } | null> {
  const d = deviceRecord(machine);
  if (!d) return null;
  const reach = reachabilityOf(await tailnet(), d);
  return reach.reachability === 'offline' ? { lastSeen: reach.lastSeen } : null;
}

/**
 * Ben's message to a thread that stays on the machine holding it (ownership.ts remoteHolder): written for the holder
 * to send, and answered as accepted. The message shows in the transcript once the holder's turn syncs back; until then
 * the thread lists it as on its way. Its files are in Storage before the command is written, so the holder never sees
 * a message whose files it cannot fetch. `ifAway: 'ask'` (the reply box) refuses it first, with Send there and Take
 * over to offer, when Tailscale sees the holder asleep or offline; without it the message waits for the holder.
 */
export async function forwardMessage(
  t: Thread,
  prompt: string,
  opts: { mode: Forwarded['mode']; from: 'ben' | 'conductor'; requestId?: string; attachments?: Attachment[]; context?: MessageContext[]; ifAway?: 'ask' | 'send' },
) {
  const { mode, from } = opts;
  const holder = remoteHolder(t)!;
  const away = opts.ifAway === 'ask' ? await asleep(holder) : null;
  if (away) throw livesOnRefusal({ machine: { id: holder, name: nameOf(holder) }, why: 'offline', last_seen: away.lastSeen });
  const id = opts.requestId && isId(opts.requestId) ? opts.requestId : randomUUID();
  const files = await sendSaved(opts.attachments ?? []).catch((err) => {
    throw refused(`Could not send the files to ${nameOf(holder)}: ${(err as Error).message}`, (err as { status?: number }).status ?? 503);
  });
  const c = send({ id, thread_id: t.id, kind: 'message', target: holder, prompt, mode, source: from, context: opts.context ?? null, files });
  publishFeed({ type: 'thread', thread: t });
  return { ...t, request: { id, request_id: id, state: 'accepted' as const, accepted_at: c.created_at }, forwarded_to: c.target_name };
}

/** A delegated thread's report for a parent that another machine holds: that machine files it on its next sync. */
export function forwardReport(parentId: string, key: string, prompt: string, payload: CrewReport) {
  const holder = holderOf(parentId);
  if (!holder) return;
  send({ id: reportCommandId(parentId, key), thread_id: parentId, kind: 'report', target: holder, prompt, mode: 'steer', report_key: key, report: payload });
}

/**
 * Ben's action on the limit stop of a routed thread that runs elsewhere: the holder ran the turn, so it owns the stop
 * and acts on it at its next sync, and the stop's new state syncs back. Refused here for what the holder would refuse.
 */
export function forwardLimit(t: Thread, action: LimitAction): Thread {
  const l = threads.limit(t.id);
  if (!l) throw refused('This thread is not waiting on a usage limit.');
  if (action === 'schedule' && !l.limit_resets_at) throw refused('The harness did not say when its limit resets, so this thread can only be resumed by hand.');
  send({ id: randomUUID(), thread_id: t.id, kind: 'limit', target: remoteHolder(t)!, limit_action: action });
  publishFeed({ type: 'thread', thread: t });
  return t;
}

/** Ben's Stop on a routed thread that runs elsewhere: the holder stops it at its next sync, or says that nothing was running. */
export function forwardStop(t: Thread): Thread {
  send({ id: randomUUID(), thread_id: t.id, kind: 'stop', target: remoteHolder(t)! });
  return t;
}

/** Stops from an older version this machine has acted on, by record and time, so a later sync does not stop the next turn too. */
const stopped = new Map<string, string>();

/**
 * After each sync, on the machine that holds a routed thread: act on what the other machines sent it, each command
 * once, and answer it; on every machine, expire its own commands no holder answered in time. A message whose files
 * cannot be fetched yet waits for the next sync. One pass at a time; a sync during a pass runs another after it.
 */
export function reconcileRunOn(worker: SyncWorker, now = Date.now()): Promise<void> {
  if (reconciling) {
    again = true;
    return reconciling;
  }
  reconciling = (async () => {
    try {
      do {
        again = false;
        await reconcileOnce(worker, now);
      } while (again);
    } finally {
      reconciling = null;
    }
  })();
  return reconciling;
}

let reconciling: Promise<void> | null = null;
let again = false;

async function reconcileOnce(worker: SyncWorker, now: number) {
  const self = worker.machineId;
  // A turn here whose thread another machine took meanwhile stops before anything more is delivered to it.
  fenceStale();
  for (const c of remoteCommands.pending()) {
    try {
      const holds = holderOf(c.thread_id) === self && !inFlight(c.thread_id);
      const due = Date.parse(c.expires_at);
      if (holds) {
        // A message this machine saved before (its receipt travelled with the thread) is accepted however old it is.
        if (c.kind === 'message' && kv.get(receiptKey(c))) answer(c, self, 'accepted');
        else if (now >= due) answer(c, self, 'expired', expiryReason(c));
        else await act(c, self);
      } else if (c.sender === self && now >= due + SENDER_GRACE_MS) {
        answer(c, self, 'expired', expiryReason(c));
      }
    } catch (err) {
      console.error(`[run-on] ${c.kind} ${c.id}:`, (err as Error).message);
    }
  }
  await legacyMessages(self, now);
  legacyStops(self, now);
}

/** Answer a command this machine holds or sent. The sender's own answer goes in the transcript at once. */
function answer(c: RemoteCommand, self: string, state: 'accepted' | 'rejected' | 'expired', reason: string | null = null) {
  if (!remoteCommands.settle(c.id, state, self, reason)) return;
  if (c.sender === self) recordOutcome(remoteCommands.get(c.id)!);
  const t = threads.get(c.thread_id);
  if (t) publishFeed({ type: 'thread', thread: t });
}

/** The kv flag a holder sets once a message is saved there, so no machine sends it twice. */
const receiptKey = (c: Pick<RemoteCommand, 'thread_id' | 'id'>) => `runon.accepted.${c.thread_id}.${c.id}`;

/** Act on one command for a thread this machine holds, and answer it. */
async function act(c: RemoteCommand, self: string) {
  const threadId = c.thread_id;
  if (c.kind === 'stop') {
    const t = threads.get(threadId);
    if (t && (t.status === 'running' || t.status === 'queued')) {
      interruptThread(threadId);
      answer(c, self, 'accepted');
    } else answer(c, self, 'rejected', `No turn was running on ${c.target_name}.`);
    return;
  }
  if (c.kind === 'limit') {
    const why = actOnLimit(threadId, c.limit_action ?? 'resume');
    if (why) answer(c, self, 'rejected', why);
    else answer(c, self, 'accepted');
    return;
  }
  if (c.kind === 'report') {
    if (!c.report_key || !isCrewReport(c.report)) return answer(c, self, 'rejected', 'The report was malformed.');
    // Saved under the report's own key, so a second sync files nothing more.
    fileReport(threadId, c.report_key, c.prompt, c.report);
    answer(c, self, 'accepted');
    return;
  }
  // A message. Requests are local; its receipt travels with the thread when another machine takes over.
  const receipt = receiptKey(c);
  const mode = c.mode === 'queue' || c.mode === 'interrupt' ? c.mode : 'steer';
  const from = c.source === 'conductor' ? 'conductor' : 'ben';
  const attachments = await receiveUploads(threadId, c.files);
  if (kv.get(receipt)) return answer(c, self, 'accepted');
  const row = tx(() => {
    const row = saveOwn(threadId, `runon:${c.id}`, { prompt: c.prompt, kind: 'user', payload: null, source: from, mode, context: c.context, attachments });
    kv.set(receipt, true);
    return row;
  });
  answer(c, self, 'accepted');
  if (row) {
    threads.setDone(threadId, false);
    void wakePrepared(row).catch((err) => console.error(`[run-on] ${c.id}:`, (err as Error).message));
  }
}

/** A limit action another machine forwarded, as if Ben took it here. Null when it was taken, else why the stop refused it. */
function actOnLimit(threadId: string, action: LimitAction): string | null {
  try {
    if (action === 'resume') resumeLimitNow(threadId);
    else if (action === 'schedule') scheduleLimitResume(threadId);
    else if (action === 'cancel') cancelLimitResume(threadId);
    return null;
  } catch (err) {
    console.log(`[run-on] ${threadId}: limit ${action} not taken: ${(err as Error).message}`);
    return (err as Error).message;
  }
}

/** The arrays a machine on an older version forwards with. Each entry is sent once, as its own command would be. */
async function legacyMessages(self: string, now: number) {
  for (const [key, value] of kv.list<unknown>(MSGS)) {
    try {
      const [threadId] = key.slice(MSGS.length).split('.');
      if (!safeSegment(threadId) || holderOf(threadId) !== self || inFlight(threadId) || !Array.isArray(value)) continue;
      for (const m of value as Forwarded[]) {
        if (!isId(m?.id) || typeof m.prompt !== 'string' || typeof m.at !== 'string' || !fresh(m.at, now)) continue;
        if (m.report) {
          if (typeof m.report.key === 'string' && isCrewReport(m.report.payload)) fileReport(threadId, m.report.key, m.prompt, m.report.payload);
          continue;
        }
        const receipt = `runon.accepted.${threadId}.${m.id}`;
        if (kv.get(receipt)) continue;
        if (m.limit) {
          kv.set(receipt, true);
          actOnLimit(threadId, m.limit);
          continue;
        }
        const mode = m.mode === 'queue' || m.mode === 'interrupt' ? m.mode : 'steer';
        const from = m.from === 'conductor' ? 'conductor' : 'ben';
        const attachments = await receiveUploads(threadId, m.files);
        if (kv.get(receipt)) continue;
        const row = tx(() => {
          const row = saveOwn(threadId, `runon:${m.id}`, { prompt: m.prompt, kind: 'user', payload: null, source: from, mode, context: m.context, attachments });
          kv.set(receipt, true);
          return row;
        });
        if (row) {
          threads.setDone(threadId, false);
          void wakePrepared(row).catch((err) => console.error(`[run-on] ${key}:`, (err as Error).message));
        }
      }
    } catch (err) {
      console.error(`[run-on] ${key}:`, (err as Error).message);
    }
  }
}

/** A Stop from a machine on an older version: acted on once while it is fresh. */
function legacyStops(self: string, now: number) {
  for (const [key, value] of kv.list<unknown>(STOP)) {
    const [threadId] = key.slice(STOP.length).split('.');
    if (!safeSegment(threadId) || typeof value !== 'string' || !fresh(value, now, STOP_FRESH_MS) || holderOf(threadId) !== self) continue;
    if (stopped.get(key) === value) continue;
    stopped.set(key, value);
    const t = threads.get(threadId);
    if (t && (t.status === 'running' || t.status === 'queued')) interruptThread(threadId);
  }
}

/**
 * After each sync, on the machine that runs a thread: a run switch Ben queued on another machine while this one ran
 * the turn (sync/guard.ts switchBlocked), which synced in after that turn ended, applies now, as a pick made here
 * between turns does, and the warm process from the old run closes. One that landed during the turn applies when the
 * turn ends (runner/switch.ts applyQueued).
 */
function applySyncedRuns(machineId: string) {
  const rows = db.prepare('SELECT id, status FROM threads WHERE queued_harness IS NOT NULL').all() as { id: string; status: string }[];
  for (const r of rows) {
    if (r.status === 'running' || r.status === 'queued' || holderOf(r.id) !== machineId || inFlight(r.id)) continue;
    applyQueued(r.id);
  }
}

/** The sync workers claimOwnWorktrees has run for in this process. */
const claimedFor = new WeakSet<SyncWorker>();

/**
 * Once per sync worker, after its first sync: claim each worktree thread no machine is assigned to whose worktree is
 * on this machine. Such a thread last ran before assignments existed (an older delegated thread, say), so no machine
 * would forward a reply to it here, and the one Ben replied on would try to cut its worktree again from a branch that
 * may be on no remote. After the sync, so a row another machine wrote is here first; two machines that both have the
 * folder settle on one owner by the row's tie rule (db/repos/assignments.ts). Returns how many it claimed.
 */
export function claimOwnWorktrees(worker: SyncWorker): number {
  if (claimedFor.has(worker)) return 0;
  claimedFor.add(worker);
  const rows = db
    .prepare(`SELECT id, cwd FROM threads t WHERE branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.thread_id = t.id)`)
    .all() as { id: string; cwd: string }[];
  let claimed = 0;
  for (const r of rows) {
    // Its own worktree (handoff/worktree.ts inOwnWorktree), here; and no holder an older build wrote in kv.
    if (basename(r.cwd) !== r.id || basename(dirname(r.cwd)) !== 'worktrees' || !existsSync(r.cwd) || assignments.get(r.id)) continue;
    if (assignments.claim(r.id, worker.machineId)) claimed++;
  }
  if (claimed) console.log(`[run-on] claimed ${claimed} worktree thread${claimed === 1 ? '' : 's'} that ran here before assignments existed`);
  return claimed;
}

onSynced((worker) => {
  try {
    claimOwnWorktrees(worker);
  } catch (err) {
    console.error('[run-on] could not claim worktree threads:', (err as Error).message);
  }
  try {
    applySyncedRuns(worker.machineId);
  } catch (err) {
    console.error('[run-on] could not apply a synced run switch:', (err as Error).message);
  }
  void reconcileRunOn(worker);
});
