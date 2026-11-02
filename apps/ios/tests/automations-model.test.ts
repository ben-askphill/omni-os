import type { Automation } from '@omni/client-core';
import { describe, expect, it } from 'vitest';

import { automationRows, nextRunLabel, triggerLabel, withEnabled } from '../src/settings/automations-model';

const NOW = Date.parse('2026-11-02T08:00:00Z');

function automation(over: Partial<Automation> = {}): Automation {
  return { id: 'daily', name: 'Daily digest', cron: '0 9 * * *', timezone: 'UTC', channel: 'general', enabled: true, ...over };
}

describe('triggerLabel', () => {
  it('describes a schedule', () => {
    expect(triggerLabel(automation({ cron: '0 9 * * 1-5' }))).toBe('Weekdays at 09:00');
  });

  it('describes each event in words', () => {
    const label = (event: string) => triggerLabel(automation({ cron: '', on: { event } }));
    expect(label('pr_opened')).toBe('When a PR opens');
    expect(label('pr_checks_failed')).toBe('When PR checks fail');
    expect(label('pr_conflict')).toBe('When a PR has conflicts');
    expect(label('pr_review')).toBe('When a PR gets review comments');
    expect(label('artifact_published')).toBe('When a page is published');
    expect(label('github_webhook')).toBe('When GitHub sends a webhook');
  });

  it('shows an event it does not know as the server sent it', () => {
    expect(triggerLabel(automation({ cron: '', on: { event: 'deploy_failed' } }))).toBe('deploy_failed');
  });
});

describe('nextRunLabel', () => {
  it('says Today and Tomorrow by the automation timezone calendar', () => {
    expect(nextRunLabel('2026-11-02T09:00:00Z', 'UTC', NOW)).toBe('Today 09:00');
    expect(nextRunLabel('2026-11-03T09:00:00Z', 'UTC', NOW)).toBe('Tomorrow 09:00');
  });

  it('names the weekday and date from the day after tomorrow', () => {
    expect(nextRunLabel('2026-11-06T09:05:00Z', 'UTC', NOW)).toBe('Fri 6 Nov, 09:05');
  });

  it('reads the time on the clock of the automation timezone', () => {
    expect(nextRunLabel('2026-11-02T09:00:00Z', 'America/New_York', NOW)).toBe('Today 04:00');
  });

  it('counts the day in that timezone, not in UTC', () => {
    const lateUtc = Date.parse('2026-11-02T23:30:00Z');
    expect(nextRunLabel('2026-11-03T00:30:00Z', 'UTC', lateUtc)).toBe('Tomorrow 00:30');
    expect(nextRunLabel('2026-11-03T00:30:00Z', 'Asia/Tokyo', lateUtc)).toBe('Today 09:30');
  });

  it('writes midnight as 00:00', () => {
    expect(nextRunLabel('2026-11-03T00:00:00Z', 'UTC', NOW)).toBe('Tomorrow 00:00');
  });

  it('reads an invalid timezone as UTC', () => {
    expect(nextRunLabel('2026-11-02T09:00:00Z', 'Mars/Olympus', NOW)).toBe('Today 09:00');
    expect(nextRunLabel('2026-11-02T09:00:00Z', 'Asia/Tokyo', NOW)).toBe('Today 18:00');
  });

  it('is empty for a time it cannot read', () => {
    expect(nextRunLabel('soon', 'UTC', NOW)).toBe('');
  });
});

describe('automationRows', () => {
  it('shows the schedule, the channel and the next run of an enabled automation', () => {
    const [row] = automationRows([automation({ next: '2026-11-02T09:00:00Z' })], NOW);
    expect(row).toMatchObject({ id: 'daily', name: 'Daily digest', enabled: true, invalid: false, switchLabel: 'Pause Daily digest' });
    expect(row.detail).toBe('Every day at 09:00 · #general\nNext Today 09:00');
  });

  it('shows no next line for an enabled automation without a next run', () => {
    const [event] = automationRows([automation({ cron: '', on: { event: 'pr_opened' }, next: null })], NOW);
    expect(event.detail).toBe('When a PR opens · #general');
  });

  it('shows Paused instead of the next run for a paused automation', () => {
    const [row] = automationRows([automation({ enabled: false, next: '2026-11-02T09:00:00Z' })], NOW);
    expect(row.detail).toBe('Every day at 09:00 · #general\nPaused');
    expect(row.switchLabel).toBe('Enable Daily digest');
    expect(row.invalid).toBe(false);
  });

  it('shows Invalid and the reason for an automation that cannot run', () => {
    const [row] = automationRows([automation({ error: 'Unknown model "gpt-9"', next: '2026-11-02T09:00:00Z' })], NOW);
    expect(row.invalid).toBe(true);
    expect(row.detail).toBe('Every day at 09:00 · #general\nInvalid: Unknown model "gpt-9"');
  });

  it('keeps the server order', () => {
    const rows = automationRows([automation({ id: 'b', name: 'B' }), automation({ id: 'a', name: 'A' })], NOW);
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('withEnabled', () => {
  const list = [automation({ id: 'a' }), automation({ id: 'b', enabled: false })];

  it('switches only the named automation and leaves the input alone', () => {
    const next = withEnabled(list, 'a', false);
    expect(next.map((a) => a.enabled)).toEqual([false, false]);
    expect(list[0].enabled).toBe(true);
    expect(withEnabled(list, 'b', true).map((a) => a.enabled)).toEqual([true, true]);
  });

  it('changes nothing for an id that is not there', () => {
    expect(withEnabled(list, 'zzz', false)).toEqual(list);
  });
});
