import { describe, expect, it } from 'vitest';
import { untilLabel } from '../src/format.ts';

// How long until a usage window resets, on the Usage card and the Cursor month tooltip. The leftover minutes used to
// be rounded on their own, so 2h 59m 45s read "in 2h 60m".
describe('untilLabel', () => {
  const now = Date.parse('2026-11-19T12:00:00Z');
  const s = 1000;
  const m = 60 * s;
  const h = 60 * m;
  const at = (ms: number) => (now + ms) / 1000;

  it('splits whole minutes into hours and minutes, never 60m', () => {
    const cases: [number, string][] = [
      [0, 'now'],
      [-5 * s, 'now'],
      [10 * s, 'in 1m'],
      [5 * m, 'in 5m'],
      [59 * m + 29 * s, 'in 59m'],
      [59 * m + 30 * s, 'in 1h 0m'],
      [59 * m + 45 * s, 'in 1h 0m'],
      [59 * m + 50 * s, 'in 1h 0m'],
      [h, 'in 1h 0m'],
      [2 * h + 5 * m, 'in 2h 5m'],
      [2 * h + 59 * m + 29 * s, 'in 2h 59m'],
      [2 * h + 59 * m + 45 * s, 'in 3h 0m'],
      [23 * h + 59 * m + 29 * s, 'in 23h 59m'],
    ];
    for (const [ms, label] of cases) expect([ms, untilLabel(at(ms), now)]).toEqual([ms, label]);
  });

  it('names the day and time once it is a day or more away, including 23h 59m 45s', () => {
    for (const ms of [23 * h + 59 * m + 45 * s, 30 * h]) expect(untilLabel(at(ms), now)).not.toMatch(/^in /);
  });
});
