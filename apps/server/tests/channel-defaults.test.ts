import { describe, it, expect, beforeAll } from 'vitest';
import { startRunner } from './runner-boot.ts';

// A channel's default harness, model and effort: set through /api/channels, checked against the
// catalog, and picked up by a new thread that does not choose its own.

let H: Awaited<ReturnType<typeof startRunner>>;
let app: Awaited<typeof import('../app.ts')>['app'];

beforeAll(async () => {
  H = await startRunner();
  ({ app } = await import('../app.ts'));
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

  it('a default the catalog no longer has does not block a thread, which goes to Auto', async () => {
    H.db.channels.update('tuned', { default_model: 'claude-retired-1' });
    const t = await H.runner.createThread({ channel: 'tuned', prompt: 'hi' });
    expect(H.thread(t.id)).toMatchObject({ harness: 'claude-code', auto_reason: expect.any(String) });
  });

  it('a retired default does not block a save that leaves it alone', async () => {
    H.db.channels.update('tuned', { default_model: 'claude-retired-1' });
    expect((await patch({ archived: 1 })).status).toBe(200);
    expect((await patch({ archived: 0, notes: 'y' })).status).toBe(200);
    // Touching the defaults still checks them.
    expect((await patch({ default_effort: 'low' })).status).toBe(400);
  });
});

describe('Auto', () => {
  it('picks the run for a thread that sets nothing, and says why', async () => {
    H.db.channels.create({ id: 'plain', name: 'Plain', kind: 'internal', use_worktree: 0, base_dir: H.tmp });
    const t = await H.runner.createThread({ channel: 'plain', prompt: 'What is the capital of the Netherlands?' });
    expect(H.thread(t.id)).toMatchObject({ harness: 'claude-code', model: 'claude-haiku-4-5', effort: 'low' });
    expect(H.thread(t.id).auto_reason).toMatch(/Haiku 4\.5, low effort/);
  });

  it('is a channel default, and a thread that names a model leaves it', async () => {
    expect((await patch({ default_harness: '', default_model: 'auto', default_effort: '' })).status).toBe(200);
    const auto = await H.runner.createThread({ channel: 'tuned', prompt: 'Fix the typo in README.md' });
    expect(H.thread(auto.id)).toMatchObject({ model: 'claude-sonnet-5-5', auto_reason: expect.any(String) });
    const picked = await H.runner.createThread({ channel: 'tuned', prompt: 'Fix the typo in README.md', model: 'opus' });
    expect(H.thread(picked.id)).toMatchObject({ model: 'opus', auto_reason: null });
  });
});

describe('Conductor channel defaults', () => {
  const save = async (model: string | null) => {
    const { bus } = await import('../bus.ts');
    const feed: unknown[] = [];
    const changed = (event: unknown) => feed.push(event);
    bus.on('feed', changed);
    const res = await app.request('/api/channels/conductor', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ default_harness: null, default_model: model, default_effort: null }),
    });
    bus.off('feed', changed);
    expect(res.status).toBe(200);
    expect((await res.json() as any).default_model).toBe(model);
    expect(feed).toContainEqual({ type: 'channel', id: 'conductor' });
  };
  const start = (over = {}) => H.runner.createThread({ channel: 'conductor', role: 'conductor', prompt: 'Fix the typo in README.md', ...over });

  it('uses saved settings instead of the automatically attached role, including after a change', async () => {
    await save('claude-sonnet-5-5');
    const pinned = await start();
    expect(H.thread(pinned.id)).toMatchObject({ role: 'conductor', model: 'claude-sonnet-5-5', auto_reason: null });
    await save('auto');
    const auto = await start();
    expect(H.thread(auto.id)).toMatchObject({ role: 'conductor', model: 'claude-sonnet-5-5', auto_reason: expect.any(String) });
    const explicit = await start({ model: 'claude-haiku-4-5', effort: 'low' });
    expect(H.thread(explicit.id)).toMatchObject({ model: 'claude-haiku-4-5', effort: 'low', auto_reason: null });
  });

  it('uses Auto for a retired saved default instead of falling back to the Opus charter', async () => {
    H.db.channels.update('conductor', { default_model: 'claude-retired-1' });
    // The exact JSON the untouched web/phone/Mac composers send: no inherited model promoted to a pick.
    const response = await app.request('/api/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel: 'conductor', role: 'conductor', prompt: 'Fix the typo in README.md' }),
    });
    expect(response.status).toBe(200);
    const t = await response.json() as any;
    expect(H.thread(t.id)).toMatchObject({ model: 'claude-sonnet-5-5', auto_reason: expect.any(String) });
    await expect(start({ model: 'claude-retired-1' })).rejects.toThrow(/Unknown Claude Code model/);
  });

  it('uses the Auto charter default when no channel default is saved', async () => {
    await save(null);
    const unset = await start();
    expect(H.thread(unset.id)).toMatchObject({ model: 'claude-sonnet-5-5', auto_reason: expect.any(String) });
    const other = await start({ channel: 'tuned' });
    expect(H.thread(other.id)).toMatchObject({ model: 'claude-sonnet-5-5', auto_reason: expect.any(String) });
  });
});
