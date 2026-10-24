import { afterEach, describe, expect, it } from 'vitest';
import {
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  DEFAULT_CONCURRENCY,
  DEFAULT_MAX_AGE_MS,
  backoffMs,
  backoffUntil,
  clearBackoff,
  concurrencyOf,
  expiresAt,
  holdReason,
  isExpired,
  maxAgeMs,
  recordFailedStart,
  span,
} from '../delivery-policy.ts';

const T0 = Date.parse('2026-01-05T09:00:00.000Z');

describe('max age', () => {
  it('is a day unless the trigger says, and counts from when the event arrived', () => {
    expect(maxAgeMs(undefined)).toBe(DEFAULT_MAX_AGE_MS);
    expect(maxAgeMs({})).toBe(DEFAULT_MAX_AGE_MS);
    expect(maxAgeMs({ max_age: '15m' })).toBe(15 * 60_000);
    expect(maxAgeMs({ max_age: '2h' })).toBe(2 * 3_600_000);
    expect(expiresAt('2026-01-05T09:00:00.000Z', { max_age: '15m' }).toISOString()).toBe('2026-01-05T09:15:00.000Z');
  });

  it('an event is expired from the moment its age reaches the limit', () => {
    const on = { max_age: '15m' };
    expect(isExpired('2026-01-05T09:00:00.000Z', on, T0 + 15 * 60_000 - 1)).toBe(false);
    expect(isExpired('2026-01-05T09:00:00.000Z', on, T0 + 15 * 60_000)).toBe(true);
  });
});

describe('concurrency', () => {
  it('is two unless the trigger says, and never above the cap', () => {
    expect(concurrencyOf(undefined)).toBe(DEFAULT_CONCURRENCY);
    expect(concurrencyOf({ concurrency: 1 })).toBe(1);
    expect(concurrencyOf({ concurrency: 99 })).toBe(8);
  });
});

describe('span', () => {
  it('says how long, to the largest units', () => {
    expect(span(400)).toBe('1s');
    expect(span(45_000)).toBe('45s');
    expect(span(15 * 60_000)).toBe('15m');
    expect(span(2 * 3_600_000 + 5 * 60_000)).toBe('2h 5m');
    expect(span(12 * 3_600_000)).toBe('12h');
    expect(span(51 * 3_600_000)).toBe('2d 3h');
    expect(span(2 * 86_400_000)).toBe('2d');
  });
});

describe('backoff', () => {
  afterEach(() => clearBackoff('flaky'));

  it('doubles for each failure in a row, up to a cap', () => {
    expect(backoffMs(1)).toBe(BACKOFF_BASE_MS);
    expect(backoffMs(2)).toBe(2 * BACKOFF_BASE_MS);
    expect(backoffMs(3)).toBe(4 * BACKOFF_BASE_MS);
    expect(backoffMs(30)).toBe(BACKOFF_MAX_MS);
  });

  it('holds an automation after a failed start until the pause is over, and not another', () => {
    recordFailedStart('flaky', T0);
    expect(backoffUntil('flaky', T0 + 1)).toBe(T0 + BACKOFF_BASE_MS);
    expect(backoffUntil('other', T0 + 1)).toBeNull();
    expect(backoffUntil('flaky', T0 + BACKOFF_BASE_MS)).toBeNull();
    recordFailedStart('flaky', T0 + BACKOFF_BASE_MS);
    expect(backoffUntil('flaky', T0 + BACKOFF_BASE_MS + 1)).toBe(T0 + 3 * BACKOFF_BASE_MS);
  });

  it('clearing it, as a start that worked does, ends the pause and the count', () => {
    recordFailedStart('flaky', T0);
    recordFailedStart('flaky', T0);
    clearBackoff('flaky');
    expect(backoffUntil('flaky', T0 + 1)).toBeNull();
    recordFailedStart('flaky', T0);
    expect(backoffUntil('flaky', T0 + 1)).toBe(T0 + BACKOFF_BASE_MS);
  });
});

describe('holdReason', () => {
  afterEach(() => clearBackoff('flaky'));

  it('holds an automation at its limit of runs, and says so', () => {
    expect(holdReason('flaky', { concurrency: 2 }, 1, T0)).toBeNull();
    expect(holdReason('flaky', { concurrency: 2 }, 2, T0)).toBe('Waiting for a free slot: 2 of 2 runs are going');
    expect(holdReason('flaky', undefined, DEFAULT_CONCURRENCY, T0)).toMatch(/^Waiting for a free slot/);
  });

  it('holds it while it backs off, with the time left', () => {
    recordFailedStart('flaky', T0);
    expect(holdReason('flaky', undefined, 0, T0 + 1_000)).toBe('Backing off after a start that failed. Next try in 29s');
  });

  it('a retry by hand ignores the pause but not the limit on runs going', () => {
    recordFailedStart('flaky', T0);
    expect(holdReason('flaky', { concurrency: 1 }, 0, T0 + 1_000, true)).toBeNull();
    expect(holdReason('flaky', { concurrency: 1 }, 1, T0 + 1_000, true)).toBe('Waiting for a free slot: 1 of 1 runs are going');
  });
});
