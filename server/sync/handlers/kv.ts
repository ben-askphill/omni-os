import { db } from '../../db.ts';
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
});
