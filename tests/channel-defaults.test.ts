import { describe, it, expect, beforeAll } from 'vitest';
import { startRunner } from './runner-boot.ts';

// A channel's default harness, model and effort: set through /api/channels, checked against the
// catalog, and picked up by a new thread that does not choose its own.

let H: Awaited<ReturnType<typeof startRunner>>;
let app: Awaited<typeof import('../server/app.ts')>['app'];

beforeAll(async () => {
  H = await startRunner();
  ({ app } = await import('../server/app.ts'));
  H.db.channels.create({ id: 'tuned', name: 'Tuned', kind: 'internal', use_worktree: 0, base_dir: H.tmp });
});

const patch = async (body: unknown) => {
  const res = await app.request('/api/channels/tuned', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
};

describe('channel run defaults', () => {
  it('sets, keeps and clears them', async () => {
    const set = await patch({ default_harness: 'claude-code', default_model: 'claude-opus-5-5', default_effort: 'max' });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ default_harness: 'claude-code', default_model: 'claude-opus-5-5', default_effort: 'max' });
    expect((await patch({ notes: 'x' })).body.default_model).toBe('claude-opus-5-5');
    expect((await patch({ default_effort: '' })).body.default_effort).toBeNull();
  });

  it('refuses a model or effort the catalog does not have', async () => {
    const bad = await patch({ default_model: 'gpt-nope' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/Unknown Claude Code model/);
    // An effort is checked against the model the channel already has.
    expect((await patch({ default_effort: 'turbo' })).status).toBe(400);
  });

  it("a new thread runs on the channel's default when it picks nothing", async () => {
    await patch({ default_harness: 'claude-code', default_model: 'claude-opus-5-5', default_effort: 'low' });
    const t = await H.runner.createThread({ channel: 'tuned', prompt: 'hi' });
    expect(H.thread(t.id)).toMatchObject({ harness: 'claude-code', model: 'claude-opus-5-5', effort: 'low' });
  });

  it("the thread's own choice wins", async () => {
    const t = await H.runner.createThread({ channel: 'tuned', prompt: 'hi', model: 'claude-haiku-4-5' });
    expect(H.thread(t.id)).toMatchObject({ model: 'claude-haiku-4-5', effort: '' });
  });

  it('a default the catalog no longer has does not block a thread', async () => {
    H.db.channels.update('tuned', { default_model: 'claude-retired-1' });
    const t = await H.runner.createThread({ channel: 'tuned', prompt: 'hi' });
    expect(H.thread(t.id)).toMatchObject({ harness: 'claude-code', model: null, effort: '' });
  });

  it('a retired default does not block a save that leaves it alone', async () => {
    H.db.channels.update('tuned', { default_model: 'claude-retired-1' });
    expect((await patch({ archived: 1 })).status).toBe(200);
    expect((await patch({ archived: 0, notes: 'y' })).status).toBe(200);
    // Touching the defaults still checks them.
    expect((await patch({ default_effort: 'low' })).status).toBe(400);
  });
});
