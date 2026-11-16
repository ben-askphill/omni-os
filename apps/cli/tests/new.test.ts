import { describe, expect, it } from 'vitest';
import { BASE, TOKEN, detail, fake, needsYouFor, wire } from './helpers.ts';

const ID = '00000000-0000-4000-8000-000000000001';
const create = { method: 'POST', path: '/api/threads', reply: { json: wire('thread-created.json') } };

describe('omni new', () => {
  it('starts a thread with the token, a retry-safe id and only the fields given, and prints its id and link', async () => {
    const f = fake({ routes: [create] });
    expect(await f.run('new', 'fix', 'the', 'cart', '-c', 'acme', '-r', 'builder', '-m', 'haiku')).toBe(0);
    expect(f.sent).toEqual([
      {
        method: 'POST',
        path: '/api/threads',
        body: { id: '00000000-0000-4000-9000-000000000001', prompt: 'fix the cart', channel: 'acme', role: 'builder', model: 'haiku', source: 'capture' },
        auth: `Bearer ${TOKEN}`,
      },
    ]);
    expect(f.out()).toBe(`Started 00000000 in #acme: Fix the cart\n${BASE}/#/t/${ID}\n`);
  });

  it('reads the prompt from stdin, and prints JSON', async () => {
    const f = fake({ routes: [create], stdin: 'a long brief\nover lines\n' });
    expect(await f.run('new', '--json')).toBe(0);
    expect((f.sent[0].body as { prompt: string }).prompt).toBe('a long brief\nover lines');
    const printed = JSON.parse(f.out());
    expect(printed).toMatchObject({ id: ID, url: `${BASE}/#/t/${ID}`, thread: { channel_id: 'acme', status: 'running' } });
  });

  it('files the thread under the one it runs in, as a delegation, when an agent runs it', async () => {
    const f = fake({ routes: [create], env: { OMNI_THREAD_ID: 'parent-thread' } });
    expect(await f.run('new', 'size the digest')).toBe(0);
    expect(f.sent[0].body).toMatchObject({ prompt: 'size the digest', source: 'conductor', parent_id: 'parent-thread' });
  });

  it('refuses an empty prompt and an unknown option as usage errors', async () => {
    const f = fake({ routes: [create] });
    expect(await f.run('new')).toBe(64);
    expect(f.err()).toContain('write a prompt');
    expect(await f.run('new', 'x', '--nope')).toBe(64);
    expect(f.err()).toContain('unknown option --nope');
    expect(f.sent).toEqual([]);
  });

  it('says the server is not running when nothing answers', async () => {
    const f = fake({ routes: [{ method: 'POST', path: '/api/threads', reply: { refused: true } }] });
    expect(await f.run('new', 'hi')).toBe(3);
    expect(f.err()).toContain(`cannot reach Omni at ${BASE}`);
    expect(f.err()).toContain('omni doctor');
  });

  it('passes on what the server refused', async () => {
    const f = fake({ routes: [{ method: 'POST', path: '/api/threads', reply: { status: 401, json: { error: 'unauthorized' } } }] });
    expect(await f.run('new', 'hi')).toBe(3);
    expect(f.err()).toContain('refused the token from OMNI_TOKEN');
  });
});

describe('omni new --wait', () => {
  const poll = (replies: unknown[], needs: unknown[]) => [
    create,
    { method: 'GET', path: `/api/threads/${ID}?history=recent`, reply: replies.map((json) => ({ json })) },
    { method: 'GET', path: `/api/needs-you?thread=${ID}`, reply: needs.map((json) => ({ json })) },
  ];

  it('exits 0 with the reply once the turn is done', async () => {
    const running = detail('thread.json');
    const done = detail('thread-open.json', { id: ID });
    const f = fake({ routes: poll([running, running, done], [needsYouFor(ID, null), needsYouFor(ID, null), needsYouFor(ID, '001')]) });
    expect(await f.run('new', 'fix the cart', '--wait')).toBe(0);
    expect(f.out()).toBe('ack: and the tax\n');
    expect(f.err()).toContain('00000000 done');
    expect(f.slept.length).toBe(2);
  });

  it('exits 1 when the thread fails', async () => {
    // The error event a harness that exited leaves, as the server records it.
    const failed = detail('thread-open.json', { id: ID, status: 'failed' });
    failed.events = [failed.events[0], { id: 157, thread_id: ID, kind: 'error', payload: JSON.stringify({ text: 'claude exited with code 1.' }), created_at: '' }];
    const f = fake({ routes: poll([detail('thread.json'), failed], [needsYouFor(ID, null), needsYouFor(ID, '006')]) });
    expect(await f.run('new', 'fix the cart', '-w')).toBe(1);
    expect(f.out()).toBe('');
    expect(f.err()).toContain('00000000 failed: claude exited with code 1.');
  });

  it('exits 2 as soon as the thread asks a question, while its turn still runs', async () => {
    const f = fake({ routes: poll([detail('thread.json')], [needsYouFor(ID, '008')]) });
    expect(await f.run('new', 'fix the cart', '--wait', '--json')).toBe(2);
    const printed = JSON.parse(f.out());
    expect(printed).toMatchObject({ id: ID, outcome: 'needs-you', status: 'running', needs_you: [{ kind: 'question', detail: 'Which store should the digest cover first?' }] });
  });

  it('exits 2 for a usage limit, which leaves the thread stopped', async () => {
    const limited = detail('thread-limited.json', { id: ID });
    const f = fake({ routes: poll([limited], [needsYouFor(ID, '019')]) });
    expect(await f.run('new', 'x', '--wait')).toBe(2);
    expect(f.err()).toContain('needs you: usage limit');
  });

  it('keeps waiting for a thread sent to another machine, which reads stopped here until it runs there', async () => {
    const created = { ...wire('thread-created.json'), status: 'stopped' };
    const away = detail('thread.json', { id: ID, status: 'stopped' }, { events: [] });
    const done = detail('thread-open.json', { id: ID });
    const f = fake({
      routes: [
        { method: 'POST', path: '/api/threads', reply: { json: created } },
        { method: 'GET', path: `/api/threads/${ID}?history=recent`, reply: [{ json: away }, { json: away }, { json: done }] },
        { method: 'GET', path: `/api/needs-you?thread=${ID}`, reply: { json: needsYouFor(ID, null) } },
      ],
    });
    expect(await f.run('new', 'x', '--wait')).toBe(0);
    expect(f.slept.length).toBe(2);
  });

  it('rides out a server restart while it waits', async () => {
    const done = detail('thread-open.json', { id: ID });
    const f = fake({
      routes: [
        create,
        { method: 'GET', path: `/api/threads/${ID}?history=recent`, reply: [{ refused: true }, { refused: true }, { json: done }] },
        { method: 'GET', path: `/api/needs-you?thread=${ID}`, reply: { json: needsYouFor(ID, null) } },
      ],
    });
    expect(await f.run('new', 'x', '--wait')).toBe(0);
  });
});
