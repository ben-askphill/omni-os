import { describe, expect, it } from 'vitest';
import { bytes, relTime } from '../format.ts';

describe('relTime', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('says just now under 45 seconds and minutes under an hour', () => {
    expect(relTime(ago(10_000), now)).toBe('just now');
    expect(relTime(ago(5 * 60_000), now)).toBe('5m ago');
  });

  it('is empty for a time it cannot read', () => {
    expect(relTime('not a date', now)).toBe('');
  });
});

describe('bytes', () => {
  it('scales to KB and MB', () => {
    expect(bytes(512)).toBe('512 B');
    expect(bytes(1536)).toBe('1.5 KB');
    expect(bytes(20 * 1024)).toBe('20 KB');
    expect(bytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
