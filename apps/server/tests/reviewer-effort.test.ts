import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX } from './support.ts';

vi.mock('../secrets.ts', async (original) => ({
  ...(await original<typeof import('../secrets.ts')>()),
  globalSecret: async () => null,
  secretsEnv: async () => ({}),
}));

// Ben's rule: a GPT review runs at high effort, never xhigh. A reviewer thread on Codex gets high however it was asked
// for, when it is made, when its run is switched and when it is continued; a Claude reviewer keeps xhigh.
let H: Awaited<ReturnType<typeof startRunner>>;
let app: Awaited<typeof import('../app.ts')>['app'];

const gptXhigh = { harness: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' };

beforeAll(async () => {
  H = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX });
  await (await import('../harness/catalog-service.ts')).loadCatalog();
  ({ app } = await import('../app.ts'));
});

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json()) as any };
};
const transition = (id: string, req: object) => call('POST', `/threads/${id}/transitions`, req);
const turnEffort = (id: string) => H.codexRequests().find((r) => r.method === 'turn/start' && r.thread_id === id)?.params.effort;

describe('a GPT reviewer runs at high effort', () => {
  it('is saved and sent at high when delegated at xhigh', async () => {
    const t = await H.start('review PR 1', { role: 'reviewer', ...gptXhigh });
    await H.untilResults(t.id, 1);
    expect(H.thread(t.id)).toMatchObject({ role: 'reviewer', harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
    expect(turnEffort(t.id)).toBe('high');
  });

  it('gets high when it names no effort, rather than the model default', async () => {
    const t = await H.start('review PR 2', { role: 'reviewer', harness: 'codex', model: 'gpt-5.6-sol' });
    await H.untilResults(t.id, 1);
    expect(H.thread(t.id).effort).toBe('high');
    expect(turnEffort(t.id)).toBe('high');
  });

  it('stays at high when its run is switched to xhigh', async () => {
    const t = await H.start('review PR 3', { role: 'reviewer', harness: 'codex', model: 'gpt-5.6-sol', effort: 'medium' });
    await H.untilResults(t.id, 1);
    expect(H.thread(t.id).effort).toBe('high');
    const made = await transition(t.id, { kind: 'reconfigure', run: gptXhigh });
    expect(made.status).toBe(200);
    // Already at high: nothing to switch, and the transition says the run it holds.
    expect(made.body).toMatchObject({ state: 'applied', run: { effort: 'high' }, thread: { effort: 'high' } });
  });

  it('is continued at high when the continuation asks for xhigh', async () => {
    const t = await H.start('review PR 4', { role: 'reviewer', ...gptXhigh });
    await H.untilResults(t.id, 1);
    const p = await call('POST', `/threads/${t.id}/transitions/preview`, { kind: 'fork', run: gptXhigh });
    expect(p.body.blocked).toBeNull();
    const made = await transition(t.id, { kind: 'fork', run: gptXhigh, text: 'again', request_id: randomUUID(), revision: p.body.revision });
    expect(made.status).toBe(200);
    expect(made.body.fork.thread).toMatchObject({ role: 'reviewer', harness: 'codex', effort: 'high' });
  });

  it('leaves a Claude reviewer at xhigh, and a GPT thread in another role', async () => {
    const claude = await H.start('review PR 5', { role: 'reviewer', harness: 'claude-code', model: 'claude-opus-5-5', effort: 'xhigh' });
    const builder = await H.start('build it', { role: 'builder', ...gptXhigh });
    await H.untilResults(claude.id, 1);
    await H.untilResults(builder.id, 1);
    expect(H.thread(claude.id).effort).toBe('xhigh');
    expect(H.thread(builder.id).effort).toBe('xhigh');
    expect(turnEffort(builder.id)).toBe('xhigh');
  });
});
