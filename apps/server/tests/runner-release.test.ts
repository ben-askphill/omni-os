import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { sleep } from './support.ts';

// A thread handed to another Mac is released here: its turn stops, its process ends for good, and the messages it
// never read come back to travel with it instead of being dropped. One slot, so a second thread waits for it.
const h = await startRunner({ OMNI_MAX_CONCURRENT: '1', OMNI_KEEPALIVE_SECONDS: '60' });
const r = h.runner;
const T = { timeout: 30_000 };

const texts = (msgs: { text: string }[]) => msgs.map((m) => m.text);
const dropped = (id: string) => h.events(id).filter((e) => e.p?.dropped);

describe('releasing a thread for a handoff', () => {
  it('stops a running turn, ends its process and returns its unread messages in order', T, async () => {
    const t = await h.start('TOOL:30000 audit the checkout');
    await h.untilTool(t.id);
    const steer = await r.postMessage(t.id, 'also check the tax lines', { mode: 'steer' });
    const queued = await r.postMessage(t.id, 'then the cart drawer', { mode: 'queue' });
    // A second thread waits for the one slot.
    const next = await h.start('summarize the audit');
    await h.untilStatus(next.id, 'queued');

    expect(texts(await r.releaseForHandoff(next.id))).toEqual(['summarize the audit']);
    expect(h.spawns(next.id)).toEqual([]);
    expect(h.thread(next.id).status).toBe('stopped');

    const [spawn] = h.spawns(t.id);
    const msgs = await r.releaseForHandoff(t.id);
    expect(texts(msgs)).toEqual(['also check the tax lines', 'then the cart drawer']);
    expect(msgs.map((m) => m.requestId)).toEqual([steer.request.request_id, queued.request.request_id]);
    expect(h.thread(t.id).status).toBe('stopped');
    expect(r.isLive(t.id)).toBe(false);
    expect(h.fakeAlive(spawn.pid)).toBe(false);
    // Nothing is marked as never sent: the caller decides where these go.
    expect(dropped(t.id)).toEqual([]);
    expect(dropped(next.id)).toEqual([]);
    expect(h.texts(t.id, 'user')).toEqual(['TOOL:30000 audit the checkout']);
    expect(r.pendingFor(t.id)).toEqual([]);
  });

  it('leaves no process behind to open a turn when a background task ends', T, async () => {
    const t = await h.start('BG:1500 fan out');
    await h.untilResults(t.id, 1);
    expect(r.isLive(t.id)).toBe(true);
    expect(await r.releaseForHandoff(t.id)).toEqual([]);
    expect(r.isLive(t.id)).toBe(false);
    await sleep(2500);
    expect(h.byKind(t.id, 'result')).toHaveLength(1);
    expect(h.statuses(t.id).at(-1)).toBe('done');
  });
});
