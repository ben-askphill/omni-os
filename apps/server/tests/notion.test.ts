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
