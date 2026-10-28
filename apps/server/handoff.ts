// Handing a thread, running or idle, to another synced Mac, and taking one over from another Mac. The records and their
// phases are in packages/shared/handoff.ts and apps/server/handoff/records.ts; the relay carries everything, and
// Tailscale only says whether the other Mac is up. The giving Mac stops the turn, uploads the session and packs the
// worktree, writing each step into its offer. Take over is a request from the Mac that wants the thread, which the Mac
// holding it answers as if Ben had handed it off there. No Mac acts as a change arrives: after every sync each
// reconciles from the records as they are, so a second run, or one after a crash on either Mac, ends where one clean
// run would.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { requestPhase, type HandoffOffer, type HandoffRequest, type HandoffView, type Takeover } from '@omni/shared/handoff.ts';
import { publishFeed } from './bus.ts';
import { paths } from './config.ts';
import { channels, completions, messageRequests, outbox, resultReads, threads, tx, type Thread } from './db.ts';
import { HARNESS_META, isHarnessId } from './harness/types.ts';
import { contextBlock, placeFor } from './message-context/project.ts';
import { handoffView, inFlight, moving, offerOf, offers, phaseOf, replyOf, requestOf, requests, writeOffer, writeReply, writeRequest } from './handoff/records.ts';
import { inOwnWorktree, packWorktree, unpackWorktree, type WorktreeBundle } from './handoff/worktree.ts';
import { releaseForHandoff, runsHere, saveOwn, wake, type Msg } from './runner.ts';
import { drop } from './runner/state.ts';
import { computerName, deviceName, deviceRecord } from './sync/devices.ts';
import { sessionOnThisMac, uploadNow } from './sync/files.ts';
import { prepareTurn } from './sync/guard.ts';
import { toPortable } from './sync/paths.ts';
import { activeWorker, onSynced, syncStatus, type SyncWorker } from './sync/worker.ts';
import { reachabilityOf, tailnet } from './tailscale.ts';
import { withWorkspace } from './workspace.ts';

type Offered = Extract<HandoffOffer, { state: 'offered' }>;
type Base = Pick<HandoffOffer, 'id' | 'thread' | 'from' | 'to' | 'idle' | 'request'>;
type Mac = HandoffOffer['from'];

const run = promisify(execFile);
const refused = (message: string, status = 409) => Object.assign(new Error(message), { status });
const iso = () => new Date().toISOString();
const base = (o: HandoffOffer): Base => ({ id: o.id, thread: o.thread, from: o.from, to: o.to, idle: o.idle, request: o.request });
const busy = (t: Pick<Thread, 'status'>) => t.status === 'running' || t.status === 'queued';

/** The answer to a handoff request or a cancel: the thread, and its handoff as this Mac shows it. */
export interface HandoffResult {
  thread: Thread;
  handoff: HandoffView | null;
}

const result = (threadId: string): HandoffResult => {
  const thread = threads.get(threadId)!;
  return { thread, handoff: handoffView(thread) };
};

const logFailure = (threadId: string) => (err: unknown) => console.error(`[handoff] ${threadId}:`, (err as Error)?.message ?? err);

/** Ben cancelled while the offer was still being prepared. */
class Cancelled extends Error {}

/** Why this Mac cannot tell the other one anything now, said as Settings would. */
function syncProblem(): string {
  const status = syncStatus();
  if (!status.machineId || !status.configured) return 'Sync is not set up on this Mac. Moving a thread between Macs needs sync on both.';
  if (!status.enabled) return 'Sync is paused on this Mac. Resume it on the Sync page to move threads between Macs.';
  return 'Sync is set up on this Mac but not running, so the other Mac cannot be told. Check the Sync page, then try again.';
}

/** Why the thread's harness could not resume it on another Mac, or null when it can. */
function notResumable(t: Thread): string | null {
  if ((t.harness !== 'codex' && t.harness !== 'cursor') || t.session_id !== t.id) return null;
  const name = isHarnessId(t.harness) ? HARNESS_META[t.harness].name : t.harness;
  return `${name} has not reported this thread's session yet, so another Mac could not resume it. Try again once it has replied.`;
}

/**
 * Why the thread cannot move to another Mac now, or null when it can: the same for Hand off, for a Take over, and for
 * the holding Mac's answer to one. `where` names the Mac that holds it.
 */
function refusal(t: Thread, where: string): string | null {
  const harness = notResumable(t);
  if (harness) return harness;
  // Its report would wake the thread that delegated it on the other Mac, while that one may be running here.
  if (t.parent_id) return `This thread reports to the thread that delegated it, so it stays on ${where}.`;
  if (t.archived) return 'This thread is archived. Restore it first.';
  if (threads.children(t.id).some(busy)) return `Threads this one delegated are still running on ${where}. Try again once they finish.`;
  // Only the Mac that ran the turn resumes a limit stop, so the resume would run there, not where the thread went.
  if (t.limit_state) return `This thread is waiting on a usage limit on ${where}. Resume it first.`;
  return null;
}

/**
 * What a message the turn never read said: Ben's own words for his, the whole prompt for one Omni wrote. Its context
 * goes as text, unchecked: the other Mac sends it later, as a plain message.
 */
function textOf(m: Msg, t: Thread) {
  const said = !m.byOmni && typeof m.event.payload.text === 'string' ? m.event.payload.text : m.text;
  if (!m.contexts?.length) return said;
  const place = placeFor(t);
  const block = contextBlock(m.contexts, place.remote ? place : { remote: false, read: null });
  return said ? `${said}\n\n${block}` : block;
}

/**
 * Ben's Hand off. Refuses with why, or writes the offer and returns at once: the rest runs in the background and
 * shows in the thread's handoff. `to` is the other Mac's sync id.
 */
export async function handOff(threadId: string, to: string): Promise<HandoffResult> {
  if (!threads.get(threadId)) throw refused('thread not found', 404);
  const self = outbox.machineId();
  const worker = activeWorker();
  if (!self || !worker) throw refused(syncProblem());
  if (to === self) throw refused('That is this Mac. Pick the Mac to hand the thread to.');
  const target = deviceRecord(to);
  if (!target) throw refused('No synced Mac has that id. A Mac shows up once it has synced with this one.');
  const [net, name] = await Promise.all([tailnet(), deviceName(self) ?? computerName()]);
  const reach = reachabilityOf(net, target);
  if (reach.reachability === 'offline') {
    throw refused(`${target.name} is offline on Tailscale${reach.lastSeen ? `, last seen ${reach.lastSeen}` : ''}. Wake it, then try again.`);
  }
  // Nothing awaits from here to the write, so two clicks never start two handoffs.
  const t = threads.get(threadId)!;
  // Another Mac holds what this one has of it, which may be behind: handing that off would undo its turns.
  const holder = threads.holder(threadId);
  if (holder && holder !== self) throw refused(`This thread is on ${deviceName(holder) ?? 'your other Mac'}. Take it over instead.`);
  // A running turn must be this Mac's to stop; an idle thread has none, so only the Mac that runs it elsewhere is refused.
  if (busy(t) && !runsHere(threadId)) throw refused('This thread is running on another Mac, so only that Mac can hand it off.');
  const why = refusal(t, 'this Mac');
  if (why) throw refused(why);
  if (moving(phaseOf(threadId)?.phase)) throw refused('This thread is already being handed off.');
  startGiving(t, { id: self, name }, { id: target.id, name: target.name }, worker);
  return result(threadId);
}

/** Write the offer, then give the thread away in the background. Nothing awaits before the write. */
function startGiving(t: Thread, from: Mac, to: Mac, worker: SyncWorker, request?: string) {
  const offer: HandoffOffer = {
    id: randomUUID(),
    thread: t.id,
    from,
    to,
    at: iso(),
    idle: !busy(t),
    ...(request ? { request } : {}),
    state: 'preparing',
    step: busy(t) ? 'stopping' : 'uploading',
  };
  writeOffer(offer);
  void giveAway(offer, worker).catch(logFailure(t.id));
}

/** Another Mac holds the thread, so Ben may take it over here. Null while this Mac holds it, no Mac is known to, or it is on its way. */
export function takeoverOf(t: Thread): Takeover | null {
  const self = outbox.machineId();
  const holder = self && threads.holder(t.id);
  if (!self || !holder || holder === self || inFlight(t.id)) return null;
  const from = { id: holder, name: deviceName(holder) ?? 'your other Mac' };
  const to = { id: self, name: deviceName(self) ?? 'this Mac' };
  return { from, to, running: busy(t), refused: activeWorker() ? refusal(t, from.name) : syncProblem() };
}

/**
 * Ben's Take over: ask the Mac that holds the thread to hand it here. Refuses with why, or writes the request and returns
 * at once. That Mac answers on its next sync, as if Ben had handed the thread off there, and the request shows in the
 * thread's handoff until it does.
 */
export async function requestTakeover(threadId: string): Promise<HandoffResult> {
  if (!threads.get(threadId)) throw refused('thread not found', 404);
  const self = outbox.machineId();
  const worker = activeWorker();
  if (!self || !worker) throw refused(syncProblem());
  const name = deviceName(self) ?? (await computerName());
  // Nothing awaits from here to the write, so two clicks never send two requests.
  const t = threads.get(threadId)!;
  const take = takeoverOf(t);
  if (!take) {
    const holder = threads.holder(threadId);
    if (holder === self) throw refused('This thread is on this Mac already.');
    throw refused(holder ? 'This thread is already on its way between Macs.' : 'No Mac is known to hold this thread yet. Once it runs again, it can be taken over.');
  }
  if (take.refused) throw refused(take.refused);
  writeRequest({ id: randomUUID(), thread: threadId, by: { id: self, name }, from: take.from, at: iso(), after: offerOf(threadId)?.id ?? null, state: 'pending' });
  void worker.syncNow();
  return result(threadId);
}

/** Move the offer on, unless Ben cancelled it meanwhile. */
function advance(offer: Base, next: Pick<HandoffOffer, 'state'> & Record<string, unknown>) {
  const now = offerOf(offer.thread);
  if (now?.id !== offer.id || now.state !== 'preparing') throw new Cancelled();
  writeOffer({ ...offer, at: iso(), ...next } as HandoffOffer);
}

/** The stop a handoff makes is not a result for Ben: read at once, so Needs you lists it on neither Mac. */
function quiet(threadId: string, before: string | undefined) {
  const c = completions.latest(threadId);
  if (!c || c.uid === before || c.status !== 'stopped') return;
  resultReads.read(c.uid);
  publishFeed({ type: 'needs_you', thread_id: threadId });
}

/** Messages that stay on this Mac after all: a saved request waits for Resume, anything else is marked never sent. */
function keep(threadId: string, msgs: Msg[]) {
  const lost = msgs.filter((m) => !(m.requestId && messageRequests.park(m.uuid)));
  if (lost.length) drop(threadId, lost);
  publishFeed({ type: 'needs_you', thread_id: threadId });
}

/** A note for the other Mac when the thread's folder is a shared checkout with changes that cannot travel. */
async function leftBehind(cwd: string, mac: string): Promise<string | null> {
  const changes = await run('git', ['-C', cwd, 'status', '--porcelain'], { timeout: 30_000 }).then((r) => r.stdout.trim(), () => '');
  return changes ? `${toPortable(cwd)} has uncommitted changes on ${mac}; they stay there.` : null;
}

/**
 * The giving side, one step at a time, each written into the offer so both Macs show where it is. A cancel stops it at
 * the next step. The messages the turn never read go out in the offer; until it is out they are this Mac's, and a
 * failure or a cancel leaves them here for Resume.
 */
async function giveAway(offer: HandoffOffer, worker: SyncWorker) {
  const id = offer.thread;
  const b = base(offer);
  let carried: Msg[] = [];
  try {
    const before = completions.latest(id)?.uid;
    carried = await releaseForHandoff(id);
    quiet(id, before);
    const t = threads.get(id)!;
    // Stopped in its first turn: the harness has a session all the same, which the other Mac must resume.
    if (!t.has_run && sessionOnThisMac(t)) threads.update(id, { has_run: 1, updated_at: t.updated_at });
    advance(b, { state: 'preparing', step: 'uploading' });
    await uploadNow(id);
    let bundle: WorktreeBundle | null = null;
    let left: string | null = null;
    if (inOwnWorktree(t)) {
      advance(b, { state: 'preparing', step: 'packing' });
      bundle = await packWorktree(t.cwd, id, offer.id, worker.transport);
    } else left = await leftBehind(t.cwd, offer.from.name);
    tx(() => {
      advance(b, { state: 'offered', queued: carried.map((m) => textOf(m, t)), bundle, leftBehind: left });
      // The other Mac sends them now. Here they leave the queue unsent, as a cancelled message does.
      for (const m of carried) if (m.requestId) messageRequests.mark(m.uuid, 'cancelled');
    });
  } catch (err) {
    keep(id, carried);
    if (!(err instanceof Cancelled)) {
      console.error(`[handoff] ${id}: could not hand off:`, (err as Error).message);
      try {
        advance(b, { state: 'failed', error: (err as Error).message });
      } catch {
        // Cancelled meanwhile: that is the outcome.
      }
    }
  }
  void worker.syncNow();
}

/** A handoff that went out and will not run there: the messages it carried wait here for Resume. Once per offer. */
function restore(offer: Offered) {
  const saved = offer.queued.filter((text, n) => {
    const row = saveOwn(offer.thread, `handoff-back:${offer.id}:${n}`, { prompt: text, kind: 'user', payload: { text, source: 'ben' }, source: 'handoff', mode: 'queue' });
    return row && messageRequests.mark(row.id, 'recovered');
  });
  if (saved.length) publishFeed({ type: 'needs_you', thread_id: offer.thread });
}

/**
 * The other Mac picked the thread up before it heard of the Cancel, so it runs there with the messages it carried: the
 * copies the Cancel left here for Resume go, or they would be sent twice.
 */
function withdraw(offer: HandoffOffer) {
  let gone = 0;
  for (let n = 0; ; n++) {
    const row = messageRequests.byRequestId(offer.thread, `handoff-back:${offer.id}:${n}`);
    if (!row) break;
    if (messageRequests.mark(row.id, 'cancelled')) gone++;
  }
  if (gone) {
    publishFeed({ type: 'needs_you', thread_id: offer.thread });
    const t = threads.get(offer.thread);
    if (t) publishFeed({ type: 'thread', thread: t });
  }
}

/**
 * Ben's Cancel: of this Mac's Take over until it has taken the thread, or of a handoff from this Mac while the offer is
 * prepared or waits to be picked up. Cancelling twice is a no-op.
 */
export function cancelHandoff(threadId: string): HandoffResult {
  if (!threads.get(threadId)) throw refused('thread not found', 404);
  const self = outbox.machineId();
  const offer = offerOf(threadId);
  const phase = phaseOf(threadId)?.phase;
  const asked = requestOf(threadId);
  const mine = asked?.by.id === self ? asked : null;
  // Until the thread is here, even once the other Mac has answered: the offer it sends is then refused (stillWanted).
  if (mine?.state === 'pending' && !(offer?.request === mine.id && phase === 'accepted')) {
    writeRequest({ ...mine, state: 'cancelled' });
    void activeWorker()?.syncNow();
    return result(threadId);
  }
  const giving = offer?.from.id === self ? offer : null;
  // A request of this Mac's that has already ended, and no handoff from here to cancel instead.
  if (mine && !(giving && moving(phase))) return result(threadId);
  if (!giving) throw refused('This thread is not being handed off from this Mac.');
  if (phase === 'accepted') throw refused(`${giving.to.name} has already picked this thread up.`);
  if (moving(phase)) {
    tx(() => {
      if (giving.state === 'offered') restore(giving);
      writeOffer({ ...base(giving), at: iso(), state: 'cancelled' });
    });
    void activeWorker()?.syncNow();
  }
  return result(threadId);
}

/** At boot: a handoff the last server was still preparing never went out. It fails, and the thread stays stopped here. */
export function recoverHandoffs(): number {
  const self = outbox.machineId();
  const stuck = self ? offers().filter((o) => o.from.id === self && o.state === 'preparing') : [];
  for (const o of stuck) writeOffer({ ...base(o), at: iso(), state: 'failed', error: 'Omni restarted while handing this thread off' });
  return stuck.length;
}

// ---------- the taking Mac ----------

/** Offers this Mac is picking up right now, so a sync during a slow download does not start a second pickup. */
const taking = new Set<string>();

const continuation = (offer: Offered) => ({
  prompt:
    `This thread was moved from ${offer.from.name} to this Mac (${offer.to.name}) while you were working, and your last turn ` +
    `was cut off at the handoff. Continue where you left off.${offer.leftBehind ? ` Note: ${offer.leftBehind}` : ''}`,
  kind: 'user' as const,
  payload: { text: `${offer.request ? 'Taken over' : 'Handed off'} from ${offer.from.name}. Continue where you left off.`, source: 'handoff' },
  source: 'handoff' as const,
});

/** A thread this Mac asked for and no longer wants: Ben cancelled the request, or it ran out before the answer came. */
function stillWanted(offer: Offered) {
  if (!offer.request) return;
  const asked = requestOf(offer.thread);
  if (asked?.by.id !== offer.to.id || asked.state === 'pending') return;
  throw new Error(asked.state === 'cancelled' ? `Cancelled on ${offer.to.name}` : 'The request expired');
}

/**
 * Pick up a thread offered to this Mac: its worktree laid out from the bundle, its folder checked, then in one write the
 * reply, the holder record and every message to send (the continuation, then what was queued on the other Mac), and
 * only then are they sent. Anything that stops it, a Take over cancelled here among them, is the reply instead.
 */
async function take(offer: Offered, worker: SyncWorker) {
  if (taking.has(offer.id)) return;
  taking.add(offer.id);
  const id = offer.thread;
  const unanswered = () => {
    const now = offerOf(id);
    return now?.id === offer.id && now.state === 'offered' && replyOf(id)?.offer !== offer.id;
  };
  try {
    stillWanted(offer);
    const t = threads.get(id);
    // Not here yet, or the giving Mac's stopped row has not arrived: the next sync tries again.
    if (!t || busy(t)) return;
    const { bundle } = offer;
    if (bundle) {
      const repo = channels.get(t.channel_id)?.repo_path;
      if (!t.branch || !repo || !existsSync(repo)) throw new Error(`the channel's repository is not on this Mac${repo ? `: ${repo}` : ''}`);
      const dir = join(paths.worktrees, id);
      const { branch } = t;
      // Held like a start, so a cleanup never removes the folder while the handoff lays it out (workspace.ts).
      await withWorkspace(dir, () => unpackWorktree({ repo, dir, branch, threadId: id, offerId: offer.id, bundle, transport: worker.transport }));
    }
    await prepareTurn(threads.get(id)!, false, true);
    // The download may have taken a while: hear of a Cancel on the other Mac before answering, not after.
    await worker.syncNow();
    const rows = tx(() => {
      if (!unanswered()) return [];
      stillWanted(offer);
      writeReply(id, { offer: offer.id, at: iso(), state: 'accepted' });
      threads.hold(id);
      // Between turns there is nothing to continue: the thread waits for Ben's next message here.
      return [
        ...(offer.idle ? [] : [saveOwn(id, `handoff:${offer.id}`, continuation(offer))]),
        ...offer.queued.map((text, n) =>
          saveOwn(id, `handoff:${offer.id}:${n}`, { prompt: text, kind: 'user', payload: { text, source: 'ben' }, source: 'handoff', mode: 'queue' }),
        ),
      ].filter((r) => !!r);
    });
    for (const r of rows) wake(r);
    void worker.syncNow();
  } catch (err) {
    console.error(`[handoff] ${id}: could not pick it up:`, (err as Error).message);
    if (unanswered()) {
      writeReply(id, { offer: offer.id, at: iso(), state: 'failed', error: (err as Error).message.replace(/\.$/, '') });
      void worker.syncNow();
    }
  } finally {
    taking.delete(offer.id);
  }
}

/**
 * The holding Mac's answer to a Take over: as the holder only, and only onto an offer key no handoff is using, so it
 * never gives away a thread it no longer has, nor writes over one on its way. Nothing awaits from the checks to the
 * write, and the offer names the request, so a repeated sync never answers twice.
 */
function answer(asked: HandoffRequest, worker: SyncWorker) {
  const t = threads.get(asked.thread)!;
  if (offerOf(t.id)?.request === asked.id || threads.holder(t.id) !== worker.machineId || moving(phaseOf(t.id)?.phase)) return;
  // Past the hour the asking Mac ends it, unless it sleeps too: then a Mac waking the next morning must not act on it.
  if (requestPhase(asked, Date.now()).phase === 'expired') return;
  const from = { id: worker.machineId, name: deviceName(worker.machineId) ?? asked.from.name };
  const why = refusal(t, from.name);
  if (!why) return startGiving(t, from, asked.by, worker, asked.id);
  writeOffer({ id: randomUUID(), thread: t.id, from, to: asked.by, at: iso(), request: asked.id, state: 'declined', error: why });
  void worker.syncNow();
}

/**
 * The asking Mac ends its own request, since only it writes it: once the handoff that answered it is over, when the
 * thread went to some other Mac meanwhile (or here), or after REQUEST_TTL_MS by its own clock. It keeps its time.
 */
function settle(asked: HandoffRequest) {
  const end = (state: 'cancelled' | 'expired') => writeRequest({ ...asked, state });
  if (offerOf(asked.thread)?.request === asked.id) {
    if (!moving(phaseOf(asked.thread)?.phase)) end('cancelled');
    return;
  }
  const holder = threads.holder(asked.thread);
  if (holder && holder !== asked.from.id) end('cancelled');
  else if (requestPhase(asked, Date.now()).phase === 'expired') end('expired');
}

/**
 * After each sync, from the records as they are now: pick up what was handed to this Mac, take back the messages of a
 * handoff from this Mac that the other one could not pick up, answer a Take over of a thread this Mac holds, and end
 * this Mac's own requests once they are settled.
 */
export function reconcileHandoffs(worker: SyncWorker) {
  for (const offer of offers()) {
    // One offer that cannot be settled (its thread deleted here) must not fail the sync or hold up the others.
    try {
      if (!threads.get(offer.thread)) continue;
      const reply = replyOf(offer.thread);
      const answer = reply?.offer === offer.id ? reply : null;
      const mine = offer.from.id === worker.machineId;
      if (offer.state === 'offered' && offer.to.id === worker.machineId && !answer) void take(offer, worker).catch(logFailure(offer.thread));
      else if (offer.state === 'offered' && mine && answer?.state === 'failed') tx(() => restore(offer));
      else if (offer.state === 'cancelled' && mine && answer?.state === 'accepted') withdraw(offer);
    } catch (err) {
      logFailure(offer.thread)(err);
    }
  }
  for (const asked of requests()) {
    try {
      if (asked.state !== 'pending' || !threads.get(asked.thread)) continue;
      if (asked.by.id === worker.machineId) settle(asked);
      else if (asked.from.id === worker.machineId) answer(asked, worker);
    } catch (err) {
      logFailure(asked.thread)(err);
    }
  }
}

onSynced((worker) => reconcileHandoffs(worker));
