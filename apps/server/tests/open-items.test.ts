import { describe, it, expect } from 'vitest';
import { readOpenItems } from '@omni/shared/open-items.ts';
import { startRunner } from './runner-boot.ts';

// After a finished turn, Haiku lists what the agent left open for Ben: a card under the transcript to answer, spin off or dismiss.
const h = await startRunner({ OMNI_SUGGESTIONS: '1' });
const r = h.runner;
const { threadsApi } = await import('../threads-api.ts');
const { threadRoutesApi } = await import('../thread-routes-api.ts');
const T = { timeout: 20_000 };

const openCalls = () => h.invocations().filter((i) => i.entrypoint === 'omni-os-open-items');
const items = (id: string) => readOpenItems(h.thread(id).open_items);
const patch = (id: string, body: unknown) =>
  threadsApi.request(`/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const FAKE = [
  { kind: 'question', text: 'Should the export include archived threads?' },
  { kind: 'decision', text: 'Store the cache in SQLite or in Postgres?', options: ['SQLite', 'Postgres'] },
  { kind: 'blocker', text: 'The APNs key is missing from the secret store, so push alerts cannot be tested.' },
];

describe('runner: open items after a turn', () => {
  it('stores what a turn ending on questions, decisions and blockers leaves open, without touching updated_at', T, async () => {
    const t = await h.start('OPEN_ITEMS');
    await h.untilResults(t.id, 1);
    const done = h.thread(t.id).updated_at;
    await h.until('open items', () => h.thread(t.id).open_items);
    expect(items(t.id)).toEqual(FAKE);
    expect(h.thread(t.id).updated_at).toBe(done);
    expect(openCalls().at(-1)?.args).toEqual(expect.arrayContaining(['--model', 'haiku', '--tools', '']));
  });

  it("lists them in the Conductor's thread summary, and leaves the field out when none are open", T, async () => {
    const t = await h.start('OPEN_ITEMS');
    await h.until('open items', () => h.thread(t.id).open_items);
    expect(await (await threadRoutesApi.request(`/${t.id}/summary`)).json()).toMatchObject({ id: t.id, open_items: FAKE });
    await patch(t.id, { open_items: null });
    expect(await (await threadRoutesApi.request(`/${t.id}/summary`)).json()).not.toHaveProperty('open_items');
  });

  it('stores none for a clean turn', T, async () => {
    const n = openCalls().length;
    const t = await h.start('hello');
    await h.untilResults(t.id, 1);
    await h.until('open-items call ran', () => openCalls().length > n);
    await new Promise((res) => setTimeout(res, 500));
    expect(h.thread(t.id).open_items).toBeNull();
    expect(items(t.id)).toEqual([]);
  });

  it('drops them when a message is sent, answers included', T, async () => {
    const t = await h.start('OPEN_ITEMS');
    await h.until('open items', () => h.thread(t.id).open_items);
    r.sendMessage(t.id, 'My answers to what you left open: SQLite');
    expect(h.thread(t.id).open_items).toBeNull();
  });

  it('drops an answer that comes back after another message was sent', T, async () => {
    const t = await h.start('OPEN_ITEMS OPEN:800');
    await h.untilResults(t.id, 1);
    // As for the follow-up thread: settle the title first, or the second turn reads OPEN_ITEMS from it.
    await h.until('title', () => h.thread(t.id).title === 'Fake title');
    r.sendMessage(t.id, 'carry on');
    await h.untilResults(t.id, 2);
    await new Promise((res) => setTimeout(res, 1200));
    expect(h.thread(t.id).open_items).toBeNull();
  });

  it('PATCH dismiss_open_item drops one and open_items: null drops the rest, keeping the thread in place', T, async () => {
    const t = await h.start('OPEN_ITEMS');
    await h.until('open items', () => h.thread(t.id).open_items);
    const before = h.thread(t.id).updated_at;

    const one = await patch(t.id, { dismiss_open_item: FAKE[1].text });
    expect(one.status).toBe(200);
    expect(readOpenItems(((await one.json()) as { open_items: string }).open_items)).toEqual([FAKE[0], FAKE[2]]);
    // A text no item has changes nothing.
    await patch(t.id, { dismiss_open_item: 'not on the card' });
    expect(items(t.id)).toEqual([FAKE[0], FAKE[2]]);

    const all = await patch(t.id, { open_items: null });
    expect(all.status).toBe(200);
    expect(await all.json()).toMatchObject({ id: t.id, open_items: null });
    expect(h.thread(t.id).updated_at).toBe(before);
    expect((await patch(t.id, { open_items: [] })).status).toBe(400);
    expect((await patch(t.id, { dismiss_open_item: '' })).status).toBe(400);
  });
});
