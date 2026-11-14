import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Cron } from 'croner';
import { startRunner } from './runner-boot.ts';

// #679: a scheduled automation's `precheck` runs before any harness starts; a failure or timeout skips the run with a
// recorded reason and no thread. #680: a catch-up older than `catchup_max_age` is recorded as skipped instead of run.

process.env.SHELL = '/bin/sh';
const dir = mkdtempSync(join(tmpdir(), 'omni-precheck-'));
const out = join(dir, 'cwd.txt');
const r = await startRunner({ OMNI_AUTOMATIONS_DIR: dir });
const yaml = (extra: string) => `name: Nightly\nenabled: true\ncron: "0 2 * * *"\ntimezone: Europe/Amsterdam\nchannel: scratch\nprompt: tidy up\n${extra}`;
const write = (id: string, extra: string) => writeFileSync(join(dir, `${id}.yaml`), yaml(extra));
write('go', `precheck:\n  command: pwd > ${out}; exit 0\n`);
write('nothing', `precheck: echo "no open PRs" >&2; exit 3\n`);
write('slow', `precheck:\n  command: sleep 5\n  timeout: 0.5\n`);
write('stale', `catchup: true\ncatchup_max_age: 1h\n`);
write('fresh', `catchup: true\ncatchup_max_age: 6h\n`);
write('stale-check', `catchup: true\ncatchup_max_age: 6h\nprecheck: exit 1\n`);
const automations = await import('../automations.ts');
const { app } = await import('../app.ts');

const get = (id: string) => automations.loadAutomations().find((a) => a.id === id)!;
const runs = (id: string) =>
  r.db.db.prepare(`SELECT trigger, thread_id, skip_reason FROM automation_runs WHERE automation = ? ORDER BY id`).all(id) as any[];
const threadsOf = (id: string) => (r.db.db.prepare(`SELECT COUNT(*) AS n FROM threads WHERE automation = ?`).get(id) as any).n;
const slot = new Cron('0 2 * * *', { timezone: 'Europe/Amsterdam', paused: true }).previousRuns(1, new Date())[0];
const hoursAfterSlot = (h: number) => new Date(slot.getTime() + h * 3_600_000);

describe('parsing', () => {
  it('reads precheck as a string or { command, timeout }, 30s by default', () => {
    expect(automations.parseAutomation('x', 'cron: "0 2 * * *"\nprompt: p\nprecheck: exit 0').precheck).toEqual({ command: 'exit 0', timeout: 30 });
    expect(get('slow').precheck).toEqual({ command: 'sleep 5', timeout: 0.5 });
  });

  it('refuses a precheck without a command or with a bad timeout', () => {
    expect(automations.parseAutomation('x', 'cron: "0 2 * * *"\nprompt: p\nprecheck: { timeout: 5 }').error).toBe('precheck needs a command');
    expect(automations.parseAutomation('x', 'cron: "0 2 * * *"\nprompt: p\nprecheck: { command: x, timeout: -1 }').error).toMatch(/timeout/);
  });

  it('reads catchup_max_age as seconds or a duration', () => {
    expect(get('stale').catchupMaxAge).toBe(3600);
    expect(automations.parseAutomation('x', 'cron: "0 2 * * *"\nprompt: p\ncatchup_max_age: 90').catchupMaxAge).toBe(90);
    expect(automations.parseAutomation('x', 'cron: "0 2 * * *"\nprompt: p\ncatchup_max_age: 2d').catchupMaxAge).toBe(172_800);
    expect(automations.parseAutomation('x', 'cron: "0 2 * * *"\nprompt: p\ncatchup_max_age: soon').error).toMatch(/catchup_max_age/);
  });
});

describe('precheck', () => {
  it('exit 0 runs the automation, in the channel folder', async () => {
    expect(await automations.fireScheduled(get('go'))).not.toBeNull();
    expect(runs('go')).toEqual([expect.objectContaining({ trigger: 'cron', skip_reason: null })]);
    expect(threadsOf('go')).toBe(1);
    const channel = r.db.channels.get('scratch')!;
    expect(realpathSync(readFileSync(out, 'utf8').trim())).toBe(realpathSync((channel.repo_path ?? channel.base_dir)!));
  });

  it('a non-zero exit skips: a run with its reason, no thread', async () => {
    expect(await automations.fireScheduled(get('nothing'))).toBeNull();
    expect(runs('nothing')).toEqual([{ trigger: 'cron', thread_id: null, skip_reason: 'precheck exited 3: no open PRs' }]);
    expect(threadsOf('nothing')).toBe(0);
  });

  it('a timeout skips', async () => {
    expect(await automations.fireScheduled(get('slow'))).toBeNull();
    expect(runs('slow')).toEqual([{ trigger: 'cron', thread_id: null, skip_reason: 'precheck timed out after 0.5s' }]);
    expect(threadsOf('slow')).toBe(0);
  });

  it('Run now ignores it', async () => {
    expect(await automations.runAutomation(get('nothing'), 'manual')).not.toBeNull();
    expect(runs('nothing').map((x) => x.trigger)).toEqual(['cron', 'manual']);
  });

  it('a skipped run shows in the history the clients read', async () => {
    const list = (await (await app.request('/api/automations')).json()) as any[];
    const slow = list.find((a) => a.id === 'slow');
    expect(slow.runs[0]).toMatchObject({ thread_id: null, trigger: 'cron', status: 'skipped', skip_reason: 'precheck timed out after 0.5s' });
  });
});

describe('catchup_max_age', () => {
  it('a missed run older than the cap is recorded as skipped, once', async () => {
    expect(await automations.catchUp(get('stale'), hoursAfterSlot(3))).toBeNull();
    expect(runs('stale')).toEqual([{ trigger: 'catchup', thread_id: null, skip_reason: expect.stringMatching(/older than catchup_max_age \(1h\)$/) }]);
    expect(threadsOf('stale')).toBe(0);
    expect(await automations.catchUp(get('stale'), hoursAfterSlot(3))).toBeNull();
    expect(runs('stale')).toHaveLength(1);
  });

  it('a missed run within the cap fires once', async () => {
    expect(await automations.catchUp(get('fresh'), hoursAfterSlot(3))).not.toBeNull();
    expect(await automations.catchUp(get('fresh'), hoursAfterSlot(3))).toBeNull();
    expect(runs('fresh')).toEqual([expect.objectContaining({ trigger: 'catchup', skip_reason: null })]);
  });

  it('a catch-up runs the precheck too', async () => {
    expect(await automations.catchUp(get('stale-check'), hoursAfterSlot(3))).toBeNull();
    expect(runs('stale-check')).toEqual([{ trigger: 'catchup', thread_id: null, skip_reason: 'precheck exited 1' }]);
  });
});
