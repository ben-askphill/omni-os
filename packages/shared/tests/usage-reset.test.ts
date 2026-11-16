import { describe, expect, it } from 'vitest';
import { resetAt, resetAtShort, resetIn, resetMs, resetSentence } from '../usage-reset.ts';

// Local-time dates, so the tests hold in any timezone.
const now = new Date(2026, 10, 16, 12, 0, 0).getTime();
const secs = (d: Date) => d.getTime() / 1000;
const later = (ms: number) => (now + ms) / 1000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('resetIn', () => {
  it('counts minutes under an hour, rounded up', () => {
    expect(resetIn(later(45 * MIN), now)).toBe('45m');
    expect(resetIn(later(20_000), now)).toBe('1m');
    expect(resetIn(later(59 * MIN + 1), now)).toBe('1h');
  });

  it('counts hours and minutes under a day', () => {
    expect(resetIn(later(2 * HOUR + 10 * MIN), now)).toBe('2h 10m');
    expect(resetIn(later(5 * HOUR), now)).toBe('5h');
    expect(resetIn(later(2 * HOUR + 9 * MIN + 30_000), now)).toBe('2h 10m');
  });

  it('counts days and hours under a week, then whole days', () => {
    expect(resetIn(later(3 * DAY + 4 * HOUR), now)).toBe('3d 4h');
    expect(resetIn(later(DAY), now)).toBe('1d');
    expect(resetIn(later(12 * DAY + 5 * HOUR), now)).toBe('12d');
  });

  it('says nothing once the reset has passed', () => {
    expect(resetIn(later(0), now)).toBeNull();
    expect(resetIn(later(-HOUR), now)).toBeNull();
  });

  it('says nothing when the source sent no usable reset', () => {
    for (const v of [undefined, null, 0, -5, Number.NaN, Number.POSITIVE_INFINITY, '1790328600', {}]) expect(resetIn(v, now)).toBeNull();
  });
});

describe('resetAt', () => {
  it('names today and tomorrow by word, in local time', () => {
    expect(resetAt(secs(new Date(2026, 10, 16, 14, 20)), now)).toBe('today 14:20');
    expect(resetAt(secs(new Date(2026, 10, 17, 9, 5)), now)).toBe('tomorrow 09:05');
  });

  it('gives the weekday and date further out', () => {
    expect(resetAt(secs(new Date(2026, 10, 20, 9, 0)), now)).toBe('Fri 20 Nov, 09:00');
  });

  it('is null without a reset', () => {
    expect(resetAt(undefined, now)).toBeNull();
    expect(resetAt(0, now)).toBeNull();
  });
});

describe('resetAtShort', () => {
  it('gives the time today, the weekday this week, and the date further out', () => {
    expect(resetAtShort(secs(new Date(2026, 10, 16, 14, 20)), now)).toBe('at 14:20');
    expect(resetAtShort(secs(new Date(2026, 10, 20, 9, 0)), now)).toBe('Fri 09:00');
    expect(resetAtShort(secs(new Date(2026, 10, 28, 9, 0)), now)).toBe('28 Nov');
  });

  it('is null without a reset', () => {
    expect(resetAtShort(Number.NaN, now)).toBeNull();
  });
});

describe('resetSentence', () => {
  it('reads both the time left and the local time', () => {
    expect(resetSentence(secs(new Date(2026, 10, 16, 14, 10)), now)).toBe('Resets in 2h 10m, today 14:10.');
  });

  it('says a passed reset already happened', () => {
    expect(resetSentence(secs(new Date(2026, 10, 16, 11, 0)), now)).toBe('Reset today 11:00; these numbers are from before it.');
  });

  it('is null without a reset', () => {
    expect(resetSentence(undefined, now)).toBeNull();
  });
});

describe('resetMs', () => {
  it('turns epoch seconds into ms', () => {
    expect(resetMs(1790328600)).toBe(1790328600_000);
  });
});
