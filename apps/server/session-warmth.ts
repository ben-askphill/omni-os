// Whether a thread's session is still in the model provider's prompt cache. A parent thread follows up on a warm
// session with message_thread; a cold one it carries into a new session instead (crew/conductor.md), because
// resuming it re-reads the whole context uncached.
import { events, type Thread } from './db.ts';

/**
 * How long a session stays warm after its last model call: the 1-hour prompt cache Claude Code gets on a plan.
 * The provider can drop it sooner (5 minutes in overage), which Omni cannot see, so this is the best case.
 */
export const SESSION_WARM_MS = 60 * 60_000;

export interface SessionWarmth {
  warm: boolean;
  /** The thread's last model activity (a reply, a tool call or result, a turn's end), null before its first turn. */
  last_activity_at: string | null;
  /** Minutes since then, null before its first turn. */
  idle_minutes: number | null;
}

/**
 * A thread that runs, waits to start, has never run or had model activity within SESSION_WARM_MS is warm. A CLI
 * process kept alive between turns does not count: it keeps the session in memory, not the provider's cache.
 */
export function sessionWarmth(t: Thread, at = Date.now()): SessionWarmth {
  const last = events.lastModelAt(t.id);
  const idle = last ? at - Date.parse(last) : null;
  const warm = t.status === 'running' || t.status === 'queued' || !t.has_run || idle === null || idle < SESSION_WARM_MS;
  return { warm, last_activity_at: last, idle_minutes: idle === null ? null : Math.floor(idle / 60_000) };
}

/** Why message_thread will not wake this cold thread, and what to do instead. */
export const coldRefusal = (t: Thread, w: SessionWarmth) =>
  `Not sent: "${t.title}" (${t.id}) has been idle ${w.idle_minutes} minutes, so its session is out of the prompt cache ` +
  `(warm for ${SESSION_WARM_MS / 60_000} minutes after its last model activity). Waking it re-reads its whole context uncached. ` +
  `Open a new session instead: continue_thread on its harness (${t.harness}) with a message that carries the follow-up, ` +
  'or delegate a fresh thread whose brief stands alone and links this one. Then say which thread replaced which. ' +
  'To learn how it went, read it with get_thread. Pass wake_cold: true only when you were asked to resume this thread itself.';
