import { beforeAll, describe, expect, it } from 'vitest';
import type { HarnessAccount } from '@omni/shared/harness-accounts.ts';
import { usageRows, type UsageRow } from '@omni/shared/account-usage.ts';
import { MemoryTransport } from '../sync/transport.ts';
import { tailscaleStatus, waitFor } from './support.ts';
import { bootMac, type Mac } from './two-macs.ts';

// A plan reading is filed only under the account it was read as (harness-accounts.ts attributeUsage), from PR #750's
// review: a partial Codex update never takes a window from another account, and a reading that lands around an
// account switch goes under neither account.

const relay = new MemoryTransport();
const NODE_A = { id: 'nA', dns: 'office-air.tail1234.ts.net' };
const NODE_B = { id: 'nB', dns: 'omarchy.tail1234.ts.net' };
let a: Mac;
let b: Mac;
const usageOf: Record<string, typeof import('../usage.ts')> = {};
const accountsOf: Record<string, typeof import('../harness-accounts.ts')> = {};
const normOf: Record<string, typeof import('../harness/codex/normalize.ts')> = {};
/** Who each machine's harnesses say they run as, read on every check. */
const who: Record<string, Record<string, string>> = {
  'mac-a': { 'claude-code': 'ben@work.example', codex: 'a-codex@example.com' },
  'mac-b': { 'claude-code': 'ben@work.example', codex: 'b-codex@example.com' },
};
const reader = (machine: string) => async (harness: string): Promise<HarnessAccount> =>
  who[machine]![harness]
    ? { harness, state: 'signed-in', label: who[machine]![harness]!, org: null, plan: 'Max', note: null, switched: null }
    : { harness, state: 'not-installed', label: null, org: null, plan: null, note: null, switched: null };

async function boot(id: string, name: string, node: typeof NODE_A, peer: typeof NODE_A) {
  const m = await bootMac(id, name, relay);
  m.tailnet(tailscaleStatus(node, [{ ...peer, online: true }]));
  accountsOf[id] = await import('../harness-accounts.ts');
  accountsOf[id].configureAccounts({ read: reader(id) });
  usageOf[id] = await import('../usage.ts');
  normOf[id] = await import('../harness/codex/normalize.ts');
  return m;
}

async function syncBoth() {
  for (const m of [a, b, a]) await m.sync();
}

/** Record a reading on a machine and wait until it is filed (or dropped). */
async function record(m: Mac, ...args: Parameters<typeof import('../usage.ts').recordUsage>) {
  usageOf[m.id]!.recordUsage(...args);
  await accountsOf[m.id]!.usageFiled();
}

const week = (utilization: number, five?: number) => ({
  ...(five === undefined ? {} : { five_hour: { utilization: five, resetsAt: 2_000_000_000 } }),
  seven_day: { utilization, resetsAt: 2_000_000_000 },
  updated_at: new Date().toISOString(),
});

/** A Codex account/rateLimits/updated with only the 5-hour window, as the adapter hands it on. */
const fiveOnly = (m: Mac, usedPercent: number) =>
  normOf[m.id]!.normalizeRateLimits({ limitId: 'codex', primary: { usedPercent, windowDurationMins: 300, resetsAt: 2_000_000_000 }, secondary: null } as any);

async function rowsOn(m: Mac, harness: string): Promise<UsageRow[]> {
  const view = (await m.json('/accounts')).body;
  return usageRows([harness], view, view.usage);
}
const rowOf = (rows: UsageRow[], label: string) => rows.find((r) => r.account?.label === label);

beforeAll(async () => {
  a = await boot('mac-a', "Ben's MacBook Air", NODE_A, NODE_B);
  b = await boot('mac-b', 'omarchy', NODE_B, NODE_A);
  for (const m of [a, b]) {
    await m.sync();
    await waitFor(() => m.db.kv.get(`devices.${m.id}`), `${m.id} to describe itself`);
  }
  await waitFor(() => a.db.kv.get('accounts.mac-a') && b.db.kv.get('accounts.mac-b'), 'both records');
  await a.json('/accounts?refresh=1');
  await b.json('/accounts?refresh=1');
  await syncBoth();
}, 30_000);

describe('filing plan usage per account across two machines', () => {
  it("fills a partial Codex update from this account's own reading, never from the other account's", async () => {
    await record(b, 'codex', week(0.9, 0.1));
    await syncBoth();
    // The per-harness key is B's now, on A too: the gap a partial update used to be filled from.
    expect((a.db.kv.get('usage:codex') as any)?.seven_day?.utilization).toBe(0.9);

    await record(a, 'codex', fiveOnly(a, 20), { partial: true });
    await syncBoth();
    let rows = await rowsOn(b, 'codex');
    expect(rowOf(rows, 'a-codex@example.com')!.usage).toMatchObject({ five_hour: { utilization: 0.2 } });
    expect(rowOf(rows, 'a-codex@example.com')!.usage!.seven_day).toBeUndefined();
    expect(rowOf(rows, 'b-codex@example.com')!.usage).toMatchObject({ five_hour: { utilization: 0.1 }, seven_day: { utilization: 0.9 } });

    // Once A's own account has a week, a partial update keeps that one.
    await record(a, 'codex', week(0.4, 0.25));
    await record(a, 'codex', fiveOnly(a, 30), { partial: true });
    await syncBoth();
    rows = await rowsOn(b, 'codex');
    expect(rowOf(rows, 'a-codex@example.com')!.usage).toMatchObject({ five_hour: { utilization: 0.3 }, seven_day: { utilization: 0.4 } });
    expect(rowOf(rows, 'b-codex@example.com')!.usage).toMatchObject({ seven_day: { utilization: 0.9 } });
  });

  it('files a reading that lands around an account switch under neither account, then the next under the new one', async () => {
    await record(b, 'claude-code', week(0.2));
    await syncBoth();
    // claude auth login on A as another account. A's record still says work: nothing read it again yet.
    who['mac-a']!['claude-code'] = 'ben@personal.example';
    await record(a, 'claude-code', week(0.95));
    await syncBoth();
    let rows = await rowsOn(b, 'claude-code');
    expect(rowOf(rows, 'ben@work.example')!.usage).toMatchObject({ seven_day: { utilization: 0.2 } });
    expect(rowOf(rows, 'ben@personal.example')!.usage).toBeNull();
    // The check the reading set off saw the switch: A's record has it without a full reading.
    expect(rowOf(rows, 'ben@personal.example')!.account!.machines).toEqual(["Ben's MacBook Air"]);

    await record(a, 'claude-code', week(0.5));
    await syncBoth();
    rows = await rowsOn(b, 'claude-code');
    expect(rowOf(rows, 'ben@personal.example')!.usage).toMatchObject({ seven_day: { utilization: 0.5 } });
    expect(rowOf(rows, 'ben@work.example')!.usage).toMatchObject({ seven_day: { utilization: 0.2 } });
  });

  it('files nothing for a harness that is not signed in', async () => {
    const before = a.db.kv.list('usage-account.').length;
    await record(a, 'cursor', { monthly: { utilization: 0.5, resetsAt: 2_000_000_000 }, updated_at: new Date().toISOString() });
    expect(a.db.kv.list('usage-account.').length).toBe(before);
  });

  it("marks a reading kept off every account, so no account's row falls back to it", async () => {
    await record(a, 'cursor', { monthly: { utilization: 0.6, resetsAt: 2_000_000_000 }, updated_at: new Date().toISOString() }, { account: false });
    expect(a.db.kv.get('usage:cursor')).toMatchObject({ unattributed: true });
  });
});
