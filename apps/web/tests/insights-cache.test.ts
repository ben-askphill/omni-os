import { describe, expect, it } from 'vitest';
import { dayKey, type Insights } from '@omni/shared/insights.ts';
import { FRESH_MS, isFresh, keepInsights, keptInsights } from '../src/insights-cache.ts';

const answer = (complete = true, prs: Insights['prs'] = { open: 0, mine: null, withChecks: 0, mergedFromThreads: 0, top: [], failed: [] }) =>
  ({ range: '7d', usage: { complete }, prs }) as unknown as Insights;

describe('the Inbox dashboard cache', () => {
  it('hands back the last answer for a path, and nothing for another', () => {
    const kept = keepInsights('/insights?range=7d&tz=UTC', answer(), 1000);
    expect(keptInsights('/insights?range=7d&tz=UTC')).toBe(kept);
    expect(keptInsights('/insights?range=30d&tz=UTC')).toBeUndefined();
  });

  it('asks again once the answer is older than FRESH_MS', () => {
    const kept = keepInsights('/a', answer(), 0);
    expect(isFresh(kept, FRESH_MS - 1)).toBe(true);
    expect(isFresh(kept, FRESH_MS)).toBe(false);
    expect(isFresh(undefined, 0)).toBe(false);
  });

  it('never keeps a partial answer fresh, so the logs or GitHub fill in on the next open', () => {
    expect(isFresh(keepInsights('/b', answer(false), 0), 1)).toBe(false);
    expect(isFresh(keepInsights('/c', answer(true, null), 0), 1)).toBe(false);
  });
});

describe('dayKey', () => {
  it('keeps each zone apart while reusing its formatter', () => {
    const late = Date.UTC(2026, 10, 12, 23, 30);
    expect([dayKey(late, 'UTC'), dayKey(late, 'Europe/Amsterdam'), dayKey(late, 'America/Los_Angeles'), dayKey(late, 'UTC')]).toEqual([
      '2026-11-12',
      '2026-11-13',
      '2026-11-12',
      '2026-11-12',
    ]);
  });
});
