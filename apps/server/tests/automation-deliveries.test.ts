import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';

// What Ben does with an event automation's deliveries, against a real db and the fake claude CLI: the history, retry,
// skip, the age limit, the cap on runs going and the pause after a failed start. The rule under test is that a retry
// never duplicates an admitted run, and that nothing whose outcome is unknown is started again.

const dir = mkdtempSync(join(tmpdir(), 'omni-deliveries-'));
const r = await startRunner({ OMNI_AUTOMATIONS_DIR: dir });
const yaml = (id: string, body: string) => writeFileSync(join(dir, `${id}.yaml`), body);
let n = 0;
/**
 * A new event automation for one test, so what another test left running, held or backing off never counts against it.
 * `channel: gone` makes every start of it fail before a thread exists. Room for eight runs unless `extra` says.
 */
const make = ({ channel = 'scratch', extra = ', concurrency: 8', prompt = 'THINK:1', enabled = true } = {}) => {
  const id = `auto${n++}`;
  yaml(id, `name: ${id}\nenabled: ${enabled}\non: { event: artifact_published${extra} }\nchannel: ${channel}\nprompt: ${prompt}\n`);
  return id;
};
/** The same automation pointed at another channel: the fix for what made its starts fail. */
const repoint = (id: string, channel: string) =>
  yaml(id, `name: ${id}\nenabled: true\non: { event: artifact_published, concurrency: 8 }\nchannel: ${channel}\nprompt: THINK:1\n`);

const triggers = await import('../automation-triggers.ts');
const { triggerDeliveries, deliveryThreadId } = await import('../db/repos/trigger-deliveries.ts');
const { applyChange } = await import('../sync/apply.ts');
const { skipDelivery } = await import('../automation-deliveries.ts');
const { app } = await import('../app.ts');

let seq = 0;
const add = (automation: string, over: Record<string, unknown> = {}) =>
  triggerDeliveries.add({
    automation,
    source: 'artifact_published',
    source_id: `src:${seq++}`,
    summary: 'page.html in #scratch',
    context: { url: 'https://claude.ai/code/artifact/p', title: 'page.html', update: 'false', thread: 'x', thread_title: 'x', channel: 'scratch' },
    state: 'accepted',
    reason: null,
    owner: null,
    source_thread: null,
    ...over,
  }).delivery;
const HOUR = 3_600_000;
/** The event arrived this long ago. */
const age = (id: string, ms: number) => r.db.db.prepare('UPDATE trigger_deliveries SET created_at = ? WHERE uid = ?').run(new Date(Date.now() - ms).toISOString(), id);
/** `count` events for an automation, the first the oldest: the worker takes them in the order they arrived, and events saved in one millisecond have no order. */
const burstOf = (automation: string, count: number) =>
  Array.from({ length: count }, (_, i) => {
    const d = add(automation);
    age(d.id, (count - i) * 10);
    return d;
  });
const row = (id: string) => triggerDeliveries.get(id)!;
const threadsOf = (automation: string) => r.db.db.prepare('SELECT id, status FROM threads WHERE automation = ?').all(automation) as { id: string; status: string }[];
const runsOf = (automation: string) => r.db.db.prepare('SELECT thread_id FROM automation_runs WHERE automation = ?').all(automation) as { thread_id: string }[];
const post = async (path: string, body: unknown = {}) => {
  const res = await app.request(`/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
};
const get = async (path: string) => {
  const res = await app.request(`/api${path}`);
  return { status: res.status, body: (await res.json()) as any };
};
const retry = (id: string, attempt: number) => post(`/deliveries/${id}/retry`, { attempt });
const skip = (id: string, attempt?: number) => post(`/deliveries/${id}/skip`, attempt === undefined ? {} : { attempt });
/** What the other Mac sends for a delivery: the row as it stands here with `over` on top, at a time after any local write. */
const fromOtherMac = (id: string, over: Record<string, unknown>) => {
  const data = { ...(r.db.db.prepare('SELECT * FROM trigger_deliveries WHERE uid = ?').get(id) as Record<string, unknown>), ...over };
  return applyChange({ seq: ++seq, machine_id: 'other-mac', entity: 'trigger_delivery', entity_id: id, op: 'upsert', data, ts: new Date(Date.now() + 1000).toISOString() }, { machineId: 'this-mac' });
};
/** A delivery that failed because its automation's channel is gone, then the automation fixed. */
const failedThenFixed = async () => {
  const a = make({ channel: 'gone' });
  const d = add(a);
  await triggers.admitPending();
  expect(row(d.id)).toMatchObject({ state: 'failed', reason: 'unknown channel "gone"', thread_id: null, attempt: 1 });
  repoint(a, 'scratch');
  return { a, d };
};

// Nothing pending is left for the next test's pass to start or count.
afterEach(() => void r.db.db.prepare(`UPDATE trigger_deliveries SET state = 'skipped', reason = 'test over' WHERE state IN ('received', 'accepted', 'queued')`).run());

describe('retry', () => {
  it('a delivery that failed before any thread was made goes again as the next attempt, with a thread of its own', async () => {
    const a = make({ channel: 'gone' });
    const d = add(a);
    await triggers.admitPending();
    expect(threadsOf(a)).toEqual([]);
    expect((await get(`/deliveries/${d.id}`)).body).toMatchObject({ can_retry: true, retry_blocked: null, can_skip: true, thread_status: null });

    repoint(a, 'scratch');
    const res = await retry(d.id, 1);
    expect(res.status).toBe(200);
    expect(res.body.delivery).toMatchObject({ attempt: 2, state: 'accepted', reason: null });
    const started = await r.until('the retry to start', () => row(d.id).state === 'started' && row(d.id));
    expect(started).toMatchObject({ attempt: 2, thread_id: deliveryThreadId(d.id, 2) });
    expect(deliveryThreadId(d.id, 2)).not.toBe(deliveryThreadId(d.id, 1));
    expect(r.db.threads.get(deliveryThreadId(d.id, 1))).toBeUndefined();
    expect(threadsOf(a).map((t) => t.id)).toEqual([deliveryThreadId(d.id, 2)]);
    expect(runsOf(a)).toEqual([{ thread_id: deliveryThreadId(d.id, 2) }]);
  });

  it('two clicks on Retry make one attempt and one thread', async () => {
    const { a, d } = await failedThenFixed();
    const [x, y] = await Promise.all([retry(d.id, 1), retry(d.id, 1)]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const refused = x.status === 409 ? x : y;
    expect(refused.body.error).toMatch(/moved on/);
    expect(refused.body.delivery).toMatchObject({ id: d.id, attempt: 2 });
    await r.until('the retry to start', () => row(d.id).state === 'started');
    // A late click, on the page that still shows attempt 1 or on the new state, changes nothing either.
    expect((await retry(d.id, 1)).status).toBe(409);
    const late = await retry(d.id, 2);
    expect(late.status).toBe(409);
    expect(late.body.error).toMatch(/Only a failed delivery can be retried, and this one is started/);
    await triggers.admitPending();
    expect(threadsOf(a)).toHaveLength(1);
    expect(runsOf(a)).toHaveLength(1);
  });

  it('a failed delivery whose thread exists is not retried: what it did is unknown, so it links to the thread', async () => {
    const a = make();
    const d = add(a);
    const id = deliveryThreadId(d.id);
    await r.runner.createThread({ id, channel: 'scratch', prompt: 'THINK:1', source: 'automation', automation: a });
    triggerDeliveries.settle(d.id, 1, 'failed', { reason: 'Omni is shutting down', thread_id: id });
    const view = (await get(`/deliveries/${d.id}`)).body;
    expect(view).toMatchObject({ state: 'failed', thread_id: id, can_retry: false, can_skip: false });
    expect(view.thread_status).toBeTruthy();
    expect(view.retry_blocked).toMatch(/thread exists/);
    const res = await retry(d.id, 1);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/thread exists/);
    expect((await skip(d.id)).status).toBe(409);
    await triggers.admitPending();
    expect(row(d.id)).toMatchObject({ state: 'failed', attempt: 1, thread_id: id });
    expect(threadsOf(a)).toHaveLength(1);
  });

  it('a failure recorded without its thread, by older code, is still not retried once the thread is there', async () => {
    const a = make();
    const d = add(a);
    await r.runner.createThread({ id: deliveryThreadId(d.id), channel: 'scratch', prompt: 'THINK:1', source: 'automation', automation: a });
    triggerDeliveries.settle(d.id, 1, 'failed', { reason: 'boom' });
    expect(row(d.id).thread_id).toBeNull();
    const view = (await get(`/deliveries/${d.id}`)).body;
    expect(view).toMatchObject({ can_retry: false, can_skip: false });
    expect(view.retry_blocked).toMatch(/thread exists/);
    expect((await retry(d.id, 1)).status).toBe(409);
    expect(threadsOf(a)).toHaveLength(1);
    expect(row(d.id).attempt).toBe(1);
  });

  it('only a failed delivery can be retried', async () => {
    const a = make();
    const started = add(a);
    await triggers.admitPending();
    expect(row(started.id).state).toBe('started');
    const skipped = add(a, { state: 'skipped', reason: 'Skipped by hand' });
    const pending = add(make({ enabled: false }));
    for (const d of [started, skipped, pending]) {
      const res = await retry(d.id, 1);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/Only a failed delivery can be retried/);
    }
    expect((await retry('00000000-0000-4000-8000-00000000dead', 1)).status).toBe(404);
  });

  it('is refused for an event older than the age limit, and for a paused automation', async () => {
    const old = add(make({ extra: ', max_age: 1h' }), { state: 'failed', reason: 'boom' });
    age(old.id, 2 * HOUR);
    const view = (await get(`/deliveries/${old.id}`)).body;
    expect(view).toMatchObject({ can_retry: false, can_skip: true });
    expect(view.retry_blocked).toBe("The event is older than the automation's 1h limit.");
    expect((await retry(old.id, 1)).status).toBe(409);
    expect(row(old.id)).toMatchObject({ state: 'failed', attempt: 1 });

    const paused = add(make({ enabled: false }), { state: 'failed', reason: 'boom' });
    expect((await get(`/deliveries/${paused.id}`)).body.retry_blocked).toBe('The automation is paused.');
    expect((await retry(paused.id, 1)).status).toBe(409);
  });
});

describe('retry and skip are check-and-set', () => {
  it('on the attempt the caller saw: a retry or skip aimed at an attempt that has gone changes nothing', async () => {
    const { d } = await failedThenFixed();
    expect(triggerDeliveries.retry(d.id, 1, 'accepted', null)).toBe(true);
    expect(row(d.id)).toMatchObject({ attempt: 2, state: 'accepted', reason: null });
    // It fails again, as the next attempt: only a click that saw attempt 2 may go again.
    r.db.db.prepare(`UPDATE trigger_deliveries SET state = 'failed', reason = 'boom' WHERE uid = ?`).run(d.id);
    expect(triggerDeliveries.retry(d.id, 1, 'accepted', null)).toBe(false);
    expect(triggerDeliveries.skip(d.id, 1, 'Skipped by hand')).toBe(false);
    expect(row(d.id)).toMatchObject({ attempt: 2, state: 'failed' });
    expect(triggerDeliveries.retry(d.id, 2, 'queued', 'other-mac')).toBe(true);
    expect(row(d.id)).toMatchObject({ attempt: 3, state: 'queued', owner: 'other-mac' });
  });

  it('settling, too: a late answer for an old attempt changes nothing', async () => {
    const { d } = await failedThenFixed();
    triggerDeliveries.retry(d.id, 1, 'accepted', null);
    expect(triggerDeliveries.settle(d.id, 1, 'failed', { reason: 'late' })).toBe(false);
    expect(triggerDeliveries.settle(d.id, 1, 'started', { thread_id: 'x' })).toBe(false);
    expect(row(d.id)).toMatchObject({ attempt: 2, state: 'accepted', thread_id: null });
  });
});

describe('skip', () => {
  it('a skipped delivery is never started, by this pass or a later one', async () => {
    const a = make();
    const d = add(a);
    const res = await skip(d.id, 1);
    expect(res.status).toBe(200);
    expect(res.body.delivery).toMatchObject({ state: 'skipped', reason: 'Skipped by hand', can_skip: false, can_retry: false });
    await triggers.admitPending();
    await triggers.admitPending();
    expect(row(d.id)).toMatchObject({ state: 'skipped', thread_id: null });
    expect(threadsOf(a)).toEqual([]);
    expect((await skip(d.id)).status).toBe(409);
  });

  it('a failed delivery can be skipped, and then cannot be retried', async () => {
    const { d } = await failedThenFixed();
    expect((await skip(d.id)).status).toBe(200);
    expect(row(d.id).state).toBe('skipped');
    expect((await retry(d.id, 1)).status).toBe(409);
  });

  it('a skip that names an attempt that has gone changes nothing', async () => {
    const { d } = await failedThenFixed();
    expect((await retry(d.id, 1)).status).toBe(200);
    const res = await skip(d.id, 1);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/moved on/);
    expect(row(d.id).attempt).toBe(2);
    await r.until('the retry to start', () => row(d.id).state === 'started');
  });

  it('racing the worker, at the narrowest moment: claimed, no thread yet. The skip is refused and the run starts once', async () => {
    const a = make();
    const d = add(a);
    const pass = triggers.admitPending();
    expect(triggerDeliveries.isStarting(d.id)).toBe(true);
    expect(r.db.threads.get(deliveryThreadId(d.id))).toBeUndefined();
    expect(skipDelivery(d.id)).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/being started right now/) });
    expect(triggerDeliveries.skip(d.id, 1, 'Skipped by hand')).toBe(false);
    expect(triggerDeliveries.retry(d.id, 1, 'accepted', null)).toBe(false);
    await pass;
    expect(row(d.id)).toMatchObject({ state: 'started', thread_id: deliveryThreadId(d.id) });
    expect(threadsOf(a)).toHaveLength(1);
  });

  it('racing the worker, over the route: a skip while the start is under way is refused, and the run starts once', async () => {
    const a = make();
    const d = add(a);
    const pass = triggers.admitPending();
    expect(triggerDeliveries.isStarting(d.id)).toBe(true);
    const res = await skip(d.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/being started right now/);
    expect(res.body.delivery).toMatchObject({ can_skip: false });
    expect((await retry(d.id, 1)).status).toBe(409);
    await pass;
    expect(row(d.id)).toMatchObject({ state: 'started', thread_id: deliveryThreadId(d.id) });
    expect(triggerDeliveries.isStarting(d.id)).toBe(false);
    expect(threadsOf(a).map((t) => t.id)).toEqual([deliveryThreadId(d.id)]);
    expect(runsOf(a)).toHaveLength(1);
  });

  it('racing the other Mac: its skip lands first and nothing starts; one that lands mid-start loses to the thread that exists', async () => {
    const a = make();
    const first = add(a);
    expect(fromOtherMac(first.id, { state: 'skipped', reason: 'Skipped by hand' })).toBe('applied');
    await triggers.admitPending();
    expect(row(first.id)).toMatchObject({ state: 'skipped', thread_id: null });
    expect(threadsOf(a)).toEqual([]);

    const second = add(a);
    const pass = triggers.admitPending();
    expect(triggerDeliveries.isStarting(second.id)).toBe(true);
    expect(fromOtherMac(second.id, { state: 'skipped', reason: 'Skipped by hand' })).toBe('applied');
    expect(row(second.id).state).toBe('skipped');
    await pass;
    expect(row(second.id)).toMatchObject({ state: 'started', thread_id: deliveryThreadId(second.id) });
    expect(threadsOf(a)).toHaveLength(1);
    // The other Mac's copy of the same skip arriving again changes nothing.
    expect(fromOtherMac(second.id, { state: 'skipped', reason: 'Skipped by hand' })).toBe('skipped');
    expect(row(second.id).state).toBe('started');
  });
});

describe('a late delivery', () => {
  it('is skipped with the reason, and no restart, repeat pass or stale copy from the other Mac launches it later', async () => {
    const a = make({ extra: ', max_age: 1h' });
    const d = add(a);
    age(d.id, 3 * HOUR);
    await triggers.admitPending();
    expect(row(d.id)).toMatchObject({ state: 'skipped', reason: 'Expired: it arrived 3h ago, over the 1h limit', thread_id: null });
    await triggers.admitPending();
    expect(fromOtherMac(d.id, { state: 'queued', reason: null })).toBe('skipped');
    expect(fromOtherMac(d.id, { state: 'accepted', reason: null })).toBe('skipped');
    await triggers.admitPending();
    expect(row(d.id)).toMatchObject({ state: 'skipped', attempt: 1 });
    expect(threadsOf(a)).toEqual([]);
    expect((await get(`/deliveries/${d.id}`)).body).toMatchObject({ can_skip: false, can_retry: false, expires_at: null });
  });

  it('counts from when the event arrived, not from when anything last touched the row', async () => {
    const d = add(make({ extra: ', max_age: 1h' }));
    age(d.id, 3 * HOUR);
    r.db.db.prepare('UPDATE trigger_deliveries SET updated_at = ? WHERE uid = ?').run(new Date().toISOString(), d.id);
    await triggers.admitPending();
    expect(row(d.id).state).toBe('skipped');
  });

  it('an event with no limit of its own is dropped after a day', async () => {
    const d = add(make());
    age(d.id, 25 * HOUR);
    await triggers.admitPending();
    expect(row(d.id)).toMatchObject({ state: 'skipped', reason: 'Expired: it arrived 1d 1h ago, over the 1d limit' });
  });

  it('shows when a pending event will expire', async () => {
    const d = add(make({ enabled: false }));
    const view = (await get(`/deliveries/${d.id}`)).body;
    expect(Date.parse(view.expires_at) - Date.parse(view.created_at)).toBe(24 * HOUR);
  });
});

describe('a restart', () => {
  it('after a retry made its thread but before the delivery said so: the thread is found, not made again', async () => {
    const { a, d } = await failedThenFixed();
    expect((await retry(d.id, 1)).status).toBe(200);
    await r.until('the retry to start', () => row(d.id).state === 'started');
    // Omni went down between making the thread and saying so: the delivery is pending again, the thread is there.
    r.db.db.prepare(`UPDATE trigger_deliveries SET state = 'accepted', thread_id = NULL WHERE uid = ?`).run(d.id);
    await triggers.admitPending();
    expect(row(d.id)).toMatchObject({ state: 'started', attempt: 2, thread_id: deliveryThreadId(d.id, 2) });
    expect(threadsOf(a)).toHaveLength(1);
    expect(runsOf(a)).toHaveLength(1);
  });

  it('a stale copy of attempt 1 from the other Mac never undoes the retry', async () => {
    const { d } = await failedThenFixed();
    expect((await retry(d.id, 1)).status).toBe(200);
    await r.until('the retry to start', () => row(d.id).state === 'started');
    expect(fromOtherMac(d.id, { state: 'failed', attempt: 1, reason: 'boom', thread_id: null })).toBe('skipped');
    expect(fromOtherMac(d.id, { state: 'skipped', attempt: 1, reason: 'Skipped by hand', thread_id: null })).toBe('skipped');
    expect(row(d.id)).toMatchObject({ state: 'started', attempt: 2 });
  });
});

describe('bursts', () => {
  it('an automation at its limit of runs holds the rest of a burst, and starts the next as each run ends', async () => {
    const a = make({ extra: ', concurrency: 1', prompt: 'TOOL:400' });
    const burst = burstOf(a, 3);
    expect(await triggers.admitPending()).toBe(1);
    expect(burst.map((d) => row(d.id).state)).toEqual(['started', 'accepted', 'accepted']);
    expect(await triggers.admitPending()).toBe(0);
    expect(threadsOf(a)).toHaveLength(1);
    expect((await get(`/deliveries/${burst[1].id}`)).body).toMatchObject({ state: 'accepted', waiting: 'Waiting for a free slot: 1 of 1 runs are going', can_skip: true });

    await r.untilStatus(row(burst[0].id).thread_id!, 'done', 15_000);
    expect(await triggers.admitPending()).toBe(1);
    expect(burst.map((d) => row(d.id).state)).toEqual(['started', 'started', 'accepted']);
    await r.untilStatus(row(burst[1].id).thread_id!, 'done', 15_000);
    expect(await triggers.admitPending()).toBe(1);
    await r.untilStatus(row(burst[2].id).thread_id!, 'done', 15_000);
    expect(threadsOf(a)).toHaveLength(3);
  });

  it('a held delivery that outlives the age limit while it waits is skipped, not started when a slot frees', async () => {
    const a = make({ extra: ', concurrency: 1', prompt: 'TOOL:400' });
    const [running, held] = burstOf(a, 2);
    await triggers.admitPending();
    expect(row(running.id).state).toBe('started');
    expect(row(held.id).state).toBe('accepted');
    age(held.id, 25 * HOUR);
    await triggers.admitPending();
    expect(row(held.id)).toMatchObject({ state: 'skipped', thread_id: null });
    expect(row(held.id).reason).toMatch(/^Expired/);
    await r.untilStatus(row(running.id).thread_id!, 'done', 15_000);
    await triggers.admitPending();
    expect(threadsOf(a)).toHaveLength(1);
  });

  it('after a start fails the automation backs off: the rest of its burst waits, and a retry by hand goes at once', async () => {
    const a = make({ channel: 'gone' });
    const burst = burstOf(a, 3);
    expect(await triggers.admitPending()).toBe(1);
    expect(burst.map((d) => row(d.id).state)).toEqual(['failed', 'accepted', 'accepted']);
    expect(await triggers.admitPending()).toBe(0);
    const held = (await get(`/deliveries/${burst[1].id}`)).body;
    expect(held.waiting).toMatch(/^Backing off after a start that failed. Next try in /);
    expect(held.can_skip).toBe(true);

    repoint(a, 'scratch');
    expect((await retry(burst[0].id, 1)).status).toBe(200);
    await r.until('the retry to start', () => row(burst[0].id).state === 'started');
    // The retry went through the pause, and the start worked: that ends it, so the next goes too.
    await r.until('the next to start', async () => {
      await triggers.admitPending();
      return row(burst[1].id).state === 'started';
    });
  });
});

describe('the history and detail routes', () => {
  it('page through an automation newest first without a gap or a repeat, even when events arrived in the same millisecond', async () => {
    const a = make({ enabled: false });
    const made = Array.from({ length: 7 }, () => add(a, { state: 'skipped', reason: 'Skipped by hand' }));
    r.db.db.prepare('UPDATE trigger_deliveries SET created_at = ? WHERE automation = ?').run('2026-01-05T09:00:00.000Z', a);
    const seen: string[] = [];
    let before = '';
    for (let page = 0; page < 5; page++) {
      const res = await get(`/automations/${a}/deliveries?limit=3${before ? `&before=${before}` : ''}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.deliveries.map((d: { id: string }) => d.id));
      expect(res.body.more).toBe(seen.length < 7);
      if (!res.body.more) break;
      before = res.body.deliveries.at(-1).id;
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen)).toEqual(new Set(made.map((d) => d.id)));
    const latest = (await get('/automations')).body.find((x: { id: string }) => x.id === a);
    expect(latest.deliveries).toHaveLength(5);
    expect(latest.deliveries_more).toBe(true);
    expect(latest.deliveries.map((d: { id: string }) => d.id)).toEqual(seen.slice(0, 5));
  });

  it('a delivery is only the bounded fields of the event, with no signature or raw request anywhere', async () => {
    const d = add(make({ enabled: false }), {
      source: 'github_webhook',
      source_id: '6f1c2d3e-0000-4000-8000-000000000228',
      context: { event: 'workflow_run', repo: 'o/r', workflow: 'CI', conclusion: 'failure', branch: 'fix-cart' },
    });
    const view = (await get(`/deliveries/${d.id}`)).body;
    expect(Object.keys(view).sort()).toEqual(
      ['attempt', 'automation', 'can_retry', 'can_skip', 'context', 'created_at', 'expires_at', 'id', 'owner', 'reason', 'retry_blocked', 'source', 'source_id', 'source_thread', 'state', 'summary', 'thread_id', 'thread_status', 'updated_at', 'waiting'].sort(),
    );
    expect(Object.keys(view.context)).toEqual(['event', 'repo', 'workflow', 'conclusion', 'branch']);
    expect(JSON.stringify(view).toLowerCase()).not.toMatch(/signature|secret|sha256|x-hub/);
    expect((await get('/deliveries/00000000-0000-4000-8000-00000000dead')).status).toBe(404);
  });

  it('shows where a started delivery stands: the thread it made and what that thread did', async () => {
    const d = add(make());
    await triggers.admitPending();
    await r.untilStatus(row(d.id).thread_id!, 'done');
    expect((await get(`/deliveries/${d.id}`)).body).toMatchObject({ state: 'started', thread_id: deliveryThreadId(d.id), thread_status: 'done', can_skip: false, can_retry: false });
  });
});
