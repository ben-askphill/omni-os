import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { sleep } from './support.ts';

// Durable requests (apps/server/db/repos/requests.ts) through the real runner and the fake claude CLI: what each
// accepted message's row says as it moves, retries with the same request id, what a shutdown parks, and how
// parked requests resume. One slot, so resuming can be checked against the harness's cap.
// apps/server/tests/requests-restart.test.ts does the same across real server restarts, over HTTP.

const h = await startRunner({ OMNI_MAX_CONCURRENT: '1' });
const r = h.runner;
const T = { timeout: 30_000 };
const row = (id: string) => h.db.messageRequests.get(id)!;
const rowsOf = (threadId: string) =>
  (h.db.db.prepare('SELECT id, state, prompt FROM message_requests WHERE thread_id = ? ORDER BY seq').all(threadId) as { id: string; state: string; prompt: string }[]);

describe('requests: accepted messages are saved and tracked', () => {
  it('saves a queued message before answering, and follows it from held to delivered', T, async () => {
    const t = await h.start('TOOL:1500 work');
    await h.untilTool(t.id);
    const posted = await r.postMessage(t.id, 'then tidy up', { mode: 'queue', requestId: 'req-held' });
    expect(posted.request).toMatchObject({ request_id: 'req-held', state: 'held' });
    expect(posted.request.duplicate).toBeUndefined();
    expect(row(posted.request.id)).toMatchObject({ prompt: 'then tidy up', mode: 'queue', source: 'ben', state: 'held', thread_id: t.id });
    expect(r.pendingFor(t.id)).toMatchObject([{ uuid: posted.request.id, text: 'then tidy up', state: 'held', request_id: 'req-held', delivery: 'held' }]);

    await h.untilResults(t.id, 2);
    const user = h.byKind(t.id, 'user')[1];
    expect(user.p).toEqual({ text: 'then tidy up', source: 'ben' });
    // The transcript keeps it where the harness read it, and the row points there.
    expect(row(posted.request.id)).toMatchObject({ state: 'delivered', event_id: user.id });
  });

  it('answers a retry with the same request id with the first acceptance, and sends it once', T, async () => {
    const t = await h.start('TOOL:1200 work');
    await h.untilTool(t.id);
    const [a, b] = await Promise.all([
      r.postMessage(t.id, 'once only', { mode: 'queue', requestId: 'req-dup' }),
      r.postMessage(t.id, 'once only', { mode: 'queue', requestId: 'req-dup' }),
    ]);
    const c = await r.postMessage(t.id, 'once only', { mode: 'queue', requestId: 'req-dup' });
    expect(b.request).toMatchObject({ id: a.request.id, accepted_at: a.request.accepted_at, duplicate: true });
    expect(c.request).toMatchObject({ id: a.request.id, accepted_at: a.request.accepted_at, duplicate: true });
    expect(r.pendingFor(t.id)).toHaveLength(1);

    // The same id with other text, or another mode, is refused.
    await expect(r.postMessage(t.id, 'something else', { mode: 'queue', requestId: 'req-dup' })).rejects.toMatchObject({ status: 409 });
    await expect(r.postMessage(t.id, 'once only', { mode: 'steer', requestId: 'req-dup' })).rejects.toMatchObject({ status: 409 });

    await h.untilResults(t.id, 2);
    expect(h.texts(t.id, 'user')).toEqual(['TOOL:1200 work', 'once only']);
    // Once delivered, a retry still gets the acceptance and sends nothing.
    const late = await r.postMessage(t.id, 'once only', { mode: 'queue', requestId: 'req-dup' });
    expect(late.request).toMatchObject({ id: a.request.id, state: 'delivered', duplicate: true });
    await sleep(200);
    expect(h.texts(t.id, 'user')).toEqual(['TOOL:1200 work', 'once only']);
  });

  it('marks a request dropped when Ben interrupts before the agent read it', T, async () => {
    const t = await h.start('TOOL:6000 long job');
    await h.untilTool(t.id);
    const q = await r.postMessage(t.id, 'never mind this', { mode: 'queue', requestId: 'req-drop' });
    r.interruptThread(t.id);
    await h.untilStatus(t.id, 'stopped');
    expect(row(q.request.id).state).toBe('dropped');
    expect(h.byKind(t.id, 'user').at(-1)!.p).toMatchObject({ text: 'never mind this', dropped: true });
  });
});

describe('requests: a shutdown parks what the runner held', () => {
  it('keeps a held message for Resume and marks one written to the harness uncertain, without dropping either', T, async () => {
    const t = await h.start('TOOL:8000 long job');
    await h.untilTool(t.id);
    const steer = await r.postMessage(t.id, 'steer: also PINEAPPLE', { mode: 'steer', requestId: 'req-steer' });
    const queued = await r.postMessage(t.id, 'queued: then MANGO', { mode: 'queue', requestId: 'req-queue' });
    expect(row(steer.request.id).state).toBe('sent');

    await r.shutdownAll();
    expect(rowsOf(t.id).map((x) => [x.prompt, x.state])).toEqual([
      ['steer: also PINEAPPLE', 'uncertain'],
      ['queued: then MANGO', 'recovered'],
    ]);
    // Not in the transcript as dropped: they wait on Ben.
    expect(h.byKind(t.id, 'user').filter((e) => e.p.dropped)).toEqual([]);
    expect(r.pendingFor(t.id)).toMatchObject([
      { uuid: steer.request.id, state: 'held', delivery: 'uncertain', request_id: 'req-steer', mode: 'steer' },
      { uuid: queued.request.id, state: 'held', delivery: 'recovered', request_id: 'req-queue', mode: 'queue' },
    ]);

    // Resume without ids sends only the recovered one. The uncertain one is never sent on its own.
    const spawned = h.spawns(t.id).length;
    await r.resumeRequests(t.id);
    await h.until('the recovered message to run', () => row(queued.request.id).state === 'delivered' && h.thread(t.id).status === 'done');
    expect(h.spawns(t.id)).toHaveLength(spawned + 1);
    expect(h.texts(t.id, 'user').filter((x) => !x.startsWith('TOOL'))).toEqual(['queued: then MANGO']);
    expect(row(queued.request.id).state).toBe('delivered');
    expect(r.pendingFor(t.id)).toMatchObject([{ uuid: steer.request.id, delivery: 'uncertain' }]);

    // Discard is the other decision: it stays in the transcript as never sent.
    r.discardRequests(t.id, [steer.request.id]);
    expect(row(steer.request.id).state).toBe('discarded');
    expect(h.byKind(t.id, 'user').at(-1)!.p).toMatchObject({ text: 'steer: also PINEAPPLE', source: 'ben', dropped: true });
    expect(r.pendingFor(t.id)).toEqual([]);
    expect(() => r.discardRequests(t.id, [steer.request.id])).toThrow(/no longer waiting/);
  });
});

describe('requests: resuming after a restart', () => {
  /** A thread with requests parked as a killed server leaves them, then the boot recovery. */
  async function parkedThread(prompts: string[], machine: string | null = null) {
    const t = await h.start('hello');
    await h.untilResults(t.id, 1);
    const ids = prompts.map((prompt, i) => {
      const { row: saved } = h.db.messageRequests.accept({
        thread_id: t.id, request_id: `${t.id}-${i}`, prompt, mode: 'queue', source: 'ben', attachments: null, fingerprint: 'f', machine_id: machine,
      });
      h.db.messageRequests.mark(saved.id, i === 0 ? 'sent' : 'held');
      return saved.id;
    });
    return { t, ids };
  }

  it('parks only what this Mac accepted, and resumes recovered requests in order', T, async () => {
    const { t, ids } = await parkedThread(['first, maybe read', 'second', 'third']);
    const other = await parkedThread(['from the other Mac'], 'mac-b');
    expect(h.db.messageRequests.recover('mac-a')).toBe(3);
    expect(rowsOf(t.id).map((x) => x.state)).toEqual(['uncertain', 'recovered', 'recovered']);
    // Another Mac's request is not parked here, and not shown as waiting on Ben.
    expect(rowsOf(other.t.id).map((x) => x.state)).toEqual(['sent']);

    await r.resumeRequests(t.id);
    await h.untilResults(t.id, 3);
    expect(h.texts(t.id, 'user')).toEqual(['hello', 'second', 'third']);
    expect(rowsOf(t.id).map((x) => x.state)).toEqual(['uncertain', 'delivered', 'delivered']);

    // Sending the uncertain one again is an explicit choice, by id.
    await r.resumeRequests(t.id, [ids[0]]);
    await h.untilResults(t.id, 4);
    expect(h.texts(t.id, 'user').at(-1)).toBe('first, maybe read');
    await expect(r.resumeRequests(t.id, [ids[0]])).rejects.toMatchObject({ status: 409 });
  });

  it('resumes through the harness slots: a full harness keeps the next thread queued', T, async () => {
    const { t, ids } = await parkedThread(['resumed after the slot frees']);
    h.db.messageRequests.recover(null);
    const again = await h.start('TOOL:2000 holds the only slot');
    await h.untilTool(again.id);
    await r.resumeRequests(t.id, ids);
    await sleep(150);
    expect(h.thread(t.id).status).toBe('queued');
    expect(r.pendingFor(t.id)).toMatchObject([{ text: 'resumed after the slot frees', state: 'waiting', delivery: 'waiting' }]);
    await h.untilResults(again.id, 1);
    await h.untilResults(t.id, 2);
    expect(h.texts(t.id, 'user').at(-1)).toBe('resumed after the slot frees');
  });

  it("never resumes another Mac's request", T, async () => {
    h.db.outbox.arm('mac-a');
    const { t, ids } = await parkedThread(['queued on mac-b'], 'mac-b');
    h.db.messageRequests.park(ids[0]);
    await expect(r.resumeRequests(t.id, ids)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/other Mac/) });
    expect(row(ids[0]).state).toBe('uncertain');
    expect(h.texts(t.id, 'user')).toEqual(['hello']);
  });
});
