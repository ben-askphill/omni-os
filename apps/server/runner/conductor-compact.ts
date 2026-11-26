// Conductor compaction (#1015): a #conductor thread on any model compacts between turns once its context passes a
// threshold, with a focus that keeps its routing state. The harness's own autocompact runs mid-turn and summarises
// with no instructions, so it can drop the task ids and open delegations the Conductor routes by; Claude Code's window
// for Sonnet is also left to the user's own setting (harness/claude/adapter.ts COMPACT_WINDOWS covers Opus only).
// OMNI_CONDUCTOR_COMPACT_AT sets the threshold in tokens; 0 turns the policy off (Settings > Threads lists it).
//
// Which harnesses: those whose profile has a compact command (Claude Code with the focus, Codex without, since its
// /compact takes no instructions). Cursor Agent, Cursor Cloud, Hermes, custom harnesses and Antigravity have none.
import { randomUUID } from 'node:crypto';
import { CONDUCTOR_CHANNEL } from '@omni/shared/channel-icon.ts';
import { config } from '../config.ts';
import { lastContext } from '../context.ts';
import { threads, type Thread, type ThreadStatus } from '../db.ts';
import { profileOf } from '../harness/profile.ts';
import { deliver } from './queue.ts';
import { messageFor } from './api.ts';
import { autoCompacting, isShuttingDown, lives, turnEnded, waitingMsgs } from './state.ts';

/** What the summary must keep, so the Conductor can carry on routing after it. */
export const CONDUCTOR_COMPACT_FOCUS =
  'Keep the routing state: every open delegation and team with its thread id, task id (T-...), agent, channel and ' +
  'what it was asked to do; who waits on what, and which reports have not come back; questions still waiting for the ' +
  'user or for a thread, with their ids; the decisions the user made and their latest request. Finished work in one ' +
  'line each. Drop tool output and anything a thread can be asked again.';

/** The message Omni sends: the harness's own /compact, with the focus where it takes one. */
export const compactMessage = (thread: Pick<Thread, 'harness'>): string =>
  profileOf(thread.harness).compact?.focus ? `/compact ${CONDUCTOR_COMPACT_FOCUS}` : '/compact';

/** When Omni last asked a thread to compact: a reading from before then is the one that asked. */
const askedAt = new Map<string, string>();

/** Whether a Conductor thread that just finished a turn should compact now. */
export function compactDue(t: Thread | undefined, threshold = config.conductorCompactAt): boolean {
  if (!t || threshold <= 0) return false;
  if (t.channel_id !== CONDUCTOR_CHANNEL || t.source === 'member' || t.parent_id || t.quick) return false;
  if (!profileOf(t.harness).compact) return false;
  const c = lastContext(t.id);
  if (!c?.used || c.used < threshold) return false;
  // The reading Omni already asked on (a compaction that reported nothing new yet) asks no second time.
  const asked = askedAt.get(t.id);
  return !asked || c.updated_at > asked;
}

/**
 * A turn ended done. A Conductor thread past the threshold compacts now, before the next message: queued as a turn of
 * its own, so a message the user sends meanwhile runs after it. Not after its own compaction, and not when something
 * already waits to run.
 */
function compactAfterTurn(id: string, status: ThreadStatus) {
  if (status !== 'done' || isShuttingDown() || autoCompacting.has(id)) return;
  const t = threads.get(id);
  const live = lives.get(id);
  if (!live || live.closing || live.held.length || waitingMsgs.get(id)?.length || !compactDue(t)) return;
  const m = messageFor(t!, compactMessage(t!), { uuid: randomUUID(), source: 'omni', mode: 'queue' });
  m.byOmni = true;
  askedAt.set(id, new Date().toISOString());
  autoCompacting.add(id);
  try {
    deliver(id, m);
  } catch {
    autoCompacting.delete(id);
  }
}

// Loaded by runner.ts, so none of the lifecycle modules imports it (tests/import-boundaries.test.ts).
turnEnded.push(compactAfterTurn);
