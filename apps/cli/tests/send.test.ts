import { describe, expect, it } from 'vitest';
import { detail, fake, needsYouFor, wire } from './helpers.ts';

const ID = '00000000-0000-4000-8000-000000000001';
const posted = { method: 'POST', path: `/api/threads/${ID}/messages`, reply: { json: wire('message-sent.json') } };

describe('omni send', () => {
  it('steers a busy thread by default and says how it will read the message', async () => {
    const f = fake({ routes: [posted] });
    expect(await f.run('send', ID, 'and', 'the', 'tests')).toBe(0);
    expect(f.sent[0]).toMatchObject({ method: 'POST', path: `/api/threads/${ID}/messages`, body: { prompt: 'and the tests', mode: 'steer', request_id: '00000000-0000-4000-9000-000000000001', from: 'ben' } });
    expect(f.out()).toBe('Sent to 00000000 (running): it reads it at its next step.\n');
  });

  it('queues or interrupts, and refuses both at once', async () => {
    const f = fake({ routes: [posted] });
    expect(await f.run('send', ID, 'later', '--queue')).toBe(0);
    expect(await f.run('send', ID, 'now', '--interrupt')).toBe(0);
    expect(f.sent.map((s) => (s.body as { mode: string }).mode)).toEqual(['queue', 'interrupt']);
    expect(await f.run('send', ID, 'x', '--queue', '--interrupt')).toBe(64);
  });

  it("sends to the thread that started this one as `parent`, from an agent's side", async () => {
    const self = detail('thread.json', { id: 'child-thread', parent_id: ID });
    const f = fake({ env: { OMNI_THREAD_ID: 'child-thread' }, routes: [{ method: 'GET', path: '/api/threads/child-thread?history=recent', reply: { json: self } }, posted] });
    expect(await f.run('send', 'parent', 'blocked on the Directus password')).toBe(0);
    expect(f.sent[1]).toMatchObject({ path: `/api/threads/${ID}/messages`, body: { prompt: 'blocked on the Directus password', from: 'conductor' } });
  });

  it('refuses `parent` outside a thread, and a thread with none', async () => {
    const outside = fake({ routes: [posted] });
    expect(await outside.run('send', 'parent', 'x')).toBe(3);
    expect(outside.err()).toContain('only works inside an Omni thread');
    const orphan = fake({ env: { OMNI_THREAD_ID: ID }, routes: [{ method: 'GET', path: `/api/threads/${ID}?history=recent`, reply: { json: detail('thread.json') } }] });
    expect(await orphan.run('send', 'parent', 'x')).toBe(3);
    expect(orphan.err()).toContain('has no parent');
  });

  it('finds a thread by the start of its id and reads a link to it', async () => {
    const f = fake({ routes: [{ method: 'GET', path: '/api/threads?limit=500', reply: { json: wire('threads.json') } }, posted] });
    expect(await f.run('send', '00000000-0000-4000-8000-0000000000', 'x')).toBe(0);
    expect(await f.run('send', `http://127.0.0.1:4747/#/t/${ID}`, 'y')).toBe(0);
    expect(f.sent.filter((s) => s.method === 'POST').map((s) => s.path)).toEqual([`/api/threads/${ID}/messages`, `/api/threads/${ID}/messages`]);
  });

  it('passes on a refusal, such as a cold thread an agent may not wake', async () => {
    const f = fake({ env: { OMNI_THREAD_ID: 'me' }, routes: [{ method: 'POST', path: `/api/threads/${ID}/messages`, reply: { status: 409, json: { error: 'That thread went cold an hour ago. Continue it instead.' } } }] });
    expect(await f.run('send', ID, 'x')).toBe(3);
    expect(f.err()).toContain('went cold');
  });

  it('waits for the turn the message starts, not one that ended before it', async () => {
    const before = detail('thread-open.json', { id: ID });
    const running = detail('thread.json');
    const after = detail('thread-open.json', { id: ID }, { events: [...before.events, { id: 200, thread_id: ID, kind: 'user', payload: '{"text":"and the tests"}', created_at: '' }, { id: 201, thread_id: ID, kind: 'assistant_text', payload: '{"text":"tests pass"}', created_at: '' }, { id: 202, thread_id: ID, kind: 'result', payload: '{"ok":true}', created_at: '' }] });
    const f = fake({
      routes: [
        { method: 'GET', path: `/api/threads/${ID}?history=recent`, reply: [{ json: before }, { json: before }, { json: running }, { json: after }] },
        { method: 'POST', path: `/api/threads/${ID}/messages`, reply: { json: { ...wire('message-sent.json'), status: 'done' } } },
        { method: 'GET', path: `/api/needs-you?thread=${ID}`, reply: { json: needsYouFor(ID, null) } },
      ],
    });
    expect(await f.run('send', ID, 'and the tests', '--wait')).toBe(0);
    expect(f.out()).toBe('tests pass\n');
  });
});
