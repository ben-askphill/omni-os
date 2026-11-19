import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// Show technical details and the Shopify add-on: one value in kv, seeded from what the install already holds, set over
// PUT /api/display and synced like the other preferences.

const r = await startRunner();
const { db } = r;
const { metaApi } = await import('../meta-api.ts');
const { DISPLAY_KEY } = await import('../display.ts');
const { applyChange } = await import('../sync/apply.ts');
await import('../sync/handlers/index.ts');
const raw = (await import('../db.ts')).db;
const { buildSystemPrompt } = await import('../runner/prompts.ts');

const get = async () => (await metaApi.request('/display')).json();
const put = (body: unknown) => metaApi.request('/display', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const forget = () => raw.prepare('DELETE FROM kv WHERE key = ?').run(DISPLAY_KEY);
const feed = () => {
  const seen: string[] = [];
  const on = (e: { type: string }) => seen.push(e.type);
  r.bus.on('feed', on);
  return { seen, stop: () => r.bus.off('feed', on) };
};

describe('display switches', () => {
  it('starts a new install with both off', async () => {
    forget();
    expect(raw.prepare('SELECT COUNT(*) AS n FROM threads').get()).toEqual({ n: 0 });
    expect(await get()).toEqual({ technical: false, shopify: false });
  });

  it('keeps technical detail on for an install that already has threads, and the add-on where a channel has a store', async () => {
    await r.start('hello');
    db.channels.create({ id: 'shop', name: 'Shop', store_domain: 'acme.myshopify.com' });
    forget();
    expect(await get()).toEqual({ technical: true, shopify: true });
    // Seeded once: a later read keeps what was saved.
    db.channels.update('shop', { store_domain: '' });
    expect(await get()).toEqual({ technical: true, shopify: true });
  });

  it('sets either switch, tells the clients and refuses a body that is not booleans', async () => {
    const f = feed();
    const res = await put({ technical: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ technical: false, shopify: true });
    expect(f.seen).toContain('display');
    f.stop();
    expect((await put({ technical: 'no' })).status).toBe(400);
    expect((await put({})).status).toBe(400);
    expect(await get()).toEqual({ technical: false, shopify: true });
  });

  it('takes the value another machine saved and tells the clients', async () => {
    const f = feed();
    const ts = new Date(Date.now() + 60_000).toISOString();
    await applyChange({ seq: 1, machine_id: 'other-mac', entity: 'kv', entity_id: DISPLAY_KEY, op: 'upsert', data: { value: { technical: true, shopify: false } }, ts }, { machineId: 'this-mac' });
    expect(await get()).toEqual({ technical: true, shopify: false });
    expect(f.seen).toContain('display');
    f.stop();
  });

  it("gives the agent the channel's store and portal lines only while the Shopify pack is on", async () => {
    db.channels.update('shop', { store_domain: 'acme.myshopify.com', portal_slug: 'acme' });
    const t = await r.start('hello');
    const shop = db.channels.get('shop')!;
    await put({ shopify: true });
    const on = buildSystemPrompt(r.thread(t.id), shop);
    expect(on).toContain('- Shopify store: acme.myshopify.com');
    expect(on).toContain('- Client portal slug: acme');
    await put({ shopify: false });
    const off = buildSystemPrompt(r.thread(t.id), shop);
    expect(off).not.toContain('Shopify store');
    expect(off).not.toContain('portal slug');
  });
});
