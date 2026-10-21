import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';
import type { PRInfo } from '../automation-events.ts';

// The event watcher against a real db and the fake claude CLI, with gh replaced by a list the test edits:
// the first poll only records, a failing push starts one run with the event in its prompt, the next poll does
// not start it again, and the API shows the watched repo and poll errors.

const dir = mkdtempSync(join(tmpdir(), 'omni-event-automations-'));
const r = await startRunner({ OMNI_AUTOMATIONS_DIR: dir });
writeFileSync(
  join(dir, 'fix-ci.yaml'),
  'name: Fix CI\nenabled: true\non: { event: pr_checks_failed, repo: o/r }\nchannel: scratch\nprompt: Fix the failing checks.\n',
);
writeFileSync(join(dir, 'no-repo.yaml'), 'name: No repo\nenabled: true\non: pr_opened\nchannel: scratch\nprompt: Look.\n');
const watch = await import('../automation-watch.ts');
const { app } = await import('../app.ts');

let prs: PRInfo[] = [];
let ghFails = false;
const started: { id: string; prompt: string; title: string }[] = [];
const deps: import('../automation-watch.ts').WatchDeps = {
  listPRs: async () => {
    if (ghFails) throw new Error('HTTP 502\nmore');
    return prs;
  },
  self: async () => 'omni-bot',
  start: async (a, prompt, title) => {
    started.push({ id: a.id, prompt, title });
    const { runAutomation } = await import('../automations.ts');
    return runAutomation(a, 'event', { prompt, title });
  },
};
const pr = (sha: string, failed: boolean): PRInfo => ({
  number: 12,
  title: 'Add thing',
  url: 'https://github.com/o/r/pull/12',
  headRefName: 'add-thing',
  headRefOid: sha,
  isDraft: false,
  statusCheckRollup: [{ name: 'test', conclusion: failed ? 'FAILURE' : 'SUCCESS' }],
});
const runs = () =>
  r.db.db.prepare(`SELECT r.trigger, t.title FROM automation_runs r JOIN threads t ON t.id = r.thread_id WHERE r.automation = 'fix-ci' ORDER BY r.id`).all();
const listed = async () => ((await (await app.request('/api/automations')).json()) as any[]).reduce((m, a) => ((m[a.id] = a), m), {} as any);

describe('event automations', () => {
  it('parse as event automations and are left off the cron schedule', async () => {
    const a = (await listed())['fix-ci'];
    expect(a.on).toEqual({ event: 'pr_checks_failed', repo: 'o/r', drafts: false });
    expect(a.next).toBeNull();
    expect(a.error).toBeUndefined();
    expect(a.repo).toBe('o/r');
  });

  it('the first poll records a PR that is already failing, without a run', async () => {
    prs = [pr('sha1', true)];
    expect(await watch.pollOnce(deps)).toBe(0);
    expect(runs()).toEqual([]);
  });

  it('a new failing push starts one run with the event in its prompt', async () => {
    prs = [pr('sha2', true)];
    expect(await watch.pollOnce(deps)).toBe(1);
    expect(runs()).toEqual([{ trigger: 'event', title: 'Fix CI · #12' }]);
    expect(started[0].prompt).toMatch(/^Fix the failing checks\.\n/);
    expect(started[0].prompt).toContain('When PR checks fail: o/r#12 "Add thing"');
  });

  it('the same failure does not start it again', async () => {
    expect(await watch.pollOnce(deps)).toBe(0);
    expect(runs()).toHaveLength(1);
  });

  it('shows why a poll failed, and clears it on the next good poll', async () => {
    ghFails = true;
    await watch.pollOnce(deps);
    expect((await listed())['fix-ci'].poll_error).toBe('gh pr list o/r failed: HTTP 502');
    ghFails = false;
    await watch.pollOnce(deps);
    expect((await listed())['fix-ci'].poll_error).toBeNull();
  });

  it('an automation with no repo to watch says so', async () => {
    const a = (await listed())['no-repo'];
    expect(a.repo).toBeNull();
    expect(a.poll_error).toMatch(/no repo to watch/);
  });

  it('Run now still works and runs the plain prompt', async () => {
    const res = await app.request('/api/automations/fix-ci/run', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(runs().map((x: any) => x.trigger)).toEqual(['event', 'manual']);
  });
});
