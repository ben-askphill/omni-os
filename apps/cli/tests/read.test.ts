import { describe, expect, it } from 'vitest';
import { detail, fake, needsYouFor, wire } from './helpers.ts';

const ID = '00000000-0000-4000-8000-000000000001';

describe('omni threads', () => {
  it('lists the latest threads in a table', async () => {
    const f = fake({ routes: [{ method: 'GET', path: '/api/threads?limit=20', reply: { json: wire('threads.json') } }] });
    expect(await f.run('threads')).toBe(0);
    expect(f.out()).toBe('ID        STATUS  CHANNEL  UPDATED  TITLE\n00000000  done    #acme    5m ago   Fix the cart and the tests\n');
  });

  it('filters by channel, running and count, and prints JSON', async () => {
    const f = fake({ routes: [{ method: 'GET', path: '/api/threads?channel=acme&status=running&limit=5', reply: { json: [] } }] });
    expect(await f.run('threads', '-c', 'acme', '--running', '-n', '5')).toBe(0);
    expect(f.out()).toBe('Nothing is running.\n');
    const g = fake({ routes: [{ method: 'GET', path: '/api/threads?limit=20', reply: { json: wire('threads.json') } }] });
    expect(await g.run('threads', '--json')).toBe(0);
    expect(JSON.parse(g.out())[0].id).toBe(ID);
    expect(await g.run('threads', '-n', '0')).toBe(64);
  });

  it('lists what needs you, with why', async () => {
    const f = fake({ routes: [{ method: 'GET', path: '/api/needs-you', reply: { json: wire('needs-you.json') } }] });
    expect(await f.run('threads', '--needs-you')).toBe(0);
    const lines = f.out().trim().split('\n');
    expect(lines[0]).toMatch(/^ID\s+WHY\s+CHANNEL\s+WHEN\s+TITLE$/);
    expect(lines).toHaveLength(8);
    expect(f.out()).toContain('question');
    expect(f.out()).toContain('usage limit');
    expect(f.out()).toContain('setup failed, messages to resume');
    expect(f.out()).toContain('failed, unread');
  });
});

describe('omni show', () => {
  it("prints the thread's state, what waits on you and its latest reply", async () => {
    const d = detail('thread-open.json', { id: ID });
    const f = fake({
      routes: [
        { method: 'GET', path: `/api/threads/${ID}?history=recent`, reply: { json: d } },
        { method: 'GET', path: `/api/needs-you?thread=${ID}`, reply: { json: needsYouFor(ID, '008') } },
      ],
    });
    expect(await f.run('show', ID)).toBe(0);
    const out = f.out();
    expect(out.split('\n')[0]).toBe(d.thread.title);
    expect(out).toMatch(/^status\s+done, updated 5m ago$/m);
    expect(out).toMatch(/^channel\s+#acme$/m);
    expect(out).toMatch(/^needs you\s+question: Which store should the digest cover first\?$/m);
    expect(out).toMatch(new RegExp(`^url\\s+http://127.0.0.1:4747/#/t/${ID}$`, 'm'));
    expect(out.trimEnd().endsWith('\n\nack: and the tax')).toBe(true);
  });

  it('fetches a reply the history page clipped', async () => {
    const d = detail('thread-open.json', { id: ID });
    d.events = d.events.map((e: { kind: string }) => (e.kind === 'assistant_text' ? { ...e, payload: '{"text":"ack: and the t"}', clipped: { bytes: 99999 } } : e));
    const f = fake({
      routes: [
        { method: 'GET', path: `/api/threads/${ID}?history=recent`, reply: { json: d } },
        { method: 'GET', path: `/api/needs-you?thread=${ID}`, reply: { json: needsYouFor(ID, null) } },
        { method: 'GET', path: `/api/threads/${ID}/events/155`, reply: { json: wire('thread-event.json') } },
      ],
    });
    expect(await f.run('show', ID, '--json')).toBe(0);
    expect(JSON.parse(f.out()).reply).toBe(JSON.parse(wire('thread-event.json').payload).text);
  });

  it('says when a short id matches several threads', async () => {
    const two = [...wire('threads.json'), { ...wire('threads.json')[0], id: '00000000-0000-4000-8000-000000000999' }];
    const f = fake({ routes: [{ method: 'GET', path: '/api/threads?limit=500', reply: { json: two } }] });
    expect(await f.run('show', '00000000')).toBe(3);
    expect(f.err()).toContain('matches 2 threads');
  });

  it('says when the thread does not exist', async () => {
    const f = fake({ routes: [{ method: 'GET', path: /^\/api\//, reply: { status: 404, json: wire('error-not-found.json') } }] });
    expect(await f.run('show', ID)).toBe(3);
    expect(f.err()).toContain('has nothing by that id');
  });
});
