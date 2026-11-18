// Which agent threads may change automations. Omni's MCP servers name the thread they serve on every API call
// (apps/mcp/api.ts sends CALLER_HEADER); Ben's own clients send none, and nothing here holds them. Two rules:
// - A thread an automation started, or any thread below one, cannot create, change, turn on or run automations, or
//   start a usage scan: nobody watches a loop that builds or starts more loops. Cloudroom has the same guard
//   ("Loop-spawned threads cannot create loops").
// - A usage scan's lead (crew/usage-scan.md) only creates, only after Ben has answered in its thread, and what it
//   creates starts off (the route sets `enabled: false`).
// The header only ever narrows what a call may do, so a caller that names another thread gains nothing. It holds the
// path agents are told to use, not a determined one: every thread can read the install token (sandbox.ts), so a shell
// command that calls the API without the header, or posts a message as Ben, is not stopped. Closing that needs tokens
// scoped to one thread.
import type { Context } from 'hono';
import { db } from './db.ts';
import { ancestry, automationOf } from './lineage.ts';
import { userName } from './profile.ts';
import { SCAN_ROLE } from './usage-scan/asks.ts';

export const CALLER_HEADER = 'x-omni-thread';

/**
 * Who a message an API call posts is from: an agent thread's call (one that names its thread, as Omni's MCP servers do)
 * is the Conductor's, never Ben's, whatever it says. The guards read Ben's messages in a thread as his answer
 * (benAnswered below, crew-guard.ts), so every route that posts a message on Ben's behalf takes its sender from here.
 */
export const senderOf = (c: Context, from: 'ben' | 'conductor' = 'ben'): 'ben' | 'conductor' => (c.req.header(CALLER_HEADER) ? 'conductor' : from);

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
