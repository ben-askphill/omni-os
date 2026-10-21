import { describe, expect, it } from 'vitest';
import { monthlyTitle } from '../src/format.ts';

describe('monthlyTitle', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  const m = { utilization: 0.4308, resetsAt: Date.parse('2026-10-24T13:37:09Z') / 1000, auto: 0.3949, api: 0.8231, spendCents: 56_436, includedCents: 7000 };

  it('names the percent, both buckets, the spend and the reset date', () => {
    expect(monthlyTitle('Cursor', m, now)).toBe('Cursor month: 43% of included usage (Auto 39%, API 82%). $564.36 spent, $70.00 included. Resets 24 Oct (in 3d).');
  });

  it('leaves out what Cursor did not send, and counts the last day in hours', () => {
    const soon = { utilization: 1, resetsAt: now / 1000 + 5 * 3600 };
    expect(monthlyTitle('Cursor', soon, now)).toMatch(/^Cursor month: 100% of included usage\. Resets \d+ \w+ \(in 5h 0m\)\.$/);
  });
});
