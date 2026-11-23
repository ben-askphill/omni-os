// Durable sends (apps/server/db/repos/requests.ts) from the Web UI's side: what makes two sends the same message, and what a
// restart left waiting on Ben. The request id itself is packages/shared/request-id.ts, the parked rows' labels
// packages/shared/parked.ts.
import type { PendingMsg } from './api.ts';

/** What makes two sends the same message: its text, mode, files and context records. A send without context keys as it always did. */
export function sendKey(prompt: string, mode: string | undefined, files: readonly { name: string; size: number; lastModified?: number }[], contextIds: readonly string[] = []) {
  return JSON.stringify([prompt, mode ?? '', files.map((f) => [f.name, f.size, f.lastModified ?? 0]), ...(contextIds.length ? [contextIds] : [])]);
}

/** A thread's parked messages, split by the decision each needs. */
export function parkedOf(items: readonly PendingMsg[]) {
  return {
    recovered: items.filter((m) => m.delivery === 'recovered'),
    uncertain: items.filter((m) => m.delivery === 'uncertain'),
  };
}

/**
 * Where each crew report to this thread is, by the thread that reported, for the delegation card's rows. Only the
 * ones the agent has not read yet: a delivered one is in the transcript.
 */
export function reportNotes(items: readonly PendingMsg[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of items) {
    if (m.kind !== 'crew_report' || !m.thread_id) continue;
    const note =
      m.delivery === 'recovered' ? 'report held for Resume'
      : m.delivery === 'uncertain' ? 'report may not have arrived'
      : m.state === 'waiting' ? 'report waiting for a slot'
      : m.state === 'held' ? 'report queued'
      : 'report on its way';
    out.set(m.thread_id, note);
  }
  return out;
}
