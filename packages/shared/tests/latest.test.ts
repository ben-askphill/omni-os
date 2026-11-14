import { describe, expect, it } from 'vitest';
import { latestOnly } from '../latest.ts';

describe('latestOnly', () => {
  it('applies a read nothing overtook', () => {
    const l = latestOnly();
    const t = l.begin();
    expect(l.holds(t)).toBe(true);
  });

  it('drops a read that started before a local edit', () => {
    const l = latestOnly();
    const t = l.begin();
    l.edit();
    expect(l.holds(t)).toBe(false);
    // A read that starts after the edit applies.
    expect(l.holds(l.begin())).toBe(true);
  });

  it('drops the older of two reads in flight', () => {
    const l = latestOnly();
    const older = l.begin();
    const newer = l.begin();
    expect(l.holds(older)).toBe(false);
    expect(l.holds(newer)).toBe(true);
  });
});
