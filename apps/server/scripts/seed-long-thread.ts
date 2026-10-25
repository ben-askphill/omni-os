// Seeds a long thread for QA and screenshots (#223): the events of packages/test-fixtures/long-thread.ts, written
// through the server's repos so search finds them, in a new `inbox` thread titled "Long thread (seeded)". Prints its id.
//
//   OMNI_DATA_DIR=<qa data dir> npx tsx apps/server/scripts/seed-long-thread.ts [--turns N]
//
// Safe next to a running server on that data dir (scripts/qa-stack.sh up). Refuses to run without OMNI_DATA_DIR, so it
// never writes the live install's data/.

import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { longThread } from '@omni/test-fixtures/long-thread.ts';

if (!process.env.OMNI_DATA_DIR) {
  console.error('seed-long-thread: set OMNI_DATA_DIR to a QA stack data dir (scripts/qa-stack.sh status prints it)');
  process.exit(2);
}
const at = process.argv.indexOf('--turns');
const turns = at >= 0 ? Number(process.argv[at + 1]) : undefined;
if (turns !== undefined && !(Number.isInteger(turns) && turns > 0)) {
  console.error('seed-long-thread: --turns takes a whole number of turns');
  process.exit(2);
}

const { artifactsDir, threadDir } = await import('../config.ts');
const { db, events, threads, tx } = await import('../db.ts');

const id = randomUUID();
mkdirSync(artifactsDir(id), { recursive: true });
tx(() => {
  threads.create({
    id, channel_id: 'inbox', title: 'Long thread (seeded)', status: 'done', role: null, model: null, session_id: id,
    cwd: threadDir(id), branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
  });
  for (const e of longThread({ turns })) events.add(id, e.kind, e.payload);
});
db.close();
console.log(id);
