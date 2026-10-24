// A worktree thread's turn snapshots (apps/server/turns.ts): its checkout saved before each turn and once it ends.
// Saving never holds up a Result: the turn ends when the harness says so, and the after snapshot settles behind it.
// A snapshot that cannot be saved fails on its own row with its reason and leaves the turn's Result as it was.
// Each thread's saves run one after another, so a turn's before snapshot waits for the last turn's after snapshot,
// and its first message waits for its before snapshot (bounded), so the harness changes nothing first. Every save
// writes only the row of the turn it was started for, keyed by that turn's id.
import { randomUUID } from 'node:crypto';
import { config } from '../config.ts';
import { completions, threads, turnSnapshots } from '../db.ts';
import { snapshot, snapshotCheckout, turnRef } from '../turns.ts';
import { isRemoteHarness } from '../harness/types.ts';
import { crash, emitThread, lives, track, userLine, writeLine, type Live } from './state.ts';

/** Each thread's last queued save. */
const chains = new Map<string, Promise<void>>();
/** Saves not settled yet, for shutdown to wait on. */
const pending = new Set<Promise<void>>();

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
  if (!t?.branch || isRemoteHarness(t.harness)) return;
  const id = randomUUID();
  live.snap = id;
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
    if (live.gate === gate) live.gate = null;
    release(live);
  });
  live.gate = gate;
}

/** Write the messages a warm process held back while the checkout was saved. */
function release(live: Live) {
  const held = live.gated?.splice(0) ?? [];
  if (lives.get(live.threadId) !== live || !live.child || live.closing) return;
  for (const m of held) {
    // Dropped while it waited (the process was stopped).
    if (!live.inflight.includes(m)) continue;
    track(m, 'sent');
    if (!writeLine(live, userLine(live, m))) {
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
  const id = live.snap;
  if (!id) return;
  live.snap = null;
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
