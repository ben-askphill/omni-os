import { describe, expect, it } from 'vitest';
import { blankDraft, draftOf, draftProblem, fieldsOf } from '../src/automation-draft.ts';

// The Automations editor's form, to and from the fields PUT /api/automations/:id takes.

const base = { name: 'Fix CI', enabled: true, channel: 'acme', prompt: 'Fix it.' };

describe('automation draft', () => {
  it('a schedule round-trips, and an event drops the schedule keys', () => {
    const d = draftOf({ ...base, cron: '0 8 * * 1-5', timezone: 'Europe/Amsterdam', catchup: true }, null, 'mac-a');
    expect(d.trigger).toBe('schedule');
    expect(fieldsOf(d)).toMatchObject({ cron: '0 8 * * 1-5', timezone: 'Europe/Amsterdam', catchup: true });
    const ev = fieldsOf({ ...d, trigger: 'event', event: 'pr_checks_failed', repo: 'acme/shop', drafts: true });
    expect(ev).toMatchObject({ cron: '', timezone: '', catchup: false, on: { event: 'pr_checks_failed', repo: 'acme/shop', drafts: true } });
  });

  it('reads an `on:` block, a bare event name included, and writes back only what its event takes', () => {
    const d = draftOf({ ...base, on: { event: 'github_webhook', repo: 'acme/shop', events: ['workflow_run'], trust: 'any', concurrency: 1 } }, null, null);
    expect(d).toMatchObject({ trigger: 'event', event: 'github_webhook', webhookEvents: ['workflow_run'], trustAny: true, concurrency: '1' });
    expect(fieldsOf({ ...d, channels: ['ops'], drafts: true }).on).toEqual({ event: 'github_webhook', repo: 'acme/shop', events: ['workflow_run'], trust: 'any', concurrency: 1 });
    expect(draftOf({ ...base, on: 'artifact_published' }, null, null).event).toBe('artifact_published');
  });

  it('maps the machine: this one as here, another by id, an unknown name as written', () => {
    expect(draftOf({ ...base, cron: '0 8 * * *', machine: 'omarchy' }, 'mac-a', 'mac-a').machine).toBe('here');
    expect(draftOf({ ...base, cron: '0 8 * * *', machine: 'MacBook' }, 'mac-b', 'mac-a').machine).toBe('mac-b');
    expect(draftOf({ ...base, cron: '0 8 * * *', machine: 'toaster' }, null, 'mac-a').machine).toBe('toaster');
    expect(draftOf({ ...base, cron: '0 8 * * *' }, null, 'mac-a').machine).toBe('');
  });

  it('a model without a harness, or an effort without a model, is not sent', () => {
    expect(fieldsOf({ ...blankDraft(), name: 'x', prompt: 'y', model: 'opus', effort: 'high' })).toMatchObject({ harness: '', model: '', effort: '' });
  });

  it('says what is missing before saving', () => {
    expect(draftProblem(blankDraft())).toMatch(/name/);
    expect(draftProblem({ ...blankDraft(), name: 'x', prompt: 'y', cron: '0 8 *' })).toMatch(/five cron fields/);
    expect(draftProblem({ ...blankDraft(), name: 'x', prompt: 'y', trigger: 'event', event: 'github_webhook' })).toMatch(/owner\/name/);
    expect(draftProblem({ ...blankDraft(), name: 'x', prompt: 'y' })).toBeNull();
  });
});
