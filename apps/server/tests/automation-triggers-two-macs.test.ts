import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryTransport } from '../sync/transport.ts';
import { bootMac, type Mac } from './two-macs.ts';

// An event automation on two synced Macs, two real servers with fake claude and one in-memory relay. Mac A runs
// automations. A publish both Macs see starts one run, on A; one only B sees is held on B and started on A. The
// automation is paused on B and on on A: the Mac that runs automations decides.

const relay = new MemoryTransport();
const T = { timeout: 30_000 };
const shop = mkdtempSync(join(tmpdir(), 'omni-trigger-shop-'));
const automationsDir = (enabled: boolean) => {
  const dir = mkdtempSync(join(tmpdir(), 'omni-trigger-two-'));
  writeFileSync(join(dir, 'review.yaml'), `name: Review\nenabled: ${enabled}\non: artifact_published\nchannel: shop\nprompt: Review the page.\n`);
  return dir;
};

type Triggers = typeof import('../automation-triggers.ts');
let a: Mac & { triggers: Triggers };
let b: Mac & { triggers: Triggers };
let source: string;

const page = (n: string) => ({ url: `https://claude.ai/code/artifact/page-${n}`, title: `${n}.html`, update: false });
const delivery = (m: Mac, sourceId: string) =>
  m.db.db.prepare('SELECT uid, state, owner, thread_id FROM trigger_deliveries WHERE source_id = ?').get(sourceId) as
    | { uid: string; state: string; owner: string | null; thread_id: string | null }
    | undefined;
const runs = (m: Mac) => m.db.db.prepare(`SELECT id, run_machine FROM threads WHERE automation = 'review' ORDER BY id`).all() as { id: string }[];
const both = async () => {
  await a.sync();
  await b.sync();
  await a.sync();
};

beforeAll(async () => {
  const macA = await bootMac('mac-a', 'Mac A', relay, { OMNI_AUTOMATIONS_DIR: automationsDir(true) });
  a = { ...macA, triggers: await import('../automation-triggers.ts') };
  a.db.channels.create({ id: 'shop', name: 'Shop', kind: 'client', use_worktree: 0, base_dir: shop, notes: '' });
  const t = await a.runner.createThread({ channel: 'shop', prompt: 'THINK:1', title: 'Write the page' });
  source = t.id;
  await a.untilResults(source, 1);
  const macB = await bootMac('mac-b', 'Mac B', relay, { OMNI_AUTOMATIONS_DIR: automationsDir(false) });
  b = { ...macB, triggers: await import('../automation-triggers.ts') };
  for (const m of [a, b]) m.triggers.startTriggerDeliveries();
  await both();
  await b.sync();
}, 60_000);

describe('event automations on two Macs', () => {
  it('both Macs agree that A runs automations, and B has the thread that publishes', () => {
    expect(a.db.kv.get('automations.owner')).toBe('mac-a');
    expect(b.db.kv.get('automations.owner')).toBe('mac-a');
    expect(b.db.threads.get(source)).toBeTruthy();
  });

  it('a publish both Macs see makes one delivery and one run, on A', T, async () => {
    const id = `${source}:toolu_both`;
    const held = b.triggers.observePublication(source, 'toolu_both', page('both'));
    expect(held).toMatchObject([{ state: 'queued', owner: 'mac-a', thread_id: null }]);
    await b.triggers.admitPending();
    expect(runs(b)).toEqual([]);

    a.triggers.observePublication(source, 'toolu_both', page('both'));
    await a.until('A to start it', () => delivery(a, id)?.state === 'started');
    await both();
    const onA = delivery(a, id)!;
    expect(delivery(b, id)).toEqual(onA);
    expect(runs(a)).toHaveLength(1);
    expect(runs(a)[0].id).toBe(onA.thread_id);
    expect(runs(b).map((r) => r.id)).toEqual([onA.thread_id]);
    // A copy of the held delivery reaching A after it started changes nothing there.
    expect(a.db.db.prepare('SELECT COUNT(*) AS n FROM trigger_deliveries').get()).toEqual({ n: 1 });
  });

  it('a publish only B sees is held there, and starts on A once it syncs', T, async () => {
    const id = `${source}:toolu_b_only`;
    b.triggers.observePublication(source, 'toolu_b_only', page('b-only'));
    expect(delivery(b, id)).toMatchObject({ state: 'queued', owner: 'mac-a' });
    await b.sync();
    await a.sync();
    await a.until('A to start the held delivery', () => delivery(a, id)?.state === 'started');
    await both();
    expect(delivery(b, id)).toMatchObject({ state: 'started', thread_id: delivery(a, id)!.thread_id });
    expect(runs(a)).toHaveLength(2);
    expect(runs(b)).toHaveLength(2);
  });

  it('B never starts a held delivery itself, even after a restart pass', async () => {
    b.triggers.observePublication(source, 'toolu_held', page('held'));
    expect(await b.triggers.admitPending()).toBe(0);
    expect(delivery(b, `${source}:toolu_held`)?.state).toBe('queued');
  });
});
