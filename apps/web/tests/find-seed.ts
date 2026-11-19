import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { longThread } from '@omni/test-fixtures/long-thread.ts';

// A long thread for the find bar's browser test (thread-find-browser.test.ts) and for checking it by hand on a QA
// stack: the long fixture's 80 turns written straight into a server's db under a thread the server made, with one
// word only an early call's output holds. The server reads events from the db on every request.

/** The word only the output of an early call says, folded in a finished turn's steps card. */
export const OUTPUT_NEEDLE = 'zebrafish-marker';

/** Appends the long thread's rows to `threadId` in the db at `dbPath`. Returns how many it wrote. */
export function seedLongThread(dbPath: string, threadId: string, turns = 80): number {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout = 5000;');
  const rows = longThread({ turns, hugeResult: 40_000, hugeWrite: 20_000 });
  // Turn 5's first call result: past the first page a client opens on, and folded in its steps.
  const at = rows.findIndex((e, i) => e.kind === 'tool_result' && rows.slice(0, i).filter((r) => r.kind === 'result').length === 5);
  rows[at] = { ...rows[at], payload: { ...rows[at].payload, text: `checked 12 files\nfound the ${OUTPUT_NEEDLE} in fixtures/old.json\ndone` } };
  const insert = db.prepare('INSERT INTO events (uid, thread_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)');
  const t0 = Date.parse('2026-11-19T08:00:00.000Z');
  db.exec('BEGIN');
  rows.forEach((e, i) => insert.run(randomUUID(), threadId, e.kind, JSON.stringify(e.payload), new Date(t0 + i * 1000).toISOString()));
  db.exec('COMMIT');
  db.close();
  return rows.length;
}

// By hand: `npx tsx apps/web/tests/find-seed.ts <db> <thread id>`.
if (process.argv[1]?.endsWith('find-seed.ts') && process.argv[2] && process.argv[3]) {
  console.log(`wrote ${seedLongThread(process.argv[2], process.argv[3])} rows`);
}
