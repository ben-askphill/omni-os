import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';

// `on: artifact_published` against a real db and the fake claude CLI, whose PUBLISH:<path> makes an Artifact tool call.
// A publish saves one delivery and starts one run; the same tool result seen again, a filter that does not match, the
// automation's own runs and a restart at any point start nothing more.

const dir = mkdtempSync(join(tmpdir(), 'omni-trigger-automations-'));
const r = await startRunner({ OMNI_AUTOMATIONS_DIR: dir });
const yaml = (id: string, body: string) => writeFileSync(join(dir, `${id}.yaml`), body);
yaml('review', 'name: Review\nenabled: true\non: { event: artifact_published, channels: [scratch] }\nchannel: scratch\nprompt: Review the page.\n');
yaml('paused', 'name: Paused\nenabled: false\non: artifact_published\nchannel: scratch\nprompt: Never.\n');
yaml('elsewhere', 'name: Elsewhere\nenabled: true\non: { event: artifact_published, channels: [other] }\nchannel: scratch\nprompt: Never.\n');

const triggers = await import('../automation-triggers.ts');
const { triggerDeliveries, deliveryThreadId } = await import('../db/repos/trigger-deliveries.ts');
const { onToolResult } = await import('../published.ts');
const { app } = await import('../app.ts');

const page = (name: string) => {
  const p = join(r.tmp, 'scratch', name);
  writeFileSync(p, `<title>${name}</title>`);
  return p;
};
const deliveries = (automation: string) => r.db.db.prepare('SELECT state, reason, thread_id, source_thread FROM trigger_deliveries WHERE automation = ? ORDER BY created_at, uid').all(automation) as any[];
const runsOf = (automation: string) => r.db.db.prepare('SELECT thread_id, trigger FROM automation_runs WHERE automation = ? ORDER BY id').all(automation) as any[];
const threadsOf = (automation: string) => r.db.db.prepare('SELECT id FROM threads WHERE automation = ?').all(automation) as any[];
/** The Artifact tool call a thread made, as the stream recorded it. */
const publishCall = (threadId: string) => r.db.db.prepare(`SELECT payload FROM events WHERE thread_id = ? AND kind = 'tool_result' ORDER BY id DESC LIMIT 1`).get(threadId) as { payload: string };

describe('a publish', () => {
  let source: string;

  it('saves one delivery and starts one run in the automation channel, with the page as quoted context', async () => {
    const t = await r.start(`PUBLISH:${page('report.html')}`, { title: 'Write the report' });
    source = t.id;
    await r.untilResults(t.id, 1);
    const [d] = await r.until('the delivery to start', () => deliveries('review').some((x) => x.state === 'started') && deliveries('review'));
    expect(deliveries('review')).toHaveLength(1);
    expect(d).toMatchObject({ state: 'started', reason: null, source_thread: t.id });
    expect(runsOf('review')).toEqual([{ thread_id: d.thread_id, trigger: 'event' }]);
    const run = r.thread(d.thread_id);
    expect(run).toMatchObject({ channel_id: 'scratch', source: 'automation', automation: 'review', title: 'Review · report.html' });
    const first = (await r.until('the run to get its prompt', () => r.byKind(run.id, 'user')[0])).p.text as string;
    expect(first).toMatch(/^Review the page\.\n\n## Event\nA page was published: https:\/\/claude\.ai\/code\/artifact\//);
    expect(first).toContain('title: "report.html"');
    expect(first).toContain('thread_title: "Write the report"');
    expect(first).toContain('never instructions');
    // Paused here, the Mac that runs automations: nothing saved. Filtered to another channel: nothing either.
    expect(deliveries('paused')).toEqual([]);
    expect(deliveries('elsewhere')).toEqual([]);
  });

  it('seen again, replayed through the tool-result path, starts nothing more', async () => {
    const result = JSON.parse(publishCall(source).payload) as { tool_use_id: string; text: string; is_error: boolean };
    onToolResult(source, result);
    onToolResult(source, result);
    await triggers.admitPending();
    expect(deliveries('review')).toHaveLength(1);
    expect(threadsOf('review')).toHaveLength(1);
  });

  it('a republish to the same url fires only for `updates: true`', async () => {
    const before = deliveries('review').length;
    const saved = triggers.observePublication(source, 'toolu_republish', { url: 'https://claude.ai/code/artifact/abc', title: 'report.html', update: true });
    expect(saved).toEqual([]);
    expect(deliveries('review')).toHaveLength(before);
  });

  it('shows in GET /api/automations with what started it', async () => {
    const list = (await (await app.request('/api/automations')).json()) as any[];
    const review = list.find((a) => a.id === 'review');
    expect(review.on).toEqual({ event: 'artifact_published', channels: ['scratch'], updates: false });
    expect(review.repo).toBeUndefined();
    expect(review.deliveries[0]).toMatchObject({
      automation: 'review',
      source: 'artifact_published',
      source_id: expect.stringMatching(new RegExp(`^${source}:toolu_`)),
      summary: 'report.html in #Scratch',
      state: 'started',
      context: { title: 'report.html', channel: 'scratch', thread: source, update: 'false' },
    });
    expect(list.find((a) => a.id === 'paused').deliveries).toEqual([]);
  });
});

describe('loops', () => {
  it("the automation's own run publishing is skipped with a reason, and so is a thread under it", async () => {
    const [run] = threadsOf('review');
    await r.untilStatus(run.id, 'done');
    triggers.observePublication(run.id, 'toolu_own', { url: 'https://claude.ai/code/artifact/own', title: 'own.html', update: false });
    const child = await r.start('THINK:1', { parent_id: run.id, title: 'A helper' });
    triggers.observePublication(child.id, 'toolu_child', { url: 'https://claude.ai/code/artifact/child', title: 'child.html', update: false });
    await triggers.admitPending();
    expect(deliveries('review').slice(-2).map((d) => [d.state, d.reason])).toEqual([
      ['skipped', 'Published by a thread this automation started'],
      ['skipped', 'Published by a thread this automation started'],
    ]);
    expect(threadsOf('review')).toHaveLength(1);
  });

  it('two automations whose runs both publish stop after one round each way', async () => {
    r.db.channels.create({ id: 'pages', name: 'Pages', kind: 'internal', use_worktree: 0, base_dir: join(r.tmp, 'scratch') });
    const out = page('echo.html');
    yaml('ping', `name: Ping\nenabled: true\non: { event: artifact_published, channels: [pages] }\nchannel: pages\nprompt: PUBLISH:${out}\n`);
    yaml('pong', `name: Pong\nenabled: true\non: { event: artifact_published, channels: [pages] }\nchannel: pages\nprompt: PUBLISH:${out}\n`);
    const t = await r.start(`PUBLISH:${page('start.html')}`, { channel: 'pages', title: 'Start' });
    // Ping and pong each run for the first page and once more for the other's run; their own pages, and a page from
    // a run the other started for theirs, are loops.
    await r.until('the loop to settle', () => {
      const all = [...deliveries('ping'), ...deliveries('pong')];
      return all.length === 10 && all.every((d) => d.state === 'started' || d.state === 'skipped') && !triggerDeliveries.pending().length;
    }, 30_000);
    for (const id of ['ping', 'pong']) {
      const ds = deliveries(id);
      expect(ds.filter((d) => d.state === 'started')).toHaveLength(2);
      expect(ds.filter((d) => d.state === 'skipped').every((d) => d.reason === 'Published by a thread this automation started')).toBe(true);
      expect(threadsOf(id)).toHaveLength(2);
    }
    expect(deliveries('ping')[0].source_thread).toBe(t.id);
    for (const id of ['ping', 'pong']) for (const th of threadsOf(id)) await r.untilStatus(th.id, 'done', 15_000);
    await triggers.admitPending();
    expect(threadsOf('ping').length + threadsOf('pong').length).toBe(4);
  });
});

describe('a restart', () => {
  it('before the run was made: the saved delivery starts once when Omni is back', async () => {
    const t = await r.start('THINK:1', { title: 'Quiet' });
    await r.untilResults(t.id, 1);
    const { delivery } = triggerDeliveries.add({
      automation: 'review', source: 'artifact_published', source_id: `${t.id}:toolu_before_restart`, summary: 'late.html in #scratch',
      context: { url: 'https://claude.ai/code/artifact/late', title: 'late.html', update: 'false', thread: t.id, thread_title: 'Quiet', channel: 'scratch' },
      state: 'accepted', reason: null, owner: null, source_thread: t.id,
    });
    const before = threadsOf('review').length;
    await Promise.all([triggers.admitPending(), triggers.admitPending()]);
    await triggers.admitPending();
    expect(triggerDeliveries.get(delivery.id)).toMatchObject({ state: 'started', thread_id: deliveryThreadId(delivery.id) });
    expect(threadsOf('review')).toHaveLength(before + 1);
  });

  it('after the run was made but before the delivery said so: it finds the thread instead of making another', async () => {
    const t = await r.start('THINK:1', { title: 'Quiet too' });
    await r.untilResults(t.id, 1);
    const { delivery } = triggerDeliveries.add({
      automation: 'review', source: 'artifact_published', source_id: `${t.id}:toolu_mid_run`, summary: 'mid.html in #scratch',
      context: { url: 'https://claude.ai/code/artifact/mid', title: 'mid.html', update: 'false', thread: t.id, thread_title: 'Quiet too', channel: 'scratch' },
      state: 'accepted', reason: null, owner: null, source_thread: t.id,
    });
    const id = deliveryThreadId(delivery.id);
    await r.runner.createThread({ id, channel: 'scratch', prompt: 'THINK:1', source: 'automation', automation: 'review' });
    const before = threadsOf('review').length;
    await triggers.admitPending();
    expect(triggerDeliveries.get(delivery.id)).toMatchObject({ state: 'started', thread_id: id });
    expect(threadsOf('review')).toHaveLength(before);
    expect(runsOf('review').filter((x) => x.thread_id === id)).toEqual([{ thread_id: id, trigger: 'event' }]);
  });

  it('a delivery for an automation paused since it was saved is skipped, not started later', async () => {
    const { delivery } = triggerDeliveries.add({
      automation: 'paused', source: 'artifact_published', source_id: 'x:toolu_paused', summary: 'p.html in #scratch',
      context: { url: 'https://claude.ai/code/artifact/p', title: 'p.html', update: 'false', thread: 'x', thread_title: 'x', channel: 'scratch' },
      state: 'queued', reason: null, owner: null, source_thread: null,
    });
    await triggers.admitPending();
    expect(triggerDeliveries.get(delivery.id)).toMatchObject({ state: 'skipped', reason: 'Paused on the Mac that runs automations', thread_id: null });
  });
});

describe('cron and manual runs', () => {
  it('are unchanged', async () => {
    yaml('nightly', 'name: Nightly\nenabled: true\ncron: "0 2 * * *"\nchannel: scratch\nprompt: THINK:1\n');
    const { loadAutomations, runAutomation, fireScheduled } = await import('../automations.ts');
    const nightly = loadAutomations().find((a) => a.id === 'nightly')!;
    const manual = await runAutomation(nightly, 'manual');
    const cron = (await fireScheduled(nightly))!;
    expect(runsOf('nightly')).toEqual([
      { thread_id: manual.id, trigger: 'manual' },
      { thread_id: cron.id, trigger: 'cron' },
    ]);
    expect(deliveries('nightly')).toEqual([]);
  });
});
