// A worktree thread's turn snapshots (apps/server/turns.ts): its checkout saved before each turn and once it ends.
// Saving never holds up a Result: the turn ends when the harness says so, and the after snapshot settles behind it.
// A snapshot that cannot be saved fails on its own row with its reason and leaves the turn's Result as it was.
// Each thread's saves run one after another, so a turn's before snapshot waits for the last turn's after snapshot,
// and its first message waits for its before snapshot (bounded), so the harness changes nothing first. Every save
// writes only the row of the turn it was started for, keyed by that turn's id.
// A group thread (ADR 0019, Q25) saves one checkpoint per message across all its agents: a message that names agents
// saves the checkout before it is handed to any of them and after the last one finishes (runner/members.ts), and
// while that checkpoint is open, no agent's turn saves one of its own. A member's session never saves its own.
import { randomUUID } from 'node:crypto';
import { config } from '../config.ts';
import { completions, threads, turnSnapshots } from '../db.ts';
import { snapshot, snapshotCheckout, turnRef } from '../turns.ts';
import { isProviderHarness } from '../harness/types.ts';
import { crash, deliver, emitThread, lives, track, type Live } from './state.ts';

/** Each thread's last queued save. */
const chains = new Map<string, Promise<void>>();
/** Saves not settled yet, for shutdown to wait on. */
const pending = new Set<Promise<void>>();
/** Group threads with a message checkpoint open, and how many: their agents' turns save none of their own. */
const covering = new Map<string, number>();

/** Run fn after the thread's earlier saves. A failure is fn's to record; this only keeps the chain going. */
function queue(threadId: string, fn: () => Promise<void>): Promise<void> {
  const next = (chains.get(threadId) ?? Promise.resolve()).then(fn).catch((err) => console.error(`[turns] ${threadId}:`, err));
  chains.set(threadId, next);
  pending.add(next);
  void next.finally(() => {
    pending.delete(next);
    if (chains.get(threadId) === next) chains.delete(threadId);
  });
  return next;
}

const message = (err: unknown) => ((err as { stderr?: string }).stderr?.trim() || (err as Error).message || String(err)).slice(0, 500);

/** Save one side of a turn, or fail its row with why. */
async function save(threadId: string, turnId: string, side: 'before' | 'after') {
  const row = turnSnapshots.get(turnId);
  // Failed already (the wait ran out, or the before snapshot failed): nothing more to save for it.
  if (!row || row.state === 'failed' || row.state === 'ready') return;
  const at = await snapshotCheckout(threads.get(threadId));
  if ('reason' in at) {
    turnSnapshots.fail(turnId, at.reason);
    return emitThread(threadId);
  }
  try {
    const snap = await snapshot(at.dir, turnRef(threadId, turnId, side));
    if (side === 'before') turnSnapshots.saveBefore(turnId, snap);
    else turnSnapshots.saveAfter(turnId, snap);
  } catch (err) {
    turnSnapshots.fail(turnId, `Could not save the checkout ${side === 'before' ? 'before' : 'after'} this turn: ${message(err)}`);
  }
  emitThread(threadId);
}

/**
 * A turn starts in a worktree thread: record it and save its checkout. Until that is saved, or the wait runs out,
 * the turn's messages wait (`live.gate`): spawnLive holds the process back, and `send` holds a warm one's lines.
 */
export function startTurnSnapshot(live: Live) {
  if (live.snap || !config.turnSnapshots) return;
  const t = threads.get(live.threadId);
  if (!t?.branch || isProviderHarness(t.harness)) return;
  if (t.source === 'member' || covering.get(t.id)) return;
  const id = randomUUID();
  live.snapStarted(id);
  turnSnapshots.start(id, t.id, completions.latest(t.id)?.n ?? 0);
  const saved = queue(t.id, () => save(t.id, id, 'before'));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<void>((done) => (timer = setTimeout(done, config.turnSnapshotWaitMs)));
  const gate = Promise.race([saved, late]).then(() => {
    clearTimeout(timer);
    // The wait ran out: the turn goes ahead, so a before snapshot taken from here on would hold its edits.
    if (!turnSnapshots.get(id)?.before_sha && turnSnapshots.fail(id, 'Saving the checkout before this turn took too long, so the turn ran without it.')) {
      emitThread(t.id);
    }
    live.gateOff(gate);
    release(live);
  });
  live.gateOn(gate);
}

/**
 * A message to a group thread's agents (runner/members.ts): record its checkpoint and save the checkout before any
 * of them changes it, waiting at most as long as a turn's first message would. Its id, for finishMessageSnapshot, or
 * null when the thread saves no turns.
 */
export async function startMessageSnapshot(threadId: string): Promise<string | null> {
  if (!config.turnSnapshots) return null;
  const t = threads.get(threadId);
  if (!t?.branch || isProviderHarness(t.harness)) return null;
  covering.set(t.id, (covering.get(t.id) ?? 0) + 1);
  const id = randomUUID();
  turnSnapshots.start(id, t.id, completions.latest(t.id)?.n ?? 0);
  emitThread(t.id);
  const saved = queue(t.id, () => save(t.id, id, 'before'));
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([saved, new Promise<void>((done) => (timer = setTimeout(done, config.turnSnapshotWaitMs)))]);
  clearTimeout(timer);
  if (!turnSnapshots.get(id)?.before_sha && turnSnapshots.fail(id, 'Saving the checkout before this message took too long, so the agents ran without it.')) emitThread(t.id);
  return id;
}

/** Every agent the message named has finished: link the last Result and save the checkout after the message. */
export function finishMessageSnapshot(threadId: string, id: string | null) {
  if (!id) return;
  const left = (covering.get(threadId) ?? 1) - 1;
  if (left > 0) covering.set(threadId, left);
  else covering.delete(threadId);
  const row = turnSnapshots.get(id);
  if (!row) return;
  const c = completions.latest(threadId);
  turnSnapshots.end(id, c && c.n > row.prior_n ? c.uid : null);
  if (turnSnapshots.get(id)?.state !== 'capturing') return;
  emitThread(threadId);
  void queue(threadId, () => save(threadId, id, 'after'));
}

/** Write the messages a warm process held back while the checkout was saved. */
function release(live: Live) {
  const held = live.takeGated();
  if (lives.get(live.threadId) !== live || !live.session || live.closing) return;
  for (const m of held) {
    // Dropped while it waited (the process was stopped).
    if (!live.inflight.includes(m)) continue;
    track(m, 'sent');
    if (!deliver(live, m)) {
      crash(live);
      break;
    }
  }
}

/**
 * The turn ended, its status already written: link the Result it left and save its checkout after it, behind
 * whatever is still saving for the thread. Safe to call more than once and for a turn with no snapshot.
 */
export function finishTurnSnapshot(live: Live) {
  const id = live.snapEnded();
  if (!id) return;
  const row = turnSnapshots.get(id);
  if (!row) return;
  // The status write that ended the turn added its Result: the first one after the turn started is this turn's.
  const c = completions.latest(live.threadId);
  turnSnapshots.end(id, c && c.n > row.prior_n ? c.uid : null);
  if (turnSnapshots.get(id)?.state !== 'capturing') return;
  emitThread(live.threadId);
  void queue(live.threadId, () => save(live.threadId, id, 'after'));
}

/** Wait for saves still running, at most ms. Shutdown calls it once every process is gone. */
export async function settleSnapshots(ms = 5_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([Promise.allSettled([...pending]), new Promise((done) => (timer = setTimeout(done, ms)))]);
  clearTimeout(timer);
}
