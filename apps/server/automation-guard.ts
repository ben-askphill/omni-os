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
import { db } from './db.ts';
import { userName } from './profile.ts';
import { SCAN_ROLE } from './usage-scan/asks.ts';

export const CALLER_HEADER = 'x-omni-thread';

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

/** How deep the walk up the parent chain goes: deeper than any real delegation, and a cycle in bad data still ends. */
const MAX_DEPTH = 64;

export interface Lineage {
  /** The automation that started this thread or one above it. */
  automation: string | null;
  /** The usage scan thread this thread is, or sits below. */
  scan: string | null;
}

export function lineage(threadId: string): Lineage {
  const rows = db
    .prepare(
      `WITH RECURSIVE up(id, parent_id, automation, source, role, depth) AS (
         SELECT id, parent_id, automation, source, role, 0 FROM threads WHERE id = ?
         UNION ALL SELECT t.id, t.parent_id, t.automation, t.source, t.role, up.depth + 1 FROM threads t JOIN up ON t.id = up.parent_id
         WHERE up.depth < ${MAX_DEPTH})
       SELECT id, automation, source, role FROM up ORDER BY depth`,
    )
    .all(threadId) as { id: string; automation: string | null; source: string; role: string | null }[];
  const ran = rows.find((r) => r.automation || r.source === 'automation');
  return { automation: ran ? (ran.automation ?? ran.id) : null, scan: rows.find((r) => r.role === SCAN_ROLE)?.id ?? null };
}

/** Ben answered in the scan's thread: a message of his after Omni's report, or an answer to a question the lead asked. */
function answered(threadId: string): boolean {
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
  if (!answered(l.scan)) return `Not yet: a usage scan saves automations only after ${userName()} says which ones in its thread.`;
  return null;
}
