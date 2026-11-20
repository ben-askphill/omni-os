// Where a thread came from, in one place for everything that asks "did an automation or an agent start this?": the
// automation guard (automation-guard.ts) and the usage scan's asks (usage-scan/asks.ts). Two columns link a thread to
// the one it came from. parent_id: delegate, delegate_team, review notes and PR review. continued_from: continue.ts,
// whose new thread has no automation, and a delegated source's parent and source (no parent and source manual otherwise). Hand off and the run switch keep the thread's id.
// Both walks read each thread once, so a cycle in bad data ends them, and neither has a depth limit.
// Takes the database as an argument: the repeated-asks script opens its own, read-only.
import type { DatabaseSync } from 'node:sqlite';

const LINKS = ['parent_id', 'continued_from'] as const;

/** The link columns this database has: one from before continued threads has only parent_id. */
function links(db: DatabaseSync): string[] {
  const have = new Set((db.prepare(`SELECT name FROM pragma_table_info('threads')`).all() as { name: string }[]).map((r) => r.name));
  return LINKS.filter((c) => have.has(c));
}

/**
 * SQL for one recursive CTE, `name(id)`: the threads `seed` selects, and every thread that came from one of them at any
 * depth. UNION keeps each thread once.
 */
export function descendantsCte(db: DatabaseSync, name: string, seed: string): string {
  const on = links(db).map((c) => `t.${c} = ${name}.id`).join(' OR ');
  return `${name}(id) AS (${seed} UNION SELECT t.id FROM threads t JOIN ${name} ON ${on})`;
}

export interface Origin {
  id: string;
  automation: string | null;
  source: string;
  role: string | null;
}

/** The thread and every thread it came from, nearest first. */
export function ancestry(db: DatabaseSync, threadId: string): Origin[] {
  const cols = links(db);
  const get = db.prepare(`SELECT id, automation, source, role, ${cols.join(', ')} FROM threads WHERE id = ?`);
  const out: Origin[] = [];
  const seen = new Set<string>();
  const queue = [threadId];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const t = get.get(id) as (Origin & Record<string, string | null>) | undefined;
    if (!t) continue;
    out.push({ id: t.id, automation: t.automation, source: t.source, role: t.role });
    for (const c of cols) if (t[c] && !seen.has(t[c]!)) queue.push(t[c]!);
  }
  return out;
}

/** The automation that started this thread or one it came from: its id, or the run thread's when the row has none. */
export const automationOf = (line: readonly Origin[]): string | null => {
  const ran = line.find((t) => t.automation || t.source === 'automation');
  return ran ? (ran.automation ?? ran.id) : null;
};
