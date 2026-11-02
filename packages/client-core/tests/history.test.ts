import { describe, expect, it } from 'vitest';
import { ThreadHistory } from '../src/history.ts';

const row = (id: number) => ({ id, kind: 'message', payload: '{}', created_at: '' });

describe('thread history', () => {
  it('deduplicates and sorts replayed and out-of-order events without rewinding the cursor', () => {
    const history = new ThreadHistory();
    history.open({ events: [row(10)], history: { from: 10, to: null, results_below: 0 } });
    history.append([row(15), row(12), row(15)]);
    expect(history.history.rows.map(r => r.id)).toEqual([10, 12, 15]);
    expect(history.after).toBe(15);
  });

  it('preserves the gap when a reconnect receives a snapshot, then pages it', async () => {
    const history = new ThreadHistory();
    history.open({ events: [row(10)], history: { from: 10, to: null, results_below: 0 } });
    history.snapshot({ events: [row(30)], history: { from: 30, to: null, results_below: 0 } });
    expect(history.history.spans).toEqual([{ from: 10, to: 11 }, { from: 30, to: null }]);
    expect(history.after).toBe(30);
    await history.page({ take: 'oldest', after: 10, before: 30 }, async query => {
      expect(query).toBe('take=oldest&after=10&before=30');
      return { events: [row(20)], span: { from: 11, to: 30 } };
    });
    expect(history.history.spans).toEqual([{ from: 10, to: null }]);
    expect(history.history.rows.map(r => r.id)).toEqual([10, 20, 30]);
    expect(history.after).toBe(30);
  });
});
