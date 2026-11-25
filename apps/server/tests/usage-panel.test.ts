import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// Settings > Usage panel: one value in the synced kv, read and replaced over /api/usage-panel, and taken from another
// machine like the other preferences.

const r = await startRunner();
const { metaApi } = await import('../meta-api.ts');
const { USAGE_PANEL_KEY } = await import('../usage-panel.ts');
const { applyChange } = await import('../sync/apply.ts');
await import('../sync/handlers/index.ts');
const raw = (await import('../db.ts')).db;

const get = async () => (await metaApi.request('/usage-panel')).json();
const put = (body: unknown) => metaApi.request('/usage-panel', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const feed = () => {
  const seen: string[] = [];
  const on = (e: { type: string }) => seen.push(e.type);
  r.bus.on('feed', on);
  return { seen, stop: () => r.bus.off('feed', on) };
};

describe('usage panel', () => {
  it('starts with nothing chosen and saves nothing until the user changes it', async () => {
    expect(await get()).toEqual({ order: [], visible: {} });
    expect(raw.prepare('SELECT 1 FROM kv WHERE key = ?').get(USAGE_PANEL_KEY)).toBeUndefined();
  });

  it('replaces the whole value, keeps it in the synced kv and tells the clients', async () => {
    const f = feed();
    const value = { order: ['antigravity:abc', 'claude-code:def', 'hermes'], visible: { hermes: true, 'claude-code:def': false } };
    const res = await put(value);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(value);
    expect(await get()).toEqual(value);
    expect(f.seen).toContain('usage_panel');
    f.stop();
    expect(JSON.parse((raw.prepare('SELECT value FROM kv WHERE key = ?').get(USAGE_PANEL_KEY) as { value: string }).value)).toEqual(value);
  });

  it('refuses a body that is not a whole value', async () => {
    const before = await get();
    expect((await put({ order: ['a'] })).status).toBe(400);
    expect((await put({ order: [1], visible: {} })).status).toBe(400);
    expect((await put({ order: [], visible: { a: 'yes' } })).status).toBe(400);
    expect(await get()).toEqual(before);
  });

  it('takes the value another machine saved and tells the clients', async () => {
    const f = feed();
    const ts = new Date(Date.now() + 60_000).toISOString();
    const value = { order: ['codex'], visible: { codex: false } };
    await applyChange({ seq: 1, machine_id: 'other-mac', entity: 'kv', entity_id: USAGE_PANEL_KEY, op: 'upsert', data: { value }, ts }, { machineId: 'this-mac' });
    expect(await get()).toEqual(value);
    expect(f.seen).toContain('usage_panel');
    f.stop();
  });
});
