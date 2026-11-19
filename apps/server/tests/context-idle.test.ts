import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX } from './support.ts';

// An idle thread's context level and Compact. The last reading a turn left is kept in kv, so the meter shows it while
// no process runs and after a restart, and Compact on a thread with no process starts one, compacts, and moves the
// level. The fake CLIs report a context that grows each call and shrinks on /compact (CTX: in fake-claude.mjs).

let H: Awaited<ReturnType<typeof startRunner>>;
let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
let ctx: typeof import('../context.ts');
/** Connections the restarted copies opened, closed before the runner's teardown removes the data dir. */
const opened: { close: () => void }[] = [];

beforeAll(async () => {
  H = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX });
  ({ app } = await import('../app.ts'));
  ctx = await import('../context.ts');
  const svc = await import('../harness/catalog-service.ts');
  await svc.loadCatalog();
});
afterAll(() => {
  for (const c of opened) c.close();
});

const get = async (id: string) => (await (await app.request(`/api/threads/${id}/context`)).json()) as any;
const compact = (id: string) => app.request(`/api/threads/${id}/compact`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
const kept = (id: string) => H.db.kv.get<{ used: number; source: string }>(`context-last:${id}`);
const poll = async <T>(label: string, fn: () => Promise<T | false | undefined | null>, timeout = 8000): Promise<T> => {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
};

/** What a restarted server answers: a fresh context.ts with nothing in memory, over the same database. */
async function afterRestart(id: string) {
  vi.resetModules();
  const fresh: typeof import('../context.ts') = await import('../context.ts');
  const db: typeof import('../db.ts') = await import('../db.ts');
  opened.push(db.db);
  return fresh.contextView(db.threads.get(id)!);
}

/** End the thread's warm process, as an idle timeout or a quit does: the next turn starts a new one. */
async function endProcess(id: string) {
  for (const s of H.spawns(id)) if (H.fakeAlive(s.pid, 'fake-claude.mjs')) process.kill(s.pid, 'SIGTERM');
  await H.until('the process to go', () => !H.runner.isLive(id));
}

describe('Claude Code, idle', () => {
  it('keeps the last turn’s reading, shows it after a restart, and compacts with no process', async () => {
    const t = await H.start('CTX:120000 hello');
    await H.untilResults(t.id, 1);
    // The CLI's split arrives after the result, on an idle thread: kept as it comes.
    await poll('the kept reading', async () => kept(t.id)?.source === 'claude-cli' && kept(t.id)!.used === 121_500);

    const restarted = await afterRestart(t.id);
    expect(restarted.context).toMatchObject({ used: 121_500, max: 200_000, source: 'claude-cli' });
    expect(restarted.context?.categories?.map((c) => c.name)).toContain('Messages');
    expect(restarted.compact).toEqual({ ok: true, focus: true });

    await endProcess(t.id);
    expect((await compact(t.id)).status).toBe(200);
    await H.untilResults(t.id, 2);
    // A new process ran the compaction, and its reading replaces the kept one.
    expect(H.spawns(t.id)).toHaveLength(2);
    await poll('the reading after /compact', async () => (await get(t.id)).context?.used === 8000);
    await poll('the kept reading after /compact', async () => kept(t.id)?.used === 8000);
    expect((await afterRestart(t.id)).context).toMatchObject({ used: 8000, source: 'claude-cli' });
  });

  it('writes the reading once a turn ends, not on every call to the model', async () => {
    const t = await H.start('CTX:50000 hello');
    await H.untilResults(t.id, 1);
    await poll('the first kept reading', async () => kept(t.id)?.used === 51_500);
    const sets: string[] = [];
    const kv = H.db.kv;
    const set = kv.set;
    kv.set = (key, value) => (key === `context-last:${t.id}` && sets.push(H.thread(t.id).status), set(key, value));
    try {
      H.runner.sendMessage(t.id, 'TOOL:10 TOOL:10 TOOL:10 keep going');
      await H.untilResults(t.id, 2);
      await poll('the kept reading after the turn', async () => kept(t.id)!.used > 51_500);
    } finally {
      kv.set = set;
    }
    // The stream's per-call totals moved the live reading; none of them was written while the turn ran.
    expect(sets.length).toBeGreaterThan(0);
    expect(sets).not.toContain('running');
  });

  it('forgets the reading when the thread starts over with fresh context', async () => {
    const t = await H.start('CTX:90000 hello');
    await H.untilResults(t.id, 1);
    await poll('the kept reading', async () => kept(t.id)?.used === 91_500);
    const res = await app.request(`/api/threads/${t.id}/session/fresh`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(kept(t.id)).toBeUndefined();
    expect((await get(t.id)).context).toBeNull();
  });
});

describe('Codex, idle', () => {
  it('shows the kept reading after a restart, and compacts with no process', async () => {
    const t = await H.start('hello', { harness: 'codex', model: 'gpt-5.6-sol' });
    await H.untilResults(t.id, 1, 12000);
    await poll('the kept reading', async () => kept(t.id)?.source === 'codex' && kept(t.id));
    // Before this was kept, a Codex thread showed nothing once its process was gone.
    expect((await afterRestart(t.id)).context).toMatchObject({ used: 32_000, max: 272_000, source: 'codex' });

    expect((await compact(t.id)).status).toBe(200);
    await poll('the kept reading after compacting', async () => kept(t.id)?.used === 5000);
    expect((await afterRestart(t.id)).context).toMatchObject({ used: 5000, source: 'codex' });
  });
});

describe('Cursor, idle', () => {
  it('shows a kept reading with Compact off and the reason', async () => {
    // A thread row's shape with an id no process has reported on, so only the kept reading can answer.
    const t = { ...H.thread((await H.start('hello')).id), id: 'cursor-kept-reading', harness: 'cursor', status: 'done' as const, has_run: 1 };
    H.db.kv.set(`context-last:${t.id}`, { used: 30_000, max: 200_000, model: 'auto', source: 'cursor', updated_at: new Date().toISOString() });
    const view = ctx.contextView(t);
    expect(view.context).toMatchObject({ used: 30_000, source: 'cursor' });
    expect(view.compact).toEqual({ ok: false, reason: 'Cursor Agent has no compact command.', focus: false });
  });
});
