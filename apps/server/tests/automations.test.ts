import { describe, it, expect, vi } from 'vitest';

// automations.ts imports runner.ts (which imports db.ts). Mock both so nothing opens data/omni.db.
vi.mock('../runner.ts', () => ({ createThread: vi.fn() }));
vi.mock('../db.ts', () => ({ db: { prepare: vi.fn() } }));

import { join } from 'node:path';
import { parseAutomation } from '../automations.ts';
import { config, paths, ROOT } from '../config.ts';
import { yamlFiles } from '../automation-store.ts';

const valid = `
name: Daily digest
enabled: true
cron: "0 8 * * 1-5"
timezone: Europe/Amsterdam
channel: inbox
role: inbox
model: sonnet
prompt: |
  Sum up yesterday.
`;

describe('parseAutomation', () => {
  it('parses a valid automation and computes the next run', () => {
    const a = parseAutomation('daily-digest', valid, '/x/daily-digest.yaml');
    expect(a).toMatchObject({
      id: 'daily-digest',
      name: 'Daily digest',
      cron: '0 8 * * 1-5',
      timezone: 'Europe/Amsterdam',
      channel: 'inbox',
      role: 'inbox',
      model: 'sonnet',
      prompt: 'Sum up yesterday.',
      enabled: true,
      file: '/x/daily-digest.yaml',
    });
    expect(a.error).toBeUndefined();
    const next = new Date(a.next!);
    expect(next.getTime()).toBeGreaterThan(Date.now());
    // 08:00 Amsterdam is 06:00 or 07:00 UTC depending on DST, on a weekday.
    expect([6, 7]).toContain(next.getUTCHours());
    expect(next.getUTCMinutes()).toBe(0);
    expect([1, 2, 3, 4, 5]).toContain(next.getUTCDay());
  });

  it('defaults name, channel, timezone and enabled', () => {
    const a = parseAutomation('nightly', 'cron: "0 2 * * *"\nprompt: do it\n');
    expect(a.name).toBe('nightly');
    expect(a.channel).toBe('inbox');
    expect(a.timezone).toBe(config.timezone);
    expect(a.timezone).toBe('Europe/Amsterdam');
    expect(a.enabled).toBe(false);
    expect(a.error).toBeUndefined();
    expect(a.next).toBeTruthy();
  });

  it('only enables on a literal true', () => {
    expect(parseAutomation('x', 'cron: "* * * * *"\nprompt: p\nenabled: "yes"').enabled).toBe(false);
    expect(parseAutomation('x', 'cron: "* * * * *"\nprompt: p\nenabled: true').enabled).toBe(true);
  });

  it('flags a missing cron', () => {
    const a = parseAutomation('x', 'prompt: hello');
    expect(a.error).toBe('missing cron');
    expect(a.next).toBeUndefined();
  });

  it('reports missing cron before missing prompt', () => {
    expect(parseAutomation('x', 'name: nothing').error).toBe('missing cron');
  });

  it('flags a bad cron expression', () => {
    expect(parseAutomation('x', 'cron: "not a cron"\nprompt: p').error).toMatch(/^invalid schedule/);
    expect(parseAutomation('x', 'cron: "61 * * * *"\nprompt: p').error).toMatch(/^invalid schedule.*minute/);
  });

  it('flags a missing or blank prompt', () => {
    expect(parseAutomation('x', 'cron: "0 8 * * *"').error).toBe('missing prompt');
    expect(parseAutomation('x', 'cron: "0 8 * * *"\nprompt: "   "').error).toBe('missing prompt');
  });

  it('coerces numeric cron/prompt values to strings', () => {
    const a = parseAutomation('x', 'cron: 5\nprompt: 7');
    expect(a.cron).toBe('5');
    expect(a.prompt).toBe('7');
    expect(a.error).toMatch(/^invalid schedule/);
  });

  it('survives an empty file and non-mapping YAML', () => {
    expect(parseAutomation('x', '').error).toBe('missing cron');
    expect(parseAutomation('x', '- a\n- b').error).toBe('missing cron');
  });

  it('reports an invalid timezone as an error instead of throwing', () => {
    const a = parseAutomation('x', 'cron: "0 8 * * *"\ntimezone: Mars/Base\nprompt: p');
    expect(a.error).toMatch(/timezone/i);
  });

  // A half-saved automations/*.yaml must surface as an error, not crash the file-watch timer.
  it('returns an error instead of throwing on malformed YAML', () => {
    const a = parseAutomation('x', 'cron: [unclosed\nprompt: p');
    expect(a.error).toMatch(/yaml/i);
    expect(a.enabled).toBe(false);
  });

  it('parses an event automation: on instead of cron, no next run', () => {
    const a = parseAutomation('fix-ci', 'enabled: true\non: pr_checks_failed\nchannel: acme\nprompt: Fix it.');
    expect(a.on).toEqual({ event: 'pr_checks_failed', drafts: false });
    expect(a.cron).toBe('');
    expect(a.next).toBeNull();
    expect(a.error).toBeUndefined();
  });

  it('rejects an unknown event, and cron with on', () => {
    expect(parseAutomation('x', 'on: push\nprompt: p').error).toMatch(/invalid "on": unknown event "push"/);
    expect(parseAutomation('x', 'on: pr_opened\ncron: "0 8 * * *"\nprompt: p').error).toBe('set either cron or on, not both');
    expect(parseAutomation('x', 'on: pr_opened').error).toBe('missing prompt');
  });
});

// A fresh install starts with no automations: nothing in the repo's automations/ loads for everyone.
// apps/desktop/tests/stage.test.ts checks the app does not ship the folder either.
describe('shared automations', () => {
  it('ships none', () => {
    expect(paths.automations).toBe(join(ROOT, 'automations'));
    expect(yamlFiles(paths.automations)).toEqual([]);
  });
});
