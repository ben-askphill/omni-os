import { db, tx } from '../connection.ts';
import { localKey, record } from '../sync.ts';

export const kv = {
  get: <T>(key: string): T | undefined => {
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  },
  set: (key: string, value: unknown) =>
    tx(() => {
      const res = db
        .prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(key, JSON.stringify(value));
      if (!localKey(key)) record('kv', key);
      return res;
    }),
};
