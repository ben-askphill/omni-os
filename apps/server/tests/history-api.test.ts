import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// The history routes (apps/server/thread-history-api.ts) and the hooks beside them: GET /api/threads/:id unchanged
// without ?history=recent, the head with it, the 400s and 404s, one whole row, and search hits that name their event.

const r = await startRunner();
const { app } = await import('../app.ts');

const thread = (id: string, title = `Thread ${id}`) =>
  r.db.threads.create({
    id, channel_id: 'scratch', title, status: 'done', role: null, model: null, session_id: id, cwd: r.tmp,
    branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
  });
const call = async (path: string) => {
  const res = await app.request(`/api${path}`);
  return { status: res.status, body: (await res.json()) as any };
};

thread('a', 'Albatross notes');
const add = (kind: string, payload: unknown) => r.db.events.add('a', kind, payload).id;
const first = add('user', { text: 'find the albatross in the logs', source: 'ben' });
add('init', { model: 'sonnet', cwd: '/repo' });
const use = add('tool_use', { id: 'c1', name: 'Read', input: { file_path: '/repo/a.ts' } });
const big = add('tool_result', { tool_use_id: 'c1', text: 'x'.repeat(100_000), is_error: false, truncated: false });
add('assistant_text', { text: 'Found it.' });
const end = add('result', { ok: true });
thread('b');
const other = r.db.events.add('b', 'user', { text: 'the pelican is elsewhere', source: 'ben' }).id;
thread('empty');

describe('GET /api/threads/:id', () => {
  it('sends every event and no history without ?history=recent', async () => {
    const res = await app.request('/api/threads/a');
    const body = JSON.parse(await res.text());
    expect(body.history).toBeUndefined();
    expect(JSON.stringify(body.events)).toBe(JSON.stringify(r.db.events.since('a')));
  });

  it('sends the head and its history with ?history=recent', async () => {
    const { body } = await call('/threads/a?history=recent');
    expect(body.history).toEqual({ from: 0, to: null, results_below: 0 });
    expect(body.events.map((e: any) => e.id)).toEqual([first, first + 1, use, big, big + 1, end]);
    // A tool_result travels compact (#225), not clipped: its preview and its size.
    const compact = body.events.find((e: any) => e.id === big);
    expect(compact.clipped).toBeUndefined();
    expect(JSON.parse(compact.payload)).toMatchObject({ tool_use_id: 'c1', truncated: true, output: { chars: 100_000, lines: 1 } });
    expect(JSON.parse(compact.payload).text).toHaveLength(1024);
    expect(body.thread.id).toBe('a');
  });

  it('opens a thread with no events on an empty head', async () => {
    const { body } = await call('/threads/empty?history=recent');
    expect(body.events).toEqual([]);
    expect(body.history).toEqual({ from: 0, to: null, results_below: 0 });
  });
});

describe('GET /api/threads/:id/history', () => {
  it('pages by cursor', async () => {
    const newest = await call(`/threads/a/history?before=${end}`);
    expect(newest.status).toBe(200);
    expect(newest.body.span).toEqual({ from: 0, to: end });
    expect(newest.body.events.map((e: any) => e.id)).toEqual([first, first + 1, use, big, big + 1]);
    const oldest = await call(`/threads/a/history?take=oldest&after=${use}`);
    expect(oldest.body).toMatchObject({ span: { from: use + 1, to: null } });
    expect(oldest.body.events.map((e: any) => e.id)).toEqual([big, big + 1, end]);
    const at = await call(`/threads/a/history?at=${big}`);
    expect(at.body.span).toEqual({ from: 0, to: null });
    expect((await call('/threads/empty/history')).body).toEqual({ events: [], span: { from: 0, to: null } });
  });

  it('refuses a query that names no cursor', async () => {
    for (const q of ['after=x', 'before=-1', 'take=oldest', 'take=sideways', 'after=9&before=3', `at=${use}&take=oldest`, `at=${use}&after=${big}`, `at=${use}&before=${use}`]) {
      const res = await call(`/threads/a/history?${q}`);
      expect(res.status, q).toBe(400);
      expect(res.body.error, q).toEqual(expect.any(String));
    }
  });

  it('is 404 for an unknown thread, or an event of another thread', async () => {
    expect((await call('/threads/nope/history')).status).toBe(404);
    expect(await call(`/threads/a/history?at=${other}`)).toMatchObject({ status: 404, body: { error: 'event not found' } });
    expect((await call('/threads/a/history?at=999999')).status).toBe(404);
  });
});

describe('GET /api/threads/:id/events/:eventId', () => {
  it('sends the whole row', async () => {
    const { status, body } = await call(`/threads/a/events/${big}`);
    expect(status).toBe(200);
    expect(body).toEqual(r.db.events.since('a').find((e) => e.id === big));
    expect(body.clipped).toBeUndefined();
  });

  it('is 404 for an unknown thread, another thread\'s event, or no id', async () => {
    expect((await call(`/threads/nope/events/${big}`)).status).toBe(404);
    expect((await call(`/threads/a/events/${other}`)).status).toBe(404);
    expect((await call('/threads/a/events/abc')).status).toBe(404);
  });
});

describe('GET /api/search', () => {
  it('names the event of a body hit, and none for a thread only its title matched', async () => {
    const hits = (await call('/search?q=pelican')).body as any[];
    expect(hits).toEqual([expect.objectContaining({ thread_id: 'b', event_id: other })]);
    const both = (await call('/search?q=albatross')).body as any[];
    expect(both).toEqual([expect.objectContaining({ thread_id: 'a', event_id: first, snippet: '' })]);
    const titled = (await call('/search?q=notes')).body as any[];
    expect(titled).toEqual([expect.objectContaining({ thread_id: 'a', event_id: null, snippet: '' })]);
  });
});
