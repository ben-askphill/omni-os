import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { startRunner } from './runner-boot.ts';

// Threads reach Notion through the "Omni" connection's token and the REST helper beside the charters, never the
// OAuth-only Notion MCP plugin (docs/user/notion.md).
const r = await startRunner();
const { buildSystemPrompt, notionHelper, NOTION_TOKEN_SECRET } = await import('../runner/prompts.ts');
const { getCrew } = await import('../crew.ts');
// Plain JavaScript beside the charters, so it ships and runs without a build: no types to import.
const helper: any = await import(pathToFileURL(notionHelper()).href);

const SECTION = '## Notion';
const TOKEN = 'ntn_test_value_never_printed';

describe('the Notion section of the system prompt', () => {
  it('is there for a local working thread whose environment has the token, naming the shipped helper', async () => {
    const t = await r.start('THINK:1', { role: 'builder' });
    await r.untilResults(t.id, 1);
    const thread = r.thread(t.id);
    const channel = r.db.channels.get('scratch')!;
    const prompt = buildSystemPrompt(thread, channel, getCrew('builder'), false, ['OTHER', NOTION_TOKEN_SECRET]);
    expect(prompt).toContain(SECTION);
    expect(prompt).toContain(`node ${notionHelper()}`);
    expect(prompt).toContain('Notion-Version: 2022-06-28');
    expect(prompt).toContain('object_not_found');
    expect(existsSync(notionHelper())).toBe(true);
    // No token in the thread's environment, a delegate-only Conductor, or a harness on another server: no section.
    expect(buildSystemPrompt(thread, channel, getCrew('builder'), false, ['OTHER'])).not.toContain(SECTION);
    expect(buildSystemPrompt(thread, channel, getCrew('conductor'), false, [NOTION_TOKEN_SECRET])).not.toContain(SECTION);
    expect(buildSystemPrompt({ ...thread, harness: 'hermes' }, channel, undefined, false, [NOTION_TOKEN_SECRET])).not.toContain(SECTION);
  });
});

/** A fake api.notion.com: routes keyed by "METHOD path", each a JSON body or a [status, body] pair. */
function fakeNotion(routes: Record<string, unknown>) {
  const calls: { method: string; path: string; headers: Record<string, string>; body?: any }[] = [];
  const fetchImpl = async (url: string, init: any) => {
    const u = new URL(url);
    const key = `${init.method} ${u.pathname}${u.search}`;
    calls.push({ method: init.method, path: `${u.pathname}${u.search}`, headers: init.headers, body: init.body && JSON.parse(init.body) });
    const hit = routes[key] ?? routes[`${init.method} ${u.pathname}`];
    const [status, body] = Array.isArray(hit) && typeof hit[0] === 'number' ? hit : hit ? [200, hit] : [404, { object: 'error', code: 'object_not_found', message: 'Could not find' }];
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

const rt = (s: string, extra: object = {}) => [{ plain_text: s, href: null, annotations: {}, ...extra }];
const PAGE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const DB = '11111111-2222-3333-4444-555555555555';

describe('crew/tools/notion.mjs', () => {
  it('takes an id from a bare id or any Notion URL, dashed', () => {
    const id = '0123456789abcdef0123456789abcdef';
    const dashed = '01234567-89ab-cdef-0123-456789abcdef';
    expect(helper.notionId(id)).toBe(dashed);
    expect(helper.notionId(dashed)).toBe(dashed);
    expect(helper.notionId(`https://www.notion.so/askphill/Plan-${id}`)).toBe(dashed);
    expect(helper.notionId(`https://app.notion.com/p/${id}?v=ffffffffffffffffffffffffffffffff`)).toBe(dashed);
    // A slug word that looks like hex does not shift the id.
    expect(helper.notionId(`https://www.notion.so/Cafe-deadbeef-${id}`)).toBe(dashed);
    expect(helper.notionId('not an id')).toBeNull();
  });

  it('reads a page as Markdown, with its properties and nested blocks across pages of results', async () => {
    const { calls, fetchImpl } = fakeNotion({
      [`GET /v1/pages/${PAGE}`]: { object: 'page', id: PAGE, url: 'https://www.notion.so/x', properties: { Name: { type: 'title', title: rt('Kickoff') }, Status: { type: 'status', status: { name: 'Done' } }, Empty: { type: 'rich_text', rich_text: [] } } },
      [`GET /v1/blocks/${PAGE}/children?page_size=100`]: {
        results: [
          { id: 'b1', type: 'heading_2', heading_2: { rich_text: rt('Agenda') } },
          { id: 'b2', type: 'numbered_list_item', has_children: true, numbered_list_item: { rich_text: rt('Scope') } },
          { id: 'b3', type: 'numbered_list_item', numbered_list_item: { rich_text: rt('Timeline') } },
        ],
        has_more: true,
        next_cursor: 'c2',
      },
      [`GET /v1/blocks/${PAGE}/children?page_size=100&start_cursor=c2`]: {
        results: [
          { id: 'b4', type: 'to_do', to_do: { checked: true, rich_text: rt('Send deck') } },
          { id: 'b5', type: 'child_page', has_children: true, child_page: { title: 'Notes' } },
        ],
        has_more: false,
      },
      'GET /v1/blocks/b2/children?page_size=100': { results: [{ id: 'b6', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt('docs', { href: 'https://d.example' }) } }], has_more: false },
    });
    const out = await helper.run(['read', `https://www.notion.so/Kickoff-${PAGE.replace(/-/g, '')}`], { OMNI_NOTION_TOKEN: TOKEN }, fetchImpl);
    expect(out).toBe(
      ['# Kickoff', 'https://www.notion.so/x', '', '- Status: Done', '', '## Agenda', '1. Scope', '  - [docs](https://d.example)', '2. Timeline', '- [x] Send deck', `[page: Notes] (id b5)`].join('\n'),
    );
    // Every call carries the token and the pinned version; a child page is listed, not read.
    expect(calls.every((c) => c.headers.Authorization === `Bearer ${TOKEN}` && c.headers['Notion-Version'] === helper.NOTION_VERSION)).toBe(true);
    expect(calls.some((c) => c.path.startsWith('/v1/blocks/b5'))).toBe(false);
    expect(out).not.toContain(TOKEN);
  });

  it('reads a database id as its rows', async () => {
    const { fetchImpl } = fakeNotion({
      [`GET /v1/databases/${DB}`]: { object: 'database', id: DB, url: 'https://www.notion.so/db', title: rt('Tasks') },
      [`POST /v1/databases/${DB}/query`]: { results: [{ id: 'r1', properties: { Name: { type: 'title', title: rt('Ship it') }, Tags: { type: 'multi_select', multi_select: [{ name: 'a' }, { name: 'b' }] } } }], has_more: false },
    });
    expect(await helper.run(['read', DB], { OMNI_NOTION_TOKEN: TOKEN }, fetchImpl)).toBe(['# Tasks', 'https://www.notion.so/db', '', '- Ship it · Tags: a, b (id r1)'].join('\n'));
  });

  it('names the bot, searches, and explains a page that is not shared', async () => {
    const { calls, fetchImpl } = fakeNotion({
      'GET /v1/users/me': { object: 'user', id: 'u1', name: 'Omni', type: 'bot', bot: { workspace_name: 'Ask Phill' } },
      'POST /v1/search': { results: [{ object: 'page', id: PAGE, url: 'https://www.notion.so/p', last_edited_time: '2026-11-17T10:00:00.000Z', properties: { title: { type: 'title', title: rt('Roadmap') } } }], has_more: false },
    });
    const env = { OMNI_NOTION_TOKEN: TOKEN };
    expect(await helper.run(['me'], env, fetchImpl)).toBe('Omni (bot, id u1), workspace Ask Phill');
    expect(await helper.run(['search', 'road', 'map', '--type', 'page'], env, fetchImpl)).toBe(`page\t${PAGE}\tRoadmap\t2026-11-17\thttps://www.notion.so/p`);
    expect(calls.at(-1)!.body).toMatchObject({ query: 'road map', filter: { property: 'object', value: 'page' }, page_size: 50 });

    const err = await helper.run(['api', 'GET', '/v1/pages/missing'], env, fetchImpl).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(helper.NotionError);
    expect(helper.explain(err)).toContain('not shared with the Omni connection');
    await expect(helper.run(['me'], {}, fetchImpl)).rejects.toThrow('OMNI_NOTION_TOKEN is not set');
  });

  it('turns Markdown into blocks: lists nest by indent, code stays raw, tables keep their rows', () => {
    const blocks = helper.markdownToBlocks(
      ['# Title', '', 'Hi **there**, see [docs](https://d.example)', 'second line', '', '- a', '  - b', '- [x] done', '1. one', '> quote', '---', '```ts', 'const x = **1**', '```', '| h1 | h2 |', '|---|---|', '| 1 | 2 |'].join('\n'),
    );
    expect(blocks.map((b: any) => b.type)).toEqual(['heading_1', 'paragraph', 'bulleted_list_item', 'to_do', 'numbered_list_item', 'quote', 'divider', 'code', 'table']);
    const [, para, list, todo, , , , code, table] = blocks as any[];
    expect(para.paragraph.rich_text).toEqual([
      { type: 'text', text: { content: 'Hi ' } },
      { type: 'text', text: { content: 'there' }, annotations: { bold: true } },
      { type: 'text', text: { content: ', see ' } },
      { type: 'text', text: { content: 'docs', link: { url: 'https://d.example' } } },
      { type: 'text', text: { content: '\nsecond line' } },
    ]);
    expect(list.bulleted_list_item.children[0].bulleted_list_item.rich_text[0].text.content).toBe('b');
    expect(todo.to_do.checked).toBe(true);
    expect(code.code).toEqual({ language: 'typescript', rich_text: [{ type: 'text', text: { content: 'const x = **1**' } }] });
    expect(table.table.table_width).toBe(2);
    expect(table.table.children).toHaveLength(2);
    // Notion caps one text object at 2000 characters.
    expect(helper.inline('x'.repeat(4500)).map((t: any) => t.text.content.length)).toEqual([2000, 2000, 500]);
  });

  it("creates a page under a database with that database's title property, in requests of 100 blocks", async () => {
    const { calls, fetchImpl } = fakeNotion({
      [`GET /v1/databases/${DB}`]: { object: 'database', id: DB, properties: { Task: { type: 'title', title: {} }, Status: { type: 'status', status: {} } } },
      'POST /v1/pages': { object: 'page', id: PAGE, url: 'https://www.notion.so/new' },
      [`PATCH /v1/blocks/${PAGE}/children`]: { results: [] },
    });
    const md = Array.from({ length: 150 }, (_, i) => `- item ${i}`).join('\n');
    const out = await helper.run(['create', DB, 'Call Ben', md, '--props', '{"Status":{"status":{"name":"To do"}}}'], { OMNI_NOTION_TOKEN: TOKEN }, fetchImpl);
    expect(out).toBe(`Created https://www.notion.so/new (id ${PAGE})`);
    const create = calls.find((c) => c.method === 'POST')!.body;
    expect(create.parent).toEqual({ database_id: DB });
    expect(create.properties).toEqual({ Status: { status: { name: 'To do' } }, Task: { title: [{ type: 'text', text: { content: 'Call Ben' } }] } });
    expect(create.children).toHaveLength(100);
    expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body.children.length)).toEqual([50]);

    // Under a page, the title property is always "title".
    const page = fakeNotion({ 'POST /v1/pages': { object: 'page', id: PAGE, url: 'https://www.notion.so/sub' } });
    await helper.run(['create', PAGE, 'Notes'], { OMNI_NOTION_TOKEN: TOKEN }, page.fetchImpl);
    expect(page.calls.at(-1)!.body).toMatchObject({ parent: { page_id: PAGE }, properties: { title: { title: [{ text: { content: 'Notes' } }] } }, children: [] });
  });

  it('sends the token only to https://api.notion.com/v1/, refusing other hosts, http and paths outside the API', async () => {
    const { calls, fetchImpl } = fakeNotion({ 'GET /v1/users/me': { object: 'user', id: 'u1', name: 'Omni', type: 'bot' } });
    const env = { OMNI_NOTION_TOKEN: TOKEN };
    for (const path of [
      'https://foreign.invalid/collect',
      'http://api.notion.com/v1/users/me',
      'https://api.notion.com/v2/users/me',
      'https://api.notion.com/oauth/token',
      'https://user:pw@api.notion.com/v1/users/me',
      'https://api.notion.com.foreign.invalid/v1/users/me',
      '/v1/../oauth/token',
      'file:///etc/passwd',
    ]) {
      await expect(helper.run(['api', 'GET', path], env, fetchImpl), path).rejects.toThrow(/Refused|Not a Notion API path/);
    }
    expect(calls).toHaveLength(0);
    // Relative paths, with or without /v1, and the full API URL all land under it.
    expect(helper.notionUrl('/users/me')).toBe('https://api.notion.com/v1/users/me');
    expect(helper.notionUrl('users/me')).toBe('https://api.notion.com/v1/users/me');
    expect(helper.notionUrl('//foreign.invalid/x')).toBe('https://api.notion.com/v1//foreign.invalid/x');
    expect(helper.notionUrl('https://api.notion.com/v1/users/me')).toBe('https://api.notion.com/v1/users/me');
    await helper.run(['api', 'GET', 'https://api.notion.com/v1/users/me'], env, fetchImpl);
    expect(calls.map((c) => c.path)).toEqual(['/v1/users/me']);
  });

  it('follows no redirect and retries no write on a server error', async () => {
    const seen: { url: string; init: any }[] = [];
    const reply = (status: number, headers: Record<string, string> = {}) =>
      (async (url: string, init: any) => {
        seen.push({ url, init });
        return new Response(status >= 300 && status < 400 ? null : JSON.stringify({ object: 'error', code: 'internal_server_error', message: 'boom' }), { status, headers });
      }) as unknown as typeof fetch;
    const env = { OMNI_NOTION_TOKEN: TOKEN };
    await expect(helper.run(['api', 'GET', '/users/me'], env, reply(302, { location: 'https://foreign.invalid/' }))).rejects.toThrow('redirect');
    expect(seen.map((s) => [s.url, s.init.redirect])).toEqual([['https://api.notion.com/v1/users/me', 'manual']]);

    seen.length = 0;
    const err = await helper.run(['api', 'POST', '/pages', '{}'], env, reply(500)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(helper.NotionError);
    expect(seen).toHaveLength(1);
  });

  /** A fake that answers each call in turn from `answers` ([status, body, headers?]), recording the requests. */
  function sequence(answers: [number, unknown, Record<string, string>?][]) {
    const calls: { method: string; path: string; body?: any }[] = [];
    const fetchImpl = (async (url: string, init: any) => {
      const u = new URL(url);
      calls.push({ method: init.method, path: `${u.pathname}${u.search}`, body: init.body && JSON.parse(init.body) });
      const next = answers.shift();
      if (!next) throw new Error(`unexpected ${init.method} ${url}`);
      if (next[0] === 0) throw new TypeError('fetch failed');
      return new Response(JSON.stringify(next[1]), { status: next[0], headers: next[2] });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }
  const env = { OMNI_NOTION_TOKEN: TOKEN };

  it('never repeats a write that may have landed, and says so', async () => {
    // A 503 that names what it committed.
    const committed = sequence([
      [404, { object: 'error', code: 'object_not_found', message: 'not a database' }],
      [503, { object: 'error', code: 'service_unavailable', message: 'Do not repeat the write', committed_resource_id: 'p-9' }],
    ]);
    let err = await helper.run(['create', PAGE, 'Notes', 'hello'], env, committed.fetchImpl).catch((e: unknown) => e);
    expect(committed.calls.map((c) => c.method)).toEqual(['GET', 'POST']);
    expect(helper.explain(err)).toContain('committed anyway as p-9. Do not repeat it.');

    // A 503 halfway through an append: one try, and the message says how far it got and that the outcome is unknown.
    const md = Array.from({ length: 150 }, (_, i) => `- item ${i}`).join('\n');
    const half = sequence([
      [200, { results: Array.from({ length: 100 }, (_, i) => ({ id: `n${i}` })) }],
      [503, { object: 'error', code: 'service_unavailable', message: 'busy' }],
    ]);
    err = await helper.run(['append', PAGE, md], env, half.fetchImpl).catch((e: unknown) => e);
    expect(half.calls.map((c) => c.body.children.length)).toEqual([100, 50]);
    expect((err as any).unknown).toBe(true);
    expect(helper.explain(err)).toMatch(/may or may not have landed, so it was not retried.*100 of 150 top-level blocks were appended/);

    // No answer at all on a write is unknown too, and not retried.
    const silent = sequence([[0, null]]);
    err = await helper.run(['append', PAGE, 'x'], env, silent.fetchImpl).catch((e: unknown) => e);
    expect(silent.calls).toHaveLength(1);
    expect(helper.explain(err)).toContain('gave no answer');

    // A 429 means Notion did not run it: the write is retried after Retry-After.
    const limited = sequence([
      [429, { object: 'error', code: 'rate_limited', message: 'slow down' }, { 'retry-after': '0' }],
      [200, { results: [{ id: 'n0' }] }],
    ]);
    expect(await helper.run(['append', PAGE, 'x'], env, limited.fetchImpl)).toBe(`Appended 1 block to ${PAGE}`);
    expect(limited.calls.map((c) => c.method)).toEqual(['PATCH', 'PATCH']);
  });

  it('cuts any children array at 100 and appends the rest to the block it belongs to', async () => {
    // A header and 120 data rows: the table goes out with 100 rows, then 21 more are appended to it.
    const table = ['| h1 | h2 |', '|---|---|', ...Array.from({ length: 120 }, (_, i) => `| r${i} | v${i} |`)].join('\n');
    const created = sequence([
      [404, { object: 'error', code: 'object_not_found', message: 'not a database' }],
      [200, { object: 'page', id: PAGE, url: 'https://www.notion.so/new' }],
      [200, { results: [{ id: 'tbl' }], has_more: false }],
      [200, { results: Array.from({ length: 21 }, (_, i) => ({ id: `row${i}` })) }],
    ]);
    expect(await helper.run(['create', PAGE, 'Big table', table], env, created.fetchImpl)).toBe(`Created https://www.notion.so/new (id ${PAGE})`);
    const [, post, list, rest] = created.calls;
    expect(post.body.children[0].table.children).toHaveLength(100);
    expect(list.path).toBe(`/v1/blocks/${PAGE}/children?page_size=100`);
    expect(rest.method).toBe('PATCH');
    expect(rest.path).toBe('/v1/blocks/tbl/children');
    expect(rest.body.children).toHaveLength(21);
    expect(rest.body.children[20].table_row.cells[0][0].text.content).toBe('r119');

    // A list item with 101 nested items, appended: 100 go with it, the last one follows under the item's new id.
    const list101 = ['- parent', ...Array.from({ length: 101 }, (_, i) => `  - child ${i}`)].join('\n');
    const appended = sequence([
      [200, { results: [{ id: 'item' }] }],
      [200, { results: [{ id: 'c100' }] }],
    ]);
    await helper.run(['append', PAGE, list101], env, appended.fetchImpl);
    expect(appended.calls[0].body.children[0].bulleted_list_item.children).toHaveLength(100);
    expect(appended.calls[1].path).toBe('/v1/blocks/item/children');
    expect(appended.calls[1].body.children.map((b: any) => b.bulleted_list_item.rich_text[0].text.content)).toEqual(['child 100']);

    // trimBlock keeps two levels of nesting in one request; deeper children wait for their parent's id.
    const deep = { type: 'toggle', toggle: { children: [{ type: 'toggle', toggle: { children: [{ type: 'toggle', toggle: { children: [{ type: 'paragraph', paragraph: {} }] } }] } }] } };
    const { block, overflow } = helper.trimBlock(deep);
    expect(block.toggle.children[0].toggle.children[0].toggle.children).toBeUndefined();
    expect(overflow).toEqual([{ path: [0, 0], rest: [{ type: 'paragraph', paragraph: {} }] }]);
  });

  it('renders the property and block types it knows, and a placeholder for the rest', () => {
    expect(helper.propValue({ type: 'date', date: { start: '2026-01-01', end: '2026-01-02' } })).toBe('2026-01-01 to 2026-01-02');
    expect(helper.propValue({ type: 'formula', formula: { type: 'number', number: 3 } })).toBe('3');
    expect(helper.propValue({ type: 'unique_id', unique_id: { prefix: 'T', number: 7 } })).toBe('T-7');
    expect(helper.propValue({ type: 'checkbox', checkbox: false })).toBe('no');
    const table = { id: 't', type: 'table', table: {}, children: [{ type: 'table_row', table_row: { cells: [rt('a'), rt('b')] } }, { type: 'table_row', table_row: { cells: [rt('1'), rt('2|3')] } }] };
    expect(helper.blocksToMarkdown([table as any])).toBe('| a | b |\n| --- | --- |\n| 1 | 2\\|3 |');
    expect(helper.blocksToMarkdown([{ type: 'code', code: { language: 'js', rich_text: rt('x()') } } as any])).toBe('```js\nx()\n```');
    expect(helper.blocksToMarkdown([{ type: 'ai_block', ai_block: {} } as any])).toBe('[ai_block]');
  });
});
