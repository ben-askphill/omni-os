import { beforeAll, describe, expect, it } from 'vitest';
import { MemoryTransport } from '../sync/transport.ts';
import { tailscaleStatus, waitFor } from './support.ts';
import { bootMac, type Mac } from './two-macs.ts';

// Each synced Mac describes itself in kv devices.<id> (its name and Tailscale node) and lists the others with whether
// its own Tailscale sees them up. That is what the handoff picker shows and what a thread running elsewhere names.

const relay = new MemoryTransport();
const NODE_A = { id: 'nA', dns: 'office-air.tail1234.ts.net' };
const NODE_B = { id: 'nB', dns: 'home-pro.tail1234.ts.net' };
let a: Mac;
let b: Mac;

const deviceWrites = (id: string) => relay.changes.filter((c) => c.entity === 'kv' && c.entity_id === `devices.${id}`).length;

beforeAll(async () => {
  a = await bootMac('mac-a', "Ben's MacBook Air", relay);
  a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: true }]));
  b = await bootMac('mac-b', "Ben's MacBook Pro", relay);
  b.tailnet(tailscaleStatus(NODE_B, [{ ...NODE_A, online: true }]));
  // Each Mac writes its record after a sync; the next sync carries it.
  for (const m of [a, b]) {
    await m.sync();
    await waitFor(() => m.db.kv.get(`devices.${m.id}`), `${m.id} to describe itself`);
    await m.sync();
  }
  await a.sync();
}, 30_000);

describe('synced Macs', () => {
  it('each lists the other with its name, its MagicDNS name and whether it is up, never itself', async () => {
    expect((await a.json('/devices')).body).toEqual([
      { id: 'mac-b', name: "Ben's MacBook Pro", reachability: 'online', dnsName: NODE_B.dns, lastSeen: null },
    ]);
    expect((await b.json('/devices')).body).toEqual([
      { id: 'mac-a', name: "Ben's MacBook Air", reachability: 'online', dnsName: NODE_A.dns, lastSeen: null },
    ]);
  });

  it('says when Tailscale saw an offline Mac last, and unknown without Tailscale', async () => {
    a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: false, lastSeen: '2026-10-23T07:00:00Z' }]));
    expect((await a.json('/devices')).body[0]).toMatchObject({ reachability: 'offline', lastSeen: '2026-10-23T07:00:00.000Z' });
    a.tailnet('');
    expect((await a.json('/devices')).body[0]).toMatchObject({ reachability: 'unknown', dnsName: NODE_B.dns, lastSeen: null });
    a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: true }]));
  });

  it('writes its record again only when its name or node changed', async () => {
    const later = Date.now() + 120_000;
    await b.devices.announceDevice(later);
    expect(deviceWrites('mac-b')).toBe(1);
    b.devices.configureDevices({ name: "Ben's Mac Studio" });
    await b.devices.announceDevice(later + 120_000);
    await b.sync();
    await a.sync();
    expect(deviceWrites('mac-b')).toBe(2);
    expect((await a.json('/devices')).body[0].name).toBe("Ben's Mac Studio");
  });

  it('names the Mac a thread runs on when this one cannot take a turn', async () => {
    a.db.threads.create({
      id: 'elsewhere', channel_id: 'scratch', title: 'elsewhere', status: 'done', role: null, model: null, session_id: 'elsewhere',
      cwd: a.tmp, branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
    });
    // Stands in for mac-b's synced writes: the running row, and the assignment its turn claimed.
    a.db.db.prepare(`UPDATE threads SET status = 'running', run_machine = 'mac-b' WHERE id = 'elsewhere'`).run();
    a.db.assignments.claim('elsewhere', 'mac-b');
    expect((await a.json('/threads/elsewhere')).body.blocked).toBe("This thread is running on Ben's Mac Studio.");
  });
});
