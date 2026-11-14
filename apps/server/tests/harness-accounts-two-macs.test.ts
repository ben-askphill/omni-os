import { beforeAll, describe, expect, it } from 'vitest';
import type { HarnessAccount } from '@omni/shared/harness-accounts.ts';
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
});
