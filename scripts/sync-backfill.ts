// Queues every existing row (channels, threads, events, artifacts, automation runs, kv) for the sync relay.
//
//   npm run sync:backfill
//
// For after moving to a new Supabase project, or when the relay lost history. The first sync on a machine already
// sends everything, so a normal setup never needs this. Idempotent: a row already waiting is not queued twice.
// Only queues; the running server pushes on its next sync (within a minute), or press Sync now in Settings.

import { backfill, type BackfillCount } from '../server/sync/backfill.ts';

const LABEL: Record<BackfillCount['entity'], string> = {
  channel: 'channels',
  thread: 'threads',
  event: 'events',
  artifact: 'artifacts',
  automation_run: 'automation runs',
  kv: 'settings (kv)',
};

if (process.argv.some((a) => a === '--help' || a === '-h')) {
  console.log('usage: npm run sync:backfill');
  process.exit(0);
}

try {
  const report = backfill({
    onProgress: (c) => {
      const parts = [`${c.queued} queued`, `${c.alreadyQueued} already queued`];
      if (c.elsewhere) parts.push(`${c.elsewhere} last written on another Mac`);
      console.log(`${LABEL[c.entity].padEnd(16)} ${parts.join(', ')} (of ${c.total})`);
    },
  });
  const queued = report.reduce((n, c) => n + c.queued, 0);
  console.log(queued ? `Queued ${queued} rows. Omni pushes them on its next sync.` : 'Nothing new to queue.');
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
