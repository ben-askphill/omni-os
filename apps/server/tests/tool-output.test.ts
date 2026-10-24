import { describe, expect, it } from 'vitest';
import { HISTORY_BUDGET } from '@omni/shared/history.ts';
import { TOOL_OUTPUT, type OutputChunk } from '@omni/shared/tool-output.ts';
import { startRunner } from './runner-boot.ts';

// Compact tool results (#225, apps/server/tool-output.ts): a tool_result longer than the preview travels as its
// preview and its size, from a page, the stream or a replay; the stored row keeps the whole text; and the output route
// reads it back in bounded chunks. Each read is one primary-key read, which the plan test checks.

const r = await startRunner();
const { app } = await import('../app.ts');
const { compactRow, compactStored, readOutput } = await import('../tool-output.ts');
const { TOOL_OUTPUT_SQL } = await import('../db/repos/tool-output.ts');
const { headPage } = await import('../history.ts');

const thread = (id: string) =>
  r.db.threads.create({
    id, channel_id: 'scratch', title: `Thread ${id}`, status: 'done', role: null, model: null, session_id: id, cwd: r.tmp,
    branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
  });
const result = (threadId: string, text: string, extra: object = {}) =>
  r.db.events.add(threadId, 'tool_result', { tool_use_id: 'c1', text, is_error: false, truncated: false, ...extra });
const payload = (row: { payload: string }) => JSON.parse(row.payload) as Record<string, any>;
const get = async <T>(path: string) => {
  const res = await app.request(`/api${path}`);
  return { status: res.status, body: (await res.json()) as T };
};
const P = TOOL_OUTPUT.preview;

thread('t');
thread('other');

describe('compactRow', () => {
  it('leaves a short result, any other kind and a compact row as they are', () => {
    const short = result('t', 'x'.repeat(P));
    expect(compactRow(short)).toBe(short);
    const text = r.db.events.add('t', 'assistant_text', { text: 'y'.repeat(5000) });
    expect(compactRow(text)).toBe(text);
    const long = compactRow(result('t', 'z'.repeat(P + 1)));
    expect(compactRow(long)).toBe(long);
    for (const payload of ['not json', JSON.stringify({ tool_use_id: 'c', text: 5 }), JSON.stringify(null)]) {
      const odd = { id: 1, thread_id: 't', kind: 'tool_result', payload: payload.padEnd(P + 10, ' '), created_at: '' };
      expect(compactRow(odd)).toBe(odd);
    }
  });

  it('keeps the preview, the identity, the flags and the size', () => {
    const text = `Exit code 2\n${'line\n'.repeat(1000)}`;
    const row = compactRow(result('t', text, { is_error: true, dropped: true }));
    const p = payload(row);
    expect(p).toMatchObject({ tool_use_id: 'c1', is_error: true, truncated: true, dropped: true });
    expect(p.text).toBe(text.slice(0, P));
    expect(p.output).toEqual({ chars: text.length, lines: 1002, exit_code: 2 });
    expect(Buffer.byteLength(JSON.stringify(row))).toBeLessThan(P * 2);
  });

  it('cuts by code point, never inside a surrogate pair', () => {
    const row = compactRow(result('t', '😀'.repeat(P + 500)));
    const p = payload(row);
    expect(Array.from(p.text)).toHaveLength(P);
    expect(p.text).toBe('😀'.repeat(P));
    expect(p.output.chars).toBe(P + 500);
  });
});

describe('a result a client reads as data', () => {
  it('always travels whole: a delegation\'s JSON, a published page\'s URL', async () => {
    thread('data');
    const big = JSON.stringify({ lead: { thread_id: 'x', title: 'y'.repeat(4000) }, members: [] });
    for (const [name, id] of [['mcp__omni__delegate_team', 'd1'], ['Artifact', 'a1'], ['Bash', 'b1']] as const) {
      r.db.events.add('data', 'tool_use', { id, name, input: {}, parent: null });
      const row = r.db.events.add('data', 'tool_result', { tool_use_id: id, text: big, is_error: false, truncated: false });
      expect(compactRow(row) === row, name).toBe(name !== 'Bash');
      expect(payload(compactRow(row)).text.length === big.length, name).toBe(name !== 'Bash');
    }
    // Too big for a row too: the page cuts the Bash one by SQLite and leaves the delegation's to the blind clip.
    const huge = JSON.stringify({ text: 'z'.repeat(60_000) });
    r.db.events.add('data', 'tool_use', { id: 'd2', name: 'mcp__omni__delegate', input: {}, parent: null });
    const stored = r.db.events.add('data', 'tool_result', { tool_use_id: 'd2', text: huge, is_error: false, truncated: false });
    expect(compactStored(stored.id)).toBeNull();
    const { events } = headPage('data');
    expect(events.filter((e) => e.kind === 'tool_result').map((e) => payload(e).output?.chars ?? null)).toEqual([null, null, big.length, null]);
  });
});

describe('a stored result too big to load', () => {
  it('is cut by SQLite to the same bytes compactRow makes', () => {
    const text = `Exit code 1\n${'ünï 😀 line\n'.repeat(60_000)}`;
    const row = result('t', text, { dropped: true, truncated: true });
    const stored = compactStored(row.id)!;
    expect(stored).toEqual(compactRow(row));
    expect(payload(stored).output.chars).toBe(Array.from(text).length);
  });

  it('has no compact row when it has no text, or text that fits', () => {
    expect(compactStored(result('t', 'short').id)).toBeNull();
    const noText = r.db.events.add('t', 'tool_result', { tool_use_id: 'c1', is_error: false });
    expect(compactStored(noText.id)).toBeNull();
    expect(compactStored(r.db.events.add('t', 'assistant_text', { text: 'x'.repeat(5000) }).id)).toBeNull();
  });
});

describe('GET /api/threads/:id/events/:eventId/output', () => {
  // Multi-byte text, so a chunk cut by bytes or UTF-16 units would split a character.
  const original = Array.from({ length: 30_000 }, (_, i) => (i % 7 === 0 ? '😀' : i % 5 === 0 ? 'é' : 'x') + (i % 40 === 39 ? '\n' : '')).join('');
  const id = result('t', `Exit code 3\n${original}`, { is_error: true }).id;
  const whole = `Exit code 3\n${original}`;

  it('reads the saved text back in bounded chunks that add up to all of it', async () => {
    let text = '';
    let offset: number | null = 0;
    let n = 0;
    while (offset !== null) {
      const res = await get<OutputChunk>(`/threads/t/events/${id}/output?offset=${offset}&limit=7000`);
      const body: OutputChunk = res.body;
      expect(res.status).toBe(200);
      expect(body.offset).toBe(offset);
      expect(Array.from(body.text).length).toBeLessThanOrEqual(7000);
      expect(body).toMatchObject({ event_id: id, tool_use_id: 'c1', is_error: true, truncated: false, exit_code: 3, total: Array.from(whole).length });
      text += body.text;
      offset = body.next;
      expect(++n, 'chunks').toBeLessThan(20);
    }
    expect(text).toBe(whole);
    expect(n).toBe(Math.ceil(Array.from(whole).length / 7000));
  });

  it('sends TOOL_OUTPUT.chunk code points by default and never more than chunkMax', async () => {
    const big = result('t', 'a'.repeat(200_000)).id;
    const dflt = await get<OutputChunk>(`/threads/t/events/${big}/output`);
    expect(dflt.body.text).toHaveLength(TOOL_OUTPUT.chunk);
    expect(dflt.body.next).toBe(TOOL_OUTPUT.chunk);
    const capped = await get<OutputChunk>(`/threads/t/events/${big}/output?limit=9999999`);
    expect(capped.body.text).toHaveLength(TOOL_OUTPUT.chunkMax);
    const past = await get<OutputChunk>(`/threads/t/events/${big}/output?offset=300000`);
    expect(past.body).toMatchObject({ text: '', next: null, total: 200_000 });
  });

  it('refuses a bad range, and a row that is not this thread\'s tool_result', async () => {
    for (const q of ['offset=-1', 'offset=x', 'limit=0', 'limit=1.5']) expect((await get(`/threads/t/events/${id}/output?${q}`)).status, q).toBe(400);
    expect((await get(`/threads/nope/events/${id}/output`)).status).toBe(404);
    expect((await get(`/threads/other/events/${id}/output`)).status).toBe(404);
    expect((await get(`/threads/t/events/999999/output`)).status).toBe(404);
    expect((await get(`/threads/t/events/abc/output`)).status).toBe(404);
    const text = r.db.events.add('t', 'assistant_text', { text: 'hello' }).id;
    expect((await get(`/threads/t/events/${text}/output`)).status).toBe(404);
  });

  it('serves a short or legacy result the same way, and the whole row stays retrievable', async () => {
    const short = result('t', 'hello\nworld', { truncated: true });
    expect(readOutput('t', short.id, 0)).toMatchObject({ text: 'hello\nworld', next: null, total: 11, truncated: true });
    const row = await get<{ payload: string }>(`/threads/t/events/${id}`);
    expect(JSON.parse(row.body.payload).text).toBe(whole);
  });
});

describe('a page with huge persisted results', () => {
  it('stays inside the page budget, each result compact', () => {
    thread('huge');
    r.db.events.add('huge', 'user', { text: 'run it', source: 'ben' });
    // 6 x 2 MB: every one over rowBytes, so none is read whole by the page.
    for (let i = 0; i < 6; i++) {
      r.db.events.add('huge', 'tool_use', { id: `h${i}`, name: 'Bash', input: { command: `cat big${i}` }, parent: null });
      r.db.events.add('huge', 'tool_result', { tool_use_id: `h${i}`, text: `${i}`.repeat(2_000_000), is_error: false, truncated: false });
    }
    r.db.events.add('huge', 'result', { ok: true });
    const { events } = headPage('huge');
    const bytes = events.reduce((n, e) => n + Buffer.byteLength(JSON.stringify(e)), 0);
    expect(events.filter((e) => e.kind === 'tool_result')).toHaveLength(6);
    expect(bytes).toBeLessThan(HISTORY_BUDGET.bytes);
    for (const e of events.filter((e) => e.kind === 'tool_result')) {
      expect(e.clipped).toBeUndefined();
      expect(Buffer.byteLength(JSON.stringify(e))).toBeLessThan(P * 2);
      expect(payload(e).output.chars).toBe(2_000_000);
    }
  });
});

describe('the reads', () => {
  it('are single primary-key reads', () => {
    for (const [name, sql] of Object.entries(TOOL_OUTPUT_SQL)) {
      const params = Array(sql.split('?').length - 1).fill(1);
      const plan = (r.db.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[]).map((p) => p.detail);
      // `SCAN t` is the one materialized row, not the table.
      expect(plan.filter((d) => /^SCAN events/.test(d)), `${name}: ${plan.join('; ')}`).toEqual([]);
      expect(plan.join('; '), name).toMatch(/SEARCH events USING INTEGER PRIMARY KEY/);
    }
  });
});
