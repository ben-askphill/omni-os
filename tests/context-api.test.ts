import { beforeAll, describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX } from './support.ts';

// The context meter's API: GET /threads/:id/context with the harness's own reading, and POST
// /threads/:id/compact sending the harness's /compact. The fake CLIs report a context that grows each
// call and shrinks on /compact (see CTX: in fake-claude.mjs).

let H: Awaited<ReturnType<typeof startRunner>>;
let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
let ctx: typeof import('../server/context.ts');

beforeAll(async () => {
  H = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX });
  ({ app } = await import('../server/app.ts'));
  ctx = await import('../server/context.ts');
  const svc = await import('../server/harness/catalog-service.ts');
  await svc.loadCatalog();
});

const get = async (id: string, refresh = false) => {
  const res = await app.request(`/api/threads/${id}/context${refresh ? '?refresh=1' : ''}`);
  return { status: res.status, body: (await res.json()) as any };
};
const compact = async (id: string, body: unknown = {}) => {
  const res = await app.request(`/api/threads/${id}/compact`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};
/** Poll an API answer until it passes; waitFor in support.ts takes only sync checks. */
const poll = async <T>(label: string, fn: () => Promise<T | false | undefined | null>, timeout = 8000): Promise<T> => {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
};
const userTexts = (id: string) => H.byKind(id, 'user').map((e) => e.p.text as string);

describe('Claude Code', () => {
  it('reports the CLI split after a turn, and compacts with a focus once idle', async () => {
    const t = await H.start('CTX:120000 TOOL:10 hello');
    await H.untilResults(t.id, 1);
    // Three model calls at 1.5K each on top of 120K; the CLI's answer follows the result.
    const first = await poll('a claude-cli reading', async () => {
      const r = await get(t.id);
      return r.body.context?.source === 'claude-cli' && r.body.context.used === 124_500 && r;
    });
    expect(first.body.context).toMatchObject({ max: 200_000, autoCompactAt: 167_000, model: expect.any(String) });
    expect(first.body.context.modelWindow).toBeUndefined();
    // The deferred MCP tools are not in the window.
    expect(first.body.context.categories.map((c: { name: string }) => c.name)).toEqual([
      'System prompt',
      'System tools',
      'Messages',
      'Autocompact buffer',
      'Free space',
    ]);
    expect(first.body.context.tools).toEqual([expect.objectContaining({ name: 'Bash' })]);
    expect(first.body.compact).toEqual({ ok: true, focus: true });

    // While a turn runs, compacting waits.
    H.runner.sendMessage(t.id, 'TOOL:1500 keep going');
    await H.untilStatus(t.id, 'running');
    const busy = await get(t.id);
    expect(busy.body.compact).toEqual({ ok: false, reason: 'Wait for the current turn to finish.', focus: true });
    expect(await compact(t.id)).toMatchObject({ status: 409, body: { error: 'Wait for the current turn to finish.' } });
    await H.untilResults(t.id, 2);

    expect((await compact(t.id, { focus: '  the  failing\ntest ' })).status).toBe(200);
    await H.untilResults(t.id, 3);
    expect(userTexts(t.id)).toContain('/compact the failing test');
    const after = await poll('the reading after /compact', async () => {
      const r = await get(t.id, true);
      return r.body.context?.used === 8000 && r;
    });
    expect(after.body.context.source).toBe('claude-cli');
  });

  it('remembers the window per model for threads read back without a process', async () => {
    const t = await H.start('hello');
    await H.untilResults(t.id, 1);
    const model = await poll('a reading with a model', async () => (await get(t.id)).body.context?.model);
    expect(ctx.knownWindow(model)).toEqual({ max: 200_000 });
    expect(ctx.knownWindow('never-seen')).toBeNull();
    expect(ctx.knownWindow(null)).toBeNull();
  });

  it('answers 404 for a missing thread', async () => {
    expect((await get('nope')).status).toBe(404);
    expect((await compact('nope')).status).toBe(404);
  });
});

describe('Codex', () => {
  const codex = { harness: 'codex', model: 'gpt-5.6-sol' };

  it('reports the last turn total in the model window, and compacts without a focus', async () => {
    const t = await H.start('hello', codex);
    await H.untilResults(t.id, 1, 12000);
    const first = await poll('a codex reading', async () => {
      const r = await get(t.id);
      return r.body.context?.source === 'codex' && r;
    });
    expect(first.body.context).toMatchObject({ used: 32_000, max: 272_000 });
    expect(first.body.context.categories).toBeUndefined();
    expect(first.body.largest).toEqual([]);
    expect(first.body.compact).toEqual({ ok: true, focus: false });

    expect((await compact(t.id, { focus: 'ignored' })).status).toBe(200);
    expect(userTexts(t.id)).toContain('/compact');
    await poll('the reading after compacting', async () => (await get(t.id)).body.context?.used === 5000);
  });
});

describe('compactBlocked', () => {
  const thread = (over: Record<string, unknown>) => ({ harness: 'claude-code', status: 'done', has_run: 1, ...over }) as any;

  it('names the harness that has no compact command', () => {
    expect(ctx.compactBlocked(thread({ harness: 'cursor' }))).toBe('Cursor Agent has no compact command.');
    expect(ctx.compactBlocked(thread({ harness: 'hermes' }))).toBe('Hermes has no compact command.');
  });
  it('waits for a running or queued turn, and needs a first run', () => {
    expect(ctx.compactBlocked(thread({ status: 'running' }))).toBe('Wait for the current turn to finish.');
    expect(ctx.compactBlocked(thread({ status: 'queued' }))).toBe('Wait for the current turn to finish.');
    expect(ctx.compactBlocked(thread({ has_run: 0 }))).toBe('Nothing to compact yet.');
    expect(ctx.compactBlocked(thread({}))).toBeNull();
    expect(ctx.compactBlocked(thread({ harness: 'codex' }))).toBeNull();
  });
  it('shows no meter for a harness that reports no context', () => {
    expect(ctx.contextView(thread({ id: 'x', harness: 'cursor' }))).toEqual({
      context: null,
      largest: [],
      compact: { ok: false, reason: 'Cursor Agent has no compact command.', focus: false },
    });
  });
});

describe('readTranscript', () => {
  const line = (o: unknown) => JSON.stringify(o);
  const call = (id: string, name: string, input: unknown, usage = { input_tokens: 10, cache_read_input_tokens: 5000 }, extra = {}) =>
    line({ type: 'assistant', message: { model: 'claude-opus-5-5', usage, content: [{ type: 'tool_use', id, name, input }] }, ...extra });
  const result = (id: string, content: unknown, extra = {}) => line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content }] }, ...extra });

  it('reads after the last compaction, ranks tool results by size and labels them', () => {
    const text = [
      call('old', 'Read', { file_path: '/before/compact.ts' }),
      result('old', 'x'.repeat(40_000)),
      line({ type: 'system', subtype: 'compact_boundary' }),
      call('a', 'Read', { file_path: '/repo/big.ts' }),
      result('a', 'y'.repeat(8000)),
      call('b', 'Bash', { command: 'npm   test\n --silent', description: 'Run tests' }),
      result('b', [{ type: 'text', text: 'z'.repeat(400) }, { type: 'image', source: { data: 'q'.repeat(90_000) } }]),
      // A sub-agent's call and result live in its own window.
      call('c', 'Grep', { pattern: 'x' }, { input_tokens: 1, cache_read_input_tokens: 999_999 }, { isSidechain: true }),
      result('c', 'w'.repeat(80_000), { isSidechain: true }),
      call('d', 'Glob', { pattern: '**/*.ts' }, { input_tokens: 20, cache_read_input_tokens: 9000 }),
      result('d', ''),
      // A local command's message has no real usage.
      line({ type: 'assistant', message: { model: '<synthetic>', usage: { input_tokens: 0 }, content: [] } }),
      'not json',
      '',
    ].join('\n');
    expect(ctx.readTranscript(text)).toEqual({
      used: 9020,
      model: 'claude-opus-5-5',
      largest: [
        { tool: 'Read', label: '/repo/big.ts', tokens: 2000 },
        { tool: 'Bash', label: 'npm test --silent', tokens: 100 },
      ],
    });
  });

  it('keeps the top N', () => {
    const text = Array.from({ length: 12 }, (_, i) => [call(`t${i}`, 'Read', { path: `/f${i}` }), result(`t${i}`, 'a'.repeat(4 * (i + 1)))].join('\n')).join('\n');
    const { largest } = ctx.readTranscript(text, 3);
    expect(largest.map((r) => r.label)).toEqual(['/f11', '/f10', '/f9']);
  });

  it('labels a call by its first useful input', () => {
    expect(ctx.toolLabel({ url: 'https://x.dev' })).toBe('https://x.dev');
    expect(ctx.toolLabel({ other: 'first string' })).toBe('first string');
    expect(ctx.toolLabel(null)).toBe('');
    expect(ctx.toolLabel({ command: 'a'.repeat(200) })).toHaveLength(140);
    expect(ctx.toolLabel({ file_path: `/${'d'.repeat(200)}/main.liquid` })).toHaveLength(213);
    expect(ctx.toolLabel({ file_path: `/${'d'.repeat(2000)}/main.liquid` })).toMatch(/^…d{987}\/main\.liquid$/);
  });
});
