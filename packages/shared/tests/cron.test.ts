import { describe, expect, it } from 'vitest';
import { describeCron } from '../cron.ts';

describe('describeCron', () => {
  it.each([
    ['*/15 * * * *', 'Every 15 minutes'],
    ['0 * * * *', 'Every hour'],
    ['5 * * * *', 'Every hour at :05'],
    ['0 */6 * * *', 'Every 6 hours'],
    ['30 9 * * *', 'Every day at 09:30'],
    ['0 9,17 * * *', 'Every day at 09:00, 17:00'],
    ['0 9 * * 1-5', 'Weekdays at 09:00'],
    ['0 10 * * 0,6', 'Weekends at 10:00'],
    ['0 8 * * 1,3', 'Mondays, Wednesdays at 08:00'],
    ['0 8 * * 7', 'Sundays at 08:00'],
    ['0 7 15 * *', 'Day 15 of every month at 07:00'],
  ])('reads %s as %s', (cron, label) => {
    expect(describeCron(cron)).toBe(label);
  });

  it('gives back an expression it cannot read', () => {
    for (const cron of ['@daily', '0 9 1 6 *', '* 9 * * *', '0 9-17 * * *', '0 9 * * MON']) expect(describeCron(cron)).toBe(cron);
  });
});
