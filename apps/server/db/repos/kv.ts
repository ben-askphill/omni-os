import { db, tx } from '../connection.ts';
import { localKey, record } from '../sync.ts';

export const kv = {
  get: <T>(key: string): T | undefined => {
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  },
  /** Every key that starts with prefix, with its value, in key order. */
  list: <T>(prefix: string): [string, T][] =>
    (db.prepare('SELECT key, value FROM kv WHERE substr(key, 1, ?) = ? ORDER BY key').all(prefix.length, prefix) as { key: string; value: string }[]).map(
      (r) => [r.key, JSON.parse(r.value) as T],
    ),
  set: (key: string, value: unknown) =>
    tx(() => {
      const res = db
        .prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(key, JSON.stringify(value));
      if (!localKey(key)) record('kv', key);
      return res;
    }),
};
