import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX } from './support.ts';

// Limit stops (apps/server/runner/limits.ts) through the real runner with the fake claude and codex CLIs and a fake clock:
// what counts as one, scheduling and cancelling the one continuation, sending it once at the reset, and everything
// that clears it. A real restart is in limits-restart.test.ts.

let H: Awaited<ReturnType<typeof startRunner>>;
const codex = { harness: 'codex', model: 'gpt-5.6-sol' };
/** A reset well after the test, so nothing comes due unless the clock is moved there. */
const RESET = Math.floor(Date.now() / 1000) + 3 * 3600;
const iso = (epoch: number) => new Date(epoch * 1000).toISOString();

beforeAll(async () => {
  H = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX, OMNI_MAX_CONCURRENT_CODEX: '1', OMNI_LIMIT_GRACE_MS: '0' });
  const svc = await import('../harness/catalog-service.ts');
  await svc.loadCatalog();
});

afterEach(() => {
  H.runner.limitClock.now = () => Date.now();
});

/** Error-free answer of a refused call: the status and the message. */
const refused = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return { status: (err as { status?: number }).status, message: (err as Error).message };
  }
  throw new Error('expected a refusal');
};

const limited = async (prompt: string, extra: Record<string, unknown> = {}) => {
  const t = await H.start(prompt, extra);
  await H.until(`a limit stop: ${prompt}`, () => H.thread(t.id).limit_state === 'limited' && H.thread(t.id).status === 'failed', 12_000);
  return t;
};

const continuations = (id: string) => H.db.messageRequests.forThread(id).filter((r) => r.source === 'limit');
const blockers = (id: string) => H.db.needsYou(undefined, id).items[0]?.blockers ?? [];

describe('what counts as a limit stop', () => {
  it('keeps a Claude turn the plan limit refused, with the reset time it reported, in the thread and Needs you', async () => {
    const t = await limited(`LIMIT:${RESET} write the report`);
    expect(H.thread(t.id)).toMatchObject({ status: 'failed', limit_state: 'limited', limit_resets_at: iso(RESET) });
    expect(H.texts(t.id, 'assistant_text').at(-1)).toContain("You've hit your limit");
    expect(blockers(t.id)).toEqual([{ kind: 'limited', detail: null, count: 0, resets_at: iso(RESET), scheduled: false, elsewhere: false }]);
    // The result is still listed, behind the blocker.
    expect(H.db.needsYou(undefined, t.id).items[0].result?.status).toBe('failed');
  });

  it('keeps a stop without a reset time, which can only be resumed by hand', async () => {
    const t = await limited('LIMIT no time given');
    expect(H.thread(t.id).limit_resets_at).toBeNull();
    expect(refused(() => H.runner.scheduleLimitResume(t.id))).toMatchObject({ status: 409, message: expect.stringMatching(/did not say when its limit resets/) });
    expect(H.thread(t.id).limit_state).toBe('limited');
  });

  it('never makes one of a full usage meter on a turn that runs', async () => {
    const t = await H.start('FULLMETER busy turn');
    await H.untilResults(t.id, 1);
    expect(H.thread(t.id)).toMatchObject({ status: 'done', limit_state: null });
    const { usageFor } = await import('../usage.ts');
    expect(usageFor('claude-code')?.five_hour?.utilization).toBe(1);
  });

  it('keeps a Codex turn the plan limit refused, with the reset in the error body or without one', async () => {
    const withTime = await limited(`LIMITRESET:${RESET} go`, codex);
    expect(H.thread(withTime.id).limit_resets_at).toBe(iso(RESET));
    // The error says when only in words: no usable time, and the meter is not full.
    const words = await limited('BADTURN please', codex);
    expect(H.thread(words.id).limit_resets_at).toBeNull();
    expect(H.texts(words.id, 'error')).toEqual(["You've hit your usage limit. It resets at 5:00 PM."]);
  });

  it('leaves a generic failure a failure', async () => {
    const t = await H.start('CRASH right now', codex);
    await H.untilStatus(t.id, 'failed', 12_000);
    expect(H.thread(t.id).limit_state).toBeNull();
    expect(blockers(t.id).some((b) => b.kind === 'limited')).toBe(false);
  });
});

describe('the continuation', () => {
  it('is scheduled once, runs once at the reset, and never again', async () => {
    const t = await limited(`LIMIT:${RESET} draft the plan`);
    H.runner.scheduleLimitResume(t.id);
    // Scheduling twice is one continuation.
    H.runner.scheduleLimitResume(t.id);
    expect(H.thread(t.id).limit_state).toBe('scheduled');
    expect(blockers(t.id)).toEqual([{ kind: 'limited', detail: null, count: 0, resets_at: iso(RESET), scheduled: true, elsewhere: false }]);

    H.runner.limitClock.now = () => RESET * 1000 - 1;
    expect(H.runner.fireDue()).toEqual([]);
    expect(continuations(t.id)).toEqual([]);

    H.runner.limitClock.now = () => RESET * 1000 + 5_000;
    expect(H.runner.fireDue()).toEqual([t.id]);
    expect(H.runner.fireDue()).toEqual([]);
    await H.untilResults(t.id, 2);
    expect(H.thread(t.id)).toMatchObject({ status: 'done', limit_state: null });
    const [sent] = continuations(t.id);
    expect(continuations(t.id)).toHaveLength(1);
    expect(sent).toMatchObject({ state: 'delivered', kind: 'user', request_id: expect.stringMatching(/^limit-resume:/) });
    // The transcript shows Omni's short line; the harness got the whole prompt.
    expect(H.byKind(t.id, 'user').at(-1)!.p).toMatchObject({ text: 'Continue where you left off.', source: 'limit' });
    expect(H.texts(t.id, 'assistant_text').at(-1)).toContain('Your usage limit has reset. Continue where you left off.');
    expect(blockers(t.id)).toEqual([]);
    expect(refused(() => H.runner.resumeLimitNow(t.id)).status).toBe(409);
  });

  it('can be cancelled, then nothing runs at the reset', async () => {
    const t = await limited(`LIMIT:${RESET} cancel me`);
    H.runner.scheduleLimitResume(t.id);
    H.runner.cancelLimitResume(t.id);
    H.runner.cancelLimitResume(t.id);
    expect(H.thread(t.id).limit_state).toBe('limited');
    H.runner.limitClock.now = () => RESET * 1000 + 5_000;
    expect(H.runner.fireDue()).toEqual([]);
    expect(continuations(t.id)).toEqual([]);
    expect(H.thread(t.id).status).toBe('failed');
  });

  it('runs at once when it is already overdue', async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    const t = await limited(`LIMIT:${past} overdue`);
    H.runner.scheduleLimitResume(t.id);
    await H.untilResults(t.id, 2);
    expect(continuations(t.id)).toHaveLength(1);
    expect(H.thread(t.id).limit_state).toBeNull();
  });

  it('is sent by hand with Resume when no reset time was given', async () => {
    const t = await limited('BADTURN by hand', codex);
    H.runner.resumeLimitNow(t.id);
    await H.untilResults(t.id, 2);
    expect(H.thread(t.id)).toMatchObject({ status: 'done', limit_state: null });
    expect(continuations(t.id)).toHaveLength(1);
    const turns = H.codexRequests().filter((r) => r.method === 'turn/start' && JSON.stringify(r.params.input).includes('Your usage limit has reset'));
    expect(turns).toHaveLength(1);
  });

  it('waits for a slot under the harness cap', async () => {
    const t = await limited(`LIMITRESET:${RESET} capped`, codex);
    H.runner.scheduleLimitResume(t.id);
    const busy = await H.start('HANG hold the slot', codex);
    await H.untilStatus(busy.id, 'running');
    H.runner.limitClock.now = () => RESET * 1000 + 5_000;
    expect(H.runner.fireDue()).toEqual([t.id]);
    expect(H.thread(t.id).status).toBe('queued');
    expect(H.runner.pendingFor(t.id).map((p) => p.text)).toEqual(['Continue where you left off.']);
    H.runner.interruptThread(busy.id);
    await H.untilResults(t.id, 2, 12_000);
    expect(H.thread(t.id).status).toBe('done');
    expect(continuations(t.id)).toHaveLength(1);
  });

  it('is only this Mac’s to send', async () => {
    const t = await limited(`LIMIT:${RESET} other mac`);
    // As sync leaves the other Mac's stop here (apps/server/sync/handlers/limit-stop.ts).
    H.db.db.prepare('UPDATE threads SET limit_machine = ?, limit_elsewhere = 1 WHERE id = ?').run('other-mac', t.id);
    expect(refused(() => H.runner.scheduleLimitResume(t.id))).toMatchObject({ status: 409, message: expect.stringMatching(/other Mac/) });
    expect(refused(() => H.runner.resumeLimitNow(t.id)).status).toBe(409);
    H.db.db.prepare(`UPDATE threads SET limit_state = 'scheduled' WHERE id = ?`).run(t.id);
    expect(refused(() => H.runner.cancelLimitResume(t.id)).status).toBe(409);
    H.runner.limitClock.now = () => RESET * 1000 + 5_000;
    expect(H.runner.fireDue()).not.toContain(t.id);
    // Listed here too, as the other Mac's: Needs you shows the reset, that Mac resumes it.
    expect(blockers(t.id).find((b) => b.kind === 'limited')).toMatchObject({ scheduled: true, elsewhere: true, resets_at: iso(RESET) });
    H.db.db.prepare('UPDATE threads SET limit_state = NULL, limit_machine = NULL, limit_elsewhere = 0 WHERE id = ?').run(t.id);
  });
});

describe('what clears it', () => {
  const scheduled = async (prompt: string) => {
    const t = await limited(`LIMIT:${RESET} ${prompt}`);
    H.runner.scheduleLimitResume(t.id);
    return t;
  };
  const due = () => {
    H.runner.limitClock.now = () => RESET * 1000 + 5_000;
    return H.runner.fireDue();
  };

  it('a new message from Ben', async () => {
    const t = await scheduled('then a reply');
    await H.runner.postMessage(t.id, 'never mind, do this instead');
    expect(H.thread(t.id).limit_state).toBeNull();
    await H.untilResults(t.id, 2);
    expect(due()).toEqual([]);
    expect(continuations(t.id)).toEqual([]);
  });

  it('Stop', async () => {
    const t = await scheduled('then stop');
    H.runner.interruptThread(t.id);
    expect(H.thread(t.id).limit_state).toBeNull();
    expect(due()).toEqual([]);
    expect(continuations(t.id)).toEqual([]);
  });

  it('archiving the thread', async () => {
    const t = await scheduled('then archive');
    const { threadsApi } = await import('../threads-api.ts');
    const res = await threadsApi.request(`/${t.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ archived: true }) });
    expect(res.status).toBe(200);
    expect(H.thread(t.id).limit_state).toBeNull();
    expect(due()).toEqual([]);
    expect(continuations(t.id)).toEqual([]);
  });
});

describe('follow-ups queued behind a limited turn', () => {
  it('wait for Ben instead of running ahead of the continuation', async () => {
    const t = await H.start(`THINK:600 LIMIT:${RESET} long one`);
    await H.untilStatus(t.id, 'running');
    await H.until('the CLI to read the first message', () => H.byKind(t.id, 'user').length === 1);
    const posted = await H.runner.postMessage(t.id, 'and then this', { mode: 'queue', requestId: 'later-1' });
    expect(H.db.messageRequests.get(posted.request.id)!.state).toBe('held');
    await H.until('the limit stop', () => H.thread(t.id).limit_state === 'limited');
    // Parked for Resume, not sent into the same limit.
    expect(H.db.messageRequests.get(posted.request.id)!.state).toBe('recovered');
    expect(H.byKind(t.id, 'user')).toHaveLength(1);
    expect(blockers(t.id).map((b) => b.kind)).toEqual(['limited', 'recovered']);

    H.runner.scheduleLimitResume(t.id);
    expect(due()).toEqual([t.id]);
    await H.untilResults(t.id, 2);
    // The continuation ran; the follow-up still waits for Ben.
    expect(H.byKind(t.id, 'user').map((e) => e.p.text)).toEqual([`THINK:600 LIMIT:${RESET} long one`, 'Continue where you left off.']);
    expect(H.db.messageRequests.get(posted.request.id)!.state).toBe('recovered');
  });

  const due = () => {
    H.runner.limitClock.now = () => RESET * 1000 + 5_000;
    return H.runner.fireDue();
  };
});
