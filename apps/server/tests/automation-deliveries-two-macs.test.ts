import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryTransport } from '../sync/transport.ts';
import { bootMac, type Mac } from './two-macs.ts';

// Retry and skip across two synced Macs, two real servers with fake claude and one in-memory relay. Mac A runs
// automations. A start that failed on A is retried from B and started once, on A. A skip on B racing a start on A
// ends as the start on both. An event that went stale while B held it never starts, whichever Mac owns automations.

const relay = new MemoryTransport();
const T = { timeout: 30_000 };
const shop = mkdtempSync(join(tmpdir(), 'omni-deliveries-shop-'));
const dirA = mkdtempSync(join(tmpdir(), 'omni-deliveries-a-'));
const dirB = mkdtempSync(join(tmpdir(), 'omni-deliveries-b-'));
/** The same automation on both Macs, pointed at a channel. `gone` has no such channel, so every start fails. */
const automation = (channel: string) => `name: Flaky\nenabled: true\non: { event: artifact_published, max_age: 1h }\nchannel: ${channel}\nprompt: THINK:1\n`;
const point = (channel: string) => [dirA, dirB].forEach((d) => writeFileSync(join(d, 'flaky.yaml'), automation(channel)));

type Triggers = typeof import('../automation-triggers.ts');
type Repo = typeof import('../db/repos/trigger-deliveries.ts');
let a: Mac & { triggers: Triggers; repo: Repo };
let b: Mac & { triggers: Triggers; repo: Repo };
let source: string;

const page = (n: string) => ({ url: `https://claude.ai/code/artifact/page-${n}`, title: `${n}.html`, update: false });
const uidOf = (sourceId: string) => a.repo.deliveryId('flaky', 'artifact_published', `${source}:${sourceId}`);
const delivery = (m: Mac, sourceId: string) =>
  m.db.db.prepare('SELECT uid, state, reason, owner, thread_id, attempt FROM trigger_deliveries WHERE source_id = ?').get(`${source}:${sourceId}`) as
    | { uid: string; state: string; reason: string | null; owner: string | null; thread_id: string | null; attempt: number }
    | undefined;
const runs = (m: Mac) => m.db.db.prepare(`SELECT id FROM threads WHERE automation = 'flaky' ORDER BY id`).all() as { id: string }[];
const both = async () => {
  await a.sync();
  await b.sync();
  await a.sync();
};

beforeAll(async () => {
  point('gone');
  const macA = await bootMac('mac-a', 'Mac A', relay, { OMNI_AUTOMATIONS_DIR: dirA });
  a = { ...macA, triggers: await import('../automation-triggers.ts'), repo: await import('../db/repos/trigger-deliveries.ts') };
  a.db.channels.create({ id: 'shop', name: 'Shop', kind: 'client', use_worktree: 0, base_dir: shop, notes: '' });
  const t = await a.runner.createThread({ channel: 'shop', prompt: 'THINK:1', title: 'Write the page' });
  source = t.id;
  await a.untilResults(source, 1);
  const macB = await bootMac('mac-b', 'Mac B', relay, { OMNI_AUTOMATIONS_DIR: dirB });
  b = { ...macB, triggers: await import('../automation-triggers.ts'), repo: await import('../db/repos/trigger-deliveries.ts') };
  for (const m of [a, b]) m.triggers.startTriggerDeliveries();
  await both();
  await b.sync();
}, 60_000);

describe('retry and skip on two Macs', () => {
  it('a start that failed on A is failed on both, retried from B, and started once, on A', T, async () => {
    a.triggers.observePublication(source, 'toolu_fail', page('fail'));
    await a.until('the start to fail on A', () => delivery(a, 'toolu_fail')?.state === 'failed');
    await both();
    expect(delivery(b, 'toolu_fail')).toMatchObject({ state: 'failed', attempt: 1, thread_id: null, reason: 'unknown channel "gone"' });
    expect((await b.json(`/deliveries/${uidOf('toolu_fail')}`)).body).toMatchObject({ can_retry: true });

    point('shop');
    const res = await b.json(`/deliveries/${uidOf('toolu_fail')}/retry`, { body: { attempt: 1 } });
    expect(res.status).toBe(200);
    // B does not run automations: it holds the retry for the Mac that does.
    expect(res.body.delivery).toMatchObject({ attempt: 2, state: 'queued' });
    await b.triggers.admitPending();
    expect(runs(b)).toEqual([]);
    await b.sync();
    await a.sync();
    await a.until('A to start the retry', () => delivery(a, 'toolu_fail')?.state === 'started');
    await both();
    const onA = delivery(a, 'toolu_fail')!;
    expect(onA).toMatchObject({ attempt: 2, thread_id: a.repo.deliveryThreadId(onA.uid, 2) });
    expect(delivery(b, 'toolu_fail')).toEqual(onA);
    expect(runs(a).map((r) => r.id)).toEqual([onA.thread_id]);
    expect(runs(b).map((r) => r.id)).toEqual([onA.thread_id]);
    // The same click again, from B's old page, goes nowhere.
    const again = await b.json(`/deliveries/${onA.uid}/retry`, { body: { attempt: 1 } });
    expect(again.status).toBe(409);
    expect(runs(a)).toHaveLength(1);
  });

  it('B cannot skip what it holds for A, which may be starting it: only A skips', T, async () => {
    b.triggers.observePublication(source, 'toolu_race', page('race'));
    expect(delivery(b, 'toolu_race')).toMatchObject({ state: 'queued' });
    const held = (await b.json(`/deliveries/${uidOf('toolu_race')}`)).body;
    expect(held).toMatchObject({ can_skip: false, waiting: expect.stringMatching(/^Held for the Mac that runs automations/) });
    const refused = await b.json(`/deliveries/${uidOf('toolu_race')}/skip`, { body: {} });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/Skip it there/);
    expect(delivery(b, 'toolu_race')).toMatchObject({ state: 'queued' });

    a.triggers.observePublication(source, 'toolu_race', page('race'));
    await a.until('A to start it', () => delivery(a, 'toolu_race')?.state === 'started');
    await both();
    const onA = delivery(a, 'toolu_race')!;
    expect(delivery(b, 'toolu_race')).toEqual(onA);
    expect(runs(a).filter((r) => r.id === onA.thread_id)).toHaveLength(1);
    expect(runs(a)).toHaveLength(2);
  });

  it('an event that went stale while B held it is skipped by B once B owns automations, and A never starts it', T, async () => {
    b.triggers.observePublication(source, 'toolu_late', page('late'));
    const id = uidOf('toolu_late');
    expect(delivery(b, 'toolu_late')).toMatchObject({ state: 'queued' });
    b.db.db.prepare('UPDATE trigger_deliveries SET created_at = ? WHERE uid = ?').run(new Date(Date.now() - 3 * 3_600_000).toISOString(), id);
    // A is not told yet. The automations move to B, which finds the held event too old.
    (await import('../sync/owner.ts')).claimAutomations();
    await b.triggers.admitPending();
    expect(delivery(b, 'toolu_late')).toMatchObject({ state: 'skipped', thread_id: null });
    expect(delivery(b, 'toolu_late')!.reason).toMatch(/^Expired: it arrived 3h ago, over the 1h limit$/);
    await both();
    expect(delivery(a, 'toolu_late')).toMatchObject({ state: 'skipped', thread_id: null });
    await a.triggers.admitPending();
    await b.triggers.admitPending();
    expect(runs(a)).toHaveLength(2);
    expect(runs(b)).toHaveLength(2);
  });
});
