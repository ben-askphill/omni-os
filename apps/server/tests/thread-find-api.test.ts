import { describe, expect, it } from 'vitest';
import { FIND_MAX_QUERY } from '@omni/shared/thread-find.ts';
import { longThread, LONG_THREAD } from '@omni/test-fixtures/long-thread.ts';
import { startRunner } from './runner-boot.ts';

// GET /api/threads/:id/find (thread-history-api.ts, db/repos/find.ts): the find bar's matches over every stored row,
// whatever page a client holds, with and without the LIKE narrowing.

const r = await startRunner();
const { app } = await import('../app.ts');

const thread = (id: string) =>
  r.db.threads.create({
    id, channel_id: 'scratch', title: `Thread ${id}`, status: 'done', role: null, model: null, session_id: id, cwd: r.tmp,
    branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
  });
const find = async (id: string, q: string) => {
  const res = await app.request(`/api/threads/${id}/find?q=${encodeURIComponent(q)}`);
  return { status: res.status, body: (await res.json()) as any };
};

thread('a');
const add = (kind: string, payload: unknown) => r.db.events.add('a', kind, payload).id;
const ask = add('user', { text: 'Where is the Albatross? albatross!', source: 'ben' });
add('status', { text: 'albatross' });
const use = add('tool_use', { id: 'c1', name: 'Bash', input: { command: 'grep -r albatross logs/', description: 'Search' } });
// Far over the row budget: a client holds only its compact preview, the find reads it whole.
const out = add('tool_result', { tool_use_id: 'c1', text: `${'x'.repeat(100_000)} ALBATROSS at the end`, is_error: false, truncated: false });
const said = add('assistant_text', { text: 'Found it: "Ärger" and C:\\logs\\bird.txt' });
add('result', { ok: true });
thread('b');
r.db.events.add('b', 'user', { text: 'another albatross', source: 'ben' });

describe('GET /api/threads/:id/find', () => {
  it('lists every event with matches and its count, case-insensitive', async () => {
    const { status, body } = await find('a', 'albatross');
    expect(status).toBe(200);
    expect(body).toEqual({
      hits: [
        { event: ask, count: 2 },
        { event: use, count: 1 },
        { event: out, count: 1 },
      ],
      total: 4,
      capped: false,
    });
  });

  it('matches what LIKE cannot narrow: quotes, backslashes, letters outside ASCII', async () => {
    for (const q of ['"ärger"', 'ÄRGER', 'c:\\logs\\']) expect((await find('a', q)).body.hits, q).toEqual([{ event: said, count: 1 }]);
  });

  it('finds the oldest message of a long thread', async () => {
    thread('long');
    for (const e of longThread({ turns: 30, hugeResult: 10_000, hugeWrite: 10_000 })) r.db.events.add('long', e.kind, e.payload);
    const { body } = await find('long', LONG_THREAD.oldNeedle.toUpperCase());
    expect(body.total).toBe(1);
    const first = r.db.events.since('long')[0].id;
    expect(body.hits[0].event - first).toBeLessThan(200);
  });

  it('answers nothing for a blank query, and refuses an unknown thread or a long query', async () => {
    expect((await find('a', '  ')).body).toEqual({ hits: [], total: 0, capped: false });
    expect((await find('nope', 'x')).status).toBe(404);
    expect((await find('a', 'x'.repeat(FIND_MAX_QUERY + 1))).status).toBe(400);
  });
});
