import { beforeAll, describe, expect, it } from 'vitest';
import type { HarnessAccount } from '@omni/shared/harness-accounts.ts';
import { usageRows, type AccountUsage } from '@omni/shared/account-usage.ts';
import { MemoryTransport } from '../sync/transport.ts';
import { tailscaleStatus, waitFor } from './support.ts';
import { bootMac, type Mac } from './two-macs.ts';

// Each machine reads its own harness accounts and syncs them in kv accounts.<id>, so every machine lists the others as
// they last reported. A switch on one shows on the other, and acknowledging it anywhere clears it everywhere.

const relay = new MemoryTransport();
const NODE_A = { id: 'nA', dns: 'office-air.tail1234.ts.net' };
const NODE_B = { id: 'nB', dns: 'omarchy.tail1234.ts.net' };
let a: Mac;
let b: Mac;
/** Each Mac's own copy of usage.ts. */
const usageOf: Record<string, typeof import('../usage.ts')> = {};
/** What each machine's Claude Code says it runs as. */
const claude: Record<string, string> = { 'mac-a': 'ben@work.example', 'mac-b': 'ben@work.example' };

const reader = (machine: string) => async (harness: string): Promise<HarnessAccount> =>
  harness === 'claude-code'
    ? { harness, state: 'signed-in', label: claude[machine], org: null, plan: 'Max', note: null, switched: null }
    : { harness, state: 'not-installed', label: null, org: null, plan: null, note: null, switched: null };

async function boot(id: string, name: string, node: typeof NODE_A, peer: typeof NODE_A) {
  const m = await bootMac(id, name, relay);
  m.tailnet(tailscaleStatus(node, [{ ...peer, online: true }]));
  // This Mac's own copy of the module: the next boot loads fresh ones.
  (await import('../harness-accounts.ts')).configureAccounts({ read: reader(id) });
  usageOf[id] = await import('../usage.ts');
  return m;
}

const row = (view: any, machine: string) => view.machines.find((m: any) => m.id === machine)?.accounts.find((x: any) => x.harness === 'claude-code');

async function syncBoth() {
  for (const m of [a, b, a]) await m.sync();
}

beforeAll(async () => {
  a = await boot('mac-a', "Ben's MacBook Air", NODE_A, NODE_B);
  b = await boot('mac-b', 'omarchy', NODE_B, NODE_A);
  for (const m of [a, b]) {
    await m.sync();
    await waitFor(() => m.db.kv.get(`devices.${m.id}`), `${m.id} to describe itself`);
  }
  // Each reads its accounts on a sync (and on GET); the next sync carries the record.
  await waitFor(() => a.db.kv.get('accounts.mac-a') && b.db.kv.get('accounts.mac-b'), 'both records');
  await syncBoth();
}, 30_000);

describe('accounts across machines', () => {
  it('lists this machine first, then each other machine with its own accounts', async () => {
    const view = (await a.json('/accounts')).body;
    expect(view.synced).toBe(true);
    expect(view.machines.map((m: any) => [m.id, m.name, m.current])).toEqual([
      ['mac-a', "Ben's MacBook Air", true],
      ['mac-b', 'omarchy', false],
    ]);
    expect(row(view, 'mac-b')).toMatchObject({ state: 'signed-in', label: 'ben@work.example', notice: false });
  });

  it('shows a switch on another machine, and clears it on both once one acknowledges it', async () => {
    claude['mac-b'] = 'ben@personal.example';
    expect(row((await b.json('/accounts?refresh=1')).body, 'mac-b')).toMatchObject({ label: 'ben@personal.example', notice: true });
    await syncBoth();
    const seenOnA = row((await a.json('/accounts')).body, 'mac-b');
    expect(seenOnA).toMatchObject({ label: 'ben@personal.example', notice: true, switched: { from: { label: 'ben@work.example' } } });

    const acked = await a.json('/accounts/seen', { body: { machine: 'mac-b', harness: 'claude-code' } });
    expect(row(acked.body, 'mac-b').notice).toBe(false);
    await syncBoth();
    expect(row((await b.json('/accounts')).body, 'mac-b').notice).toBe(false);
  });

  it('writes a record again only when it changed', async () => {
    const writes = () => relay.changes.filter((c) => c.entity === 'kv' && c.entity_id === 'accounts.mac-a').length;
    const before = writes();
    await a.json('/accounts?refresh=1');
    await a.json('/accounts?refresh=1');
    await syncBoth();
    expect(writes()).toBe(before);
  });

  it("tells the other machine's clients of a stamp synced in through the thread, not the accounts list", async () => {
    const t = await a.start('hello');
    await waitFor(() => a.thread(t.id).status === 'done', 'the turn on A');
    await syncBoth();
    await waitFor(() => b.db.threads.get(t.id), 'the thread on B');
    const heard: { type: string; thread?: string }[] = [];
    const listen = (e: any) => heard.push({ type: e.type, thread: e.thread?.id });
    b.bus.on('feed', listen);
    try {
      const stamp = { harness: 'claude-code', machine: 'mac-a', machineName: "Ben's MacBook Air", label: 'ben@stamp.example', org: null, plan: 'Max', at: new Date().toISOString() };
      a.db.kv.set(`accounts-ran.${t.id}`, stamp);
      await syncBoth();
      expect(b.db.kv.get(`accounts-ran.${t.id}`)).toMatchObject({ label: 'ben@stamp.example' });
      expect(heard.some((e) => e.type === 'thread' && e.thread === t.id)).toBe(true);
      expect(heard.some((e) => e.type === 'accounts')).toBe(false);
    } finally {
      b.bus.off('feed', listen);
    }
  });

  it('keeps each account its own plan usage when two machines run two Claude accounts', async () => {
    claude['mac-a'] = 'ben@work.example';
    claude['mac-b'] = 'ben@personal.example';
    await a.json('/accounts?refresh=1');
    await b.json('/accounts?refresh=1');
    const heard: AccountUsage[] = [];
    const listen = (e: any) => e.type === 'account_usage' && heard.push(e.usage);
    a.bus.on('feed', listen);
    try {
      const week = (utilization: number) => ({ seven_day: { utilization, resetsAt: 2_000_000_000 }, updated_at: new Date().toISOString() });
      usageOf['mac-a']!.recordUsage('claude-code', week(0.3));
      usageOf['mac-b']!.recordUsage('claude-code', week(0.7));
      const records = (m: Mac) => m.db.kv.list<AccountUsage>('usage-account.claude-code.');
      await waitFor(() => records(a).length === 1 && records(b).length === 1, 'each reading filed under its account');
      await syncBoth();

      // The per-harness key is the last writer's on both machines: it cannot tell the two accounts apart.
      expect(a.db.kv.get('usage:claude-code')).toEqual(b.db.kv.get('usage:claude-code'));
      // Each account's reading is its own, on both machines.
      for (const m of [a, b]) {
        const view = (await m.json('/accounts')).body;
        const byLabel = Object.fromEntries(view.usage.map((u: AccountUsage) => [u.label, u.usage?.seven_day?.utilization]));
        expect(byLabel).toEqual({ 'ben@work.example': 0.3, 'ben@personal.example': 0.7 });
        const rows = usageRows(['claude-code'], view, view.usage, { 'claude-code': m.db.kv.get('usage:claude-code') });
        expect(rows.map((r) => [r.account?.label, r.usage?.seven_day?.utilization, r.several])).toEqual([
          [m === a ? 'ben@work.example' : 'ben@personal.example', m === a ? 0.3 : 0.7, true],
          [m === a ? 'ben@personal.example' : 'ben@work.example', m === a ? 0.7 : 0.3, true],
        ]);
      }
      // A's clients heard its own reading, then B's as it synced in.
      expect(heard.map((u) => [u.label, u.machine])).toEqual([
        ['ben@work.example', 'mac-a'],
        ['ben@personal.example', 'mac-b'],
      ]);

      // Both machines on one account: one record, the newer reading, nothing added up.
      claude['mac-b'] = 'ben@work.example';
      await b.json('/accounts?refresh=1');
      usageOf['mac-b']!.recordUsage('claude-code', week(0.45));
      await waitFor(() => records(b).some(([, u]) => u.usage?.seven_day?.utilization === 0.45), 'B files under the work account');
      await syncBoth();
      const view = (await a.json('/accounts')).body;
      const rows = usageRows(['claude-code'], view, view.usage);
      expect(rows.map((r) => [r.account?.label, r.account?.machines, r.usage?.seven_day?.utilization, r.several])).toEqual([
        ['ben@work.example', ["Ben's MacBook Air", 'omarchy'], 0.45, false],
      ]);
    } finally {
      a.bus.off('feed', listen);
    }
  });
});
