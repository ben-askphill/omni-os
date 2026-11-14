import { db, threads } from '../../db.ts';
import { publishFeed } from '../../bus.ts';
import { ASK_PREFIX, STATUS_PREFIX } from '@omni/shared/update-fleet.ts';
import { ACCOUNTS_PREFIX, SEEN_PREFIX } from '@omni/shared/harness-accounts.ts';
import { noteSynced } from '../../machine-stats.ts';
import { claim, registerHandler } from '../apply.ts';

// kv: last writer wins per key, the value as JSON. sync.* keys (machine id, cursor, switches, path map) belong to
// one Mac: they never go out, and one that arrives anyway is ignored.

const local = (key: string) => key.startsWith('sync.');

registerHandler('kv', {
  serialize(key) {
    if (local(key)) return null;
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? { value: JSON.parse(row.value) as unknown } : null;
  },
  apply(change) {
    if (local(change.entity_id) || !claim(change)) return false;
    if (change.op === 'delete') return db.prepare('DELETE FROM kv WHERE key = ?').run(change.entity_id).changes > 0;
    const { value } = (change.data ?? {}) as { value?: unknown };
    if (value === undefined) return false;
    db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      change.entity_id,
      JSON.stringify(value),
    );
    return true;
  },
  notify(change) {
    // A handoff record (apps/server/handoff/records.ts) or the thread's holder: its banner, its Take over note, and whether
    // a turn may start follow it. The account a thread ran as (harness-accounts.ts): its quick-actions card.
    const thread = /^(?:handoff\.(?:offer|reply|request|holder)\.|accounts-ran\.)(.+)$/.exec(change.entity_id)?.[1];
    const t = thread && threads.get(thread);
    if (t) publishFeed({ type: 'thread', thread: t });
    // The Update all machines list refetches (update-fleet.ts).
    if (change.entity_id.startsWith(STATUS_PREFIX) || change.entity_id.startsWith(ASK_PREFIX)) publishFeed({ type: 'update' });
    // Another machine's harness accounts, or a switch acknowledged there (harness-accounts.ts).
    if (change.entity_id.startsWith(ACCOUNTS_PREFIX) || change.entity_id.startsWith(SEEN_PREFIX)) publishFeed({ type: 'accounts' });
    // Another machine's CPU and memory, or its ask for this machine's while it shows the machine tiles (machine-stats.ts).
    if (change.entity_id.startsWith('machine-')) noteSynced(change.entity_id, (change.data as { value?: unknown } | null)?.value);
  },
});
