import { describe, expect, it } from 'vitest';
import { api, at } from './api-helpers.ts';

describe('activity', () => {
  it('reads the latest threads, 60 unless asked for another count', async () => {
    const rows = [{ id: 't1', status: 'running' }];
    const { sent, api: a } = api({ json: rows });
    expect(await a.recent()).toEqual(rows);
    await a.recent(5);
    expect(sent).toEqual([
      { method: 'GET', url: at('/recent?limit=60') },
      { method: 'GET', url: at('/recent?limit=5') },
    ]);
  });

  it('reads the pinned threads', async () => {
    const pins = [{ id: 't1', pinned_at: '2026-11-02T08:00:00Z' }];
    const { sent, api: a } = api({ json: pins });
    expect(await a.pinned()).toEqual(pins);
    expect(sent).toEqual([{ method: 'GET', url: at('/pinned') }]);
  });

  it('reads plan usage off the server status', async () => {
    const status = { usage: { 'claude-code': { five_hour: { utilization: 42, resetsAt: 1 } } }, running: 1 };
    const { sent, api: a } = api({ json: status });
    expect((await a.status()).usage['claude-code']?.five_hour?.utilization).toBe(42);
    expect(sent).toEqual([{ method: 'GET', url: at('/status') }]);
  });
});
