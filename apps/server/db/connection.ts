import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { paths } from '../config.ts';

mkdirSync(dirname(paths.db), { recursive: true });
export const db = new DatabaseSync(paths.db);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

export const now = () => new Date().toISOString();

let savepoints = 0;
/**
 * Run fn in one transaction. A savepoint, so it nests inside a caller's BEGIN (import-history) or another tx.
 * Every repo write goes through it, so the row and its outbox entry commit together or not at all.
 */
export function tx<T>(fn: () => T): T {
  const name = `omni_tx_${savepoints++}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const out = fn();
    db.exec(`RELEASE ${name}`);
    return out;
  } catch (err) {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    throw err;
  } finally {
    savepoints--;
  }
}
