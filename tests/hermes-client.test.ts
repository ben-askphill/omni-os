import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HermesClient, HermesHttpError, probeHermes } from '../server/harness/hermes/client.ts';
import { startFakeHermes, type FakeHermes } from './fake-hermes.ts';

let fake: FakeHermes;
let client: HermesClient;

beforeAll(async () => {
  fake = await startFakeHermes();
  client = new HermesClient(fake.url, fake.token);
});
beforeEach(() => fake.reset());
afterAll(() => fake.close());

describe('Hermes HTTP client', () => {
  it('treats a 200 capabilities response as available, and 401 or a dead port as not', async () => {
    expect(await probeHermes(fake.url, '')).toBe(false);
    expect(fake.calls.filter((c) => c.path === '/v1/capabilities')).toHaveLength(0);
    expect(await probeHermes(fake.url, 'nope')).toBe(false);
    expect(await probeHermes(fake.url, fake.token)).toBe(true);
    expect(await probeHermes('http://127.0.0.1:1', fake.token, 500)).toBe(false);
  });

  it('sends an idempotency key and retries a 429 with the same key', async () => {
    fake.failPosts = 1;
    const created = await client.createRun({ input: 'hello', session_id: 'omni-1' }, 'msg-1');
    expect(created).toMatchObject({ status: 'started' });
    const posts = fake.calls.filter((c) => c.method === 'POST' && c.path === '/v1/runs');
    expect(posts).toHaveLength(2);
    expect(posts.every((c) => c.idempotencyKey === 'msg-1')).toBe(true);
    expect(posts[0].authorization).toBe(`Bearer ${fake.token}`);
    expect(posts[1].body).toMatchObject({ input: 'hello', session_id: 'omni-1' });
  });

  it('reports a rejected instructions field without echoing the request', async () => {
    fake.rejectInstructions = true;
    const err = await client.createRun({ input: 'hi', session_id: 's', instructions: 'system' }, 'k').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HermesHttpError);
    const http = err as HermesHttpError;
    expect(http.instructionsRejected).toBe(true);
    expect(http.message).not.toContain('system');
    expect(http.message).not.toContain(fake.token);
  });

  it('parses the event stream and skips comments and bad JSON', async () => {
    fake.reset();
    fake.injectBadData = true;
    const created = await client.createRun({ input: 'hi', session_id: 'omni-2' }, 'msg-2');
    const events: unknown[] = [];
    for await (const evt of client.events(created.run_id, new AbortController().signal)) events.push(evt);
    expect(events.map((e) => (e as { event: string }).event)).toEqual([
      'tool.started',
      'tool.completed',
      'message.delta',
      'reasoning.available',
      'run.completed',
    ]);
    const run = await client.getRun(created.run_id);
    expect(run.status).toBe('completed');
    expect(run.output).toBe('The command printed "hi".');
  });

  it('steers, stops and resolves an approval', async () => {
    fake.reset();
    fake.hold = true;
    const created = await client.createRun({ input: 'hi', session_id: 'omni-3' }, 'msg-3');
    const ac = new AbortController();
    const reading = (async () => {
      for await (const _evt of client.events(created.run_id, ac.signal)) void _evt;
    })();
    await client.steer(created.run_id, 'more');
    expect(await client.approval(created.run_id, { decision: 'allow' })).toEqual({ ok: true });
    await client.stop(created.run_id);
    await reading;
    const steer = fake.calls.find((c) => c.path.endsWith('/steer'));
    expect(steer?.body).toEqual({ input: 'more' });
    expect(fake.calls.some((c) => c.path.endsWith('/stop'))).toBe(true);
    expect(fake.calls.some((c) => c.path.endsWith('/approval'))).toBe(true);
  });

  it('throws on a steer the server rejects with 409', async () => {
    fake.reset();
    fake.hold = true;
    fake.steerConflict = true;
    const created = await client.createRun({ input: 'hi', session_id: 'omni-4' }, 'msg-4');
    await expect(client.steer(created.run_id, 'nope')).rejects.toMatchObject({ status: 409 });
  });
});
