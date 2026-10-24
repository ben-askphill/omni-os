import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tailId } from '@omni/shared/history.ts';
import { classifyStream } from '../src/api.ts';

// The thread stream as the server records it for the Mac app (apps/server/tests/mac-fixtures.test.ts), read the way
// useThreadStream reads it. Each connect ends its catch-up with one sync (#224).

const FIXTURES = join(resolve(import.meta.dirname, '../..'), 'mac', 'OmniKit', 'Tests', 'OmniKitTests', 'Fixtures');

/** The data frames of an SSE file, with their ids. */
function frames(name: string): { id?: string; data: unknown }[] {
  return readFileSync(join(FIXTURES, name), 'utf8')
    .split('\n\n')
    .map((block) => {
      const lines = block.split('\n');
      const data = lines.find((l) => l.startsWith('data: '))?.slice(6);
      const id = lines.find((l) => l.startsWith('id: '))?.slice(4);
      return { id, data: data ? (JSON.parse(data) as unknown) : undefined };
    })
    .filter((f) => f.data !== undefined);
}

const syncOf = (name: string) => {
  const f = frames(name).find((x) => (x.data as { kind?: string }).kind === 'sync')!;
  return { id: f.id, m: classifyStream(f.data) };
};

describe('thread stream sync', () => {
  it('reads a replay sync as the detail with no rows, after the replayed rows', () => {
    const all = frames('thread-stream.sse').map((f) => classifyStream(f.data));
    const { m } = syncOf('thread-stream.sse');
    expect(m?.type).toBe('sync');
    if (m?.type !== 'sync') return;
    expect(m.snapshot).toBe(false);
    expect(m.detail.events).toEqual([]);
    expect(m.detail.thread.id).toBe('00000000-0000-4000-8000-000000000001');
    expect(Array.isArray(m.detail.artifacts)).toBe(true);
    expect(all.filter((x) => x?.type === 'sync')).toHaveLength(1);
    expect(all.some((x) => x?.type === 'event')).toBe(true);
  });

  it('reads a snapshot sync as the newest page, whose last row is the id the stream resumes after', () => {
    const { id, m } = syncOf('thread-stream-snapshot.sse');
    expect(m?.type).toBe('sync');
    if (m?.type !== 'sync') return;
    expect(m.snapshot).toBe(true);
    expect(m.detail.history).toEqual({ from: 16, to: null, results_below: 2 });
    expect(m.detail.events.length).toBeGreaterThan(0);
    expect(tailId({ rows: m.detail.events })).toBe(Number(id));
  });

  it('takes a sync with no page as a replay, and one without rows as empty', () => {
    const thread = { id: 't' };
    expect(classifyStream({ kind: 'sync', catch_up: 'snapshot', thread })).toMatchObject({ type: 'sync', snapshot: false, detail: { events: [] } });
    expect(classifyStream({ kind: 'sync', catch_up: 'replay', thread })).toMatchObject({ type: 'sync', snapshot: false });
    expect(classifyStream({ kind: 'sync', catch_up: 'replay' })).toBeNull();
  });
});
