// Durable sends (apps/server/db/repos/requests.ts) from the Web UI's side: one request id per message, kept across
// its retries, and what a restart left waiting on Ben. RequestIds.swift is the Mac app's copy.
import type { PendingMsg } from './api.ts';

/** What makes two sends the same message: its text, mode, files and context records. A send without context keys as it always did. */
export function sendKey(prompt: string, mode: string | undefined, files: readonly { name: string; size: number; lastModified?: number }[], contextIds: readonly string[] = []) {
  return JSON.stringify([prompt, mode ?? '', files.map((f) => [f.name, f.size, f.lastModified ?? 0]), ...(contextIds.length ? [contextIds] : [])]);
}

export interface PendingRequest {
  key: string;
  id: string;
}

const newId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

/**
 * The request id for a send: the last failed one's when Ben retries the same message, so the server answers a
 * retry of something it already accepted with that acceptance; a new one for anything else.
 */
export function requestIdFor(last: PendingRequest | null, key: string, make: () => string = newId): PendingRequest {
  return last?.key === key ? last : { key, id: make() };
}

/** Accepted before a restart and waiting on Ben: `recovered` never reached a harness, `uncertain` may have. */
export const isParked = (m: PendingMsg) => m.delivery === 'recovered' || m.delivery === 'uncertain';

/** A thread's parked messages, split by the decision each needs. */
export function parkedOf(items: readonly PendingMsg[]) {
  return {
    recovered: items.filter((m) => m.delivery === 'recovered'),
    uncertain: items.filter((m) => m.delivery === 'uncertain'),
  };
}

/** Omni wrote it, not Ben: a crew report, the go a team's lead gets once its members have reported, or a PR watch's wake. */
export const isOmnis = (m: PendingMsg) => m.kind === 'crew_report' || m.source === 'team' || m.source === 'crew' || m.source === 'pr-watch';

/** "Crew report T-1 from coder": who a crew report is from. */
export function reportName(m: PendingMsg): string {
  let s = 'Crew report';
  if (m.task_id) s += ` ${m.task_id}`;
  if (m.role) s += ` from ${m.role}`;
  return s;
}

/**
 * The line over a parked message. Null for one the runner has. A held crew report waits for Resume whether a
 * restart or Ben's Stop kept it from the agent.
 */
export function parkedLabel(m: PendingMsg): string | null {
  if (m.kind === 'crew_report') {
    if (m.delivery === 'recovered') return `${reportName(m)}, held for Resume`;
    if (m.delivery === 'uncertain') return `${reportName(m)}, may have reached the agent before the restart`;
    return null;
  }
  if (m.source === 'pr-watch' && m.delivery === 'recovered') return 'PR watch, held for Resume';
  if (m.delivery === 'recovered') return 'Held after a restart, waiting for Resume';
  if (m.delivery === 'uncertain') return 'May have reached the agent before the restart';
  return null;
}

/** The line over the parked list. Crew reports also wait there when Ben stopped the thread, not only after a restart. */
export function parkedHeading(items: readonly PendingMsg[]): string {
  const n = items.length;
  const reports = items.filter((m) => m.kind === 'crew_report').length;
  // A PR watch's wake also waits for Resume when the thread cannot run here, with no restart behind it.
  const watches = items.filter((m) => m.source === 'pr-watch').length;
  if (!reports && watches) return `${n === 1 ? '1 message is' : `${n} messages are`} waiting for Resume`;
  if (!reports) return `${n === 1 ? '1 message was' : `${n} messages were`} waiting when Omni restarted`;
  if (reports === n) return `${n === 1 ? '1 crew report is' : `${n} crew reports are`} waiting for Resume`;
  return `${n} messages and crew reports are waiting for Resume`;
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
