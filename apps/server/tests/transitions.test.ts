import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX } from './support.ts';

vi.mock('../secrets.ts', async (original) => ({
  ...(await original<typeof import('../secrets.ts')>()),
  globalSecret: async () => null,
  secretsEnv: async () => ({}),
}));

// The transition service (apps/server/transition.ts) through its four routes, /api/threads/:id/transitions
// (preview, create, read, cancel), for a reconfigure (run switch) and a fork (Continue) against the real runner and the
// fake claude and codex CLIs, and for a relocate with sync off. The older routes answer through the same service:
// run-switch.test.ts, continue.test.ts and the two-Mac handoff tests hold them to their shapes.
let H: Awaited<ReturnType<typeof startRunner>>;
let app: Awaited<typeof import('../app.ts')>['app'];

const claude = { harness: 'claude-code', model: 'sonnet', effort: 'high' };
const codex = { harness: 'codex', model: '', effort: '' };

beforeAll(async () => {
  H = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX });
  await (await import('../harness/catalog-service.ts')).loadCatalog(['codex']);
  ({ app } = await import('../app.ts'));
});

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json()) as any };
};
const preview = (id: string, req: object) => call('POST', `/threads/${id}/transitions/preview`, req);
const create = (id: string, req: object) => call('POST', `/threads/${id}/transitions`, req);
const read = (id: string, tid: string) => call('GET', `/threads/${id}/transitions/${tid}`);
const cancel = (id: string, tid: string) => call('POST', `/threads/${id}/transitions/${tid}/cancel`, {});
const kinds = (id: string) => H.events(id).map((e) => e.kind);

describe('reconfigure: a run switch', () => {
  it('previews what the switch would do, and refuses what the catalog does not offer', async () => {
    const t = await H.start('first', claude);
    await H.untilResults(t.id, 1);
    expect((await preview(t.id, { kind: 'reconfigure', run: { ...claude, effort: 'low' } })).body).toMatchObject({
      kind: 'reconfigure', blocked: null, mode: 'settings', waits: false, run: { harness: 'claude-code', harnessName: 'Claude Code' },
    });
    expect((await preview(t.id, { kind: 'reconfigure', run: codex })).body).toMatchObject({ mode: 'handover', blocked: null });
    expect((await preview(t.id, { kind: 'reconfigure', run: claude })).body).toMatchObject({ mode: 'none', blocked: null });
    expect((await preview(t.id, { kind: 'reconfigure', run: { harness: 'nope', model: '', effort: '' } })).body.blocked).toBe('Unknown harness "nope".');
    expect((await preview(t.id, { kind: 'reconfigure', run: { ...claude, model: 'no-such-model' } })).body.blocked).toMatch(/no-such-model/);
  });

  it('applies between turns: created applied, read applied, cancel refused', async () => {
    const t = await H.start('first', claude);
    await H.untilResults(t.id, 1);
    const made = await create(t.id, { kind: 'reconfigure', run: { ...claude, effort: 'low' } });
    expect(made.status).toBe(200);
    expect(made.body).toMatchObject({ kind: 'reconfigure', thread_id: t.id, state: 'applied', error: null, run: { effort: 'low' }, thread: { id: t.id, effort: 'low' } });
    expect(H.byKind(t.id, 'switch').map((e) => e.p.mode)).toEqual(['settings']);

    expect((await read(t.id, made.body.id)).body).toMatchObject({ id: made.body.id, state: 'applied' });
    const refused = await cancel(t.id, made.body.id);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('This run switch has applied already. Switch the run back instead.');
    expect((await read(t.id, 'no-such-transition')).status).toBe(404);
    expect((await read('no-such-thread', made.body.id)).status).toBe(404);
  });

  it('waits on a running turn, can be cancelled, and the next pick applies when the turn ends', async () => {
    const t = await H.start('TOOL:600 a long one', claude);
    await H.untilTool(t.id);
    const first = await create(t.id, { kind: 'reconfigure', run: { ...claude, effort: 'low' } });
    expect(first.body).toMatchObject({ state: 'queued', thread: { effort: 'high', queued_effort: 'low' } });
    expect((await preview(t.id, { kind: 'reconfigure', run: codex })).body).toMatchObject({ waits: true, blocked: null });

    const dropped = await cancel(t.id, first.body.id);
    expect(dropped.status).toBe(200);
    expect(dropped.body).toMatchObject({ state: 'cancelled', thread: { queued_harness: null } });
    expect((await read(t.id, first.body.id)).body.state).toBe('cancelled');

    const second = await create(t.id, { kind: 'reconfigure', run: { ...claude, model: 'claude-opus-5-5', effort: '' } });
    expect(second.body.state).toBe('queued');
    // A later pick replaces the one waiting.
    const third = await create(t.id, { kind: 'reconfigure', run: codex });
    expect(third.body.state).toBe('queued');
    expect((await read(t.id, second.body.id)).body.state).toBe('cancelled');

    await H.untilResults(t.id, 1);
    await H.until('the queued switch to apply', () => H.thread(t.id).harness === 'codex');
    expect((await read(t.id, third.body.id)).body).toMatchObject({ state: 'applied', thread: { harness: 'codex', queued_harness: null } });
    expect(kinds(t.id).indexOf('result')).toBeLessThan(kinds(t.id).indexOf('switch'));
  });
});

describe('fork: a continued thread', () => {
  it('previews the Carryover, starts the new thread once per request id, and cannot be cancelled', async () => {
    const t = await H.start('remember the word PAPAYA', claude);
    await H.untilResults(t.id, 1);
    const p = await preview(t.id, { kind: 'fork', run: codex });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ kind: 'fork', workspace: 'folder', blocked: null, carryover: { source: { id: t.id } } });
    expect(p.body.revision).toMatch(/^[0-9a-f]{16}$/);

    const request_id = randomUUID();
    const made = await create(t.id, { kind: 'fork', run: codex, text: 'what word?', request_id, revision: p.body.revision });
    expect(made.status).toBe(200);
    expect(made.body).toMatchObject({ kind: 'fork', thread_id: t.id, state: 'started', error: null, run: { harness: 'codex' }, fork: { duplicate: false } });
    const forked = made.body.fork.thread;
    expect(made.body.id).toBe(forked.id);
    expect(forked).toMatchObject({ harness: 'codex', continued_from: t.id, title: `${H.thread(t.id).title} (continued)` });
    expect(H.thread(t.id)).toMatchObject({ harness: 'claude-code', status: 'done' });

    const again = await create(t.id, { kind: 'fork', run: codex, text: 'what word?', request_id, revision: p.body.revision });
    expect(again.body).toMatchObject({ id: forked.id, fork: { thread: { id: forked.id }, duplicate: true } });

    expect((await read(t.id, forked.id)).body).toMatchObject({ kind: 'fork', state: 'started', fork: { thread: { id: forked.id } } });
    const refused = await cancel(t.id, forked.id);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/thread of its own/);

    await H.untilResults(forked.id, 1);
    expect(H.byKind(forked.id, 'carryover')).toHaveLength(1);
  });

  it('refuses a stale revision and a busy source as Continue does', async () => {
    const t = await H.start('TOOL:600 slow', claude);
    await H.untilTool(t.id);
    const busy = await create(t.id, { kind: 'fork', run: codex, text: 'go', request_id: randomUUID(), revision: 'x' });
    expect(busy.status).toBe(409);
    expect(busy.body).toMatchObject({ code: 'busy', block: { code: 'running' } });
    await H.untilResults(t.id, 1);
    const stale = await create(t.id, { kind: 'fork', run: codex, text: 'go', request_id: randomUUID(), revision: 'stale' });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'changed', preview: { blocked: null } });
    expect((await create(t.id, { kind: 'fork', run: codex, text: '  ', request_id: 'r', revision: 'x' })).status).toBe(400);
  });
});

describe('relocate with sync off', () => {
  it('previews as blocked and refuses to start, for a handoff and for a Take over', async () => {
    const t = await H.start('first', claude);
    await H.untilResults(t.id, 1);
    const why = 'Sync is not set up on this Mac. Moving a thread between Macs needs sync on both.';
    expect((await preview(t.id, { kind: 'relocate', to: 'mac-b' })).body).toEqual({ kind: 'relocate', from: null, to: null, blocked: why, running: false, takeover: false });
    expect((await preview(t.id, { kind: 'relocate', to: 'here' })).body).toEqual({ kind: 'relocate', from: null, to: null, blocked: why, running: false, takeover: true });
    for (const to of ['mac-b', 'here']) {
      const res = await create(t.id, { kind: 'relocate', to });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe(why);
    }
    // The older routes refuse the same way.
    expect((await call('POST', `/threads/${t.id}/handoff`, { to: 'mac-b' })).body.error).toBe(why);
    expect((await call('POST', `/threads/${t.id}/takeover`, {})).body.error).toBe(why);
    expect((await call('POST', `/threads/${t.id}/handoff/cancel`, {})).body.error).toBe('This thread is not being handed off from this Mac.');
  });

  it('rejects a body with no kind', async () => {
    const t = await H.start('first', claude);
    expect((await preview(t.id, { to: 'mac-b' })).status).toBe(400);
    expect((await create(t.id, { run: codex })).status).toBe(400);
  });
});
