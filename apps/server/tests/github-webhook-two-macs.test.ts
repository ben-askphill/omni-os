import { beforeAll, describe, expect, it } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryTransport } from '../sync/transport.ts';
import { bootMac, type Mac } from './two-macs.ts';

// A signed GitHub webhook on two synced Macs, two real servers with fake claude and one in-memory relay. Mac A runs
// automations; GitHub posts to B. B saves the delivery as held before it replies, sync carries it to A, and A starts
// the one run. The same delivery posted to A as well finds that row.

const SECRET = 'hook-secret-two-macs';
const relay = new MemoryTransport();
const T = { timeout: 30_000 };
const shop = mkdtempSync(join(tmpdir(), 'omni-webhook-shop-'));
const automationsDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'omni-webhook-two-'));
  writeFileSync(join(dir, 'ci.yaml'), 'name: CI fixer\nenabled: true\non: { event: github_webhook, repo: acme/shop }\nchannel: shop\nprompt: Fix the build.\n');
  return dir;
};

type Triggers = typeof import('../automation-triggers.ts');
let a: Mac & { triggers: Triggers };
let b: Mac & { triggers: Triggers };

const delivery = (m: Mac, guid: string) =>
  m.db.db.prepare('SELECT uid, state, owner, thread_id FROM trigger_deliveries WHERE source_id = ?').get(guid) as
    | { uid: string; state: string; owner: string | null; thread_id: string | null }
    | undefined;
const runs = (m: Mac) => m.db.db.prepare(`SELECT id FROM threads WHERE automation = 'ci' ORDER BY id`).all() as { id: string }[];
const both = async () => {
  await a.sync();
  await b.sync();
  await a.sync();
};

const payload = JSON.stringify({
  action: 'completed',
  repository: { full_name: 'acme/shop' },
  workflow_run: { name: 'CI', conclusion: 'failure', head_branch: 'main', head_repository: { full_name: 'acme/shop' }, display_title: 'Bump deps' },
});
const post = (m: Mac, guid: string) =>
  m.app.request('/api/hooks/github/ci', {
    method: 'POST',
    body: payload,
    headers: {
      authorization: '',
      'content-type': 'application/json',
      'x-github-event': 'workflow_run',
      'x-github-delivery': guid,
      'x-hub-signature-256': `sha256=${createHmac('sha256', SECRET).update(payload).digest('hex')}`,
    },
  });

beforeAll(async () => {
  const macA = await bootMac('mac-a', 'Mac A', relay, { OMNI_AUTOMATIONS_DIR: automationsDir() });
  a = { ...macA, triggers: await import('../automation-triggers.ts') };
  a.db.channels.create({ id: 'shop', name: 'Shop', kind: 'client', use_worktree: 0, base_dir: shop, notes: '' });
  const macB = await bootMac('mac-b', 'Mac B', relay, { OMNI_AUTOMATIONS_DIR: automationsDir() });
  b = { ...macB, triggers: await import('../automation-triggers.ts') };
  // Both Macs find B's stub first on PATH: a Keychain that holds the signing secret.
  writeFileSync(join(b.tmp, 'bin', 'security'), `#!/bin/sh\ncase "$*" in *find-generic-password*OMNI_WEBHOOK_CI*) echo '${SECRET}'; exit 0;; esac\nexit 44\n`, { mode: 0o755 });
  for (const m of [a, b]) m.triggers.startTriggerDeliveries();
  await both();
  await b.sync();
}, 60_000);

describe('a webhook on two Macs', () => {
  it('both Macs agree that A runs automations', () => {
    expect(a.db.kv.get('automations.owner')).toBe('mac-a');
    expect(b.db.kv.get('automations.owner')).toBe('mac-a');
  });

  it('posted to B, is held there before the reply and started once on A after sync', T, async () => {
    const guid = randomUUID();
    const res = await post(b, guid);
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ state: 'queued', duplicate: false });
    expect(delivery(b, guid)).toMatchObject({ state: 'queued', owner: 'mac-a', thread_id: null });
    expect(await b.triggers.admitPending()).toBe(0);
    expect(runs(b)).toEqual([]);

    await b.sync();
    await a.sync();
    await a.until('A to start it', () => delivery(a, guid)?.state === 'started');
    await both();
    const onA = delivery(a, guid)!;
    expect(delivery(b, guid)).toEqual(onA);
    expect(runs(a).map((r) => r.id)).toEqual([onA.thread_id]);
    expect(runs(b).map((r) => r.id)).toEqual([onA.thread_id]);

    // GitHub redelivering it, to either Mac, gets the same delivery back.
    for (const m of [a, b]) expect(await (await post(m, guid)).json()).toMatchObject({ delivery: onA.uid, state: 'started', thread_id: onA.thread_id, duplicate: true });
    await a.triggers.admitPending();
    expect(runs(a)).toHaveLength(1);
  });

  it('posted to both Macs before they sync, still one run', T, async () => {
    const guid = randomUUID();
    expect(await (await post(b, guid)).json()).toMatchObject({ state: 'queued' });
    expect(await (await post(a, guid)).json()).toMatchObject({ state: 'accepted' });
    await a.until('A to start it', () => delivery(a, guid)?.state === 'started');
    await both();
    expect(delivery(b, guid)).toEqual(delivery(a, guid));
    expect(runs(a)).toHaveLength(2);
    expect(a.db.db.prepare('SELECT COUNT(*) AS n FROM trigger_deliveries').get()).toEqual({ n: 2 });
  });
});
