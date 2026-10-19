import { describe, it, expect, beforeAll, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryTransport } from '../sync/transport.ts';

// A limit stop between two Macs in one process, each with its own data dir, through one in-memory relay
// (apps/server/sync/handlers/limit-stop.ts). The Mac that ran the turn records the stop; the other Mac's Needs you lists
// the same Limited blocker with its reset time, marked as the other Mac's, instead of a bare failed result. Only the
// owner schedules or sends the continuation, and a message, Stop or archive on either Mac clears it on both.

async function machine(name: string) {
  vi.resetModules();
  process.env.OMNI_DATA_DIR = mkdtempSync(join(tmpdir(), `omni-sync-${name}-`));
  const db = await import('../db.ts');
  const { bus } = await import('../bus.ts');
  const sync = await import('../sync/worker.ts');
  const feed: any[] = [];
  bus.on('feed', (e) => feed.push(e));
  const worker = sync.createSyncWorker({ transport: relay, machineId: name });
  return { name, db, feed, worker };
}
type Mac = Awaited<ReturnType<typeof machine>>;

const relay = new MemoryTransport();
let a: Mac;
let b: Mac;

async function syncs(...macs: Mac[]) {
  for (const m of macs) expect((await m.worker.syncNow()).error).toBeUndefined();
}
const exchange = () => syncs(a, b, a);

const home = homedir();
const RESET = '2026-10-16T20:00:00.000Z';

function started(m: Mac, id: string) {
  m.db.threads.create({
    id, channel_id: 'volero', title: id, status: 'running', role: null, model: null, session_id: id,
    cwd: join(home, 'work', 'volero'), branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
  });
}
/** The turn on `m` ends at the usage limit, as records.ts limitStop does: the stop, then the failed status. */
function limited(m: Mac, id: string, resetsAt: string | null = RESET) {
  m.db.threads.setLimit(id, { state: 'limited', resets_at: resetsAt, id: `stop-${id}`, machine: m.db.outbox.machineId() });
  m.db.threads.update(id, { status: 'failed' });
}
const item = (m: Mac, id: string) => m.db.needsYou().items.find((i) => i.thread.id === id);
const blocker = (m: Mac, id: string) => item(m, id)?.blockers.find((x) => x.kind === 'limited') ?? null;

beforeAll(async () => {
  a = await machine('mac-a');
  b = await machine('mac-b');
  a.db.channels.create({ id: 'volero', name: 'Volero', kind: 'client', use_worktree: 0, base_dir: join(home, 'work') });
  await exchange();
});

describe("the second Mac's view of a limit stop", () => {
  it('lists the Limited blocker with its reset time on B, not a bare failed result', async () => {
    started(a, 't-1');
    await exchange();
    limited(a, 't-1');
    b.feed.length = 0;
    await exchange();

    // A, which ran the turn, owns it.
    expect(blocker(a, 't-1')).toEqual({ kind: 'limited', detail: null, count: 0, resets_at: RESET, scheduled: false, elsewhere: false });
    // B gets the same blocker and the same failed result, marked as the other Mac's.
    const onB = item(b, 't-1')!;
    expect(onB.result?.status).toBe('failed');
    expect(onB.result?.uid).toBe(item(a, 't-1')!.result?.uid);
    expect(onB.blockers).toEqual([{ kind: 'limited', detail: null, count: 0, resets_at: RESET, scheduled: false, elsewhere: true }]);
    expect(b.db.threads.get('t-1')).toMatchObject({ status: 'failed', limit_state: 'limited', limit_resets_at: RESET, limit_elsewhere: 1 });
    expect(a.db.threads.get('t-1')).toMatchObject({ limit_state: 'limited', limit_elsewhere: 0 });
    // Open clients on B redraw: the thread for its card, Needs you for the list.
    expect(b.feed).toContainEqual({ type: 'needs_you', thread_id: 't-1' });
    expect(b.feed.some((e) => e.type === 'thread' && e.thread.id === 't-1' && e.thread.limit_state === 'limited')).toBe(true);
  });

  it('follows the owner scheduling and cancelling, and B cannot move it itself', async () => {
    expect(a.db.threads.moveLimit('t-1', 'limited', 'scheduled')).toBe(true);
    await exchange();
    expect(blocker(b, 't-1')).toMatchObject({ scheduled: true, resets_at: RESET, elsewhere: true });
    // B never schedules or sends A's continuation: it has none of its own to fire.
    expect(b.db.threads.scheduledLimits()).toEqual([]);
    expect(b.db.threads.moveLimit('t-1', 'scheduled', 'limited')).toBe(false);
    expect(b.db.threads.takeLimit('t-1', ['limited', 'scheduled'])).toBeNull();
    expect(a.db.threads.scheduledLimits().map((r) => r.id)).toEqual(['t-1']);

    expect(a.db.threads.moveLimit('t-1', 'scheduled', 'limited')).toBe(true);
    await exchange();
    expect(blocker(b, 't-1')).toMatchObject({ scheduled: false, elsewhere: true });
  });

  it('goes away on B once A sends the continuation', async () => {
    expect(a.db.threads.takeLimit('t-1', ['limited'])).toBe('stop-t-1');
    await exchange();
    expect(blocker(a, 't-1')).toBeNull();
    expect(blocker(b, 't-1')).toBeNull();
    expect(b.db.threads.get('t-1')).toMatchObject({ limit_state: null, limit_resets_at: null, limit_elsewhere: 0 });
  });

  it('keeps "no reset time" on B, so only the owner resumes it by hand', async () => {
    started(a, 't-2');
    await exchange();
    limited(a, 't-2', null);
    await exchange();
    expect(blocker(b, 't-2')).toEqual({ kind: 'limited', detail: null, count: 0, resets_at: null, scheduled: false, elsewhere: true });
  });

  it('clears on both when B moves the thread on, and A no longer resumes it', async () => {
    started(a, 't-3');
    await exchange();
    limited(a, 't-3');
    a.db.threads.moveLimit('t-3', 'limited', 'scheduled');
    await exchange();
    expect(blocker(b, 't-3')).toMatchObject({ scheduled: true });

    // A message, Stop or archive on B clears the stop there (queue.ts, session.ts, threads-api.ts).
    expect(b.db.threads.setLimit('t-3', null)).toBe(true);
    await exchange();
    expect(blocker(b, 't-3')).toBeNull();
    expect(blocker(a, 't-3')).toBeNull();
    expect(a.db.threads.limit('t-3')).toBeUndefined();
    expect(a.db.threads.scheduledLimits().map((r) => r.id)).not.toContain('t-3');
  });

  it('is apart from the thread row: a rename on B after the stop keeps it on both', async () => {
    started(a, 't-4');
    await exchange();
    limited(a, 't-4');
    await exchange();
    b.db.threads.update('t-4', { title: 'renamed on B' });
    await exchange();
    for (const m of [a, b]) expect(m.db.threads.get('t-4')).toMatchObject({ title: 'renamed on B', status: 'failed', limit_state: 'limited' });
    expect(blocker(b, 't-4')).toMatchObject({ elsewhere: true });
    expect(blocker(a, 't-4')).toMatchObject({ elsewhere: false });
  });
});
