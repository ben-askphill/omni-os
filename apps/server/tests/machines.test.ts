import { beforeAll, describe, expect, it } from 'vitest';
import type { MachineLoad, MachinesView } from '@omni/shared/machines.ts';
import { MemoryTransport } from '../sync/transport.ts';
import { tailscaleStatus, waitFor } from './support.ts';
import { bootMac, type Mac } from './two-macs.ts';

// GET /api/machines: each machine's running and queued threads, from the rows sync carries, with whether this
// machine's Tailscale sees it up. Mac B runs threads; Mac A's dashboard counts them under B, never under itself.

const relay = new MemoryTransport();
const NODE_A = { id: 'nA', dns: 'office-air.tail1234.ts.net' };
const NODE_B = { id: 'nB', dns: 'home-pro.tail1234.ts.net' };
let a: Mac;
let b: Mac;

const thread = (m: Mac, id: string, status: 'running' | 'queued' | 'done', extra: { harness?: string; parent_id?: string | null } = {}) =>
  m.db.threads.create({
    id, channel_id: 'scratch', title: id, status, role: null, model: null, session_id: id, cwd: m.tmp, branch: null,
    parent_id: extra.parent_id ?? null, task_id: null, source: extra.parent_id ? 'team' : 'manual', automation: null, harness: extra.harness,
  });

const machines = async (m: Mac) => (await m.json('/machines')).body as MachinesView;
const named = (v: MachinesView, id: string) => v.machines.find((x) => x.id === id) as MachineLoad;

beforeAll(async () => {
  a = await bootMac('mac-a', "Ben's MacBook Air", relay);
  a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: true }]));
  b = await bootMac('mac-b', "Ben's MacBook Pro", relay);
  b.tailnet(tailscaleStatus(NODE_B, [{ ...NODE_A, online: true }]));
  for (const m of [a, b]) {
    await m.sync();
    await waitFor(() => m.db.kv.get(`devices.${m.id}`), `${m.id} to describe itself`);
    await m.sync();
  }
  // B runs a thread and queues a team member under it, on Codex.
  thread(b, 'lead', 'running');
  thread(b, 'member', 'queued', { harness: 'codex', parent_id: 'lead' });
  thread(b, 'finished', 'done');
  await b.sync();
  await a.sync();
}, 30_000);

describe('GET /api/machines', () => {
  it('lists this machine first, then each synced one with what runs there', async () => {
    const v = await machines(a);
    expect(v.syncLive).toBe(true);
    expect(v.machines.map((m) => [m.name, m.here])).toEqual([
      ["Ben's MacBook Air", true],
      ["Ben's MacBook Pro", false],
    ]);
    expect(named(v, 'mac-a')).toMatchObject({ running: 0, queued: 0, delegated: 0, reachability: 'online', agents: 0, threadIds: [] });
    const pro = named(v, 'mac-b');
    expect(pro).toMatchObject({ running: 1, queued: 1, delegated: 1, reachability: 'online', agents: null, lastSeen: null });
    expect(pro.threadIds.sort()).toEqual(['lead', 'member']);
    expect(pro.lastChangeAt).toEqual(expect.any(String));
  });

  it('splits a machine by harness against the caps it announced', async () => {
    const pro = named(await machines(a), 'mac-b');
    const caps = b.db.kv.get<{ caps: Record<string, number> }>('devices.mac-b')!.caps;
    expect(caps['claude-code']).toBeGreaterThan(0);
    expect(pro.harnesses.find((h) => h.id === 'claude-code')).toEqual({ id: 'claude-code', running: 1, queued: 0, cap: caps['claude-code'] });
    expect(pro.harnesses.find((h) => h.id === 'codex')).toEqual({ id: 'codex', running: 0, queued: 1, cap: caps.codex });
    expect(pro.harnesses.map((h) => h.id).slice(0, 2)).toEqual(['claude-code', 'codex']);
  });

  it('moves the counts when the other machine finishes, on the next sync', async () => {
    b.db.threads.update('member', { status: 'done' });
    await b.sync();
    await a.sync();
    expect(named(await machines(a), 'mac-b')).toMatchObject({ running: 1, queued: 0, delegated: 0, threadIds: ['lead'] });
  });

  it('counts Needs you under the machine that holds the thread', async () => {
    thread(a, 'stuck', 'done');
    a.db.db.prepare(`UPDATE threads SET setup = 'failed' WHERE id = 'stuck'`).run();
    a.db.assignments.claim('stuck', 'mac-b');
    const v = await machines(a);
    expect(named(v, 'mac-b').needsYou).toBe(1);
    expect(named(v, 'mac-a').needsYou).toBe(0);
  });

  it('says an offline machine is offline and keeps what it last reported', async () => {
    a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: false, lastSeen: '2026-11-14T07:00:00Z' }]));
    expect(named(await machines(a), 'mac-b')).toMatchObject({ reachability: 'offline', lastSeen: '2026-11-14T07:00:00.000Z', running: 1 });
    a.tailnet('');
    expect(named(await machines(a), 'mac-b')).toMatchObject({ reachability: 'unknown', lastSeen: null });
    a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: true }]));
  });

  it('reads a device record from an older build without caps as unknown caps', async () => {
    const rec = a.db.kv.get<Record<string, unknown>>('devices.mac-b')!;
    const { caps: _caps, ...older } = rec;
    a.db.db.prepare('UPDATE kv SET value = ? WHERE key = ?').run(JSON.stringify(older), 'devices.mac-b');
    const pro = named(await machines(a), 'mac-b');
    expect(pro.harnesses).toEqual([{ id: 'claude-code', running: 1, queued: 0, cap: null }]);
    a.db.db.prepare('UPDATE kv SET value = ? WHERE key = ?').run(JSON.stringify(rec), 'devices.mac-b');
  });
});
