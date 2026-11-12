// The relay's background work on one user's change log, a bounded slice at a time: compact the log (compact.ts),
// create the key index, then move change data still inline in SQLite out to R2 (RelayStore.moveInline).
// A Durable Object that spends more than its CPU limit is reset, and every request it was serving fails with it,
// so none of this may run as one loop behind a request. The object runs one slice per alarm and sets the next
// alarm while a slice says there is more. Plain over small interfaces, so the tests run it on node:sqlite.
import { compactStep, createKeyIndex, keysFrom, topCursor } from './compact.ts';
import type { RelayStore, Sql } from './store.ts';

/** The part of a Durable Object's key-value storage this uses. */
export interface Kv {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<unknown>;
}

/**
 * Compaction steps per slice: 5,000 rows, under a second. Every request to the object waits for the slice running,
 * and ten steps took 6 to 8 seconds of wall time on the live relay, which hung sync and the Connect page.
 */
export const SLICE_STEPS = 1;

/** The pause between slices, so requests that queued behind one run before the next starts. */
export const SLICE_GAP_MS = 250;

export class Maintenance {
  /** Items with a newer row, kept between slices. Null after a restart: rebuilt from the saved cursor. */
  private seen: Set<string> | null = null;
  private running = false;
  private removed = 0;

  constructor(
    private readonly sql: Sql,
    private readonly kv: Kv,
    private readonly transaction: <T>(fn: () => T) => T,
    private readonly store: RelayStore,
    private readonly log: (line: string) => void = console.log,
  ) {}

  /** Nothing left to do, so no alarm is needed. Turns prune on when the log is already compact. */
  async done(): Promise<boolean> {
    if (!(await this.kv.get<boolean>('compacted'))) return false;
    if (!this.store.prune) {
      createKeyIndex(this.sql);
      this.store.prune = true;
    }
    return !!(await this.kv.get<boolean>('inline_moved'));
  }

  /**
   * One slice. True while there is more to do. Rows are deleted before anything is written, so it makes headway on
   * a database that is full. A slice already running makes this one a no-op.
   */
  async slice(steps = SLICE_STEPS): Promise<boolean> {
    if (this.running) return true;
    this.running = true;
    try {
      if (!(await this.kv.get<boolean>('compacted'))) {
        const saved = await this.kv.get<number>('compact_below');
        let below = saved ?? topCursor(this.sql);
        this.seen ??= saved === undefined ? new Set<string>() : keysFrom(this.sql, below);
        for (let i = 0; i < steps; i++) {
          const step = compactStep(this.sql, this.transaction, below, this.seen);
          this.removed += step.removed;
          if (step.next === null) {
            createKeyIndex(this.sql);
            await this.kv.put('compacted', true);
            await this.kv.delete('compact_below');
            this.seen = null;
            this.log(`[relay] change log compacted, ${this.removed} superseded rows removed since this object started`);
            break;
          }
          below = step.next;
          await this.kv.put('compact_below', below);
        }
        if (this.seen) {
          this.log(`[relay] compacting: down to seq ${below}, ${this.removed} superseded rows removed since this object started`);
          return true;
        }
      }
      if (!this.store.prune) {
        createKeyIndex(this.sql);
        this.store.prune = true;
      }
      if (!(await this.kv.get<boolean>('inline_moved'))) {
        const next = await this.store.moveInline((await this.kv.get<number>('inline_moved_to')) ?? 0);
        if (next !== null) {
          await this.kv.put('inline_moved_to', next);
          return true;
        }
        await this.kv.put('inline_moved', true);
        this.log('[relay] all change data is in R2');
      }
      return false;
    } finally {
      this.running = false;
    }
  }
}
