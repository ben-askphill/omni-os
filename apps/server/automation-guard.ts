// Which agent threads may change automations. Who is calling comes from callerOf below: a thread's own token
// (thread-tokens.ts), which every local harness and its MCP servers hold, says which thread it is whatever the request
// claims; a call with the install token may still name a thread in CALLER_HEADER, which only narrows. Ben's own
// clients name none, and nothing here holds them. Two rules:
// - A thread an automation started, or any thread below one, cannot create, change, turn on or run automations, or
//   start a usage scan: nobody watches a loop that builds or starts more loops. Cloudroom has the same guard
//   ("Loop-spawned threads cannot create loops").
// - A usage scan's lead (crew/usage-scan.md) only creates, only after Ben has answered in its thread, and what it
//   creates starts off (the route sets `enabled: false`).
// The header only ever narrows what a call may do, so a caller that names another thread gains nothing. No thread is
// handed the install token any more, so a thread's calls through the paths Omni gives it (its MCP servers, the omni
// command, curl with $OMNI_TOKEN) are held to these rules with or without the header. A thread that sets out to read
// data/api-token from disk still can: keeping it from the file is the OS sandbox's job (finding 12, part 3).
import type { Context } from 'hono';
import { db } from './db.ts';
import { ancestry, automationOf } from './lineage.ts';
import { userName } from './profile.ts';
import { SCAN_ROLE } from './usage-scan/asks.ts';

import { CALLER_HEADER } from './caller-header.ts';

export { CALLER_HEADER };

/**
 * The thread a request comes from: the one its thread token was minted for (request-guard.ts has refused a header that
 * names another), else the thread an install-token caller names in CALLER_HEADER, else null for Ben's own clients.
 * Every guard asks this, never the raw header.
 */
export function callerOf(c: Context): string | null {
  const auth = c.get('omniAuth');
  if (auth?.via === 'thread') return auth.thread;
  return c.req.header(CALLER_HEADER) || null;
}

/** The thread whose own token the request carries, or null: the install token, a device session, or no credential. */
export function threadCredential(c: Context): string | null {
  const auth = c.get('omniAuth');
  return auth?.via === 'thread' ? auth.thread : null;
}

/**
 * Who a message an API call posts is from: an agent thread's call is the Conductor's, never Ben's, whatever it says.
 * The guards read Ben's messages in a thread as his answer (benAnswered below, crew-guard.ts), so every route that
 * posts a message on Ben's behalf takes its sender from here.
 */
export const senderOf = (c: Context, from: 'ben' | 'conductor' = 'ben'): 'ben' | 'conductor' => (callerOf(c) ? 'conductor' : from);

export type AutomationWrite = 'create' | 'edit' | 'enable' | 'run' | 'scan' | 'disable' | 'delete';

const WHAT: Record<AutomationWrite, string> = {
  create: 'create automations',
  edit: 'change automations',
  enable: 'turn automations on',
  run: 'run automations',
  scan: 'start a usage scan',
  disable: 'turn automations off',
  delete: 'delete automations',
};

/** What a thread an automation started may still do: stop automations, never start or make one. */
const STOPS = new Set<AutomationWrite>(['disable', 'delete']);

export interface Lineage {
  /** The automation that started this thread or one above it. */
  automation: string | null;
  /** The usage scan thread this thread is, or sits below. */
  scan: string | null;
}

/** Who this thread came from, along parent_id and continued_from at any depth (lineage.ts). */
export function lineage(threadId: string): Lineage {
  const line = ancestry(db, threadId);
  return { automation: automationOf(line), scan: line.find((t) => t.role === SCAN_ROLE)?.id ?? null };
}

/**
 * Ben answered in this thread: a message of his after its first one (Omni's report in a scan, his own request in the
 * Conductor), or an answer to a question the thread asked. The crew guard (crew-guard.ts) asks the same.
 */
export function benAnswered(threadId: string): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM events WHERE thread_id = ? AND (kind = 'question_answer'
         OR (kind = 'user' AND json_extract(payload, '$.source') = 'ben' AND json_extract(payload, '$.dropped') IS NOT 1
             AND id > (SELECT MIN(id) FROM events WHERE thread_id = ? AND kind = 'user'))) LIMIT 1`,
    )
    .get(threadId, threadId);
}

/** An automation or a usage scan sits above this thread, or it is one: nobody watches it. */
export function unattended(threadId: string): boolean {
  const l = lineage(threadId);
  return !!(l.automation || l.scan);
}

/** `id` is `ancestor` or came from it, along parent_id and continued_from at any depth. */
export const atOrBelow = (id: string, ancestor: string): boolean => ancestry(db, id).some((t) => t.id === ancestor);

/**
 * Why the thread whose token this request carries may not start a thread that comes from `from` (its parent, or the
 * thread it continues), or null when it may. A thread files what it starts under itself, so it cannot shed the
 * automation above it. `strict`: the caller picks the parent (create, team), and anything outside its own lineage is
 * refused. Otherwise the parent is the thread the call acts on (continue, a fork, review notes, a message), and only an
 * unattended thread is held, to threads under the same automation and usage scan as itself, so the Conductor still
 * continues any thread Ben names and a run's thread may continue the run.
 */
export function lineageRefusal(c: Context, from: string, strict: boolean): string | null {
  const caller = threadCredential(c);
  if (!caller || atOrBelow(from, caller)) return null;
  if (!strict) {
    if (!unattended(caller)) return null;
    const mine = lineage(caller);
    const theirs = lineage(from);
    if (theirs.automation === mine.automation && theirs.scan === mine.scan) return null;
  }
  return `A thread starts threads only under itself or a thread below it, and ${from} is neither.`;
}

/** Why the thread `caller` may not make this change, or null when it may. No caller is one of Ben's clients. */
export function automationRefusal(caller: string | null | undefined, write: AutomationWrite): string | null {
  if (!caller) return null;
  const l = lineage(caller);
  if (l.automation && !STOPS.has(write)) return `This thread runs under the automation "${l.automation}", and threads an automation started cannot ${WHAT[write]}. Ask ${userName()} to do it.`;
  if (!l.scan) return null;
  if (write !== 'create') return `A usage scan only suggests new automations; it cannot ${WHAT[write]}.`;
  if (!benAnswered(l.scan)) return `Not yet: a usage scan saves automations only after ${userName()} says which ones in its thread.`;
  return null;
}
