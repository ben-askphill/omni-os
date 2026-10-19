import { describe, it, expect } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { sleep } from './support.ts';

// One slot. Only turns in progress hold it; a warm idle process does not.
const h = await startRunner({ OMNI_MAX_CONCURRENT: '1' });
const r = h.runner;
const T = { timeout: 20_000 };

describe('runner: concurrency slots', () => {
  it('lets idle live processes give up their slot and runs waiting threads in FIFO order', T, async () => {
    const a = await h.start('hello A');
    await h.untilResults(a.id, 1);
    expect(r.isLive(a.id)).toBe(true);
    expect(r.runningCount()).toBe(0);

    // A is still warm, yet B gets the only slot.
    const b = await h.start('TOOL:2500 B works');
    await h.untilTool(b.id);
    expect(r.runningCount()).toBe(1);

    const c = await h.start('hello C');
    r.sendMessage(a.id, 'again A');
    await sleep(100);
    expect(h.thread(c.id).status).toBe('queued');
    expect(r.pendingFor(c.id)).toMatchObject([{ kind: 'user', text: 'hello C', state: 'waiting' }]);
    expect(h.thread(a.id).status).toBe('queued');
    expect(r.pendingFor(a.id)).toMatchObject([{ kind: 'user', text: 'again A', source: 'ben', state: 'waiting' }]);
    expect(r.queuedCount()).toBe(2);
    expect(r.runningCount()).toBe(1);
    // Nothing lands in the transcript before the agent has seen it.
    expect(h.byKind(c.id, 'user')).toEqual([]);
    expect(h.byKind(a.id, 'user')).toHaveLength(1);
    expect(h.spawns(c.id)).toEqual([]);

    await h.untilResults(b.id, 1);
    await h.untilResults(c.id, 1);
    await h.untilResults(a.id, 2);
    // C waited first, so it finished before A's second message was delivered.
    expect(h.byKind(c.id, 'result')[0].id).toBeLessThan(h.byKind(a.id, 'user')[1].id);
    expect(h.byKind(a.id, 'user')[1].p).toEqual({ text: 'again A', source: 'ben' });
    expect(h.texts(a.id, 'assistant_text')).toEqual(['ack: hello A', 'ack: again A']);
    // A reused its warm process.
    expect(h.spawns(a.id)).toHaveLength(1);
    expect(r.queuedCount()).toBe(0);
    expect(r.runningCount()).toBe(0);
    expect(r.pendingFor(a.id)).toEqual([]);
    expect(r.pendingFor(c.id)).toEqual([]);
  });

  it('interrupting a thread that waits for a slot drops its message into the transcript and never starts it', T, async () => {
    const b = await h.start('TOOL:1500 busy');
    await h.untilTool(b.id);
    const d = await h.start('never runs');
    expect(h.thread(d.id).status).toBe('queued');
    expect(r.pendingFor(d.id)).toMatchObject([{ text: 'never runs', state: 'waiting' }]);

    r.interruptThread(d.id);
    await h.untilStatus(d.id, 'stopped');
    // A brand new thread is never left empty.
    expect(h.byKind(d.id, 'user').map((e) => e.p)).toMatchObject([{ text: 'never runs', dropped: true }]);
    expect(r.pendingFor(d.id)).toEqual([]);
    expect(r.queuedCount()).toBe(0);

    await h.untilResults(b.id, 1);
    await sleep(300);
    expect(h.spawns(d.id)).toEqual([]);
    expect(h.thread(d.id).status).toBe('stopped');
    expect(r.isLive(d.id)).toBe(false);
  });
});
