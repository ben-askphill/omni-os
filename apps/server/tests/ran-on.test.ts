import { beforeAll, describe, expect, it } from 'vitest';
import type { RanOn } from '@omni/shared/ran-on.ts';
import { MemoryTransport } from '../sync/transport.ts';
import { waitFor } from './support.ts';
import { bootMac, type Mac } from './two-macs.ts';

// Each thread the clients get says which machine runs it or last ran it, with the machines before, and when its
// running turn started (apps/server/ran-on.ts). Mac B runs a thread; Mac A's Inbox names B. A then takes it: the row
// names A, with B before it, on both Macs.

const relay = new MemoryTransport();
let a: Mac;
let b: Mac;

type Row = { id: string; status: string; ran_on: RanOn | null; run_started_at: string | null };

const thread = (m: Mac, id: string, status: 'running' | 'queued' | 'done') =>
  m.db.threads.create({
    id, channel_id: 'scratch', title: id, status, role: null, model: null, session_id: id, cwd: m.tmp, branch: `omni/${id}`,
    parent_id: null, task_id: null, source: 'manual', automation: null,
  });

const recent = async (m: Mac) => (await m.json('/recent?limit=50')).body as Row[];
const rowOf = async (m: Mac, id: string) => (await recent(m)).find((t) => t.id === id);

beforeAll(async () => {
  a = await bootMac('mac-a', "Ben's MacBook Air", relay);
  b = await bootMac('mac-b', "Ben's MacBook Pro", relay);
  for (const m of [a, b]) {
    await m.sync();
    await waitFor(() => m.db.kv.get(`devices.${m.id}`), `${m.id} to describe itself`);
    await m.sync();
  }
  await a.sync();
}, 30_000);

describe('ran_on and run_started_at on the thread rows', () => {
  it('names the machine running a thread, on that machine and the other, with when its turn started', async () => {
    const t = thread(b, 'busy', 'running');
    b.db.events.add(t.id, 'user', { text: 'go' }, '2026-11-14T20:00:00.000Z');
    await b.sync();
    await a.sync();
    for (const m of [a, b]) {
      const row = (await rowOf(m, 'busy'))!;
      expect(row.status).toBe('running');
      expect(row.ran_on).toMatchObject({ id: 'mac-b', name: "Ben's MacBook Pro", before: [] });
      expect(row.run_started_at).toBe('2026-11-14T20:00:00.000Z');
    }
  });

  it('keeps the machine it last ran on once it ends, and drops the run start', async () => {
    b.db.threads.update('busy', { status: 'done' });
    await b.sync();
    await a.sync();
    const row = (await rowOf(a, 'busy'))!;
    expect(row.status).toBe('done');
    expect(row.ran_on).toMatchObject({ id: 'mac-b', name: "Ben's MacBook Pro", before: [] });
    expect(row.run_started_at).toBeNull();
  });

  it('lists the machine it was on before once another takes it, on both machines', async () => {
    a.db.assignments.claim('busy');
    a.db.threads.update('busy', { status: 'running' });
    await a.sync();
    await b.sync();
    for (const m of [a, b]) {
      const row = (await rowOf(m, 'busy'))!;
      expect(row.ran_on).toMatchObject({ id: 'mac-a', name: "Ben's MacBook Air", before: [{ id: 'mac-b', name: "Ben's MacBook Pro" }] });
      expect(row.ran_on!.before[0]!.at).toEqual(expect.any(String));
    }
    // Back on B: B again, with A then B before it, oldest first.
    b.db.assignments.claim('busy');
    expect(b.db.assignments.stored('busy')!.trail.map((s) => s.machine)).toEqual(['mac-b', 'mac-a']);
  });

  it('shows no machine and no start for a queued thread nothing holds yet', async () => {
    // A queued row's run_machine names its machine, but the run has not started.
    thread(a, 'waiting', 'queued');
    const row = (await rowOf(a, 'waiting'))!;
    expect(row.ran_on).toMatchObject({ id: 'mac-a' });
    expect(row.run_started_at).toBeNull();
  });
});

describe('the assignment trail', () => {
  it('takes a row from an older build without a trail, keeping the trail here and adding the holder it left', async () => {
    thread(a, 'legacy', 'done');
    a.db.assignments.claim('legacy');
    const kept = a.db.assignments.applyRemote({ thread_id: 'legacy', machine: 'mac-b', generation: 1, routed: false, at: '2026-11-14T21:00:00.000Z' });
    expect(kept).toBe(true);
    expect(a.db.assignments.stored('legacy')).toMatchObject({ machine: 'mac-b', trail: [{ machine: 'mac-a' }] });
  });

  it('reads a broken trail as none', () => {
    expect(a.db.parseTrail('not json')).toEqual([]);
    expect(a.db.parseTrail([{ machine: 'ok', at: 'x' }, { machine: '../bad', at: 'x' }, null])).toEqual([{ machine: 'ok', at: 'x' }]);
  });
});
