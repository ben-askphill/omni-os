// Switching a thread's harness, model or effort between turns. switch-plan.ts decides what happens to its sessions,
// this applies it; the next spawn hands the thread over when the harness changed (handover.ts). A switch picked during
// a turn waits on the thread until the turn ends.
import { sameRun, type Run, type RunName, type SwitchP } from '@omni/shared/run-switch.ts';
import { artifacts, events, threads, type Thread } from '../db.ts';
import { uploadsDir } from '../config.ts';
import { forgetContext } from '../context.ts';
import { userName } from '../profile.ts';
import { getHarness, resolveModel, unavailableError, validateRun, type Catalog } from '../harness/catalog.ts';
import { freshCatalog, getCatalog } from '../harness/catalog-service.ts';
import { HARNESS_META, isHarnessId, type HarnessId } from '../harness/types.ts';
import { turnBlocked } from '../sync/guard.ts';
import { buildHandover } from './handover.ts';
import { closeLive } from './session.ts';
import { planSwitch } from './switch-plan.ts';
import { pump } from './queue.ts';
import { adapterFor, addEvent, emitThread, hasBackground, lives, refusal, runsHere, waiting, type Live, type Msg } from './state.ts';

/** A run with the names the catalog gives it now, so its transcript row reads the same later. */
export function runName(run: Run, cat: Catalog = getCatalog()): RunName {
  const id = run.harness as HarnessId;
  const h = getHarness(cat, id);
  const model = run.model ? resolveModel(cat, id, run.model) : h?.models.find((m) => m.default);
  return {
    ...run,
    harnessName: h?.name ?? HARNESS_META[id]?.name ?? run.harness,
    modelLabel: model?.label ?? (run.model || 'default model'),
  };
}

const runOf = (t: Thread): Run => ({ harness: t.harness, model: t.model ?? '', effort: t.effort });

/** The run Ben picked while a turn ran, or null. */
export const queuedRun = (t: Thread | undefined): Run | null =>
  t?.queued_harness ? { harness: t.queued_harness, model: t.queued_model ?? '', effort: t.queued_effort ?? '' } : null;

const NO_QUEUED = { queued_harness: null, queued_model: null, queued_effort: null } as const;

/** A turn holds the process: running, with messages written or held for after it, or background tasks still going. */
const holdsTurn = (live: Live | undefined) => !!live && (live.turn || !!live.inflight.length || !!live.held.length || hasBackground(live));

/** The catalog's objection to a run, or null. */
export function invalid(cat: Catalog, to: Run & { harness: HarnessId }): string | null {
  const h = getHarness(cat, to.harness);
  if (!h) return `Unknown harness "${to.harness}".`;
  if (!h.available) return unavailableError(h.name, h.fix);
  const r = validateRun(cat, to.harness, to.model || h.models.find((m) => m.default)?.id || h.models[0]?.id || '', to.effort);
  return r.ok ? null : r.error;
}

const plan = (t: Thread, to: Run, cat: Catalog) =>
  planSwitch({ ...runOf(t), id: t.id, has_run: t.has_run, session_id: t.session_id, ...threads.sessionState(t.id) }, to, runName(runOf(t), cat), events.lastId(t.id), (id) =>
    events.hasContentAfter(t.id, id),
  );

/**
 * Move a thread to another run. The same run again changes nothing, and drops a run queued since. While a turn runs
 * the pick is queued instead (`queued_*` on the thread): a later pick replaces it, and it applies once the thread is
 * quiet (`applyQueued`). A run the catalog does not offer, or a move to or from Hermes or Cursor Cloud, is refused at once.
 */
export async function switchRun(threadId: string, to: Run): Promise<Thread> {
  const t = threads.get(threadId);
  if (!t) throw refusal('thread not found', 404);
  if (sameRun(runOf(t), to)) {
    if (!queuedRun(t)) return t;
    threads.update(threadId, NO_QUEUED);
    emitThread(threadId);
    return threads.get(threadId)!;
  }
  if (!isHarnessId(to.harness)) throw refusal(`Unknown harness "${to.harness}".`, 400);
  const target = { ...to, harness: to.harness };
  // Ben may have just logged in to the harness: look again before refusing.
  if (invalid(getCatalog(), target)) {
    const error = invalid(await freshCatalog(), target);
    if (error) throw refusal(error, 400);
  }
  const now = threads.get(threadId)!;
  const why = turnBlocked(now, runsHere(threadId));
  if (why) throw refusal(why, 409);
  const p = plan(now, to, getCatalog());
  if (p.kind === 'reject') throw refusal(p.error, 400);

  // A turn spans one run: the pick waits for it to end. A lead still waiting on its team counts as running.
  if (now.status === 'running' || holdsTurn(lives.get(threadId))) {
    const q = queuedRun(now);
    if (q && sameRun(q, to)) return now;
    threads.update(threadId, { queued_harness: to.harness, queued_model: to.model, queued_effort: to.effort });
    emitThread(threadId);
    return threads.get(threadId)!;
  }
  apply(now, to);
  // Messages waiting for a slot go on the new run, whose harness may have one free.
  if (waiting.includes(threadId)) pump();
  return threads.get(threadId)!;
}

/**
 * The switch itself: the thread's run, its sessions and a `switch` row, and a warm process from the old run closes so
 * the next turn starts on the new one.
 */
function apply(t: Thread, to: Run) {
  const cat = getCatalog();
  const p = plan(t, to, cat);
  if (p.kind === 'reject') throw refusal(p.error, 400);
  if (p.kind === 'none') {
    if (queuedRun(t)) threads.update(t.id, NO_QUEUED);
    return;
  }
  threads.update(t.id, {
    harness: to.harness,
    model: to.model || null,
    effort: to.effort,
    auto_reason: null,
    ...NO_QUEUED,
    session_id: p.session_id,
    sessions: p.sessions,
    handover: p.handover,
  });
  addEvent(t.id, 'switch', { from: runName(runOf(t), cat), to: runName(to, cat), mode: p.kind } satisfies SwitchP);
  // The meter's reading is the old session's.
  if (to.harness !== t.harness) forgetContext(t.id);
  const live = lives.get(t.id);
  if (live) closeLive(live);
  emitThread(t.id);
}

/**
 * The thread is quiet, or about to start a turn: switch to the run Ben queued. Not while a turn or background task
 * holds the process. A run the catalog no longer offers is dropped with an error row, and the thread stays as it was.
 * True when nothing holds the thread's next turn back: no run waits, or it applied and no process is left to close.
 */
export function applyQueued(threadId: string): boolean {
  const t = threads.get(threadId);
  const to = queuedRun(t);
  if (!t || !to) return true;
  if (holdsTurn(lives.get(threadId))) return false;
  const error = isHarnessId(to.harness) ? invalid(getCatalog(), { ...to, harness: to.harness }) : `Unknown harness "${to.harness}".`;
  try {
    if (error) throw new Error(error);
    apply(t, to);
  } catch (e) {
    threads.update(threadId, NO_QUEUED);
    addEvent(threadId, 'error', { text: `The switch to ${runName(to).modelLabel} did not apply: ${(e as Error).message}` });
    emitThread(threadId);
  }
  return !lives.has(threadId);
}

/**
 * At spawn: a pending handover goes ahead of the first message that is not a command, and decides whether the harness
 * resumes. A command keeps its place at the start of its message, so with only commands waiting the handover waits for
 * the next message. A fresh session gets its id here, so a process that dies before the handover is read leaves it
 * pending for the next spawn.
 */
export function takeHandover(live: Live, thread: Thread): { thread: Thread; resume: boolean } {
  const { handover } = threads.sessionState(thread.id);
  if (!handover || !live.inflight.length) return { thread, resume: !!thread.has_run };
  const fresh = !handover.since && !handover.started;
  if (fresh) {
    thread = { ...thread, session_id: adapterFor(thread.harness).freshSessionId(thread) };
    threads.update(thread.id, { session_id: thread.session_id });
    live.sessionId = thread.session_id;
  }
  const target = live.inflight.find((m) => !leadsWithCommand(m));
  if (target) handOverWith(live, target, thread, handover);
  else live.handoverDue = true;
  return { thread, resume: !fresh };
}

/** A native session now exists, so a pending command-first handover can resume it after the process exits. */
export function sessionStarted(live: Live) {
  const { handover } = threads.sessionState(live.threadId);
  if (handover && !handover.since && !handover.started) {
    threads.update(live.threadId, { handover: { ...handover, started: true } });
  }
}

const leadsWithCommand = (m: Msg) => !!m.commands?.some((c) => c.start === m.text.length - m.text.trimStart().length);

/** Puts the pending handover ahead of `m`, unless `m` starts with a command, which then runs first. */
export function handOverWith(live: Live, m: Msg, thread = threads.get(live.threadId)!, handover = threads.sessionState(live.threadId).handover) {
  if (leadsWithCommand(m)) return;
  live.handoverDue = false;
  if (!handover) return;
  const session = handover.since ? 'resumed' : 'fresh';
  const to = runName(runOf(thread));
  const h = buildHandover({
    from: handover.from,
    to,
    session,
    user: userName(),
    thread,
    uploadsDir: uploadsDir(thread.id),
    artifacts: artifacts.byThread(thread.id).reverse().slice(0, 20).map((a) => a.name),
    // The messages about to go are not in the transcript yet: each lands there when the harness reads it.
    events: events.since(thread.id, handover.since),
  });
  m.text = h.text + m.text;
  m.commands = m.commands?.map((c) => ({ ...c, start: c.start + h.text.length, end: c.end + h.text.length }));
  live.handover = { uuid: m.uuid, done: { to, session, entries: h.entries, omitted: h.omitted, chars: h.chars } };
}

/** The harness read the handover: the transcript says so and the thread no longer has one pending. */
export function handedOver(live: Live) {
  const done = live.handover?.done;
  if (!done) return;
  live.handover = undefined;
  threads.update(live.threadId, { handover: null });
  addEvent(live.threadId, 'handover', done);
  emitThread(live.threadId);
}
